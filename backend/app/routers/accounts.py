from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.account import (
    AccountCreate,
    AccountOut,
    AccountReconcileRequest,
    AccountReconcileResult,
    AccountSummary,
    AccountUpdate,
    TdcCycle,
)
from app.schemas.common import SuccessResponse
from app.services import account_service, transaction_service

router = APIRouter()


@router.get("")
async def list_accounts(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    accounts = await account_service.list_accounts(session, current_user.id)
    return SuccessResponse(data=[AccountOut.model_validate(a) for a in accounts])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_account(
    data: AccountCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    account = await account_service.create_account(session, current_user.id, data)
    return SuccessResponse(data=AccountOut.model_validate(account))


@router.get("/summary")
async def summary(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await account_service.get_summary(session, current_user.id)
    return SuccessResponse(data=AccountSummary(**data))


@router.get("/{account_id}")
async def get_account(
    account_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    account = await account_service.get_account(session, current_user.id, account_id)
    return SuccessResponse(data=AccountOut.model_validate(account))


@router.put("/{account_id}")
async def update_account(
    account_id: UUID,
    data: AccountUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    account = await account_service.update_account(session, current_user.id, account_id, data)
    return SuccessResponse(data=AccountOut.model_validate(account))


@router.post("/{account_id}/reconcile")
async def reconcile_account(
    account_id: UUID,
    data: AccountReconcileRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    result = await transaction_service.reconcile_account(
        session,
        current_user.id,
        account_id,
        data.real_balance,
        data.date or date.today(),
        data.notes,
    )
    return SuccessResponse(data=AccountReconcileResult(**result))


@router.delete("/{account_id}")
async def delete_account(
    account_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await account_service.delete_account(session, current_user.id, account_id)
    return SuccessResponse(data={"success": True})


@router.get("/tdc/{account_id}/cycle")
async def tdc_cycle(
    account_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    account = await account_service.get_account(session, current_user.id, account_id)
    cycle = await account_service.get_tdc_cycle(session, account, date.today())
    return SuccessResponse(data=TdcCycle(**cycle))
