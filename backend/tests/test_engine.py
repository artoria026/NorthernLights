import uuid
from datetime import date
from decimal import Decimal

import pytest
from dateutil.relativedelta import relativedelta
from httpx import AsyncClient

from app.services import engine_service

pytestmark = pytest.mark.asyncio


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


async def test_calculate_runway_pure_function():
    result = engine_service.calculate_runway(Decimal("3000"), Decimal("0"))
    assert result["label"] == "Sin compromisos fijos"

    result = engine_service.calculate_runway(Decimal("3000"), Decimal("3000"))
    assert result["days"] == 30


async def test_net_worth_with_assets_and_liabilities(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, name="Banco", initial_balance="5000")
    await _create_account(
        client, headers, name="TDC", type="liability", subtype="credit_card", initial_balance="1200"
    )

    response = await client.get("/api/v1/engine/net-worth", headers=headers)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total_assets"] == "5000.00"
    assert body["total_liabilities"] == "1200.00"
    assert body["net_worth"] == "3800.00"


async def test_income_estimate_falls_back_to_recurring_base(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="0")
    income_account = await _create_account(client, headers, type="income", subtype=None)
    income_category = await _get_category_id(client, headers, "income")

    await client.post(
        "/api/v1/recurring-items",
        headers=headers,
        json={
            "name": "Nomina",
            "item_type": "income",
            "amount": "10000.00",
            "frequency": "monthly",
            "account_id": bank,
            "contra_account_id": income_account,
            "category_id": income_category,
            "next_date": date.today().isoformat(),
        },
    )

    response = await client.get("/api/v1/engine/income", headers=headers)
    body = response.json()["data"]
    assert body["data_quality"] == "recurring_base"
    assert Decimal(body["estimated_monthly"]) == Decimal("10000.00")


async def test_income_estimate_uses_historical_average_after_three_months(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="0")
    income_category = await _get_category_id(client, headers, "income")

    today = date.today()
    for months_ago, amount in [(0, "3000.00"), (1, "4000.00"), (2, "5000.00")]:
        entry_date = (today.replace(day=1) - relativedelta(months=months_ago)).isoformat()
        await _confirm_income(client, headers, bank, income_category, amount, entry_date)

    response = await client.get("/api/v1/engine/income", headers=headers)
    body = response.json()["data"]
    assert body["data_quality"] == "historical"
    assert Decimal(body["historical_avg_3m"]) == Decimal("4000.00")
    assert Decimal(body["estimated_monthly"]) == Decimal("4000.00")


async def test_health_score_perfect_with_no_debt_and_liquid_cash(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="100000")

    response = await client.get("/api/v1/engine/health-score", headers=headers)
    assert response.status_code == 200
    body = response.json()["data"]
    # No commitments and no credit cards: DTI=100, credit=100, emergency=100
    # (committed=0 -> 99 months)
    assert body["components"]["dti"]["score"] == 100.0
    assert body["components"]["credit_utilization"]["score"] == 100.0
    assert body["components"]["emergency_coverage_months"]["score"] == 100.0


async def test_health_score_credit_utilization_component(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(
        client,
        headers,
        name="TDC",
        type="liability",
        subtype="credit_card",
        initial_balance="4500",
        credit_limit="5000",
    )

    response = await client.get("/api/v1/engine/health-score", headers=headers)
    body = response.json()["data"]
    credit = body["components"]["credit_utilization"]
    assert credit["value"] == 0.9
    assert credit["score"] == 0.0


async def test_available_spending_today_week_month(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="1000")

    for period in ("today", "week", "month"):
        response = await client.get(f"/api/v1/engine/available?period={period}", headers=headers)
        assert response.status_code == 200
        assert response.json()["data"]["period"] == period


async def test_cash_flow_projection_includes_debt_payment(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="2000")

    next_payment = (date.today() + relativedelta(days=5)).isoformat()
    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo",
            "type": "personal_loan",
            "total_amount": "500.00",
            "payment_amount": "200.00",
            "payment_frequency": "monthly",
            "next_payment_date": next_payment,
        },
    )

    response = await client.get("/api/v1/engine/cash-flow?days=10", headers=headers)
    assert response.status_code == 200
    days = response.json()["data"]
    assert len(days) == 11
    day_with_event = next(d for d in days if d["date"] == next_payment)
    assert any(
        e["type"] == "debt" and Decimal(e["amount"]) == Decimal("-200.00")
        for e in day_with_event["events"]
    )
    balance_before = Decimal(
        [d for d in days if d["date"] == date.today().isoformat()][0]["balance"]
    )
    balance_after = Decimal(day_with_event["balance"])
    assert balance_after == balance_before - Decimal("200.00")


async def test_financial_snapshot_has_all_sections(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, initial_balance="1000")

    response = await client.get("/api/v1/engine/snapshot", headers=headers)
    assert response.status_code == 200
    body = response.json()["data"]
    for key in (
        "as_of",
        "net_worth",
        "income",
        "committed_monthly",
        "spent_this_month",
        "health_score",
        "available_this_week",
        "upcoming_7_days",
        "runway",
    ):
        assert key in body


async def test_simulate_new_debt_increases_committed_and_dti(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank = await _create_account(client, headers, initial_balance="0")
    income_account = await _create_account(client, headers, type="income", subtype=None)
    income_category = await _get_category_id(client, headers, "income")
    await client.post(
        "/api/v1/recurring-items",
        headers=headers,
        json={
            "name": "Nomina",
            "item_type": "income",
            "amount": "10000.00",
            "frequency": "monthly",
            "account_id": bank,
            "contra_account_id": income_account,
            "category_id": income_category,
            "next_date": date.today().isoformat(),
        },
    )

    response = await client.post(
        "/api/v1/engine/simulate",
        headers=headers,
        json={"type": "new_debt", "monthly_amount": "1000.00"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert Decimal(body["delta"]["monthly_committed"]) == Decimal("1000.00")
    assert Decimal(body["after"]["dti"]) > Decimal(body["before"]["dti"])


async def test_simulate_extra_payment_increases_net_worth(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Deuda", "type": "personal_loan", "total_amount": "1000.00"},
    )
    debt_id = debt.json()["data"]["id"]

    response = await client.post(
        "/api/v1/engine/simulate",
        headers=headers,
        json={"type": "extra_payment", "debt_id": debt_id, "amount": "300.00"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert Decimal(body["delta"]["net_worth"]) == Decimal("300.00")


async def test_rls_isolates_engine_between_users(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    await _create_account(client, headers_a, initial_balance="5000")

    response_b = await client.get("/api/v1/engine/net-worth", headers=headers_b)
    assert Decimal(response_b.json()["data"]["net_worth"]) == Decimal("0")
