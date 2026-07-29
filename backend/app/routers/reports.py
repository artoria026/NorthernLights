from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.redis import get_redis
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import Meta, SuccessResponse
from app.schemas.report import ReportGenerateRequest, ReportOut
from app.services import report_service

router = APIRouter()


@router.get("")
async def list_reports(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    reports, total = await report_service.list_reports(session, current_user.id, page, per_page)
    return SuccessResponse(
        data=[ReportOut.model_validate(r) for r in reports],
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.get("/historical")
async def historical_reports(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    redis = await get_redis()
    items, total = await report_service.get_historical(
        session, redis, current_user.id, page, per_page
    )
    return SuccessResponse(data=items, meta=Meta(total=total, page=page, per_page=per_page))


@router.get("/summary/current")
async def current_summary(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    redis = await get_redis()
    summary = await report_service.get_current_month_summary(session, redis, current_user.id)
    return SuccessResponse(data=summary)


@router.get("/monthly/{year}/{month}")
async def monthly_report(
    year: int,
    month: int,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    report = await report_service.generate_monthly_for_user(
        session, current_user.id, year, month, generated_by="user"
    )
    return SuccessResponse(data=ReportOut.model_validate(report))


@router.post("/generate", status_code=201)
async def generate_report(
    body: ReportGenerateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    if body.year is not None:
        report = await report_service.generate_yearly_report(
            session, current_user.id, body.year, generated_by="user"
        )
        return SuccessResponse(data=ReportOut.model_validate(report))

    if body.period_start and body.period_end:
        period_start, period_end = body.period_start, body.period_end
    else:
        period_start, period_end = report_service.previous_month_bounds()

    report = await report_service.generate_report(
        session, current_user.id, period_start, period_end, generated_by="user"
    )
    return SuccessResponse(data=ReportOut.model_validate(report))


@router.get("/{report_id}")
async def get_report(
    report_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    report = await report_service.get_report(session, current_user.id, report_id)
    return SuccessResponse(data=ReportOut.model_validate(report))
