import uuid
from collections.abc import AsyncGenerator
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.ai.base import AIProvider
from app.models.insight import Insight
from app.schemas.insight import InsightCreateFromChat
from app.services import insight_service
from tests.conftest import rls_session

pytestmark = pytest.mark.asyncio


class FakeAIProvider(AIProvider):
    def __init__(self, insights: list[dict] | None = None, review: dict | None = None):
        self._insights = insights if insights is not None else []
        self._review = review or {"trend": "stable", "ai_assessment": "Sin cambios relevantes."}

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        if False:  # pragma: no cover - only to satisfy the async generator signature
            yield {}

    async def generate_insights(self, snapshot: dict) -> list[dict]:
        return self._insights

    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        return self._review

    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        return []


async def _register_and_login(client: AsyncClient) -> tuple[str, str]:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Test", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    token = login.json()["data"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    return token, me.json()["data"]["id"]


async def test_generate_insights_creates_from_snapshot(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(
        insight_service,
        "get_ai_provider",
        lambda: FakeAIProvider(
            insights=[
                {
                    "title": "Gasto alto en restaurantes",
                    "description": "...",
                    "category": "spending",
                },
                {
                    "title": "Deuda TDC creciendo",
                    "description": "...",
                    "category": "debt",
                    "priority": "high",
                },
            ]
        ),
    )
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post("/api/v1/insights/generate", headers=headers)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert len(data) == 2
    assert {i["category"] for i in data} == {"spending", "debt"}

    listing = await client.get("/api/v1/insights", headers=headers)
    assert len(listing.json()["data"]) == 2


async def test_generate_insights_dedup_by_category(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(
        insight_service,
        "get_ai_provider",
        lambda: FakeAIProvider(
            insights=[{"title": "Insight 1", "description": "...", "category": "savings"}]
        ),
    )
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.post("/api/v1/insights/generate", headers=headers)
    assert len(first.json()["data"]) == 1

    second = await client.post("/api/v1/insights/generate", headers=headers)
    assert second.json()["data"] == []

    listing = await client.get("/api/v1/insights", headers=headers)
    assert len(listing.json()["data"]) == 1


async def test_dismiss_and_resolve(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(
        insight_service,
        "get_ai_provider",
        lambda: FakeAIProvider(
            insights=[
                {"title": "Insight A", "description": "...", "category": "income"},
                {"title": "Insight B", "description": "...", "category": "budget"},
            ]
        ),
    )
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    generated = await client.post("/api/v1/insights/generate", headers=headers)
    insight_a, insight_b = generated.json()["data"]

    dismissed = await client.patch(f"/api/v1/insights/{insight_a['id']}/dismiss", headers=headers)
    assert dismissed.json()["data"]["status"] == "dismissed"

    resolved = await client.patch(f"/api/v1/insights/{insight_b['id']}/resolve", headers=headers)
    assert resolved.json()["data"]["status"] == "resolved"

    active = await client.get("/api/v1/insights", headers=headers)
    assert active.json()["data"] == []

    history = await client.get("/api/v1/insights/history", headers=headers)
    assert history.json()["meta"]["total"] == 2


async def test_review_insight_updates_trend_and_schedules_next_review(
    client: AsyncClient, session_factory, monkeypatch
):
    monkeypatch.setattr(
        insight_service,
        "get_ai_provider",
        lambda: FakeAIProvider(
            insights=[{"title": "Ahorro bajo", "description": "...", "category": "savings"}]
        ),
    )
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    generated = await client.post("/api/v1/insights/generate", headers=headers)
    insight_id = generated.json()["data"][0]["id"]

    monkeypatch.setattr(
        insight_service,
        "get_ai_provider",
        lambda: FakeAIProvider(
            review={"trend": "improved", "ai_assessment": "Mejoraste tu ahorro."}
        ),
    )

    async with rls_session(session_factory, uid) as session:
        insight = await insight_service.get_insight(session, uid, uuid.UUID(insight_id))
        review = await insight_service.review_insight(session, insight, snapshot={"net_worth": {}})
        assert review.trend == "improved"
        assert insight.review_count == 1
        assert insight.last_reviewed_at is not None
        assert insight.next_review_at > date.today()

    reviews = await client.get(f"/api/v1/insights/{insight_id}/reviews", headers=headers)
    assert len(reviews.json()["data"]) == 1
    assert reviews.json()["data"][0]["trend"] == "improved"


async def test_create_from_chat_dedup(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)

    async with rls_session(session_factory, uid) as session:
        first = await insight_service.create_from_chat(
            session,
            uid,
            InsightCreateFromChat(title="Plan de pago", description="...", category="debt"),
            snapshot={},
        )
        assert first["insight_id"] is not None

        second = await insight_service.create_from_chat(
            session,
            uid,
            InsightCreateFromChat(title="Otro plan", description="...", category="debt"),
            snapshot={},
        )
        assert second["insight_id"] is None
        assert "note" in second


async def test_enforce_active_limit_dismisses_oldest_lowest_priority(
    client: AsyncClient, session_factory
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)

    async with rls_session(session_factory, uid) as session:
        categories = ["spending", "debt", "savings", "income", "budget", "general"]
        for i in range(11):
            insight = Insight(
                user_id=uid,
                title=f"Insight {i}",
                description="...",
                category=categories[i % len(categories)],
                priority="low" if i == 0 else "high",
                generated_by="auto_celery",
                ai_provider="claude",
                ai_context={},
                metrics_at_creation={},
                review_frequency="monthly",
                next_review_at=date.today() + timedelta(days=30),
            )
            session.add(insight)
        await session.flush()

        await insight_service._enforce_active_limit(session, uid)

        active = await insight_service.list_active(session, uid)
        assert len(active) == 10
        assert all(i.title != "Insight 0" for i in active)


async def test_get_due_insights_returns_pairs_for_due_reviews(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)

    async with rls_session(session_factory, uid) as session:
        insight = Insight(
            user_id=uid,
            title="Vencido",
            description="...",
            category="spending",
            priority="medium",
            generated_by="auto_celery",
            ai_provider="claude",
            ai_context={},
            metrics_at_creation={},
            review_frequency="weekly",
            next_review_at=date.today() - timedelta(days=1),
        )
        session.add(insight)
        await session.flush()
        insight_id = insight.id

    async with rls_session(session_factory, uid) as session:
        due = await insight_service.get_due_insights(session, date.today())
        assert (insight_id, uid) in due


async def test_rls_isolates_insights_between_users(client: AsyncClient, session_factory):
    token_a, user_id_a = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    uid_a = uuid.UUID(user_id_a)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    async with rls_session(session_factory, uid_a) as session:
        await insight_service.create_from_chat(
            session,
            uid_a,
            InsightCreateFromChat(title="Solo para A", description="...", category="general"),
            snapshot={},
        )

    listing_b = await client.get("/api/v1/insights", headers=headers_b)
    assert listing_b.json()["data"] == []
