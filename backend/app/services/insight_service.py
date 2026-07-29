from datetime import UTC, date, datetime
from uuid import UUID

from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import get_ai_provider
from app.core.config import settings
from app.core.json_utils import json_safe
from app.models.insight import (
    MAX_ACTIVE_INSIGHTS_PER_USER,
    Insight,
    InsightReview,
)
from app.models.user import User
from app.schemas.insight import InsightCreateFromChat

_PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}
_REVIEW_INTERVAL = {"weekly": {"weeks": 1}, "biweekly": {"weeks": 2}, "monthly": {"months": 1}}


def _next_review_at(review_frequency: str, from_date: date | None = None) -> date:
    base = from_date or date.today()
    return base + relativedelta(**_REVIEW_INTERVAL[review_frequency])


async def list_active(session: AsyncSession, user_id: UUID) -> list[Insight]:
    result = await session.execute(
        select(Insight).where(
            Insight.user_id == user_id, Insight.status == "active", Insight.deleted_at.is_(None)
        )
    )
    insights = list(result.scalars().all())
    insights.sort(key=lambda i: (_PRIORITY_RANK.get(i.priority, 1), i.created_at), reverse=False)
    return insights


async def get_insight(session: AsyncSession, user_id: UUID, insight_id: UUID) -> Insight:
    result = await session.execute(
        select(Insight).where(
            Insight.id == insight_id, Insight.user_id == user_id, Insight.deleted_at.is_(None)
        )
    )
    insight = result.scalar_one_or_none()
    if insight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Insight no encontrado")
    return insight


