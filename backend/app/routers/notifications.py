from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import Meta, SuccessResponse
from app.schemas.notification import NotificationOut, UnreadCount
from app.services import notification_service

router = APIRouter()


@router.get("")
async def list_notifications(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    notifications, total = await notification_service.list_notifications(
        session, current_user.id, page, per_page
    )
    return SuccessResponse(
        data=[NotificationOut.model_validate(n) for n in notifications],
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.get("/unread-count")
async def unread_count(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    count = await notification_service.unread_count(session, current_user.id)
    return SuccessResponse(data=UnreadCount(unread_count=count))


@router.patch("/read-all")
async def mark_all_read(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await notification_service.mark_all_read(session, current_user.id)
    return SuccessResponse(data={"success": True})


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    notification = await notification_service.mark_read(session, current_user.id, notification_id)
    return SuccessResponse(data=NotificationOut.model_validate(notification))


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await notification_service.delete_notification(session, current_user.id, notification_id)
    return SuccessResponse(data={"success": True})
