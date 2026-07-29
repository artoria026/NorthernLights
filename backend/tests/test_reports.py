import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.services import report_insight_service, report_service
from tests.conftest import rls_session

pytestmark = pytest.mark.asyncio


class _FakeReportAI:
    """Evita llamadas reales de IA en cada test de reportes -- por default
    devuelve un insight fijo; los tests que necesitan otro comportamiento
    (o simular un fallo) sobreescriben `get_ai_provider` puntualmente."""

    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        return [
            {
                "title": "Insight de prueba",
                "description": f"Resumen de {period_label}",
                "flow_type": "expense",
                "category_name": None,
            }
        ]


@pytest.fixture(autouse=True)
def _mock_report_ai(monkeypatch):
    monkeypatch.setattr(report_insight_service, "get_ai_provider", lambda: _FakeReportAI())


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


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "0"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


async def _get_category_id(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    return response.json()["data"][0]["id"]


async def _confirm_income(
    client: AsyncClient, headers: dict, bank_id: str, category_id: str, amount: str, entry_date: str
) -> None:
    income_account = await _create_account(client, headers, type="income", subtype=None)
    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": entry_date,
            "description": "Ingreso",
            "entry_type": "income",
            "category_id": category_id,
            "lines": [
                {"account_id": bank_id, "type": "debit", "amount": amount},
                {"account_id": income_account, "type": "credit", "amount": amount},
            ],
        },
    )
    assert response.status_code == 201, response.text


async def _confirm_expense(
    client: AsyncClient, headers: dict, bank_id: str, category_id: str, amount: str, entry_date: str
) -> None:
    expense_account = await _create_account(client, headers, type="expense", subtype=None)
    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": entry_date,
            "description": "Gasto",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {"account_id": expense_account, "type": "debit", "amount": amount},
                {"account_id": bank_id, "type": "credit", "amount": amount},
            ],
        },
    )
    assert response.status_code == 201, response.text


