import asyncio
from collections import defaultdict
from datetime import date

import structlog

from app.core.celery import celery_app
from app.core.database import AsyncSessionLocal, rls_session
from app.services import engine_service, insight_service, notification_service

logger = structlog.get_logger(__name__)


async def _review_due_for_all_users() -> int:
    today = date.today()
    async with AsyncSessionLocal() as session:
        due_pairs = await insight_service.get_due_insights(session, today)

    by_user: dict = defaultdict(list)
    for insight_id, user_id in due_pairs:
        by_user[user_id].append(insight_id)

    total = 0
    for user_id, insight_ids in by_user.items():
        async with rls_session(user_id) as session:
            snapshot = await engine_service.build_financial_snapshot(session, user_id)
            for insight_id in insight_ids:
                insight = await insight_service.get_insight(session, user_id, insight_id)
                review = await insight_service.review_insight(session, insight, snapshot)
                if review.trend in ("improved", "worsened"):
                    verbo = "mejoró" if review.trend == "improved" else "empeoró"
                    await notification_service.create(
                        session,
                        user_id=user_id,
                        type_="insight_reviewed",
                        title=f"Actualización en: {insight.title}",
                        body=f"Tu situación {verbo}",
                        related_entity_type="insight",
                        related_entity_id=insight.id,
                    )
                total += 1
    return total


async def _generate_periodic_for_user(user_id) -> int:
    async with rls_session(user_id) as session:
        snapshot = await engine_service.build_financial_snapshot(session, user_id)
        insights = await insight_service.generate_for_user(session, user_id, snapshot)
        for insight in insights:
            await notification_service.create(
                session,
                user_id=user_id,
                type_="insight_generated",
                title=f"Nuevo insight: {insight.title}",
                related_entity_type="insight",
                related_entity_id=insight.id,
            )
        return len(insights)


@celery_app.task(name="insights.review_due")
def review_due_insights() -> int:
    count = asyncio.run(_review_due_for_all_users())
    logger.info("insights_review_due_completed", reviewed=count)
    return count


@celery_app.task(name="insights.generate_periodic")
def generate_periodic_insights(user_id: str) -> int:
    count = asyncio.run(_generate_periodic_for_user(user_id))
    logger.info("insights_generate_periodic_completed", user_id=user_id, generated=count)
    return count
