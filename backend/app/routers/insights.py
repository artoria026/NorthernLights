from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import Meta, SuccessResponse
from app.schemas.insight import InsightOut, InsightReviewOut
from app.services import engine_service, insight_service

router = APIRouter()


@router.get("")
async def list_insights(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    insights = await insight_service.list_active(session, current_user.id)
    return SuccessResponse(data=[InsightOut.model_validate(i) for i in insights])


@router.post("/generate", status_code=201)
async def generate_insights(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    snapshot = await engine_service.build_financial_snapshot(session, current_user.id)
    insights = await insight_service.generate_for_user(session, current_user.id, snapshot)
    return SuccessResponse(data=[InsightOut.model_validate(i) for i in insights])


@router.get("/history")
async def insight_history(
    page: int = 1,
    per_page: int = 20,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    insights, total = await insight_service.get_history(session, current_user.id, page, per_page)
    return SuccessResponse(
        data=[InsightOut.model_validate(i) for i in insights],
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.get("/{insight_id}")
async def get_insight(
    insight_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    insight = await insight_service.get_insight(session, current_user.id, insight_id)
    return SuccessResponse(data=InsightOut.model_validate(insight))


@router.get("/{insight_id}/reviews")
async def get_insight_reviews(
    insight_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    reviews = await insight_service.get_reviews(session, current_user.id, insight_id)
    return SuccessResponse(data=[InsightReviewOut.model_validate(r) for r in reviews])


@router.patch("/{insight_id}/dismiss")
async def dismiss_insight(
    insight_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    insight = await insight_service.dismiss(session, current_user.id, insight_id)
    return SuccessResponse(data=InsightOut.model_validate(insight))


@router.patch("/{insight_id}/resolve")
async def resolve_insight(
    insight_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    insight = await insight_service.resolve(session, current_user.id, insight_id)
    return SuccessResponse(data=InsightOut.model_validate(insight))
