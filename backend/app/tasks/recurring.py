import asyncio
from datetime import date

import structlog

from app.core.celery import celery_app
from app.core.database import rls_session
from app.services import recurring_service
from app.tasks._common import active_user_ids

logger = structlog.get_logger(__name__)


async def _process_due_for_all_users() -> int:
    today = date.today()
    total = 0
    for user_id in await active_user_ids():
        async with rls_session(user_id) as session:
            generated = await recurring_service.process_due_recurring_items(session, user_id, today)
            total += len(generated)
    return total


async def _remind_pending_for_all_users() -> int:
    today = date.today()
    total = 0
    for user_id in await active_user_ids():
        async with rls_session(user_id) as session:
            reminders = await recurring_service.remind_pending_recurring(session, user_id, today)
            total += len(reminders)
    return total


@celery_app.task(name="recurring.process_due")
def process_due_recurring_items() -> int:
    count = asyncio.run(_process_due_for_all_users())
    logger.info("recurring_process_due_completed", generated=count)
    return count


@celery_app.task(name="recurring.remind_pending")
def remind_pending_recurring() -> int:
    count = asyncio.run(_remind_pending_for_all_users())
    logger.info("recurring_remind_pending_completed", reminders=count)
    return count
