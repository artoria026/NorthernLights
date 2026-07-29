from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.debt import Debt
from app.models.transaction import JournalEntry
from app.models.user import User


async def list_users(
    session: AsyncSession, page: int = 1, per_page: int = 20
) -> tuple[list[dict], int]:
    total = (await session.execute(select(func.count()).select_from(User))).scalar_one()

    accounts_count = (
        select(Account.user_id, func.count().label("n")).group_by(Account.user_id).subquery()
    )
    tx_count = (
        select(JournalEntry.user_id, func.count().label("n"))
        .group_by(JournalEntry.user_id)
        .subquery()
    )

    query = (
        select(
            User,
            func.coalesce(accounts_count.c.n, 0).label("accounts_count"),
            func.coalesce(tx_count.c.n, 0).label("transactions_count"),
        )
        .outerjoin(accounts_count, accounts_count.c.user_id == User.id)
        .outerjoin(tx_count, tx_count.c.user_id == User.id)
        .order_by(User.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await session.execute(query)

    users = [
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
        }
        for user, accounts_n, tx_n in result.all()
    ]
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


async def get_stats(session: AsyncSession) -> dict:
    total_users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    active_users = (
        await session.execute(select(func.count()).where(User.is_active.is_(True)))
    ).scalar_one()
    admin_users = (
        await session.execute(select(func.count()).where(User.role == "admin"))
    ).scalar_one()
    week_ago = datetime.now(UTC) - timedelta(days=7)
    new_users = (
        await session.execute(select(func.count()).where(User.created_at >= week_ago))
    ).scalar_one()
    total_accounts = (await session.execute(select(func.count()).select_from(Account))).scalar_one()
    total_transactions = (
        await session.execute(select(func.count()).select_from(JournalEntry))
    ).scalar_one()
    total_debts = (await session.execute(select(func.count()).select_from(Debt))).scalar_one()

    return {
        "total_users": total_users,
        "active_users": active_users,
        "admin_users": admin_users,
        "new_users_last_7_days": new_users,
        "total_accounts": total_accounts,
        "total_transactions": total_transactions,
        "total_debts": total_debts,
    }
