from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.budget import (
    BudgetCurrent,
    BudgetLimitOut,
    BudgetLimitSuggestion,
    BudgetLimitsUpdate,
    BudgetSummary,
    BudgetTrendMonth,
    WeeklyBudget,
)
from app.schemas.common import SuccessResponse
from app.services import budget_service

router = APIRouter()


@router.get("/current")
async def current(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    today = date.today()
    data = await budget_service.get_current_budget(
        session, current_user.id, today.year, today.month
    )
    return SuccessResponse(data=BudgetCurrent(**data))


@router.get("/current/weekly")
async def current_weekly(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    today = date.today()
    data = await budget_service.get_weekly_view(session, current_user.id, today.year, today.month)
    return SuccessResponse(data=WeeklyBudget(**data))


@router.get("/limits")
async def get_limits(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    limits = await budget_service.get_limits(session, current_user.id)
    return SuccessResponse(data=[BudgetLimitOut(**item) for item in limits])


@router.get("/limits/suggestions")
async def get_limit_suggestions(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    suggestions = await budget_service.get_limit_suggestions(session, current_user.id)
    return SuccessResponse(data=[BudgetLimitSuggestion(**item) for item in suggestions])


@router.put("/limits")
async def update_limits(
    data: BudgetLimitsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    limits = await budget_service.set_limits(session, current_user.id, data.limits)
    return SuccessResponse(data=[BudgetLimitOut(**item) for item in limits])


@router.get("/summary")
async def summary(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await budget_service.get_summary(session, current_user.id)
    return SuccessResponse(data=BudgetSummary(**data))


@router.get("/trend")
async def trend(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await budget_service.get_budget_trend(session, current_user.id)
    return SuccessResponse(data=[BudgetTrendMonth(**item) for item in data])


@router.get("/{year}/{month}")
async def historical(
    year: int,
    month: int,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await budget_service.get_current_budget(session, current_user.id, year, month)
    return SuccessResponse(data=BudgetCurrent(**data))