async def test_generate_report_computes_income_expense_and_net_worth(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    income_category = await _get_category_id(client, headers, "income")
    expense_category = await _get_category_id(client, headers, "expense")

    await _confirm_income(client, headers, bank, income_category, "5000.00", "2026-06-10")
    await _confirm_expense(client, headers, bank, expense_category, "1500.00", "2026-06-15")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    assert response.status_code == 201, response.text
    report = response.json()["data"]
    assert report["status"] == "ready"
    assert report["type"] == "monthly_manual"
    summary = report["summary"]
    assert Decimal(str(summary["income"]["total"])) == Decimal("5000.00")
    assert Decimal(str(summary["expenses"]["total"])) == Decimal("1500.00")
    assert Decimal(str(summary["net_worth"]["start"])) == Decimal("1000.00")
    assert Decimal(str(summary["net_worth"]["end"])) == Decimal("4500.00")
    assert Decimal(str(summary["net_worth"]["delta"])) == Decimal("3500.00")

    notifications = await client.get("/api/v1/notifications", headers=headers)
    types = [n["type"] for n in notifications.json()["data"]]
    assert "report_ready" in types


async def test_generate_report_is_idempotent_for_same_period(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="500")

    body = {"period_start": "2026-05-01", "period_end": "2026-05-31"}
    first = await client.post("/api/v1/reports/generate", headers=headers, json=body)
    second = await client.post("/api/v1/reports/generate", headers=headers, json=body)
    assert first.json()["data"]["id"] == second.json()["data"]["id"]

    listing = await client.get("/api/v1/reports", headers=headers)
    assert listing.json()["meta"]["total"] == 1


async def test_monthly_endpoint_generates_report_on_demand(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="200")

    response = await client.get("/api/v1/reports/monthly/2026/4", headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "ready"
    assert data["period_start"] == "2026-04-01"
    assert data["period_end"] == "2026-04-30"


async def test_current_month_summary_is_cached(client: AsyncClient):
    """Se cachea en redis (report:{user_id}:current:*) -- verificado leyendo
    la key directo, no infiriendolo de si el numero cambia o no despues de
    una mutacion (ver test siguiente para eso)."""
    from app.core.cache_keys import report_key
    from app.core.redis import get_redis

    token, user_id = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.get("/api/v1/reports/summary/current", headers=headers)
    assert first.status_code == 200

    redis = await get_redis()
    cache_key = report_key(uuid.UUID(user_id), "current", {})
    assert await redis.get(cache_key) is not None


async def test_current_month_summary_updates_after_new_transaction(client: AsyncClient):
    """Bug real encontrado en produccion local (ver Notion, sección de
    Troubleshooting del proyecto): cache_service.invalidate_user_current no
    incluia el prefijo report:{user_id}:current, asi que este endpoint podia
    quedar hasta 5 min desactualizado despues de CUALQUIER transaccion --
    incluida una conciliacion de saldo recien hecha, justo el caso donde el
    usuario mas quiere ver el numero fresco de inmediato. Ya corregido; este
    test verifica que SI se actualiza (lo opuesto de lo que afirmaba antes
    la version vieja de este test, que en realidad estaba documentando el bug)."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="0")
    income_category = await _get_category_id(client, headers, "income")

    first = await client.get("/api/v1/reports/summary/current", headers=headers)
    assert first.status_code == 200
    assert first.json()["data"]["income"]["total"] == "0"

    await _confirm_income(client, headers, bank, income_category, "999.00", "2026-08-01")

    second = await client.get("/api/v1/reports/summary/current", headers=headers)
    assert second.json()["data"]["income"]["total"] == "999.00"


async def test_generate_report_marks_error_status_on_failure(
    client: AsyncClient, session_factory, monkeypatch
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)

    async def _boom(*args, **kwargs):
        raise RuntimeError("fallo simulado")

    monkeypatch.setattr(report_service.engine_service, "compute_period_summary", _boom)

    period_start, period_end = date(2026, 3, 1), date(2026, 3, 31)
    async with rls_session(session_factory, uid) as session:
        with pytest.raises(RuntimeError):
            await report_service.generate_report(session, uid, period_start, period_end, "user")

    monkeypatch.undo()

    async with rls_session(session_factory, uid) as session:
        existing = await report_service._get_existing_report(session, uid, period_start, period_end)
        assert existing.status == "error"
        assert existing.error_message == "fallo simulado"


async def test_generate_report_creates_ai_insights_for_full_month(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    report = response.json()["data"]
    assert report["type"] == "monthly_manual"
    assert len(report["insights"]) == 1
    assert report["insights"][0]["flow_type"] == "expense"
    # `_period_label` formatea mes+año (nombre del mes depende del locale del
    # sistema) -- solo verificamos el año, que es estable.
    assert "2026" in report["insights"][0]["description"]


async def test_generate_report_skips_insights_for_custom_range(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-05", "period_end": "2026-06-20"},
    )
    report = response.json()["data"]
    assert report["type"] == "custom"
    assert report["insights"] == []


async def test_report_insight_failure_does_not_break_report(client: AsyncClient, monkeypatch):
    class _BoomAI:
        async def generate_report_insights(self, summary, period_label):
            raise RuntimeError("proveedor caido")

    monkeypatch.setattr(report_insight_service, "get_ai_provider", lambda: _BoomAI())

    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    report = response.json()["data"]
    assert report["status"] == "ready"
    assert report["insights"] == []


async def test_report_insight_invalid_flow_type_coerced_to_general(
    client: AsyncClient, monkeypatch
):
    class _WeirdAI:
        async def generate_report_insights(self, summary, period_label):
            return [{"title": "X", "description": "Y", "flow_type": "not_a_real_type"}]

    monkeypatch.setattr(report_insight_service, "get_ai_provider", lambda: _WeirdAI())

    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    report = response.json()["data"]
    assert report["insights"][0]["flow_type"] == "general"


async def test_generate_yearly_report_requires_existing_monthly_reports(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100")

    response = await client.post("/api/v1/reports/generate", headers=headers, json={"year": 2020})
    assert response.status_code == 400


async def test_generate_yearly_report_aggregates_monthly_reports(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    income_category = await _get_category_id(client, headers, "income")
    expense_category = await _get_category_id(client, headers, "expense")

    await _confirm_income(client, headers, bank, income_category, "3000.00", "2026-01-10")
    await _confirm_expense(client, headers, bank, expense_category, "1000.00", "2026-01-15")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-01-01", "period_end": "2026-01-31"},
    )

    await _confirm_income(client, headers, bank, income_category, "3500.00", "2026-02-10")
    await _confirm_expense(client, headers, bank, expense_category, "1200.00", "2026-02-15")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-02-01", "period_end": "2026-02-28"},
    )

    yearly = await client.post("/api/v1/reports/generate", headers=headers, json={"year": 2026})
    assert yearly.status_code == 201, yearly.text
    report = yearly.json()["data"]
    assert report["type"] == "yearly_manual"
    assert report["period_start"] == "2026-01-01"
    assert report["period_end"] == "2026-12-31"
    summary = report["summary"]
    assert Decimal(str(summary["income"]["total"])) == Decimal("6500.00")
    assert Decimal(str(summary["expenses"]["total"])) == Decimal("2200.00")
    assert len(report["insights"]) == 1


async def test_generate_yearly_report_is_idempotent(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="500")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-01-01", "period_end": "2026-01-31"},
    )

    first = await client.post("/api/v1/reports/generate", headers=headers, json={"year": 2026})
    second = await client.post("/api/v1/reports/generate", headers=headers, json={"year": 2026})
    assert first.json()["data"]["id"] == second.json()["data"]["id"]


async def test_rls_isolates_reports_between_users(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    await _create_account(client, headers_a, initial_balance="100")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers_a,
        json={"period_start": "2026-02-01", "period_end": "2026-02-28"},
    )

    token_b, _ = await _register_and_login(client)
    headers_b = {"Authorization": f"Bearer {token_b}"}
    listing_b = await client.get("/api/v1/reports", headers=headers_b)
    assert listing_b.json()["meta"]["total"] == 0


async def _create_subcategory(client: AsyncClient, headers: dict, parent_id: str, name: str) -> str:
    response = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": name, "type": "expense", "parent_id": parent_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


async def test_monthly_report_rolls_up_subcategory_spend_to_parent(client: AsyncClient):
    """Decision de producto (ver Categorias): el gasto de una subcategoria
    cuenta para el total de su categoria padre en reportes/graficas, con el
    desglose por subcategoria disponible aparte, no como fila propia."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    parent_id = await _get_category_id(client, headers, "expense")
    sub_id = await _create_subcategory(client, headers, parent_id, "Restaurantes")

    await _confirm_expense(client, headers, bank, parent_id, "300.00", "2026-06-05")
    await _confirm_expense(client, headers, bank, sub_id, "150.00", "2026-06-15")

    response = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    assert response.status_code == 201, response.text
    by_category = response.json()["data"]["summary"]["expenses"]["by_category"]

    names = {row["category"] for row in by_category}
    assert "Restaurantes" not in names

    parent_row = next(row for row in by_category if row["category"] != "Restaurantes")
    assert Decimal(str(parent_row["amount"])) == Decimal("450.00")
    assert parent_row["subcategories"] == [{"category": "Restaurantes", "amount": "150.00"}]


async def test_yearly_report_merges_subcategory_breakdown_across_months(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    parent_id = await _get_category_id(client, headers, "expense")
    sub_id = await _create_subcategory(client, headers, parent_id, "Restaurantes")

    await _confirm_expense(client, headers, bank, sub_id, "100.00", "2026-01-10")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-01-01", "period_end": "2026-01-31"},
    )
    await _confirm_expense(client, headers, bank, sub_id, "200.00", "2026-02-10")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-02-01", "period_end": "2026-02-28"},
    )

    yearly = await client.post("/api/v1/reports/generate", headers=headers, json={"year": 2026})
    assert yearly.status_code == 201, yearly.text
    by_category = yearly.json()["data"]["summary"]["expenses"]["by_category"]
    parent_row = next(row for row in by_category if row["category"] != "Restaurantes")
    assert Decimal(str(parent_row["amount"])) == Decimal("300.00")
    assert parent_row["subcategories"] == [{"category": "Restaurantes", "amount": "300.00"}]


async def test_force_regenerates_ready_report_without_duplicating_insights(client: AsyncClient):
    """force=True es para el caso de backfill historico: un mes que ya se
    genero (casi vacio) antes de que el usuario cargara transacciones viejas
    -- sin force, generate_report es idempotente y ni se acerca a los datos
    nuevos (ver test_generate_report_is_idempotent_for_same_period)."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    income_category = await _get_category_id(client, headers, "income")

    first = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    assert first.json()["data"]["summary"]["income"]["total"] == "0"
    assert len(first.json()["data"]["insights"]) == 1
    first_generated_at = first.json()["data"]["generated_at"]

    # Backfill: se agrega una transaccion vieja DESPUES de que el reporte del
    # mes ya estaba 'ready'.
    await _confirm_income(client, headers, bank, income_category, "800.00", "2026-06-10")

    without_force = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
    )
    assert without_force.json()["data"]["summary"]["income"]["total"] == "0"

    forced = await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-06-01", "period_end": "2026-06-30", "force": True},
    )
    assert forced.status_code == 201, forced.text
    data = forced.json()["data"]
    assert data["id"] == first.json()["data"]["id"]
    assert data["summary"]["income"]["total"] == "800.00"
    assert data["generated_at"] != first_generated_at
    # No duplica los ReportInsight ya existentes al recalcular.
    assert len(data["insights"]) == 1


async def test_force_yearly_regeneration_cascades_missing_months(client: AsyncClient):
    """El agregado anual solo suma meses YA 'ready' -- forzar el año sin
    tocar sus meses recalcularia sobre datos mensuales viejos. force=True
    debe generar/recalcular los 12 meses primero (aqui: enero ya generado,
    febrero ni siquiera existia todavia)."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="1000")
    income_category = await _get_category_id(client, headers, "income")

    await _confirm_income(client, headers, bank, income_category, "3000.00", "2026-01-10")
    await client.post(
        "/api/v1/reports/generate",
        headers=headers,
        json={"period_start": "2026-01-01", "period_end": "2026-01-31"},
    )
    yearly_before = await client.post(
        "/api/v1/reports/generate", headers=headers, json={"year": 2026}
    )
    assert yearly_before.json()["data"]["summary"]["income"]["total"] == "3000.00"

    # Backfill de febrero SIN generar su reporte mensual explicitamente --
    # eso es justo lo que force=True debe resolver en el año.
    await _confirm_income(client, headers, bank, income_category, "500.00", "2026-02-10")

    yearly_forced = await client.post(
        "/api/v1/reports/generate", headers=headers, json={"year": 2026, "force": True}
    )
    assert yearly_forced.status_code == 201, yearly_forced.text
    assert yearly_forced.json()["data"]["summary"]["income"]["total"] == "3500.00"
    assert len(yearly_forced.json()["data"]["insights"]) == 1

    february = await client.get("/api/v1/reports/monthly/2026/2", headers=headers)
    assert february.json()["data"]["status"] == "ready"
    assert february.json()["data"]["summary"]["income"]["total"] == "500.00"
