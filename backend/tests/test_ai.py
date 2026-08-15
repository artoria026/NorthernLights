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
    """`turns` es una lista de "turnos": cada uno es la lista de chunks que
    `chat_stream` produce en esa invocacion. Simula el loop real de tool-use
    de advisor.chat, donde el proveedor se llama de nuevo tras ejecutar tools."""

    def __init__(self, turns: list[list[dict]] | None = None, captured_messages: list | None = None):
        self._turns = turns if turns is not None else [[{"type": "text", "text": "Hola."}]]
        self._call_count = 0
        # Si se pasa una lista, cada llamada le hace append a los `messages`
        # que recibio -- para poder verificar en el test que un adjunto
        # (bloque "document") de verdad llego hasta el provider.
        self._captured_messages = captured_messages

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        if self._captured_messages is not None:
            self._captured_messages.append(messages)
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
    """`advisor.chat` abre su propia sesion (ver docstring en app/ai/advisor.py)
    para sobrevivir mas alla del ciclo de vida de la dependencia de FastAPI.
    En produccion usa el engine real; en tests la reemplazamos por la sesion
    de prueba (atada a la misma transaccion que se revierte al final del
    test) para que las escrituras no persistan entre tests."""

    def _fake_rls_session(user_id):
        assert user_id == uid
        return _rls_session_factory(session_factory, user_id)

    monkeypatch.setattr(advisor, "rls_session", _fake_rls_session)


_PASSWORD = "supersecret123"


