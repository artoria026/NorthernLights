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
    """Generic cache-aside pattern: used by M08/M15 in report endpoints."""
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
    """M04 calls this when confirming/editing/deleting any transaction."""
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
        async for key in redis.scan_iter(f"{prefix}*"):  # SCAN, never KEYS
            await redis.delete(key)


async def invalidate_snapshot_for(user_id: UUID) -> None:
    """Convenience helper for services that create a record (account, debt,
    recurring item) and don't receive `redis` in their signature -- gets its
    own connection, same pattern as `transaction_service._invalidate_cache`.
    Use this in any `create_*` that changes the user's net worth/commitments,
    so `snapshot_key` doesn't stay stale until its 5 min TTL expires
    (see CACHE_TTL['financial_snapshot'])."""
    redis = await get_redis()
    await invalidate_user_current(redis, user_id)


async def invalidate_debt_progress(redis: Redis, user_id: UUID) -> None:
    """M05 calls this when recording a debt payment."""
    await redis.delete(snapshot_key(user_id))
    async for key in redis.scan_iter(f"report:{user_id}:debt_progress*"):
        await redis.delete(key)


async def invalidate_budget_cache(redis: Redis, user_id: UUID) -> None:
    """M07 calls this when changing a budget limit."""
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
    """M15 calls this when creating a new report (the historical list changed)."""
    async for key in redis.scan_iter(f"report:{user_id}:historical*"):
        await redis.delete(key)


async def check_ai_rate_limit(redis: Redis, user_id: UUID, limit: int) -> tuple[bool, int]:
    """Atomic via INCR: no race conditions between simultaneous requests."""
    key = ai_rate_key(user_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, CACHE_TTL["ai_rate_limit"])
    return count <= limit, max(0, limit - count)


async def get_ai_rate_limit_status(redis: Redis, user_id: UUID, limit: int) -> tuple[int, int]:
    """Pure GET (no increment) so the frontend can show how many queries are
    left today without spending one -- same key as check_ai_rate_limit,
    'used' is 0 if the user hasn't asked anything yet today."""
    raw = await redis.get(ai_rate_key(user_id))
    used = int(raw) if raw is not None else 0
    return used, max(0, limit - used)


async def register_failed_login(redis: Redis, email: str) -> int:
    """Atomic via INCR, same pattern as check_ai_rate_limit -- throttles brute
    force/credential stuffing against a specific account. By email, not by
    IP: simpler and goes straight at the real scenario (trying passwords
    against a known account), without needing to extract the client's IP."""
    key = login_attempts_key(email)
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, CACHE_TTL["login_attempts"])
    return attempts


async def is_login_locked(redis: Redis, email: str) -> bool:
    raw = await redis.get(login_attempts_key(email))
    return raw is not None and int(raw) >= MAX_LOGIN_ATTEMPTS


async def clear_failed_logins(redis: Redis, email: str) -> None:
    """A successful login unlocks immediately -- no need to wait for the
    15 min window to expire if the user already proved they're the account
    owner."""
    await redis.delete(login_attempts_key(email))
