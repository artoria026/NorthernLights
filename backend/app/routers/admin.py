from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_admin_db, get_db, get_rls_db
from app.core.redis import get_redis
from app.core.security import CurrentUser, require_admin
from app.schemas.admin import (
    AdminPasswordResetOut,
    AdminStats,
    AdminUserActiveUpdate,
    AdminUserOut,
    AdminUserRoleUpdate,
)
from app.schemas.common import Meta, SuccessResponse
from app.schemas.feedback import FeedbackAdminOut, FeedbackStatusUpdate
from app.services import admin_service, feedback_service

router = APIRouter()


@router.get("/users")
async def list_users(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_admin_db),
) -> SuccessResponse:
    users, total = await admin_service.list_users(session, page, per_page, search)
    return SuccessResponse(
        data=[AdminUserOut(**u) for u in users],
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.patch("/users/{user_id}/active")
async def set_user_active(
    user_id: UUID,
    body: AdminUserActiveUpdate,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse:
    user = await admin_service.set_user_active(session, user_id, body.is_active, current_admin.id)
    return SuccessResponse(data={"id": str(user.id), "is_active": user.is_active})


@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: UUID,
    body: AdminUserRoleUpdate,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse:
    user = await admin_service.set_user_role(session, user_id, body.role, current_admin.id)
    return SuccessResponse(data={"id": str(user.id), "role": user.role})


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: UUID,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse:
    temporary_password = await admin_service.reset_user_password(session, user_id)
    return SuccessResponse(data=AdminPasswordResetOut(temporary_password=temporary_password))


@router.get("/stats")
async def get_stats(
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_admin_db),
) -> SuccessResponse:
    redis = await get_redis()
    stats = await admin_service.get_stats(session, redis)
    return SuccessResponse(data=AdminStats(**stats))


@router.get("/feedback")
async def list_feedback(
    status: str | None = Query(default=None, pattern="^(new|read|considered|discarded)$"),
    current_admin: CurrentUser = Depends(require_admin),
    # get_rls_db (no get_admin_db): la policy rls_feedback ya deja ver todas
    # las filas a un admin en su propia sesion -- get_admin_db es solo
    # SELECT y aca tambien necesitamos poder actualizar el status.
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await feedback_service.list_feedback(session, status)
    return SuccessResponse(data=[FeedbackAdminOut(**item) for item in items])


@router.patch("/feedback/{feedback_id}/status")
async def update_feedback_status(
    feedback_id: UUID,
    body: FeedbackStatusUpdate,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    feedback = await feedback_service.update_status(session, feedback_id, body.status)
    return SuccessResponse(data={"id": str(feedback.id), "status": feedback.status})
