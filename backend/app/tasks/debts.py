import asyncio
from datetime import date

import structlog

from app.core.celery import celery_app
from app.core.database import rls_session
from app.services import debt_service
from app.tasks._common import active_user_ids

logger = structlog.get_logger(__name__)


async def _process_due_for_all_users() -> int:
    today = date.today()
    total = 0
    for user_id in await active_user_ids():
        async with rls_session(user_id) as session:
            generated = await debt_service.process_due_debt_payments(session, user_id, today)
            total += len(generated)
    return total


@celery_app.task(name="debts.process_due_payments")
def process_due_payments() -> int:
    count = asyncio.run(_process_due_for_all_users())
    logger.info("debts_process_due_payments_completed", generated=count)
    return count
