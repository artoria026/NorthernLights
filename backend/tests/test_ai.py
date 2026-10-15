import io
import uuid
from collections.abc import AsyncGenerator
from decimal import Decimal

import pytest
from httpx import AsyncClient
from pypdf import PdfWriter
from sqlalchemy import text

from app.ai import advisor
from app.ai.base import AIProvider
from tests.conftest import rls_session as _rls_session_factory

pytestmark = pytest.mark.asyncio


def _make_encrypted_pdf(password: str) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt(password)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


class FakeAIProvider(AIProvider):
    """`turns` is a list of "turns": each one is the list of chunks that
    `chat_stream` produces on that call. Simulates the real tool-use loop
    of advisor.chat, where the provider is called again after tools run."""

    def __init__(
        self,
        turns: list[list[dict]] | None = None,
        captured_messages: list | None = None,
        captured_systems: list | None = None,
        captured_tools: list | None = None,
    ):
        self._turns = turns if turns is not None else [[{"type": "text", "text": "Hola."}]]
        self._call_count = 0
        # If a list is passed, each call appends to it the `messages`
        # it received -- so the test can verify that an attachment
        # (a "document" block) actually reached the provider. Same for the system
        # prompt and the tools the model was offered.
        self._captured_messages = captured_messages
        self._captured_systems = captured_systems
        self._captured_tools = captured_tools

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        if self._captured_messages is not None:
            self._captured_messages.append(messages)
        if self._captured_systems is not None:
            self._captured_systems.append(system)
        if self._captured_tools is not None:
            self._captured_tools.append([t["name"] for t in tools])
        turn = self._turns[min(self._call_count, len(self._turns) - 1)]
        self._call_count += 1
        for chunk in turn:
            yield chunk

    async def generate_insights(self, snapshot: dict) -> list[dict]:
        return []

    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        return {"trend": "stable", "ai_assessment": ""}

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


def _use_test_session(monkeypatch, session_factory, uid: uuid.UUID) -> None:
    """`advisor.chat` opens its own session (see docstring in app/ai/advisor.py)
    to survive beyond the FastAPI dependency's lifecycle.
    In production it uses the real engine; in tests we replace it with the
    test session (bound to the same transaction that rolls back at the end
    of the test) so writes don't persist between tests."""

    def _fake_rls_session(user_id):
        assert user_id == uid
        return _rls_session_factory(session_factory, user_id)

    monkeypatch.setattr(advisor, "rls_session", _fake_rls_session)


_PASSWORD = "supersecret123"


