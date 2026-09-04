import json
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import Device, User

logger = structlog.get_logger(__name__)


async def _get_active_devices_with_token(session: AsyncSession, user_id: UUID) -> list[Device]:
    result = await session.execute(
        select(Device).where(
            Device.user_id == user_id,
            Device.is_active.is_(True),
            Device.push_token.is_not(None),
        )
    )
    return list(result.scalars().all())


async def _deactivate_device_token(session: AsyncSession, device_id: UUID) -> None:
    device = await session.get(Device, device_id)
    if device is not None:
        device.push_token = None


async def send_push_notification(
    session: AsyncSession, user_id: UUID, title: str, body: str, data: dict | None = None
) -> None:
    """Sends a push to every active device of the user that has a push_token.

    No Firebase credentials configured yet (FIREBASE_CREDENTIALS_JSON
    empty): left as a no-op with a structured log, ready to activate as
    soon as a real Firebase project exists. The rest of the flow (event
    detection, anti-spam, in-app notification) is already functional
    without this.
    """
    devices = await _get_active_devices_with_token(session, user_id)
    if not devices:
        return

    if not settings.FIREBASE_CREDENTIALS_JSON:
        logger.info(
            "push_skipped_no_firebase_credentials",
            user_id=str(user_id),
            device_count=len(devices),
            title=title,
        )
        return

    import firebase_admin  # lazy import: only if credentials are configured
    from firebase_admin import messaging

    if not firebase_admin._apps:
        cred_data = json.loads(settings.FIREBASE_CREDENTIALS_JSON)
        firebase_admin.initialize_app(firebase_admin.credentials.Certificate(cred_data))

    messages = [
        messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data or {},
            token=device.push_token,
        )
        for device in devices
    ]
    response = messaging.send_each(messages)

    for device, result in zip(devices, response.responses, strict=True):
        if not result.success and "registration-token-not-registered" in str(result.exception):
            await _deactivate_device_token(session, device.id)


async def send_push_if_enabled(session: AsyncSession, user_id: UUID, title: str, body: str) -> None:
    """Only sends a push if the user has push_notifications=True."""
    user = await session.get(User, user_id)
    if user is not None and user.preferences.push_notifications:
        await send_push_notification(session, user_id, title, body)
