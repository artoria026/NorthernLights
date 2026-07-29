from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import Meta, SuccessResponse
from app.schemas.recurring import (
    RecurringItemCreate,
    RecurringItemOut,
    RecurringItemUpdate,
    RecurringSummary,
)
from app.services import recurring_service, transaction_service

router = APIRouter()


@router.get("")
async def list_recurring_items(
    status: str | None = None,
    item_type: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await recurring_service.list_recurring_items(
        session, current_user.id, status, item_type
    )
    return SuccessResponse(data=[RecurringItemOut.model_validate(i) for i in items])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_recurring_item(
    data: RecurringItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.create_recurring_item(session, current_user.id, data)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))


@router.get("/upcoming")
async def upcoming(
    days_ahead: int = Query(default=30, ge=1, le=365),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await recurring_service.get_upcoming(session, current_user.id, days_ahead)
    return SuccessResponse(data=[RecurringItemOut.model_validate(i) for i in items])


@router.get("/pending")
async def pending(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    entries = await recurring_service.get_pending(session, current_user.id)
    out = await transaction_service.to_transaction_out_list(session, entries)
    return SuccessResponse(
        data=out,
        meta=Meta(total=len(entries), page=1, per_page=100),
    )


@router.get("/summary")
async def summary(
    exclude_income: bool = False,
    item_type: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    data = await recurring_service.get_summary(
        session, current_user.id, exclude_income=exclude_income, item_type=item_type
    )
    return SuccessResponse(data=RecurringSummary(**data))


@router.get("/{item_id}")
async def get_recurring_item(
    item_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.get_recurring_item(session, current_user.id, item_id)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))


@router.put("/{item_id}")
async def update_recurring_item(
    item_id: UUID,
    data: RecurringItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.update_recurring_item(session, current_user.id, item_id, data)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))


@router.patch("/{item_id}/pause")
async def pause_recurring_item(
    item_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.pause_recurring_item(session, current_user.id, item_id)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))


@router.patch("/{item_id}/cancel")
async def cancel_recurring_item(
    item_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.cancel_recurring_item(session, current_user.id, item_id)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))


@router.patch("/{item_id}/resume")
async def resume_recurring_item(
    item_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    item = await recurring_service.resume_recurring_item(session, current_user.id, item_id)
    return SuccessResponse(data=RecurringItemOut.model_validate(item))
