import asyncio
from uuid import UUID

import structlog
from sqlalchemy import select

from app.core.celery import celery_app
from app.core.database import rls_session
from app.models.budget import BudgetLimit
from app.schemas.budget import BudgetLimitIn
from app.services import budget_service
from app.tasks._common import active_user_ids

logger = structlog.get_logger(__name__)


async def _initialize_month_for_user(user_id: UUID) -> None:
    async with rls_session(user_id) as session:
        result = await session.execute(
            select(BudgetLimit.category_id, BudgetLimit.monthly_limit).where(
                BudgetLimit.user_id == user_id
            )
        )
        limits = [
            BudgetLimitIn(category_id=category_id, monthly_limit=monthly_limit)
            for category_id, monthly_limit in result.all()
        ]
        if limits:
            await budget_service.set_limits(session, user_id, limits)


async def _initialize_month_for_all_users() -> int:
    user_ids = await active_user_ids()
    for user_id in user_ids:
        await _initialize_month_for_user(user_id)
    return len(user_ids)


@celery_app.task(name="budget.initialize_month")
def initialize_monthly_budget() -> int:
    """Corre el 1ro de cada mes: asegura que exista un budget_period por
    categoria con limite configurado, con el snapshot del limite vigente,
    aunque el usuario no confirme ninguna transaccion ese dia."""
    count = asyncio.run(_initialize_month_for_all_users())
    logger.info("budget_initialize_month_completed", users=count)
    return count
