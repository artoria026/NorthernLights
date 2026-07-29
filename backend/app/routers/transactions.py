from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.models.transaction import JournalEntry
from app.schemas.common import Meta, SuccessResponse
from app.schemas.transaction import (
    SplitExpenseCreate,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from app.services import transaction_service

router = APIRouter()


async def _out_many(session: AsyncSession, entries: list[JournalEntry]) -> list[TransactionOut]:
    return await transaction_service.to_transaction_out_list(session, entries)


async def _out_one(session: AsyncSession, entry: JournalEntry) -> TransactionOut:
    return (await _out_many(session, [entry]))[0]


@router.get("")
async def list_transactions(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    entry_type: str | None = None,
    category_id: UUID | None = None,
    account_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = None,
    is_recurring: bool | None = None,
    tags: str | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    q: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entries, total = await transaction_service.list_transactions(
        session,
        current_user.id,
        page=page,
        per_page=per_page,
        entry_type=entry_type,
        category_id=category_id,
        account_id=account_id,
        date_from=date_from,
        date_to=date_to,
        status_=status,
        is_recurring=is_recurring,
        tags=tags.split(",") if tags else None,
        amount_min=amount_min,
        amount_max=amount_max,
        q=q,
    )
    return SuccessResponse(
        data=await _out_many(session, entries),
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: TransactionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.create_transaction(session, current_user.id, data)
    return SuccessResponse(data=await _out_one(session, entry))


@router.post("/split", status_code=status.HTTP_201_CREATED)
async def split_expense(
    data: SplitExpenseCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.split_expense(session, current_user.id, data)
    return SuccessResponse(data=await _out_one(session, entry))


@router.get("/drafts")
async def list_drafts(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entries, total = await transaction_service.list_transactions(
        session, current_user.id, status_="draft", per_page=100
    )
    return SuccessResponse(
        data=await _out_many(session, entries),
        meta=Meta(total=total, page=1, per_page=100),
    )


@router.get("/{entry_id}")
async def get_transaction(
    entry_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.get_transaction(session, current_user.id, entry_id)
    return SuccessResponse(data=await _out_one(session, entry))


@router.put("/{entry_id}")
async def update_transaction(
    entry_id: UUID,
    data: TransactionUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.update_transaction(session, current_user.id, entry_id, data)
    return SuccessResponse(data=await _out_one(session, entry))


@router.delete("/{entry_id}")
async def delete_transaction(
    entry_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await transaction_service.delete_transaction(session, current_user.id, entry_id)
    return SuccessResponse(data={"success": True})


@router.post("/{entry_id}/confirm")
async def confirm_draft(
    entry_id: UUID,
    edits: TransactionUpdate | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.confirm_draft(session, current_user.id, entry_id, edits)
    return SuccessResponse(data=await _out_one(session, entry))


@router.post("/{entry_id}/reject")
async def reject_draft(
    entry_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entry = await transaction_service.reject_draft(session, current_user.id, entry_id)
    return SuccessResponse(data=await _out_one(session, entry))
