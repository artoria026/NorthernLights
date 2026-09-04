import asyncio
from datetime import date
from uuid import UUID

import structlog
from fastapi import HTTPException

from app.core.celery import celery_app
from app.core.database import rls_session
from app.services import report_service
from app.tasks._common import active_user_ids

logger = structlog.get_logger(__name__)


async def _generate_for_user(
    user_id: UUID, period_start: date, period_end: date, generated_by: str
) -> str:
    async with rls_session(user_id) as session:
        report = await report_service.generate_report(
            session, user_id, period_start, period_end, generated_by
        )
        return str(report.id)


async def _generate_monthly_for_all_users() -> int:
    prev_month_start, prev_month_end = report_service.previous_month_bounds()
    user_ids = await active_user_ids()
    for user_id in user_ids:
        await _generate_for_user(user_id, prev_month_start, prev_month_end, "auto")
    return len(user_ids)


@celery_app.task(name="reports.generate_monthly")
def generate_monthly_report_for_all_users() -> int:
    """Runs on the 1st of every month at 01:00 AM via Celery Beat."""
    count = asyncio.run(_generate_monthly_for_all_users())
    logger.info("reports_generate_monthly_completed", users=count)
    return count


async def _generate_yearly_for_user(user_id: UUID, year: int) -> str | None:
    async with rls_session(user_id) as session:
        try:
            report = await report_service.generate_yearly_report(session, user_id, year, "auto")
        except HTTPException:
            # User has no ready monthly reports for that year -- nothing to aggregate.
            return None
        return str(report.id)


async def _generate_yearly_for_all_users() -> int:
    prev_year_start, _ = report_service.previous_year_bounds()
    user_ids = await active_user_ids()
    generated = 0
    for user_id in user_ids:
        if await _generate_yearly_for_user(user_id, prev_year_start.year) is not None:
            generated += 1
    return generated


@celery_app.task(name="reports.generate_yearly")
def generate_yearly_report_for_all_users() -> int:
    """Runs on January 1st at 02:00 AM via Celery Beat -- after the monthly
    job (01:00 AM), which already generated the December report for the
    year that's closing."""
    count = asyncio.run(_generate_yearly_for_all_users())
    logger.info("reports_generate_yearly_completed", users=count)
    return count


@celery_app.task(name="reports.generate_for_user")
def generate_report_for_user(
    user_id: str, period_start: str, period_end: str, generated_by: str
) -> str:
    report_id = asyncio.run(
        _generate_for_user(
            UUID(user_id),
            date.fromisoformat(period_start),
            date.fromisoformat(period_end),
            generated_by,
        )
    )
    logger.info("reports_generate_for_user_completed", user_id=user_id, report_id=report_id)
    return report_id
