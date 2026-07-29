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
    """Requiere que la base `finanzas_test` ya exista en el Postgres nativo compartido
    de esta maquina (ver ~/.infra/context/architecture.md); crearla una vez con
    `createdb -h localhost -p 5432 -U finanzas_user finanzas_test`."""
    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    yield
    command.downgrade(cfg, "base")


@pytest_asyncio.fixture(autouse=True)
async def _reset_redis_pool():
    """M09: el pool de Redis es un singleton a nivel de modulo (app/core/redis.py)
    cuyas conexiones quedan atadas al event loop donde se abrieron. pytest-asyncio
    crea un loop nuevo por test, asi que reusar conexiones de un test anterior
    revienta con "Event loop is closed" -- mismo problema que ya resuelve
    `db_connection` para Postgres, pero para Redis. Desconectar el pool al
    terminar cada test fuerza conexiones frescas en el loop del siguiente."""
    yield
    from app.core.redis import redis_pool

    await redis_pool.disconnect()


@pytest_asyncio.fixture
async def db_connection():
    """Conexion + transaccion externa que siempre se revierte: aisla cada test.

    Motor dedicado a este test (NullPool, sin compartir el engine global de la
    app): asyncpg ata sus conexiones al event loop donde se crearon, y
    pytest-asyncio usa un loop nuevo por test, asi que reusar el engine
    global entre tests revienta con "another operation is in progress".

    Cada dependencia de FastAPI abre ademas su propia AsyncSession (via
    savepoint) sobre esta misma conexion, en vez de compartir una unica
    Session mutable entre requests secuenciales.
    """
    test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    async with test_engine.connect() as conn:
        outer_tx = await conn.begin()
        yield conn
        await outer_tx.rollback()
    await test_engine.dispose()


@pytest_asyncio.fixture
async def session_factory(db_connection):
    """Factory de sesiones ligada a la misma conexion/transaccion externa que
    `client`, para tests que necesitan invocar servicios directamente (p.ej.
    las tareas de Celery de M06/M07, que no tienen endpoint HTTP propio)."""
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
            # A diferencia de una transaccion top-level real (donde SET LOCAL
            # revierte solo al terminar), aqui cada request es una savepoint
            # sobre la misma conexion/transaccion compartida entre requests de
            # un mismo test -- sin este RESET explicito antes de liberar la
            # savepoint, el siguiente request (p.ej. un register/login normal)
            # seguiria corriendo como finanzas_admin y sus INSERTs fallarian.
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
    """Sesion RLS directa para tests que invocan servicios de Celery (M06/M07)
    sin pasar por HTTP: comparte la misma conexion/transaccion que `client`,
    asi que ve los datos creados via API en el mismo test."""
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
        json={"email": email, "name": "Test User", "password": "supersecret123"},
    )
    assert response.status_code == 201
    return response.json()["data"]
