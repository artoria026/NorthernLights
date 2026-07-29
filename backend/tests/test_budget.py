import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from dateutil.relativedelta import relativedelta
from httpx import AsyncClient

from app.models.budget import BudgetPeriod
from tests.conftest import rls_session

pytestmark = pytest.mark.asyncio


async def _register_and_login(client: AsyncClient) -> tuple[str, str]:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Test", "password": "supersecret123"},
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
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def _get_category_id(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    return response.json()["data"][0]["id"]


async def _confirm_expense(
    client: AsyncClient, headers: dict, category_id: str, amount: str, entry_date: str
) -> None:
    expense_account = await _create_account(client, headers, type="expense", subtype=None)
    bank = await _create_account(client, headers, initial_balance="10000")
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
                {"account_id": bank, "type": "credit", "amount": amount},
            ],
        },
    )
    assert response.status_code == 201, response.text


async def test_set_and_get_limits(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    updated = await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "3000.00"}]},
    )
    assert updated.status_code == 200
    assert updated.json()["data"][0]["monthly_limit"] == "3000.00"

    fetched = await client.get("/api/v1/budget/limits", headers=headers)
    assert fetched.json()["data"][0]["category_id"] == category_id


async def test_confirmed_expense_updates_spent(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )
    await _confirm_expense(client, headers, category_id, "400.00", date.today().isoformat())

    current = await client.get("/api/v1/budget/current", headers=headers)
    body = current.json()["data"]
    breakdown = next(c for c in body["variable_categories"] if c["category_id"] == category_id)
    assert breakdown["spent"] == "400.00"
    assert breakdown["remaining"] == "600.00"
    assert breakdown["alert"] is False


async def test_categorized_income_does_not_leak_into_budget(client: AsyncClient):
    """Bug real: _on_confirmed escribia en budget_periods.spent para
    CUALQUIER transaccion confirmada con category_id, sin filtrar
    entry_type == 'expense'. Un ingreso categorizado (ej. 'Otro' de tipo
    income) terminaba inflando variable_total_spent y colandose en el
    desglose de presupuesto como si fuera un gasto."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    expense_category = await _get_category_id(client, headers, "expense")
    income_category = await _get_category_id(client, headers, "income")
    bank = await _create_account(client, headers, initial_balance="0")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": expense_category, "monthly_limit": "1000.00"}]},
    )
    await _confirm_expense(client, headers, expense_category, "300.00", date.today().isoformat())

    income = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": date.today().isoformat(),
            "description": "Venta de algo",
            "entry_type": "income",
            "category_id": income_category,
            "account_id": bank,
            "amount": "850.00",
        },
    )
    assert income.status_code == 201, income.text

    current = await client.get("/api/v1/budget/current", headers=headers)
    body = current.json()["data"]
    # Solo el gasto real cuenta -- el ingreso categorizado no debe aparecer
    # en el desglose ni sumarse al total gastado.
    assert body["variable_total_spent"] == "300.00"
    category_ids_in_breakdown = {c["category_id"] for c in body["variable_categories"]}
    assert income_category not in category_ids_in_breakdown


async def test_average_last_3_months_reflects_historical_spend(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )

    today = date.today()
    last_month_day = today.replace(day=1) - timedelta(days=1)
    await _confirm_expense(client, headers, category_id, "300.00", today.isoformat())
    await _confirm_expense(client, headers, category_id, "600.00", last_month_day.isoformat())

    current = await client.get("/api/v1/budget/current", headers=headers)
    breakdown = next(
        c for c in current.json()["data"]["variable_categories"] if c["category_id"] == category_id
    )
    # 2 meses distintos con gasto: (300 + 600) / 2 = 450.00
    assert breakdown["average_last_3_months"] == "450.00"


async def test_limit_suggestions_include_categories_without_limit(client: AsyncClient):
    """A diferencia de /budget/current (que solo trae categorias con limite o
    movimiento este mes), /budget/limits/suggestions debe traer TODAS las
    categorias de gasto -- incluida una que nunca tuvo limite -- para poder
    sugerir un monto de entrada en la pantalla de definir limites en bloque."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    categories = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()[
        "data"
    ]
    limited_category = categories[0]["id"]
    unlimited_category = categories[1]["id"]

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": limited_category, "monthly_limit": "1000.00"}]},
    )
    # Gasto historico en la categoria SIN limite -- debe aparecer como
    # sugerencia (average_last_3_months) aunque current_limit sea null.
    await _confirm_expense(client, headers, unlimited_category, "300.00", date.today().isoformat())

    response = await client.get("/api/v1/budget/limits/suggestions", headers=headers)
    assert response.status_code == 200
    suggestions = {s["category_id"]: s for s in response.json()["data"]}

    assert suggestions[limited_category]["current_limit"] == "1000.00"
    assert suggestions[unlimited_category]["current_limit"] is None
    assert suggestions[unlimited_category]["average_last_3_months"] == "300.00"
    assert suggestions[unlimited_category]["color"]  # cada categoria trae su propio color


