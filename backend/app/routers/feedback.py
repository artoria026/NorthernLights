from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_rls_db
from app.core.security import CurrentUser, get_current_user
from app.schemas.common import SuccessResponse
from app.schemas.feedback import FeedbackCreate, FeedbackOut
from app.services import feedback_service

router = APIRouter()


@router.post("", status_code=201)
async def create_feedback(
    data: FeedbackCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    feedback = await feedback_service.create_feedback(session, current_user.id, data)
    return SuccessResponse(data=FeedbackOut.model_validate(feedback))


@router.get("")
async def list_own_feedback(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    items = await feedback_service.list_own_feedback(session, current_user.id)
    return SuccessResponse(data=[FeedbackOut.model_validate(item) for item in items])
