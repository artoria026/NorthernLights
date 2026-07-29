from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "finanzas",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Mexico_City",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "recurring-process-due": {
        "task": "recurring.process_due",
        "schedule": crontab(hour=0, minute=5),
    },
    "recurring-remind-pending": {
        "task": "recurring.remind_pending",
        "schedule": crontab(hour=9, minute=0),
    },
    "debts-process-due-payments": {
        "task": "debts.process_due_payments",
        "schedule": crontab(hour=0, minute=10),
    },
    "budget-initialize-month": {
        "task": "budget.initialize_month",
        "schedule": crontab(hour=0, minute=1, day_of_month=1),
    },
    "alerts-process-debt-and-tdc": {
        "task": "alerts.process_debt_and_tdc",
        "schedule": crontab(hour=8, minute=10),
    },
    "alerts-process-overdue-loans": {
        "task": "alerts.process_overdue_loans",
        "schedule": crontab(hour=8, minute=15),
    },
    "insights-review-due": {
        "task": "insights.review_due",
        "schedule": crontab(hour=8, minute=0),
    },
    "generate-monthly-reports": {
        "task": "reports.generate_monthly",
        "schedule": crontab(day_of_month="1", hour="1", minute="0"),
    },
    "generate-yearly-reports": {
        "task": "reports.generate_yearly",
        # Despues del job mensual (1:00 AM) del 1ro de enero -- para entonces
        # ya existe el reporte mensual de diciembre del año que cierra.
        "schedule": crontab(month_of_year="1", day_of_month="1", hour="2", minute="0"),
    },
}

# autodiscover_tasks importa "<pkg>.tasks" por cada paquete en la lista; como
# nuestro paquete de tareas ya se llama "app.tasks", hay que apuntar a "app"
# (importa app.tasks, cuyo __init__ registra los submodulos reales).
celery_app.autodiscover_tasks(["app"])
