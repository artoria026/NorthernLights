from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.category import (
    CategoryCreate,
    CategoryImportRequest,
    CategoryImportResult,
    CategoryOut,
    CategorySummaryItem,
    CategoryUpdate,
)
from app.schemas.common import SuccessResponse
from app.services import category_service

router = APIRouter()


@router.get("")
async def list_categories(
    type: str | None = Query(default=None, pattern="^(income|expense)$"),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    categories = await category_service.list_categories(session, current_user.id, type)
    return SuccessResponse(data=[CategoryOut.model_validate(c) for c in categories])


@router.get("/hidden")
async def list_hidden_categories(
    type: str | None = Query(default=None, pattern="^(income|expense)$"),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    categories = await category_service.list_hidden_categories(session, current_user.id, type)
    return SuccessResponse(data=[CategoryOut.model_validate(c) for c in categories])


@router.get("/summary")
async def category_summary(
    year: int = Query(default_factory=lambda: date.today().year),
    month: int = Query(default_factory=lambda: date.today().month, ge=1, le=12),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    totals = await category_service.get_month_summary(session, current_user.id, year, month)
    return SuccessResponse(
        data=[CategorySummaryItem(category_id=cid, total=total) for cid, total in totals.items()]
    )


@router.get("/export")
async def export_categories(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> Response:
    export = await category_service.export_categories(session, current_user.id)
    filename = f"categorias_{date.today().isoformat()}.json"
    return Response(
        content=export.model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_categories(
    data: CategoryImportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    result = await category_service.import_categories(session, current_user.id, data)
    return SuccessResponse(data=CategoryImportResult(**result))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_category(
    data: CategoryCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    category = await category_service.create_category(session, current_user.id, data)
    return SuccessResponse(data=CategoryOut.model_validate(category))


@router.put("/{category_id}")
async def update_category(
    category_id: UUID,
    data: CategoryUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    category = await category_service.update_category(session, current_user.id, category_id, data)
    return SuccessResponse(data=CategoryOut.model_validate(category))


@router.delete("/{category_id}")
async def delete_category(
    category_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await category_service.delete_category(session, current_user.id, category_id)
    return SuccessResponse(data={"success": True})


@router.post("/{category_id}/deactivate")
async def deactivate_category(
    category_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    category = await category_service.deactivate_category(session, current_user.id, category_id)
    return SuccessResponse(data=CategoryOut.model_validate(category))


@router.post("/{category_id}/reactivate")
async def reactivate_category(
    category_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    category = await category_service.reactivate_category(session, current_user.id, category_id)
    return SuccessResponse(data=CategoryOut.model_validate(category))
