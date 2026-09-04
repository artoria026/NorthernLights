from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate
from app.services import notification_service

# Only these two statuses are "resolutions" that warrant notifying the user
# -- new/read are purely internal admin-side transitions, notifying those
# would spam the user without telling them anything new about their report.
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
    """Requires an RLS session from an admin user -- the rls_feedback policy
    is what actually enables seeing other users' rows, this doesn't do any
    bypass of its own (see require_admin in the router)."""
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
        # `notifications` has FORCE ROW LEVEL SECURITY with
        # user_id = current_user_id from the session -- this request's
        # session has the admin's id set, not the feedback owner's (almost
        # always someone else), so the normal INSERT would fail the WITH
        # CHECK. Instead of opening a new connection (breaks under the test
        # harness, which injects the request session via a dependency tied
        # to a single connection/transaction per test), `app.current_user_id`
        # is repointed to them in THE SAME session/transaction -- set_config(
        # ..., true) is LOCAL to the transaction and can be switched back as
        # many times as needed -- and it's restored to the admin's id before
        # returning control to the router, in case the request does
        # something else afterward.
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
