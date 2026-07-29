import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.models.chat_message import ChatMessage
from app.models.insight import Insight
from app.models.notification import Notification
from app.models.report import Report
from tests.conftest import rls_session

pytestmark = pytest.mark.asyncio


async def _register_and_login(client: AsyncClient) -> tuple[str, uuid.UUID]:
    email = f"{uuid.uuid4()}@example.com"
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Test", "password": "supersecret123"},
    )
    user_id = uuid.UUID(register.json()["data"]["id"])
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    return login.json()["data"]["access_token"], user_id


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "500"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def _get_category_id(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    return response.json()["data"][0]["id"]


async def test_erase_transactions_keeps_accounts_and_debts(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    account_id = await _create_account(client, headers, initial_balance="500")
    category_id = await _get_category_id(client, headers, "expense")

    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": category_id,
            "account_id": account_id,
            "amount": "200.00",
        },
    )
    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Mireya",
            "type": "informal",
            "direction": "owed_by_me",
            "total_amount": "1000.00",
        },
    )
    assert debt.status_code == 201

    erase = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["transactions"], "password": "supersecret123"},
    )
    assert erase.status_code == 200
    assert erase.json()["data"]["erased"] == ["transactions"]

    account = await client.get(f"/api/v1/accounts/{account_id}", headers=headers)
    assert account.json()["data"]["balance"] == "500.00"  # vuelve al balance inicial

    transactions = await client.get("/api/v1/transactions?per_page=100", headers=headers)
    assert transactions.json()["meta"]["total"] == 0

    debts = await client.get("/api/v1/debts", headers=headers)
    assert len(debts.json()["data"]) == 1  # las deudas no se tocan


async def test_erase_accounts_forces_transactions_and_recurring(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    account_id = await _create_account(client, headers)
    contra_id = await _create_account(client, headers, name="Otra")
    category_id = await _get_category_id(client, headers, "expense")

    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": category_id,
            "account_id": account_id,
            "amount": "50.00",
        },
    )
    recurring = await client.post(
        "/api/v1/recurring-items",
        headers=headers,
        json={
            "name": "Netflix",
            "item_type": "subscription",
            "amount": "199.00",
            "frequency": "monthly",
            "account_id": account_id,
            "contra_account_id": contra_id,
            "category_id": category_id,
            "next_date": "2026-08-01",
        },
    )
    assert recurring.status_code == 201

    erase = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["accounts"], "password": "supersecret123"},
    )
    assert erase.status_code == 200
    assert set(erase.json()["data"]["erased"]) >= {"accounts", "transactions", "recurring"}

    accounts = await client.get("/api/v1/accounts", headers=headers)
    assert accounts.json()["data"] == []

    # El token de sesion sigue funcionando -- solo se borraron los datos, no el usuario.
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200


async def test_erase_wrong_password_rejected(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)

    erase = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["notifications"], "password": "incorrecta"},
    )
    assert erase.status_code == 401


async def test_erase_missing_password_rejected(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    erase = await client.post(
        "/api/v1/data/erase", headers=headers, json={"categories": ["notifications"]}
    )
    assert erase.status_code == 401


async def test_erase_invalid_category_rejected(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    erase = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["not_a_real_category"], "password": "supersecret123"},
    )
    assert erase.status_code == 422


async def test_erase_categories_is_best_effort(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    account_id = await _create_account(client, headers)

    category = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Mi categoria", "type": "expense"}
    )
    category_id = category.json()["data"]["id"]

    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Gasto",
            "entry_type": "expense",
            "category_id": category_id,
            "account_id": account_id,
            "amount": "10.00",
        },
    )

    # Solo 'categories', sin 'transactions': sigue en uso, no se borra.
    only_categories = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["categories"], "password": "supersecret123"},
    )
    assert only_categories.status_code == 200
    still_there = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert any(c["id"] == category_id for c in still_there.json()["data"])

    # Ahora junto con 'transactions' y 'budgets' (una transaccion confirmada
    # con categoria genera un budget_period aunque nunca hayas puesto un
    # limite -- sigue "en uso" hasta que eso tambien se borre): ya no esta en
    # uso, se borra.
    both = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={
            "categories": ["transactions", "budgets", "categories"],
            "password": "supersecret123",
        },
    )
    assert both.status_code == 200
    gone = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert not any(c["id"] == category_id for c in gone.json()["data"])


async def test_erase_notifications_reports_insights_chat(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    async with rls_session(session_factory, user_id) as session:
        session.add(Notification(user_id=user_id, title="Aviso", body="x", type="budget_alert"))
        session.add(ChatMessage(user_id=user_id, role="user", content="hola"))
        session.add(
            Report(
                user_id=user_id,
                type="monthly_manual",
                period_start=date(2026, 7, 1),
                period_end=date(2026, 7, 31),
                status="ready",
                generated_by="user",
            )
        )
        session.add(
            Insight(
                user_id=user_id,
                title="Insight",
                description="desc",
                category="general",
                generated_by="auto_celery",
                ai_provider="test",
                ai_context={},
                metrics_at_creation={},
                next_review_at=date(2026, 8, 1),
            )
        )

    erase = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={
            "categories": ["notifications", "reports", "insights", "chat"],
            "password": "supersecret123",
        },
    )
    assert erase.status_code == 200
    assert set(erase.json()["data"]["erased"]) == {"notifications", "reports", "insights", "chat"}

    async with rls_session(session_factory, user_id) as session:
        for model in (Notification, ChatMessage, Report, Insight):
            count = (await session.execute(select(func.count()).select_from(model))).scalar_one()
            assert count == 0, f"{model.__name__} deberia quedar en 0"


async def test_erase_rls_isolation(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    account_b = await _create_account(client, headers_b, name="Cuenta de B")

    await client.post(
        "/api/v1/data/erase",
        headers=headers_a,
        json={"categories": ["accounts"], "password": "supersecret123"},
    )

    still_there = await client.get(f"/api/v1/accounts/{account_b}", headers=headers_b)
    assert still_there.status_code == 200
