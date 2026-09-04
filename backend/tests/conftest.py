import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://finanzas_user:finanzas_dev_pass@localhost:5432/finanzas_test",
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-use-only-in-ci-suites")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

# Hard lock, not just the fallback above: `setdefault` doesn't protect anything if
# DATABASE_URL is already set from outside (e.g. a `docker compose run`
# inheriting the production .env -- exactly what happened on 15/08/2026 and
# wiped the real DB twice, see postmortem). `apply_migrations` below
# runs `alembic downgrade base` at the end of the session -- it drops the 20 tables
# without asking. If the DB name doesn't contain "test", abort BEFORE
# any fixture gets to touch it, no matter how pytest was invoked.
_db_name = os.environ["DATABASE_URL"].rsplit("/", 1)[-1].split("?", 1)[0]
if "test" not in _db_name:
    raise RuntimeError(
        f"DATABASE_URL apunta a '{_db_name}', que no parece una base de test "
        "(el nombre no contiene 'test'). Este suite corre `alembic downgrade "
        "base` al terminar -- dropea TODAS las tablas. Nunca correrlo con el "
        ".env de produccion (ej. `docker compose -f docker-compose.prod.yml "
        "run backend pytest` hereda ese .env sin querer). Usa una DATABASE_URL "
        "explicita contra `finanzas_test` (ver README 'Setup en una maquina "
        "nueva')."
    )

import pytest
import pytest_asyncio
from alembic.config import Config
from fastapi import Depends
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command
from app.core.config import settings
from app.core.database import get_admin_db, get_db, get_rls_db
from app.core.security import CurrentUser, create_access_token, get_current_user
from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    """Requires the `finanzas_test` database to already exist on the shared native
    Postgres on this machine (see ~/.infra/context/architecture.md); create it once with
    `createdb -h localhost -p 5432 -U finanzas_user finanzas_test`."""
    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    yield
    command.downgrade(cfg, "base")


@pytest_asyncio.fixture(autouse=True)
async def _reset_redis_pool():
    """M09: the Redis pool is a module-level singleton (app/core/redis.py)
    whose connections are bound to the event loop where they were opened. pytest-asyncio
    creates a new loop per test, so reusing connections from a previous test
    blows up with "Event loop is closed" -- the same problem `db_connection`
    already solves for Postgres, but for Redis. Disconnecting the pool at
    the end of each test forces fresh connections on the next test's loop."""
    yield
    from app.core.redis import redis_pool

    await redis_pool.disconnect()


@pytest_asyncio.fixture
async def db_connection():
    """Connection + outer transaction that always rolls back: isolates each test.

    Engine dedicated to this test (NullPool, not sharing the app's global
    engine): asyncpg binds its connections to the event loop where they were
    created, and pytest-asyncio uses a new loop per test, so reusing the
    global engine across tests blows up with "another operation is in progress".

    Each FastAPI dependency also opens its own AsyncSession (via
    savepoint) on this same connection, instead of sharing a single
    mutable Session across sequential requests.
    """
    test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    async with test_engine.connect() as conn:
        outer_tx = await conn.begin()
        yield conn
        await outer_tx.rollback()
    await test_engine.dispose()


@pytest_asyncio.fixture
async def session_factory(db_connection):
    """Session factory bound to the same outer connection/transaction as
    `client`, for tests that need to call services directly (e.g.
    the M06/M07 Celery tasks, which have no HTTP endpoint of their own)."""
    return async_sessionmaker(
        bind=db_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


@pytest_asyncio.fixture
async def client(session_factory):
    async def _override_get_db():
        async with session_factory() as session:
            yield session
            await session.commit()

    async def _override_get_rls_db(current_user: CurrentUser = Depends(get_current_user)):
        async with session_factory() as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(current_user.id)},
            )
            yield session
            await session.commit()

    async def _override_get_admin_db():
        async with session_factory() as session:
            await session.execute(text("SET LOCAL ROLE finanzas_admin"))
            yield session
            # Unlike a real top-level transaction (where SET LOCAL
            # only reverts when it ends), here each request is a savepoint
            # on the same connection/transaction shared across requests of
            # the same test -- without this explicit RESET before releasing the
            # savepoint, the next request (e.g. a normal register/login)
            # would keep running as finanzas_admin and its INSERTs would fail.
            await session.execute(text("RESET ROLE"))
            await session.commit()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_rls_db] = _override_get_rls_db
    app.dependency_overrides[get_admin_db] = _override_get_admin_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@asynccontextmanager
async def rls_session(session_factory, user_id: uuid.UUID):
    """Direct RLS session for tests that call Celery services (M06/M07)
    without going through HTTP: shares the same connection/transaction as `client`,
    so it sees data created via the API in the same test."""
    async with session_factory() as session:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user_id)},
        )
        yield session
        await session.commit()


def auth_headers(user_id: uuid.UUID, role: str = "user") -> dict:
    token = create_access_token(user_id, role)
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def registered_user(client: AsyncClient) -> dict:
    email = f"test-{uuid.uuid4()}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Test User", "password": "supersecret123", "accept_disclaimer": True},
    )
    assert response.status_code == 201
    return response.json()["data"]
