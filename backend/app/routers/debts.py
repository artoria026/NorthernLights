from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import Meta, SuccessResponse
from app.schemas.debt import (
    DebtActivationRequest,
    DebtCreate,
    DebtOut,
    DebtPaymentCreate,
    DebtPaymentOut,
    DebtScheduleItem,
    DebtSimulateRequest,
    DebtSimulateResponse,
    DebtSummary,
    DebtUpdate,
    UnplannedDebtCreate,
    UnplannedDebtOut,
    UnplannedDebtUpdate,
)
from app.services import debt_service, transaction_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Unplanned debts
# ---------------------------------------------------------------------------


@router.get("/unplanned")
async def list_unplanned(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await debt_service.list_unplanned_debts(session, current_user.id)
    return SuccessResponse(data=[UnplannedDebtOut.model_validate(i) for i in items])


@router.post("/unplanned", status_code=status.HTTP_201_CREATED)
async def create_unplanned(
    data: UnplannedDebtCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await debt_service.create_unplanned_debt(session, current_user.id, data)
    return SuccessResponse(data=UnplannedDebtOut.model_validate(item))


@router.put("/unplanned/{unplanned_id}")
async def update_unplanned(
    unplanned_id: UUID,
    data: UnplannedDebtUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await debt_service.update_unplanned_debt(session, current_user.id, unplanned_id, data)
    return SuccessResponse(data=UnplannedDebtOut.model_validate(item))


@router.delete("/unplanned/{unplanned_id}")
async def delete_unplanned(
    unplanned_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await debt_service.delete_unplanned_debt(session, current_user.id, unplanned_id)
    return SuccessResponse(data={"success": True})


@router.post("/unplanned/{unplanned_id}/activate", status_code=status.HTTP_201_CREATED)
async def activate_unplanned(
    unplanned_id: UUID,
    plan: DebtActivationRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debt = await debt_service.activate_unplanned_debt(session, current_user.id, unplanned_id, plan)
    return SuccessResponse(data=DebtOut.model_validate(debt))


# ---------------------------------------------------------------------------
# Debts
# ---------------------------------------------------------------------------


@router.get("")
async def list_debts(
    status_filter: str | None = Query(default=None, alias="status"),
    direction: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debts = await debt_service.list_debts(session, current_user.id, status_filter, direction)
    return SuccessResponse(data=[DebtOut.model_validate(d) for d in debts])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_debt(
    data: DebtCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debt = await debt_service.create_debt(session, current_user.id, data, current_user.role)
    return SuccessResponse(data=DebtOut.model_validate(debt))


@router.get("/upcoming")
async def upcoming(
    days_ahead: int = Query(default=30, ge=1, le=365),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debts = await debt_service.get_upcoming(session, current_user.id, days_ahead)
    return SuccessResponse(data=[DebtOut.model_validate(d) for d in debts])


@router.get("/pending")
async def pending(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entries = await debt_service.get_pending(session, current_user.id)
    out = await transaction_service.to_transaction_out_list(session, entries)
    return SuccessResponse(
        data=out,
        meta=Meta(total=len(entries), page=1, per_page=100),
    )


@router.get("/summary")
async def summary(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await debt_service.get_summary(session, current_user.id)
    return SuccessResponse(data=DebtSummary(**data))


@router.post("/simulate")
async def simulate(
    data: DebtSimulateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    result = await debt_service.simulate(session, current_user.id, data)
    return SuccessResponse(data=DebtSimulateResponse(**result))


@router.get("/{debt_id}")
async def get_debt(
    debt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debt = await debt_service.get_debt(session, current_user.id, debt_id)
    return SuccessResponse(data=DebtOut.model_validate(debt))


@router.put("/{debt_id}")
async def update_debt(
    debt_id: UUID,
    data: DebtUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    debt = await debt_service.update_debt(session, current_user.id, debt_id, data)
    return SuccessResponse(data=DebtOut.model_validate(debt))


@router.delete("/{debt_id}")
async def delete_debt(
    debt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await debt_service.delete_debt(session, current_user.id, debt_id)
    return SuccessResponse(data={"success": True})


@router.post("/{debt_id}/payments", status_code=status.HTTP_201_CREATED)
async def register_payment(
    debt_id: UUID,
    data: DebtPaymentCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    payment = await debt_service.register_debt_payment(session, current_user.id, debt_id, data)
    return SuccessResponse(data=DebtPaymentOut.model_validate(payment))


@router.get("/{debt_id}/schedule")
async def schedule(
    debt_id: UUID,
    count: int = Query(default=12, ge=1, le=120),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await debt_service.get_schedule(session, current_user.id, debt_id, count)
    return SuccessResponse(data=[DebtScheduleItem(**item) for item in items])