async def _register_and_login_as_admin(client: AsyncClient, session_factory) -> tuple[str, str]:
    """Registers a normal user, promotes them to admin by writing the role
    directly (there is no self-promotion endpoint, on purpose) and logs in again: the
    JWT issued at registration already carries `role=user` fixed -- same pattern as
    `_register_admin` in test_admin.py."""
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Admin", "password": _PASSWORD, "accept_disclaimer": True},
    )
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    token = login.json()["data"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["data"]["id"]

    async with session_factory() as session:
        await session.execute(
            text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": user_id}
        )
        await session.commit()

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    return login.json()["data"]["access_token"], user_id


async def test_chat_simple_message_streams_text_and_saves_history(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(turns=[[{"type": "text", "text": "Tu balance es de $1,000."}]]),
    )

    response = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    assert response.status_code == 200
    assert "Tu balance es de $1,000." in response.text
    assert "[DONE]" in response.text

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 2
    # Real bug: ChatMessage.created_at used server_default=func.now(), which
    # returns the transaction START time -- since user+assistant are
    # saved in the same transaction (advisor.chat), both ended up with the
    # same created_at and ORDER BY created_at DESC didn't guarantee that the
    # most recent one (assistant) came out first. Now created_at is a
    # Python default (datetime.now(UTC) per row), so the order is
    # deterministic: the most recent one (assistant) comes first.
    assert history.json()["data"][0]["role"] == "assistant"
    assert history.json()["data"][1]["role"] == "user"
    roles = [m["role"] for m in history.json()["data"]]
    assert set(roles) == {"user", "assistant"}


async def test_chat_tool_use_creates_insight(client: AsyncClient, session_factory, monkeypatch):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "create_insight",
                        "input": {
                            "title": "Reduce gastos hormiga",
                            "description": "Estas gastando de mas en delivery.",
                            "category": "spending",
                        },
                    }
                ],
                [{"type": "text", "text": "Guarde tu plan de ahorro."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Guarda un plan para ahorrar"}
    )
    assert response.status_code == 200
    assert "Guarde tu plan de ahorro." in response.text

    insights = await client.get("/api/v1/insights", headers=headers)
    assert len(insights.json()["data"]) == 1
    assert insights.json()["data"][0]["category"] == "spending"


async def test_chat_tool_use_gets_problem_debts(client: AsyncClient, session_factory, monkeypatch):
    """get_problem_debts is the tool that gives the advisor visibility into
    debts without a payment plan (owed_by_me, pending) -- these don't show up in
    get_debt_schedule because they have no schedule."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)

    unplanned = await client.post(
        "/api/v1/debts/unplanned",
        headers=headers,
        json={"name": "Prestamo de un amigo", "amount": "3000.00", "direction": "owed_by_me"},
    )
    assert unplanned.status_code == 201, unplanned.text

    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [{"type": "tool_use", "id": "tool_1", "name": "get_problem_debts", "input": {}}],
                [{"type": "text", "text": "Encontre tu deuda sin plan."}],
            ]
        ),
    )

    captured: dict = {}
    original_execute = advisor.execute_tool

    async def _capturing_execute(session, redis, user_id_, tool_name, tool_input, snapshot):
        result = await original_execute(session, redis, user_id_, tool_name, tool_input, snapshot)
        if tool_name == "get_problem_debts":
            captured["result"] = result
        return result

    monkeypatch.setattr(advisor, "execute_tool", _capturing_execute)

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Ayudame a salir de mis deudas"}
    )
    assert response.status_code == 200
    assert "Encontre tu deuda sin plan." in response.text

    without_plan = captured["result"]["without_payment_plan"]
    assert len(without_plan) == 1
    assert without_plan[0]["name"] == "Prestamo de un amigo"
    assert without_plan[0]["amount"] == "3000.00"


async def test_chat_rate_limit_blocks_after_daily_limit(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider())
    monkeypatch.setattr(advisor.settings, "AI_RATE_LIMIT_PER_USER_DAY", 1)

    first = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    assert "Hola." in first.text

    second = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Otra vez"})
    assert "Limite diario de consultas AI alcanzado" in second.text

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 2  # the second attempt isn't saved


async def test_ai_usage_reflects_queries_made_today(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider())
    monkeypatch.setattr(advisor.settings, "AI_RATE_LIMIT_PER_USER_DAY", 5)

    before = await client.get("/api/v1/ai/usage", headers=headers)
    assert before.json()["data"] == {
        "used_today": 0,
        "remaining_today": 5,
        "limit_per_day": 5,
        "unlimited": False,
    }

    await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})

    after = await client.get("/api/v1/ai/usage", headers=headers)
    assert after.json()["data"] == {
        "used_today": 1,
        "remaining_today": 4,
        "limit_per_day": 5,
        "unlimited": False,
    }


async def test_admin_ai_bypasses_daily_rate_limit(client: AsyncClient, session_factory, monkeypatch):
    token, user_id = await _register_and_login_as_admin(client, session_factory)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider())
    monkeypatch.setattr(advisor.settings, "AI_RATE_LIMIT_PER_USER_DAY", 1)

    usage = await client.get("/api/v1/ai/usage", headers=headers)
    assert usage.json()["data"]["unlimited"] is True

    first = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    assert "Hola." in first.text

    # The limit is 1 -- a normal user would be blocked here.
    second = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Otra vez"})
    assert "Limite diario de consultas AI alcanzado" not in second.text
    assert "Hola." in second.text


async def test_delete_history_clears_messages(client: AsyncClient, session_factory, monkeypatch):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider())

    await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    deleted = await client.delete("/api/v1/ai/history", headers=headers)
    assert deleted.status_code == 200

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 0


async def test_chat_tool_result_with_decimal_values_persists_successfully(
    client: AsyncClient, session_factory, monkeypatch
):
    """`get_financial_summary` returns the real snapshot (Decimal included) --
    confirms that tool_calls_made goes through json_safe before being saved in the
    JSONB column of chat_messages (real bug: Decimal isn't serializable)."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "get_financial_summary",
                        "input": {},
                    }
                ],
                [{"type": "text", "text": "Ese es tu resumen."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Dame mi resumen financiero"}
    )
    assert response.status_code == 200
    assert "Ese es tu resumen." in response.text

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 2


async def test_chat_provider_failure_yields_graceful_error(
    client: AsyncClient, session_factory, monkeypatch
):
    """The SSE stream must not break halfway through if the provider fails
    (e.g. invalid API key): it must emit an error event + [DONE]."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)

    class BoomProvider(FakeAIProvider):
        async def chat_stream(self, messages, tools, system):
            raise RuntimeError("API key is invalid")
            yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(advisor, "get_ai_provider", lambda: BoomProvider())

    response = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    assert response.status_code == 200
    assert "El asesor no pudo responder" in response.text
    assert "[DONE]" in response.text

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 0  # nothing is saved if the call fails


async def test_rls_isolates_chat_history_between_users(
    client: AsyncClient, session_factory, monkeypatch
):
    token_a, user_id_a = await _register_and_login(client)
    uid_a = uuid.UUID(user_id_a)
    _use_test_session(monkeypatch, session_factory, uid_a)
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider())

    headers_a = {"Authorization": f"Bearer {token_a}"}
    await client.post("/api/v1/ai/chat", headers=headers_a, data={"message": "Hola"})

    token_b, _ = await _register_and_login(client)
    headers_b = {"Authorization": f"Bearer {token_b}"}
    history_b = await client.get("/api/v1/ai/history", headers=headers_b)
    assert history_b.json()["meta"]["total"] == 0


async def test_chat_pdf_wrong_password_returns_clean_error(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    pdf = _make_encrypted_pdf("correcta123")

    response = await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": "Aqui esta mi estado de cuenta", "pdf_password": "incorrecta"},
        files={"attachments": ("estado.pdf", pdf, "application/pdf")},
    )
    assert response.status_code == 400
    assert "contraseña" in response.json()["error"].lower()


async def test_chat_pdf_attachment_reaches_provider_as_document_block(
    client: AsyncClient, session_factory, monkeypatch
):
    """The PDF reaches the provider already without a password, as a 'document'
    block in Anthropic's native shape -- see advisor.chat."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)

    captured: list = []
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[[{"type": "text", "text": "Vi tu estado de cuenta."}]],
            captured_messages=captured,
        ),
    )

    pdf = _make_encrypted_pdf("clave123")
    response = await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": "Son 3 meses de mi TDC", "pdf_password": "clave123"},
        files={"attachments": ("estado.pdf", pdf, "application/pdf")},
    )
    assert response.status_code == 200
    assert "Vi tu estado de cuenta." in response.text

    assert len(captured) == 1
    user_content = captured[0][-1]["content"]
    assert isinstance(user_content, list)
    doc_blocks = [b for b in user_content if b["type"] == "document"]
    assert len(doc_blocks) == 1
    assert doc_blocks[0]["source"]["media_type"] == "application/pdf"
    text_blocks = [b for b in user_content if b["type"] == "text"]
    assert text_blocks[0]["text"] == "Son 3 meses de mi TDC"
