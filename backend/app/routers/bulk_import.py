from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.bulk_import import BulkImportResult
from app.schemas.common import SuccessResponse
from app.services import account_service, bulk_import_service, category_service

router = APIRouter()

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/template")
async def download_template(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> StreamingResponse:
    accounts = await account_service.list_accounts(session, current_user.id)
    income_categories = await category_service.list_categories(session, current_user.id, "income")
    expense_categories = await category_service.list_categories(session, current_user.id, "expense")
    buf = bulk_import_service.build_template_workbook(
        accounts, income_categories, expense_categories
    )
    return StreamingResponse(
        buf,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=plantilla_transacciones.xlsx"},
    )


@router.post("/upload")
async def upload_bulk_import(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    content = await file.read()
    parsed = bulk_import_service.parse_upload(content)
    result = await bulk_import_service.commit_parsed_rows(session, current_user.id, parsed)
    return SuccessResponse(data=BulkImportResult(**result))
