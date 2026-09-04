import structlog

from app.core.celery import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(name="email.send")
def send_email(to: str, subject: str, body_html: str) -> None:
    """Synchronous Celery task for sending emails.

    No real email provider connected yet -- explicitly pending Phase 4
    (see Notion). Meanwhile a structured log is left -- same pattern M06
    uses for its reminders -- so as not to block the rest of M11/M14/M15
    which depend on this task.
    """
    logger.info("email_send_stub", to=to, subject=subject, body_preview=body_html[:200])
