from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import SuccessResponse
from app.schemas.tag import BulkTagRequest, BulkTagResult, TagCreate, TagOut, TagUpdate
from app.services import tag_service

router = APIRouter()


@router.get("")
async def list_tags(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    return SuccessResponse(data=await tag_service.list_tags(session, current_user.id))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tag(
    data: TagCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    tag = await tag_service.create_tag(session, current_user.id, data)
    return SuccessResponse(data=TagOut.model_validate(tag))


@router.post("/bulk")
async def bulk_tag_transactions(
    data: BulkTagRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    updated = await tag_service.apply_bulk(session, current_user.id, data)
    return SuccessResponse(data=BulkTagResult(updated=updated))


@router.patch("/{tag_id}")
async def update_tag(
    tag_id: UUID,
    data: TagUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    tag = await tag_service.update_tag(session, current_user.id, tag_id, data)
    return SuccessResponse(data=TagOut.model_validate(tag))


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> Response:
    await tag_service.delete_tag(session, current_user.id, tag_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{tag_id}/summary")
async def tag_summary(
    tag_id: UUID,
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    summary = await tag_service.get_summary(session, current_user.id, tag_id, date_from, date_to)
    return SuccessResponse(data=summary)