async def get_history(
    session: AsyncSession, user_id: UUID, page: int = 1, per_page: int = 20
) -> tuple[list[Insight], int]:
    from sqlalchemy import func

    query = select(Insight).where(Insight.user_id == user_id, Insight.deleted_at.is_(None))
    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    query = query.order_by(Insight.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    return list(result.scalars().all()), total


async def get_reviews(
    session: AsyncSession, user_id: UUID, insight_id: UUID
) -> list[InsightReview]:
    await get_insight(session, user_id, insight_id)  # 404 si no es del usuario
    result = await session.execute(
        select(InsightReview)
        .where(InsightReview.insight_id == insight_id, InsightReview.user_id == user_id)
        .order_by(InsightReview.reviewed_at.desc())
    )
    return list(result.scalars().all())


async def dismiss(session: AsyncSession, user_id: UUID, insight_id: UUID) -> Insight:
    insight = await get_insight(session, user_id, insight_id)
    insight.status = "dismissed"
    insight.dismissed_at = datetime.now(UTC)
    await session.flush()
    return insight


async def resolve(session: AsyncSession, user_id: UUID, insight_id: UUID) -> Insight:
    insight = await get_insight(session, user_id, insight_id)
    insight.status = "resolved"
    insight.resolved_at = datetime.now(UTC)
    await session.flush()
    return insight


async def _enforce_active_limit(session: AsyncSession, user_id: UUID) -> None:
    """Regla M13 #5: maximo 10 activos por usuario. Si se excede, el mas
    antiguo y de menor prioridad pasa a dismissed automaticamente."""
    active = await list_active(session, user_id)
    if len(active) < MAX_ACTIVE_INSIGHTS_PER_USER:
        return
    # list_active ya viene ordenado por prioridad asc (high primero); el
    # ultimo de la lista es el de menor prioridad y, entre iguales, el mas
    # antiguo (orden estable de Insight.created_at).
    oldest_lowest = active[-1]
    oldest_lowest.status = "dismissed"
    oldest_lowest.dismissed_at = datetime.now(UTC)
    await session.flush()


async def _has_active_in_category(session: AsyncSession, user_id: UUID, category: str) -> bool:
    result = await session.execute(
        select(Insight).where(
            Insight.user_id == user_id,
            Insight.category == category,
            Insight.status == "active",
            Insight.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none() is not None


async def _create_insight(
    session: AsyncSession,
    user_id: UUID,
    *,
    title: str,
    description: str,
    category: str,
    priority: str,
    generated_by: str,
    snapshot: dict,
) -> Insight | None:
    """Regla M13 #1: deduplicacion por categoria activa."""
    if await _has_active_in_category(session, user_id, category):
        return None

    await _enforce_active_limit(session, user_id)

    user = await session.get(User, user_id)
    review_frequency = user.preferences.pay_cycle if user else "monthly"

    insight = Insight(
        user_id=user_id,
        title=title,
        description=description,
        category=category,
        priority=priority,
        generated_by=generated_by,
        ai_provider=settings.AI_PROVIDER,
        ai_context=json_safe(snapshot),
        metrics_at_creation=_extract_key_metrics(snapshot),
        review_frequency=review_frequency,
        next_review_at=_next_review_at(review_frequency),
    )
    session.add(insight)
    await session.flush()
    return insight


def _extract_key_metrics(snapshot: dict) -> dict:
    return json_safe(
        {
            "net_worth": snapshot.get("net_worth", {}).get("net_worth"),
            "health_score": snapshot.get("health_score", {}).get("score"),
            "committed_monthly": snapshot.get("committed_monthly"),
        }
    )


async def create_from_chat(
    session: AsyncSession, user_id: UUID, tool_input: InsightCreateFromChat, snapshot: dict
) -> dict:
    """Punto de integracion para M10: llamado por el tool `create_insight`
    cuando el usuario le pide al asesor guardar un plan."""
    insight = await _create_insight(
        session,
        user_id,
        title=tool_input.title,
        description=tool_input.description,
        category=tool_input.category,
        priority=tool_input.priority,
        generated_by="user_chat",
        snapshot=snapshot,
    )
    if insight is None:
        return {
            "insight_id": None,
            "title": tool_input.title,
            "note": f"Ya existe un insight activo en la categoria '{tool_input.category}'.",
        }
    return {"insight_id": str(insight.id), "title": insight.title}


async def generate_for_user(session: AsyncSession, user_id: UUID, snapshot: dict) -> list[Insight]:
    """Tarea Celery `insights.generate_periodic` (por usuario, sin schedule
    fijo: la dispara `review_due_insights` o el endpoint manual)."""
    provider = get_ai_provider()
    raw_insights = await provider.generate_insights(snapshot)

    created = []
    for raw in raw_insights:
        insight = await _create_insight(
            session,
            user_id,
            title=raw["title"],
            description=raw["description"],
            category=raw["category"],
            priority=raw.get("priority", "medium"),
            generated_by="auto_celery",
            snapshot=snapshot,
        )
        if insight is not None:
            created.append(insight)
    return created


async def review_insight(session: AsyncSession, insight: Insight, snapshot: dict) -> InsightReview:
    """Tarea Celery `insights.review_due` (por insight vencido)."""
    provider = get_ai_provider()
    review_data = await provider.review_insight(
        {
            "id": str(insight.id),
            "title": insight.title,
            "description": insight.description,
            "category": insight.category,
            "metrics_at_creation": insight.metrics_at_creation,
        },
        snapshot,
    )

    metrics = _extract_key_metrics(snapshot)
    next_review = _next_review_at(insight.review_frequency)

    review = InsightReview(
        insight_id=insight.id,
        user_id=insight.user_id,
        metrics=metrics,
        trend=review_data["trend"],
        ai_assessment=review_data["ai_assessment"],
        next_review_at=next_review,
    )
    session.add(review)

    insight.metrics_at_last_review = metrics
    insight.last_reviewed_at = datetime.now(UTC)
    insight.review_count += 1
    insight.next_review_at = next_review

    await session.flush()
    return review


async def get_due_insights(session: AsyncSession, today: date) -> list[tuple[UUID, UUID]]:
    """Consulta cross-user usada por el orquestador del task de Celery (ver
    app/tasks/insights.py): no se filtra por RLS porque es un job de sistema,
    no una operacion en nombre de un usuario especifico. Retorna pares
    (insight_id, user_id) para poder agrupar por usuario sin otra consulta."""
    result = await session.execute(
        select(Insight.id, Insight.user_id).where(
            Insight.status == "active",
            Insight.next_review_at <= today,
            Insight.deleted_at.is_(None),
        )
    )
    return [(row.id, row.user_id) for row in result.all()]