async def test_budget_alert_flag_at_80_percent(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )
    await _confirm_expense(client, headers, category_id, "850.00", date.today().isoformat())

    current = await client.get("/api/v1/budget/current", headers=headers)
    breakdown = next(
        c for c in current.json()["data"]["variable_categories"] if c["category_id"] == category_id
    )
    assert breakdown["percentage"] == 85.0
    assert breakdown["alert"] is True


async def test_deleting_confirmed_expense_reverses_spent(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")
    expense_account = await _create_account(client, headers, type="expense", subtype=None)
    bank = await _create_account(client, headers, initial_balance="10000")

    created = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": date.today().isoformat(),
            "description": "Gasto",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {"account_id": expense_account, "type": "debit", "amount": "300.00"},
                {"account_id": bank, "type": "credit", "amount": "300.00"},
            ],
        },
    )
    entry_id = created.json()["data"]["id"]

    before = await client.get("/api/v1/budget/current", headers=headers)
    spent_before = next(
        c for c in before.json()["data"]["variable_categories"] if c["category_id"] == category_id
    )["spent"]
    assert spent_before == "300.00"

    await client.delete(f"/api/v1/transactions/{entry_id}", headers=headers)

    after = await client.get("/api/v1/budget/current", headers=headers)
    categories_after = after.json()["data"]["variable_categories"]
    match = [c for c in categories_after if c["category_id"] == category_id]
    assert match == [] or match[0]["spent"] == "0.00"


async def test_changing_limit_does_not_touch_past_month(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )

    # Simula un periodo de un mes pasado ya con su snapshot escrito.
    async with rls_session(session_factory, uid) as session:
        past_period = BudgetPeriod(
            user_id=uid,
            category_id=uuid.UUID(category_id),
            year=2026,
            month=1,
            budgeted=Decimal("1000.00"),
            spent=Decimal("200.00"),
        )
        session.add(past_period)
        await session.flush()

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "2500.00"}]},
    )

    historical = await client.get("/api/v1/budget/2026/1", headers=headers)
    breakdown = next(
        c
        for c in historical.json()["data"]["variable_categories"]
        if c["category_id"] == category_id
    )
    assert breakdown["monthly_limit"] == "1000.00"

    current = await client.get("/api/v1/budget/current", headers=headers)
    current_breakdown = next(
        c for c in current.json()["data"]["variable_categories"] if c["category_id"] == category_id
    )
    assert current_breakdown["monthly_limit"] == "2500.00"


async def test_committed_fixed_includes_debts_and_recurring(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo",
            "type": "personal_loan",
            "total_amount": "1000.00",
            "payment_amount": "100.00",
            "payment_frequency": "monthly",
        },
    )

    bank = await _create_account(client, headers, initial_balance="1000")
    expense_account = await _create_account(client, headers, type="expense", subtype=None)
    category_id = await _get_category_id(client, headers, "expense")
    await client.post(
        "/api/v1/recurring-items",
        headers=headers,
        json={
            "name": "Spotify",
            "item_type": "subscription",
            "amount": "239.00",
            "frequency": "monthly",
            "account_id": bank,
            "contra_account_id": expense_account,
            "category_id": category_id,
            "next_date": date.today().isoformat(),
        },
    )

    summary = await client.get("/api/v1/budget/summary", headers=headers)
    assert Decimal(summary.json()["data"]["committed_fixed"]) == Decimal("339.00")