async def _register_and_login_as_admin(client: AsyncClient, session_factory) -> tuple[str, str]:
    """Registra un usuario normal, lo promueve a admin escribiendo el rol
    directo (no hay endpoint de auto-promocion, a proposito) y re-loguea: el
    JWT emitido al registrarse ya trae `role=user` fijo -- mismo patron que
    `_register_admin` en test_admin.py."""
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
    # Bug real: ChatMessage.created_at usaba server_default=func.now(), que
    # devuelve la hora de INICIO de transaccion -- como user+assistant se
    # guardan en la misma transaccion (advisor.chat), ambos quedaban con el
    # mismo created_at y el ORDER BY created_at DESC no garantizaba que el
    # mas reciente (assistant) saliera primero. Ahora created_at es un
    # default de Python (datetime.now(UTC) por fila), asi que el orden es
    # determinista: el mas reciente (assistant) va primero.
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
    """get_problem_debts es el tool que le da al advisor visibilidad sobre
    deudas sin plan de pago (owed_by_me, pending) -- estas no aparecen en
    get_debt_schedule porque no tienen calendario."""
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
    assert history.json()["meta"]["total"] == 2  # el segundo intento no se guarda


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

    # El limite es 1 -- un usuario normal quedaria bloqueado aqui.
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
    """`get_financial_summary` retorna el snapshot real (Decimal incluido) --
    confirma que tool_calls_made pasa por json_safe antes de guardarse en la
    columna JSONB de chat_messages (bug real: Decimal no es serializable)."""
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
    """El stream SSE no debe romperse a medio camino si el proveedor falla
    (p.ej. API key invalida): debe emitir un evento de error + [DONE]."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)

    class BoomProvider(FakeAIProvider):
        async def chat_stream(self, messages, tools, system):
            raise RuntimeError("API key is invalid")
            yield  # pragma: no cover - hace de esto un generador async

    monkeypatch.setattr(advisor, "get_ai_provider", lambda: BoomProvider())

    response = await client.post("/api/v1/ai/chat", headers=headers, data={"message": "Hola"})
    assert response.status_code == 200
    assert "El asesor no pudo responder" in response.text
    assert "[DONE]" in response.text

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 0  # nada se guarda si la llamada fallo


async def test_chat_creates_unplanned_debt(
    client: AsyncClient, session_factory, monkeypatch
):
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
                        "name": "create_unplanned_debt",
                        "input": {"name": "Nu - TDC", "creditor": "Nu", "amount": 47000},
                    }
                ],
                [{"type": "text", "text": "Cree la deuda sin plan Nu - TDC."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Debo 47000 a Nu"}
    )
    assert response.status_code == 200
    assert "Cree la deuda sin plan Nu - TDC." in response.text

    unplanned = await client.get("/api/v1/debts/unplanned", headers=headers)
    names = [d["name"] for d in unplanned.json()["data"]]
    assert "Nu - TDC" in names


async def test_chat_recurring_item_resolves_account_and_category_by_name(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco Santander", "type": "asset", "subtype": "checking"},
    )
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "create_recurring_item",
                        "input": {
                            "name": "Spotify",
                            "item_type": "subscription",
                            "amount": 239.0,
                            "frequency": "monthly",
                            "account_name": "Banco Santander",
                            "category_name": "Ocio y Entretenimiento",
                            "next_date": "2026-09-01",
                        },
                    }
                ],
                [{"type": "text", "text": "Cree tu suscripcion Spotify."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Pago Spotify $239 al mes"}
    )
    assert response.status_code == 200
    assert "Cree tu suscripcion Spotify." in response.text

    recurring = await client.get("/api/v1/recurring-items", headers=headers)
    names = [r["name"] for r in recurring.json()["data"]]
    assert "Spotify" in names


async def test_chat_unknown_account_name_returns_readable_error_not_crash(
    client: AsyncClient, session_factory, monkeypatch
):
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
                        "name": "create_recurring_item",
                        "input": {
                            "name": "Spotify",
                            "item_type": "subscription",
                            "amount": 239.0,
                            "frequency": "monthly",
                            "account_name": "Cuenta que no existe",
                            "category_name": "Ocio y Entretenimiento",
                            "next_date": "2026-09-01",
                        },
                    }
                ],
                [{"type": "text", "text": "No encontre esa cuenta, ¿me confirmas el nombre?"}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Pago Spotify $239 al mes"}
    )
    assert response.status_code == 200
    assert "No encontre esa cuenta" in response.text

    recurring = await client.get("/api/v1/recurring-items", headers=headers)
    assert recurring.json()["data"] == []


async def test_chat_invalid_enum_returns_readable_error_not_crash(
    client: AsyncClient, session_factory, monkeypatch
):
    """Si el modelo manda un `type` que no existe (alucinacion o ignoro el
    enum del schema), debe llegar como alerta legible en el tool_result, no
    tumbar todo el stream con el mensaje generico de error."""
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
                        "name": "create_account",
                        "input": {"name": "Cuenta rara", "type": "banco_magico"},
                    }
                ],
                [{"type": "text", "text": "No pude crear esa cuenta, el tipo no es valido."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Tengo una cuenta rara"}
    )
    assert response.status_code == 200
    assert "No pude crear esa cuenta, el tipo no es valido." in response.text
    assert "El asesor no pudo responder" not in response.text

    accounts = await client.get("/api/v1/accounts", headers=headers)
    assert accounts.json()["data"] == []


async def test_chat_negative_amount_returns_readable_error(
    client: AsyncClient, session_factory, monkeypatch
):
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
                        "name": "create_unplanned_debt",
                        "input": {"name": "Deuda rara", "amount": -100},
                    }
                ],
                [
                    {
                        "type": "text",
                        "text": "Ese monto no puede ser negativo, ¿me confirmas la cifra?",
                    }
                ],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Debo -100 pesos"}
    )
    assert response.status_code == 200
    assert "Ese monto no puede ser negativo" in response.text

    unplanned = await client.get("/api/v1/debts/unplanned", headers=headers)
    assert unplanned.json()["data"] == []


async def test_chat_missing_required_field_returns_readable_error(
    client: AsyncClient, session_factory, monkeypatch
):
    """El modelo olvida un campo requerido (p.ej. next_date) -- debe ser un
    KeyError capturado, no un 500 ni un crash del stream completo."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco Santander", "type": "asset", "subtype": "checking"},
    )
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "create_recurring_item",
                        "input": {
                            "name": "Spotify",
                            "item_type": "subscription",
                            "amount": 239.0,
                            "frequency": "monthly",
                            "account_name": "Banco Santander",
                            "category_name": "Ocio y Entretenimiento",
                            # next_date faltante a proposito
                        },
                    }
                ],
                [{"type": "text", "text": "¿Que dia del mes se cobra Spotify?"}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Pago Spotify $239 al mes"}
    )
    assert response.status_code == 200
    assert "Que dia del mes se cobra Spotify" in response.text

    recurring = await client.get("/api/v1/recurring-items", headers=headers)
    assert recurring.json()["data"] == []


