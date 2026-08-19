import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import Account
from app.models.debt import Debt
from app.models.feedback import Feedback
from app.models.recurring import RecurringItem
from app.models.transaction import JournalEntry
from app.models.user import Device, User
from app.services import cache_service, engine_service

# Longitud del password temporal generado por reset_user_password -- mas
# corto que el token de 32 de auth_service.forgot_password (ese viaja en un
# link, nunca lo teclea nadie); este si lo escribe un humano, pero sigue
# siendo criptograficamente seguro via secrets.token_urlsafe.
TEMP_PASSWORD_BYTES = 12


async def list_users(
    session: AsyncSession, page: int = 1, per_page: int = 20, search: str | None = None
) -> tuple[list[dict], int]:
    search_filter = (
        or_(User.name.ilike(f"%{search}%"), User.email.ilike(f"%{search}%")) if search else None
    )

    total_query = select(func.count()).select_from(User).where(User.deleted_at.is_(None))
    if search_filter is not None:
        total_query = total_query.where(search_filter)
    total = (await session.execute(total_query)).scalar_one()

    accounts_count = (
        select(Account.user_id, func.count().label("n")).group_by(Account.user_id).subquery()
    )
    tx_count = (
        select(JournalEntry.user_id, func.count().label("n"))
        .group_by(JournalEntry.user_id)
        .subquery()
    )
    last_active = (
        select(Device.user_id, func.max(Device.last_used_at).label("last_active"))
        .group_by(Device.user_id)
        .subquery()
    )

    query = (
        select(
            User,
            func.coalesce(accounts_count.c.n, 0).label("accounts_count"),
            func.coalesce(tx_count.c.n, 0).label("transactions_count"),
            last_active.c.last_active,
        )
        .outerjoin(accounts_count, accounts_count.c.user_id == User.id)
        .outerjoin(tx_count, tx_count.c.user_id == User.id)
        .outerjoin(last_active, last_active.c.user_id == User.id)
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    if search_filter is not None:
        query = query.where(search_filter)
    result = await session.execute(query)
    rows = result.all()

    # Solo el score compuesto (0-100), nunca sus componentes (DTI, tasa de
    # ahorro, etc.) -- esos si describen la situacion financiera real de la
    # cuenta, el score solo es un indicador sintetico, mismo criterio que el
    # resto de este archivo (conteos/fechas, nunca detalle financiero).
    users = []
    for user, accounts_n, tx_n, last_active_at in rows:
        health = await engine_service.calculate_health_score(session, user.id)
        users.append(
            {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "auth_provider": user.auth_provider,
                "is_active": user.is_active,
                "created_at": user.created_at,
                "accounts_count": accounts_n,
                "transactions_count": tx_n,
                "last_active_at": last_active_at,
                "health_score": health["score"],
            }
        )
    return users, total


async def _get_user(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return user


async def set_user_active(
    session: AsyncSession, user_id: UUID, is_active: bool, current_admin_id: UUID
) -> User:
    if user_id == current_admin_id and not is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No puedes desactivar tu propia cuenta")
    user = await _get_user(session, user_id)
    user.is_active = is_active
    await session.commit()
    return user


async def set_user_role(
    session: AsyncSession, user_id: UUID, role: str, current_admin_id: UUID
) -> User:
    if user_id == current_admin_id and role != "admin":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "No puedes quitarte tu propio rol de admin"
        )
    user = await _get_user(session, user_id)
    user.role = role
    await session.commit()
    return user


async def reset_user_password(session: AsyncSession, user_id: UUID) -> str:
    """Genera una contraseña temporal aleatoria y la guarda ya hasheada --
    el valor en texto plano solo existe en el return de esta funcion, nunca
    se loguea ni se persiste sin hashear. Pensado para cuando un usuario
    olvida su contraseña y no hay proveedor de email conectado todavia (ver
    comentario en auth_service.forgot_password) -- el admin se la pasa por
    fuera de la app."""
    user = await _get_user(session, user_id)
    temporary_password = secrets.token_urlsafe(TEMP_PASSWORD_BYTES)
    user.password_hash = hash_password(temporary_password)
    await session.commit()
    return temporary_password


async def get_stats(session: AsyncSession, redis: Redis) -> dict:
    # Todos los conteos sobre User de aqui en adelante excluyen soft-deleted
    # (User.deleted_at) -- sin este filtro, una cuenta borrada via "Eliminar
    # cuenta" (Settings.tsx -> auth_service.delete_account) se quedaba
    # contando para siempre en "Usuarios totales" y compania.
    not_deleted = User.deleted_at.is_(None)
    total_users = (
        await session.execute(select(func.count()).where(not_deleted))
    ).scalar_one()
    active_users = (
        await session.execute(select(func.count()).where(User.is_active.is_(True), not_deleted))
    ).scalar_one()
    admin_users = (
        await session.execute(select(func.count()).where(User.role == "admin", not_deleted))
    ).scalar_one()
    week_ago = datetime.now(UTC) - timedelta(days=7)
    new_users = (
        await session.execute(
            select(func.count()).where(User.created_at >= week_ago, not_deleted)
        )
    ).scalar_one()
    total_accounts = (await session.execute(select(func.count()).select_from(Account))).scalar_one()
    total_transactions = (
        await session.execute(select(func.count()).select_from(JournalEntry))
    ).scalar_one()
    total_debts = (await session.execute(select(func.count()).select_from(Debt))).scalar_one()

    google_users = (
        await session.execute(
            select(func.count()).where(User.auth_provider == "google", not_deleted)
        )
    ).scalar_one()
    users_with_accounts = (
        await session.execute(select(func.count(func.distinct(Account.user_id))))
    ).scalar_one()
    users_with_debts = (
        await session.execute(select(func.count(func.distinct(Debt.user_id))))
    ).scalar_one()
    users_with_recurring = (
        await session.execute(select(func.count(func.distinct(RecurringItem.user_id))))
    ).scalar_one()

    # Inactivo = sin ninguna transaccion registrada en los ultimos 30 dias --
    # para cuentas que nunca registraron nada, se compara contra su fecha de
    # alta (created_at) en vez de tratarlas como "activas" por default.
    month_ago = datetime.now(UTC) - timedelta(days=30)
    last_tx = (
        select(JournalEntry.user_id, func.max(JournalEntry.created_at).label("last_tx"))
        .group_by(JournalEntry.user_id)
        .subquery()
    )
    inactive_users_30d = (
        await session.execute(
            select(func.count())
            .select_from(User)
            .outerjoin(last_tx, last_tx.c.user_id == User.id)
            .where(func.coalesce(last_tx.c.last_tx, User.created_at) < month_ago, not_deleted)
        )
    ).scalar_one()

    feedback_new_count = (
        await session.execute(
            select(func.count()).select_from(Feedback).where(Feedback.status == "new")
        )
    ).scalar_one()

    # Altas por dia, ultimos 14 dias -- la query solo trae dias con al menos
    # un alta, se rellenan los dias en 0 en Python para que el chart no tenga
    # huecos.
    two_weeks_ago = datetime.now(UTC) - timedelta(days=13)
    signup_rows = (
        await session.execute(
            select(func.date(User.created_at).label("day"), func.count().label("n"))
            .where(User.created_at >= two_weeks_ago, not_deleted)
            .group_by("day")
        )
    ).all()
    signups_by_day = {row.day.isoformat(): row.n for row in signup_rows}
    today = datetime.now(UTC).date()
    signups_last_14_days = [
        {
            "date": (day := today - timedelta(days=offset)).isoformat(),
            "count": signups_by_day.get(day.isoformat(), 0),
        }
        for offset in range(13, -1, -1)
    ]

    # Consultas de IA de hoy en toda la app -- reusa el mismo contador Redis
    # por usuario que ya expone /ai/usage a cada quien (cache_service.py),
    # sumado sobre los ids reales de usuarios en vez de un KEYS/SCAN a ciegas.
    user_ids = (await session.execute(select(User.id).where(not_deleted))).scalars().all()
    limit = settings.AI_RATE_LIMIT_PER_USER_DAY
    ai_queries_today = 0
    for user_id in user_ids:
        used, _ = await cache_service.get_ai_rate_limit_status(redis, user_id, limit)
        ai_queries_today += used

    return {
        "total_users": total_users,
        "active_users": active_users,
        "admin_users": admin_users,
        "new_users_last_7_days": new_users,
        "total_accounts": total_accounts,
        "total_transactions": total_transactions,
        "total_debts": total_debts,
        "google_users": google_users,
        "users_with_accounts": users_with_accounts,
        "users_with_debts": users_with_debts,
        "users_with_recurring": users_with_recurring,
        "inactive_users_30d": inactive_users_30d,
        "ai_queries_today": ai_queries_today,
        "feedback_new_count": feedback_new_count,
        "signups_last_14_days": signups_last_14_days,
    }
