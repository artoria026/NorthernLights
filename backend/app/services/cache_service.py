import json
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

import structlog
from redis.asyncio import Redis

from app.core.cache_keys import (
    CACHE_TTL,
    ai_rate_key,
    budget_alert_key,
    debt_alert_key,
    login_attempts_key,
    snapshot_key,
)
from app.core.redis import get_redis

logger = structlog.get_logger(__name__)

MAX_LOGIN_ATTEMPTS = 5


async def get_or_compute(
    redis: Redis, key: str, compute_fn: Callable[[], Awaitable[Any]], ttl: int
) -> Any:
    """Patron cache-aside generico: usado por M08/M15 en endpoints de reportes."""
    cached = await redis.get(key)
    if cached is not None:
        return json.loads(cached)
    result = await compute_fn()
    await redis.set(key, json.dumps(result, default=str), ex=ttl)
    return result


async def get_financial_snapshot(redis: Redis, user_id: UUID) -> dict | None:
    cached = await redis.get(snapshot_key(user_id))
    return json.loads(cached) if cached is not None else None


async def cache_financial_snapshot(redis: Redis, user_id: UUID, snapshot: dict) -> None:
    await redis.set(
        snapshot_key(user_id), json.dumps(snapshot, default=str), ex=CACHE_TTL["financial_snapshot"]
    )


async def invalidate_user_current(redis: Redis, user_id: UUID) -> None:
    """M04 llama esto al confirmar/editar/eliminar cualquier transaccion."""
    await redis.delete(snapshot_key(user_id))
    prefixes = [
        f"report:{user_id}:monthly",
        f"report:{user_id}:current",
        f"report:{user_id}:budget",
        f"report:{user_id}:health_score",
        f"report:{user_id}:cash_flow",
        f"report:{user_id}:available",
    ]
    for prefix in prefixes:
        async for key in redis.scan_iter(f"{prefix}*"):  # SCAN, nunca KEYS
            await redis.delete(key)


async def invalidate_snapshot_for(user_id: UUID) -> None:
    """Helper de conveniencia para services que crean un registro (cuenta,
    deuda, recurrente) y no reciben `redis` en su firma -- obtiene su propia
    conexion, mismo patron que `transaction_service._invalidate_cache`. Usar
    esto en cualquier `create_*` que cambie el patrimonio/compromisos del
    usuario, para que `snapshot_key` no quede stale hasta que expire su TTL
    de 5 min (ver CACHE_TTL['financial_snapshot'])."""
    redis = await get_redis()
    await invalidate_user_current(redis, user_id)


async def invalidate_debt_progress(redis: Redis, user_id: UUID) -> None:
    """M05 llama esto al registrar un pago de deuda."""
    await redis.delete(snapshot_key(user_id))
    async for key in redis.scan_iter(f"report:{user_id}:debt_progress*"):
        await redis.delete(key)


async def invalidate_budget_cache(redis: Redis, user_id: UUID) -> None:
    """M07 llama esto al cambiar un limite de presupuesto."""
    async for key in redis.scan_iter(f"report:{user_id}:budget*"):
        await redis.delete(key)


async def _flag_already_sent(redis: Redis, key: str) -> bool:
    return bool(await redis.exists(key))


async def _mark_flag_sent(redis: Redis, key: str, ttl: int) -> None:
    await redis.set(key, "1", ex=ttl)


async def budget_alert_already_sent(redis: Redis, user_id: UUID, category_id: UUID) -> bool:
    return await _flag_already_sent(redis, budget_alert_key(user_id, category_id))


async def mark_budget_alert_sent(redis: Redis, user_id: UUID, category_id: UUID) -> None:
    await _mark_flag_sent(
        redis, budget_alert_key(user_id, category_id), CACHE_TTL["budget_alert_flag"]
    )


async def debt_alert_already_sent(
    redis: Redis, user_id: UUID, debt_id: UUID, alert_type: str
) -> bool:
    return await _flag_already_sent(redis, debt_alert_key(user_id, debt_id, alert_type))


async def mark_debt_alert_sent(redis: Redis, user_id: UUID, debt_id: UUID, alert_type: str) -> None:
    await _mark_flag_sent(
        redis, debt_alert_key(user_id, debt_id, alert_type), CACHE_TTL["debt_alert_flag"]
    )


async def invalidate_report_historical(redis: Redis, user_id: UUID) -> None:
    """M15 llama esto al crear un reporte nuevo (la lista historica cambio)."""
    async for key in redis.scan_iter(f"report:{user_id}:historical*"):
        await redis.delete(key)


async def check_ai_rate_limit(redis: Redis, user_id: UUID, limit: int) -> tuple[bool, int]:
    """Atomico via INCR: sin condiciones de carrera entre consultas simultaneas."""
    key = ai_rate_key(user_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, CACHE_TTL["ai_rate_limit"])
    return count <= limit, max(0, limit - count)


async def get_ai_rate_limit_status(redis: Redis, user_id: UUID, limit: int) -> tuple[int, int]:
    """GET puro (sin incrementar) para que el front pueda mostrar cuantas
    consultas quedan hoy sin gastar una -- misma key que check_ai_rate_limit,
    'usadas' es 0 si el usuario no ha preguntado nada todavia hoy."""
    raw = await redis.get(ai_rate_key(user_id))
    used = int(raw) if raw is not None else 0
    return used, max(0, limit - used)


async def register_failed_login(redis: Redis, email: str) -> int:
    """Atomico via INCR, mismo patron que check_ai_rate_limit -- frena fuerza
    bruta/credential stuffing contra una cuenta puntual. Por email, no por
    IP: mas simple y ataca directo el escenario real (probar passwords
    contra una cuenta conocida), sin necesitar extraer la IP del cliente."""
    key = login_attempts_key(email)
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, CACHE_TTL["login_attempts"])
    return attempts


async def is_login_locked(redis: Redis, email: str) -> bool:
    raw = await redis.get(login_attempts_key(email))
    return raw is not None and int(raw) >= MAX_LOGIN_ATTEMPTS


async def clear_failed_logins(redis: Redis, email: str) -> None:
    """Un login correcto desbloquea de inmediato -- no hace falta esperar a
    que expire la ventana de 15 min si el usuario ya probo que es el dueno
    de la cuenta."""
    await redis.delete(login_attempts_key(email))
