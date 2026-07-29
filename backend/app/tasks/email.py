import structlog

from app.core.celery import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(name="email.send")
def send_email(to: str, subject: str, body_html: str) -> None:
    """Tarea Celery sincrona para envio de emails.

    No hay proveedor de email real conectado todavia -- explicitamente
    pendiente de Fase 4 (ver Notion). Mientras tanto se deja un log
    estructurado -- mismo patron que M06 usa para sus recordatorios -- para
    no bloquear el resto de M11/M14/M15 que dependen de esta tarea.
    """
    logger.info("email_send_stub", to=to, subject=subject, body_preview=body_html[:200])