async def test_income_estimated_from_active_recurring_income(client: AsyncClient):
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
            "amount": "12000.00",
            "frequency": "monthly",
            "account_id": bank,
            "contra_account_id": income_account,
            "category_id": income_category,
            "next_date": date.today().isoformat(),
        },
    )

    summary = await client.get("/api/v1/budget/summary", headers=headers)
    assert Decimal(summary.json()["data"]["income_estimated"]) == Decimal("12000.00")


async def test_weekly_view_splits_spend_by_week(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    today = date.today()
    week1 = today.replace(day=2)
    week2 = today.replace(day=10)
    await _confirm_expense(client, headers, category_id, "100.00", week1.isoformat())
    await _confirm_expense(client, headers, category_id, "50.00", week2.isoformat())

    weekly = await client.get("/api/v1/budget/current/weekly", headers=headers)
    assert weekly.status_code == 200
    weeks = weekly.json()["data"]["weeks"]
    week1_spent = weeks[0]["spent_by_category"].get(category_id, "0")
    week2_spent = weeks[1]["spent_by_category"].get(category_id, "0")
    assert Decimal(week1_spent) == Decimal("100.00")
    assert Decimal(week2_spent) == Decimal("50.00")


async def test_budget_trend_returns_last_6_months_chronologically(
    client: AsyncClient, session_factory
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    category_id = await _get_category_id(client, headers, "expense")

    today = date.today()
    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )
    await _confirm_expense(client, headers, category_id, "300.00", today.isoformat())

    two_months_ago = today.replace(day=1) - relativedelta(months=2)
    async with rls_session(session_factory, uid) as session:
        session.add(
            BudgetPeriod(
                user_id=uid,
                category_id=uuid.UUID(category_id),
                year=two_months_ago.year,
                month=two_months_ago.month,
                budgeted=Decimal("800.00"),
                spent=Decimal("400.00"),
            )
        )
        await session.flush()

    response = await client.get("/api/v1/budget/trend", headers=headers)
    assert response.status_code == 200
    trend = response.json()["data"]
    assert len(trend) == 6
    # cronologico: el mes actual debe ser el ultimo elemento
    assert trend[-1]["year"] == today.year
    assert trend[-1]["month"] == today.month
    assert Decimal(trend[-1]["spent"]) == Decimal("300.00")

    two_months_ago_entry = next(
        m for m in trend if m["year"] == two_months_ago.year and m["month"] == two_months_ago.month
    )
    assert Decimal(two_months_ago_entry["spent"]) == Decimal("400.00")
    assert two_months_ago_entry["percentage"] == 50.0


async def test_rls_isolates_budget_limits_between_users(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    category_id = await _get_category_id(client, headers_a, "expense")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers_a,
        json={"limits": [{"category_id": category_id, "monthly_limit": "500.00"}]},
    )

    limits_b = await client.get("/api/v1/budget/limits", headers=headers_b)
    assert limits_b.json()["data"] == []


async def _create_subcategory(client: AsyncClient, headers: dict, parent_id: str, name: str) -> str:
    response = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": name, "type": "expense", "parent_id": parent_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


async def test_subcategory_expense_rolls_up_to_parent_budget(client: AsyncClient):
    """Decision de producto: el presupuesto vive en la categoria padre. Un
    gasto categorizado con una subcategoria (ej. 'Restaurantes' bajo 'Comida
    y Bebidas') debe sumar al budget_period del padre, no crear uno propio."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    parent_id = await _get_category_id(client, headers, "expense")
    sub_id = await _create_subcategory(client, headers, parent_id, "Restaurantes")

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": parent_id, "monthly_limit": "1000.00"}]},
    )
    await _confirm_expense(client, headers, sub_id, "250.00", date.today().isoformat())

    current = await client.get("/api/v1/budget/current", headers=headers)
    body = current.json()["data"]
    category_ids = {c["category_id"] for c in body["variable_categories"]}
    assert sub_id not in category_ids
    breakdown = next(c for c in body["variable_categories"] if c["category_id"] == parent_id)
    assert breakdown["spent"] == "250.00"


async def test_cannot_set_budget_limit_directly_on_subcategory(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    parent_id = await _get_category_id(client, headers, "expense")
    sub_id = await _create_subcategory(client, headers, parent_id, "Restaurantes")

    response = await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": sub_id, "monthly_limit": "200.00"}]},
    )
    assert response.status_code == 400