async def test_chat_recovers_after_failed_tool_call_in_same_turn(
    client: AsyncClient, session_factory, monkeypatch
):
    """Tras un tool_result de error, la sesion/transaccion RLS debe seguir
    sana: una segunda tool en el MISMO turno debe poder crear su registro
    con normalidad (nada se corrompe por el fallo anterior)."""
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
                        "name": "create_account",
                        "input": {"name": "Cuenta rara", "type": "banco_magico"},
                    },
                    {
                        "type": "tool_use",
                        "id": "tool_2",
                        "name": "create_account",
                        "input": {"name": "Efectivo", "type": "asset", "subtype": "cash"},
                    },
                ],
                [{"type": "text", "text": "Cree Efectivo; la otra cuenta tenia un tipo invalido."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Tengo dos cuentas"}
    )
    assert response.status_code == 200
    assert "Cree Efectivo; la otra cuenta tenia un tipo invalido." in response.text

    accounts = await client.get("/api/v1/accounts", headers=headers)
    names = [a["name"] for a in accounts.json()["data"]]
    assert names == ["Efectivo"]


async def test_chat_create_transaction_resolves_account_and_category(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Santander", "type": "asset", "subtype": "checking"},
    )
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "create_transaction",
                        "input": {
                            "date": "2026-08-10",
                            "entry_type": "expense",
                            "amount": 100.0,
                            "description": "Comida",
                            "account_name": "Santander",
                            "category_name": "Comida y Bebidas",
                        },
                    },
                    {
                        "type": "tool_use",
                        "id": "tool_2",
                        "name": "create_transaction",
                        "input": {
                            "date": "2026-08-11",
                            "entry_type": "expense",
                            "amount": 1000.0,
                            "description": "Salida con la novia",
                            "account_name": "Santander",
                            "category_name": "Comida y Bebidas",
                        },
                    },
                ],
                [{"type": "text", "text": "Registre los dos gastos en Santander."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": "Gaste 100 en comida y 1000 en salir con mi novia, todo en Santander"},
    )
    assert response.status_code == 200
    assert "Registre los dos gastos en Santander." in response.text

    transactions = await client.get("/api/v1/transactions?per_page=10", headers=headers)
    descriptions = {t["description"] for t in transactions.json()["data"]}
    assert descriptions == {"Comida", "Salida con la novia"}


async def test_chat_create_transaction_unknown_account_returns_readable_error(
    client: AsyncClient, session_factory, monkeypatch
):
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
                        "name": "create_transaction",
                        "input": {
                            "date": "2026-08-10",
                            "entry_type": "expense",
                            "amount": 100.0,
                            "description": "Comida",
                            "account_name": "Cuenta que no existe",
                            "category_name": "Comida y Bebidas",
                        },
                    }
                ],
                [{"type": "text", "text": "No encontre esa cuenta, ¿cual usamos?"}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Gaste 100 en comida"}
    )
    assert response.status_code == 200
    assert "No encontre esa cuenta" in response.text

    transactions = await client.get("/api/v1/transactions?per_page=10", headers=headers)
    assert transactions.json()["data"] == []


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


async def test_chat_can_create_account_scoped_to_user(
    client: AsyncClient, session_factory, monkeypatch
):
    """El chat tiene las tools de escritura de app/ai/write_tools.py --
    create_account queda scopeada al usuario autenticado via la misma sesion
    RLS que abre chat()."""
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
                        "name": "create_account",
                        "input": {
                            "name": "Banco Santander",
                            "type": "asset",
                            "subtype": "checking",
                            "initial_balance": 1000,
                        },
                    }
                ],
                [{"type": "text", "text": "Listo, cree tu cuenta Banco Santander."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Crea una cuenta Santander con 1000"}
    )
    assert response.status_code == 200
    assert "Listo, cree tu cuenta Banco Santander." in response.text

    accounts = await client.get("/api/v1/accounts", headers=headers)
    names = [a["name"] for a in accounts.json()["data"]]
    assert "Banco Santander" in names

    history = await client.get("/api/v1/ai/history", headers=headers)
    assert history.json()["meta"]["total"] == 2


async def test_chat_propose_action_does_not_write_anything(
    client: AsyncClient, session_factory, monkeypatch
):
    """propose_action (ver write_tools.py + advisor.execute()) es solo para
    que el frontend dibuje la tarjeta de confirmacion -- no debe tocar la
    base de datos, y sus datos deben llegar intactos a tool_calls para que
    Advisor.tsx pueda renderizar los campos."""
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
                        "name": "propose_action",
                        "input": {
                            "action": "create_account",
                            "summary": "Crear cuenta Banco Santander",
                            "fields": [
                                {"label": "Nombre", "value": "Banco Santander"},
                                {"label": "Saldo inicial", "value": "$1,000.00"},
                            ],
                        },
                    }
                ],
                [{"type": "text", "text": "Confirmas que la registre?"}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat", headers=headers, data={"message": "Crea una cuenta Santander con 1000"}
    )
    assert response.status_code == 200
    assert "Confirmas que la registre?" in response.text

    accounts = await client.get("/api/v1/accounts", headers=headers)
    assert accounts.json()["data"] == []

    history = await client.get("/api/v1/ai/history", headers=headers)
    tool_calls = history.json()["data"][0]["tool_calls"]
    assert tool_calls == [
        {
            "tool": "propose_action",
            "result": {
                "proposed": True,
                "action": "create_account",
                "summary": "Crear cuenta Banco Santander",
                "fields": [
                    {"label": "Nombre", "value": "Banco Santander"},
                    {"label": "Saldo inicial", "value": "$1,000.00"},
                ],
            },
        }
    ]


