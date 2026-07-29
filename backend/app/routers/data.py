from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import SuccessResponse
from app.schemas.data import DataEraseRequest, DataEraseResponse
from app.services import data_service

router = APIRouter()


@router.post("/erase")
async def erase_data(
    data: DataEraseRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    erased = await data_service.erase_user_data(
        session, current_user.id, data.categories, data.password
    )
    return SuccessResponse(data=DataEraseResponse(erased=erased))
