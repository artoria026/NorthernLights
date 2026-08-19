from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate
from app.services import notification_service

# Solo estos dos estados son "resoluciones" que ameritan avisarle al usuario
# -- new/read son transiciones puramente internas del lado admin, notificarlas
# saturaria al usuario sin decirle nada nuevo sobre su reporte.
_NOTIFY_STATUSES = {
    "considered": "Tu feedback fue considerado",
    "discarded": "Tu feedback no será implementado",
}


async def create_feedback(session: AsyncSession, user_id: UUID, data: FeedbackCreate) -> Feedback:
    feedback = Feedback(user_id=user_id, type=data.type, message=data.message)
    session.add(feedback)
    await session.flush()
    return feedback


async def list_own_feedback(session: AsyncSession, user_id: UUID) -> list[Feedback]:
    result = await session.execute(
        select(Feedback).where(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())
    )
    return list(result.scalars().all())


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
            "admin_note": feedback.admin_note,
            "created_at": feedback.created_at,
            "updated_at": feedback.updated_at,
        }
        for feedback, name, email in result.all()
    ]


async def update_status(
    session: AsyncSession,
    feedback_id: UUID,
    new_status: str,
    admin_note: str | None,
    current_admin_id: UUID,
) -> Feedback:
    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feedback no encontrado")
    feedback.status = new_status
    if admin_note is not None:
        feedback.admin_note = admin_note
    await session.flush()

    title = _NOTIFY_STATUSES.get(new_status)
    if title is not None:
        # `notifications` tiene FORCE ROW LEVEL SECURITY con
        # user_id = current_user_id de la sesion -- la sesion de este request
        # trae seteado el id del admin, no el del dueño del feedback (casi
        # siempre otra persona), asi que el INSERT normal fallaria el WITH
        # CHECK. En vez de abrir una conexion nueva (rompe bajo el harness de
        # tests, que inyecta la sesion de request por dependencia atada a una
        # sola conexion/transaccion por test), se reapunta `app.current_user_id`
        # a el en LA MISMA sesion/transaccion -- set_config(..., true) es
        # LOCAL a la transaccion y se puede recambiar cuantas veces haga
        # falta -- y se restaura al id del admin antes de devolver el control
        # al router, por si el request hace algo mas despues.
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(feedback.user_id)},
        )
        await notification_service.create(
            session,
            user_id=feedback.user_id,
            type_="feedback_status_changed",
            title=title,
            body=admin_note,
            related_entity_type="feedback",
            related_entity_id=feedback.id,
        )
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(current_admin_id)},
        )

    return feedback
