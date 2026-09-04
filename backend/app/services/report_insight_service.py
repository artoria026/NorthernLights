from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import get_ai_provider
from app.models.report import REPORT_INSIGHT_FLOW_TYPES, Report, ReportInsight

logger = structlog.get_logger(__name__)


def _period_label(report: Report) -> str:
    if report.type in ("yearly_auto", "yearly_manual"):
        return str(report.period_start.year)
    return report.period_start.strftime("%B %Y")


async def generate_for_report(
    session: AsyncSession, user_id: UUID, report: Report
) -> list[ReportInsight]:
    """Generates the AI points for an already-closed period (M15).
    Deliberately not called from inside `generate_report`'s/
    `generate_yearly_report`'s try/except: a failure here must never turn a
    report that already generated successfully into 'error' -- it's just
    logged and moved past."""
    try:
        provider = get_ai_provider()
        raw_insights = await provider.generate_report_insights(
            report.summary or {}, _period_label(report)
        )
    except Exception:
        logger.exception("report_insights_generation_failed", report_id=str(report.id))
        return []

    created: list[ReportInsight] = []
    for item in raw_insights:
        flow_type = item.get("flow_type")
        if flow_type not in REPORT_INSIGHT_FLOW_TYPES:
            flow_type = "general"
        insight = ReportInsight(
            user_id=user_id,
            report_id=report.id,
            flow_type=flow_type,
            title=item.get("title", ""),
            description=item.get("description", ""),
            category_name=item.get("category_name"),
        )
        session.add(insight)
        created.append(insight)

    await session.flush()
    return created
