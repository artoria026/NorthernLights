from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate


async def create_feedback(session: AsyncSession, user_id: UUID, data: FeedbackCreate) -> Feedback:
    feedback = Feedback(user_id=user_id, type=data.type, message=data.message)
    session.add(feedback)
    await session.flush()
    return feedback


async def list_feedback(session: AsyncSession, status_filter: str | None = None) -> list[dict]:
    """Requiere una sesion RLS de un usuario admin -- la policy rls_feedback
    es la que realmente habilita ver filas de otros usuarios, esto no hace
    ningun bypass propio (ver require_admin en el router)."""
    query = (
        select(Feedback, User.name, User.email)
        .join(User, User.id == Feedback.user_id)
        .order_by(Feedback.created_at.desc())
    )
    if status_filter:
        query = query.where(Feedback.status == status_filter)
    result = await session.execute(query)
    return [
        {
            "id": feedback.id,
            "user_id": feedback.user_id,
            "user_name": name,
            "user_email": email,
            "type": feedback.type,
            "message": feedback.message,
            "status": feedback.status,
            "created_at": feedback.created_at,
            "updated_at": feedback.updated_at,
        }
        for feedback, name, email in result.all()
    ]


async def update_status(session: AsyncSession, feedback_id: UUID, new_status: str) -> Feedback:
    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feedback no encontrado")
    feedback.status = new_status
    await session.flush()
    return feedback
