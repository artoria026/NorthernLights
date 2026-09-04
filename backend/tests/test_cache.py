import uuid
from datetime import date

import pytest

from app.core.redis import get_redis
from app.services import cache_service

pytestmark = pytest.mark.asyncio


async def test_get_or_compute_hit_and_miss():
    redis = await get_redis()
    key = f"test:{uuid.uuid4()}"
    calls = 0

    async def compute():
        nonlocal calls
        calls += 1
        return {"value": 42}

    first = await cache_service.get_or_compute(redis, key, compute, ttl=60)
    second = await cache_service.get_or_compute(redis, key, compute, ttl=60)

    assert first == {"value": 42}
    assert second == {"value": 42}
    assert calls == 1  # second call came from cache, didn't recompute

    await redis.delete(key)


async def test_financial_snapshot_cache_roundtrip():
    redis = await get_redis()
    user_id = uuid.uuid4()

    assert await cache_service.get_financial_snapshot(redis, user_id) is None

    await cache_service.cache_financial_snapshot(redis, user_id, {"net_worth": "100.00"})
    cached = await cache_service.get_financial_snapshot(redis, user_id)
    assert cached == {"net_worth": "100.00"}

    await cache_service.invalidate_user_current(redis, user_id)
    assert await cache_service.get_financial_snapshot(redis, user_id) is None


async def test_invalidate_user_current_uses_scan_for_report_keys():
    redis = await get_redis()
    user_id = uuid.uuid4()
    report_keys = [
        f"report:{user_id}:monthly:abc123",
        f"report:{user_id}:budget:def456",
    ]
    for key in report_keys:
        await redis.set(key, "1", ex=60)

    await cache_service.invalidate_user_current(redis, user_id)

    for key in report_keys:
        assert await redis.get(key) is None


async def test_budget_alert_anti_spam():
    redis = await get_redis()
    user_id, category_id = uuid.uuid4(), uuid.uuid4()

    assert await cache_service.budget_alert_already_sent(redis, user_id, category_id) is False
    await cache_service.mark_budget_alert_sent(redis, user_id, category_id)
    assert await cache_service.budget_alert_already_sent(redis, user_id, category_id) is True


async def test_debt_alert_anti_spam():
    redis = await get_redis()
    user_id, debt_id = uuid.uuid4(), uuid.uuid4()

    assert await cache_service.debt_alert_already_sent(redis, user_id, debt_id, "due_soon") is False
    await cache_service.mark_debt_alert_sent(redis, user_id, debt_id, "due_soon")
    assert await cache_service.debt_alert_already_sent(redis, user_id, debt_id, "due_soon") is True
    # A different alert_type is a different alert (doesn't share the flag)
    assert await cache_service.debt_alert_already_sent(redis, user_id, debt_id, "overdue") is False


async def test_ai_rate_limit_is_atomic_and_caps_at_limit():
    redis = await get_redis()
    user_id = uuid.uuid4()

    for expected_remaining in (2, 1, 0):
        allowed, remaining = await cache_service.check_ai_rate_limit(redis, user_id, limit=3)
        assert allowed is True
        assert remaining == expected_remaining

    allowed, remaining = await cache_service.check_ai_rate_limit(redis, user_id, limit=3)
    assert allowed is False
    assert remaining == 0

    await redis.delete(f"ai_rate:{user_id}:{date.today().isoformat()}")
