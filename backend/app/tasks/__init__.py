from app.tasks import (  # noqa: F401  (registers tasks with celery_app)
    alerts,
    budget,
    debts,
    email,
    insights,
    recurring,
    reports,
)