async def test_chat_write_tool_refreshes_snapshot_within_same_turn(
    client: AsyncClient, session_factory, monkeypatch
):
    """account_service.create_account no invalidaba/refrescaba el snapshot
    cacheado (gap preexistente). Ahora, si el modelo crea una cuenta y en el
    mismo turno pide get_financial_summary, debe ver el patrimonio ya
    actualizado en vez del snapshot viejo capturado al abrir chat()."""
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
                        "name": "create_account",
                        "input": {
                            "name": "Banco Santander",
                            "type": "asset",
                            "subtype": "checking",
                            "initial_balance": 1500,
                        },
                    },
                    {
                        "type": "tool_use",
                        "id": "tool_2",
                        "name": "get_financial_summary",
                        "input": {},
                    },
                ],
                [{"type": "text", "text": "Ya quedo registrada."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": "Crea la cuenta y dime mi patrimonio"},
    )
    assert response.status_code == 200

    history = await client.get("/api/v1/ai/history", headers=headers)
    assistant_msg = next(m for m in history.json()["data"] if m["role"] == "assistant")
    tool_calls = {tc["tool"]: tc["result"] for tc in assistant_msg["tool_calls"]}
    assert tool_calls["create_account"]["created"] is True
    net_worth = tool_calls["get_financial_summary"]["net_worth"]["net_worth"]
    assert Decimal(str(net_worth)) == Decimal("1500")


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
    """El PDF llega al provider ya sin contrasena, como bloque 'document' en
    el shape nativo de Anthropic -- ver advisor.chat."""
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


async def test_create_debt_with_initial_charge_creates_debt_and_transaction(
    client: AsyncClient, session_factory, monkeypatch
):
    """Una MSI leida de un estado de cuenta: create_debt con initial_charge
    debe crear la Debt Y la transaccion de la compra completa contra la TDC
    en un solo tool call (ver write_tools.py + debt_service.create_debt)."""
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)

    tdc = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "TDC Platino",
            "type": "liability",
            "subtype": "credit_card",
            "initial_balance": "0",
        },
    )
    assert tdc.status_code == 201
    tdc_id = tdc.json()["data"]["id"]

    categories = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    category_name = categories[0]["name"]

    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=[
                [
                    {
                        "type": "tool_use",
                        "id": "tool_1",
                        "name": "create_debt",
                        "input": {
                            "name": "Laptop a 12 meses",
                            "type": "installment",
                            "total_amount": 12000,
                            "payment_amount": 1000,
                            "payment_frequency": "monthly",
                            "total_installments": 12,
                            "initial_charge": {
                                "category_name": category_name,
                                "paying_account_name": "TDC Platino",
                                "description": "Laptop a 12 meses",
                            },
                        },
                    }
                ],
                [{"type": "text", "text": "Listo, registre la laptop a 12 meses."}],
            ]
        ),
    )

    response = await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": "Compre una laptop a 12 meses en mi TDC"},
    )
    assert response.status_code == 200
    assert "Listo, registre la laptop a 12 meses." in response.text

    debts = (await client.get("/api/v1/debts", headers=headers)).json()["data"]
    assert len(debts) == 1
    assert debts[0]["name"] == "Laptop a 12 meses"
    assert debts[0]["total_amount"] == "12000.00"

    tdc_after = await client.get(f"/api/v1/accounts/{tdc_id}", headers=headers)
    assert tdc_after.json()["data"]["balance"] == "12000.00"  # cargo completo, de una vez
