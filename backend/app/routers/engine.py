from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import SuccessResponse
from app.schemas.engine import (
    AvailableSpending,
    CashFlowDay,
    FinancialSnapshot,
    HealthScore,
    IncomeEstimate,
    NetWorth,
    Runway,
    SimulationRequest,
    SimulationResponse,
)
from app.services import engine_service

router = APIRouter()


@router.get("/net-worth")
async def net_worth(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.calculate_net_worth(session, current_user.id)
    return SuccessResponse(data=NetWorth(**data))


@router.get("/income")
async def income(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.get_income_estimates(session, current_user.id)
    return SuccessResponse(data=IncomeEstimate(**data))


@router.get("/health-score")
async def health_score(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.calculate_health_score(session, current_user.id)
    return SuccessResponse(data=HealthScore(**data))


@router.get("/available")
async def available(
    period: str = Query(default="week", pattern="^(today|week|month)$"),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.available_spending(session, current_user.id, period)
    return SuccessResponse(data=AvailableSpending(**data))


@router.get("/runway")
async def runway(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    committed = await engine_service.get_monthly_committed(session, current_user.id)
    available = await engine_service.available_spending(session, current_user.id, "month")
    data = engine_service.calculate_runway(available["liquid_balance"], committed)
    return SuccessResponse(data=Runway(**data))


@router.get("/cash-flow")
async def cash_flow(
    days: int = Query(default=30, ge=1, le=90),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.cash_flow_projection(session, current_user.id, days)
    return SuccessResponse(data=[CashFlowDay(**day) for day in data])


@router.get("/snapshot")
async def snapshot(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await engine_service.build_financial_snapshot(session, current_user.id)
    return SuccessResponse(data=FinancialSnapshot(**data))


@router.post("/simulate")
async def simulate(
    data: SimulationRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    result = await engine_service.simulate_scenario(session, current_user.id, data)
    return SuccessResponse(data=SimulationResponse(**result))
