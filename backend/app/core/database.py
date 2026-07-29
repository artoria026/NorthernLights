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
    """Sesion sin contexto de usuario, atomica por request.

    Usada por flujos de auth donde el usuario aun no esta identificado
    (register/login/refresh/forgot-password). Cuando el servicio ya conoce
    el user_id (tras verificar password o token) debe emitir su propio
    SET LOCAL app.current_user_id antes de tocar tablas con RLS.
    """
    async with AsyncSessionLocal() as session, session.begin():
        yield session


@asynccontextmanager
async def rls_session(user_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """Sesion con RLS activo para codigo que corre fuera de un request HTTP
    (tareas de Celery de M06/M07 en adelante). `get_rls_db` reusa este mismo
    helper para el caso FastAPI; ver su docstring para la explicacion de
    `set_config`."""
    async with AsyncSessionLocal() as session, session.begin():
        # SET LOCAL no acepta bind parameters ($1) en Postgres; set_config() si.
        # 3er argumento `true` = local a la transaccion actual (equiv. a SET LOCAL).
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user_id)},
        )
        yield session


async def get_rls_db(
    current_user: CurrentUser = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    """Sesion con RLS activo.

    SET LOCAL solo persiste dentro de esta transaccion, por eso se ejecuta
    al inicio de cada request autenticado. Nunca leer/escribir tablas de
    usuario fuera de esta dependencia.
    """
    async with rls_session(current_user.id) as session:
        yield session


async def get_admin_db() -> AsyncGenerator[AsyncSession, None]:
    """Sesion con SET LOCAL ROLE finanzas_admin (BYPASSRLS + SELECT
    unicamente, ver migracion 74f91ad52f09) -- exclusiva para las
    agregaciones cross-usuario de admin_service (list_users/get_stats).
    Misma conexion/engine que el resto de la app (finanzas_user debe ser
    miembro de finanzas_admin para poder asumirlo); SET LOCAL revierte solo
    al terminar la transaccion, igual que set_config en rls_session. Cualquier
    otra lectura/escritura de datos de usuario debe seguir usando get_rls_db.
    """
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE finanzas_admin"))
        yield session
