"""M09: patrones de clave y TTLs de Redis (DB 0 = app cache).

DB 1 y 2 (Celery broker/result backend) se configuran aparte en
`app/core/celery.py` via CELERY_BROKER_URL/CELERY_RESULT_BACKEND.
"""

import hashlib
import json
from datetime import date
from uuid import UUID

CACHE_TTL = {
    "financial_snapshot": 300,  # 5 min - snapshot para AI
    "report_monthly_current": 300,  # 5 min - mes en curso
    "report_budget_current": 300,  # 5 min - presupuesto mes actual
    "health_score": 300,  # 5 min
    "cash_flow_projection": 600,  # 10 min
    "available_spending": 300,  # 5 min
    "debt_progress": 60,  # 1 min - cambia con pagos
    "report_monthly_historic": 604800,  # 7 dias - meses pasados no cambian
    "report_historical_list": 3600,  # 1 hora - lista de reportes (M15)
    "report_budget_historic": 604800,  # 7 dias
    "net_worth_historic": 604800,  # 7 dias
    "subscription_cost": 3600,  # 1 hora
    "budget_alert_flag": 86400,  # 24h - anti-spam
    "debt_alert_flag": 86400,  # 24h - anti-spam (M11)
    "ai_rate_limit": 86400,  # 24h - rate limiting
    "login_attempts": 900,  # 15 min - ventana de intentos fallidos de login
}


def snapshot_key(user_id: UUID) -> str:
    return f"snapshot:{user_id}"


def ai_rate_key(user_id: UUID) -> str:
    return f"ai_rate:{user_id}:{date.today().isoformat()}"


def budget_alert_key(user_id: UUID, category_id: UUID) -> str:
    return f"budget_alert:{user_id}:{category_id}:{date.today().isoformat()}"


def debt_alert_key(user_id: UUID, debt_id: UUID, alert_type: str) -> str:
    return f"debt_alert:{user_id}:{debt_id}:{alert_type}:{date.today().isoformat()}"


def login_attempts_key(email: str) -> str:
    return f"login_attempts:{email.strip().lower()}"


def report_key(user_id: UUID, report_type: str, params: dict) -> str:
    digest = hashlib.md5(
        json.dumps(params, sort_keys=True, default=str).encode(), usedforsecurity=False
    ).hexdigest()[:8]
    return f"report:{user_id}:{report_type}:{digest}"
