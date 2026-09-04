from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings
from app.core.security import CurrentUser, get_current_user

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    echo=settings.APP_ENV == "development",
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Session with no user context, atomic per request.

    Used by auth flows where the user isn't identified yet
    (register/login/refresh/forgot-password). Once the service knows
    the user_id (after verifying password or token) it must issue its own
    SET LOCAL app.current_user_id before touching RLS tables.
    """
    async with AsyncSessionLocal() as session, session.begin():
        yield session


@asynccontextmanager
async def rls_session(user_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """Session with RLS active for code that runs outside an HTTP request
    (Celery tasks from M06/M07 onward). `get_rls_db` reuses this same
    helper for the FastAPI case; see its docstring for the explanation of
    `set_config`."""
    async with AsyncSessionLocal() as session, session.begin():
        # SET LOCAL doesn't accept bind parameters ($1) in Postgres; set_config() does.
        # 3rd argument `true` = local to the current transaction (equivalent to SET LOCAL).
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user_id)},
        )
        yield session


async def get_rls_db(
    current_user: CurrentUser = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    """Session with RLS active.

    SET LOCAL only persists within this transaction, which is why it runs
    at the start of every authenticated request. Never read/write user
    tables outside this dependency.
    """
    async with rls_session(current_user.id) as session:
        yield session


async def get_admin_db() -> AsyncGenerator[AsyncSession, None]:
    """Session with SET LOCAL ROLE finanzas_admin (BYPASSRLS + SELECT
    only, see migration 74f91ad52f09) -- exclusive to admin_service's
    cross-user aggregations (list_users/get_stats).
    Same connection/engine as the rest of the app (finanzas_user must be a
    member of finanzas_admin to be able to assume it); SET LOCAL reverts on its
    own when the transaction ends, same as set_config in rls_session. Any
    other read/write of user data must keep using get_rls_db.
    """
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE finanzas_admin"))
        yield session
