from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User

# High-impact events: besides the in-app notification, an email is sent
# (if the user hasn't disabled it in their preferences). The rest are in-app only.
HIGH_IMPACT_TYPES = ("report_ready", "tdc_due")


async def create(
    session: AsyncSession,
    user_id: UUID,
    type_: str,
    title: str,
    body: str | None = None,
    action_url: str | None = None,
    related_entity_type: str | None = None,
    related_entity_id: UUID | None = None,
) -> Notification:
    """Single write point for `notifications`: all modules (M04-M07, M11,
    M13, M15) call here instead of inserting directly."""
    notification = Notification(
        user_id=user_id,
        title=title,
        body=body,
        type=type_,
        action_url=action_url,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )
    session.add(notification)
    await session.flush()
    return notification


async def send_email_notification(
    session: AsyncSession, user_id: UUID, subject: str, body_html: str
) -> None:
    """Email only for high-impact events. Respects
    `users.email_notifications`. Sends via Celery (app/tasks/email.py)."""
    user = await session.get(User, user_id)
    if user is None or not user.preferences.email_notifications:
        return

    from app.tasks.email import send_email

    send_email.delay(to=user.email, subject=subject, body_html=body_html)


async def list_notifications(
    session: AsyncSession, user_id: UUID, page: int = 1, per_page: int = 20
) -> tuple[list[Notification], int]:
    query = select(Notification).where(Notification.user_id == user_id)
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar_one()
    query = (
        query.order_by(Notification.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    result = await session.execute(query)
    return list(result.scalars().all()), total


async def unread_count(session: AsyncSession, user_id: UUID) -> int:
    result = await session.execute(
        select(func.count()).where(Notification.user_id == user_id, Notification.is_read.is_(False))
    )
    return result.scalar_one()


async def _get_notification(
    session: AsyncSession, user_id: UUID, notification_id: UUID
) -> Notification:
    result = await session.execute(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id
        )
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notificacion no encontrada")
    return notification


async def mark_read(session: AsyncSession, user_id: UUID, notification_id: UUID) -> Notification:
    notification = await _get_notification(session, user_id, notification_id)
    notification.is_read = True
    notification.read_at = datetime.now(UTC)
    await session.flush()
    return notification


async def mark_all_read(session: AsyncSession, user_id: UUID) -> None:
    result = await session.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.is_read.is_(False))
    )
    now = datetime.now(UTC)
    for notification in result.scalars():
        notification.is_read = True
        notification.read_at = now


async def delete_notification(session: AsyncSession, user_id: UUID, notification_id: UUID) -> None:
    notification = await _get_notification(session, user_id, notification_id)
    await session.delete(notification)
