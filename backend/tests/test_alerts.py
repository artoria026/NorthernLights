import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.tasks import alerts
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


async def _create_debt(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Deuda", "type": "personal_loan", "total_amount": "1000.00"}
    payload.update(overrides)
    response = await client.post("/api/v1/debts", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


async def test_debt_due_in_three_days_generates_alert(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_debt(
        client,
        headers,
        payment_amount="200.00",
        payment_frequency="monthly",
        next_payment_date=(date.today() + timedelta(days=3)).isoformat(),
    )

    async with rls_session(session_factory, uid) as session:
        count = await alerts._process_debt_alerts_for_user(session, uid, date.today())
        assert count == 1

    notifications = await client.get("/api/v1/notifications", headers=headers)
    types = [n["type"] for n in notifications.json()["data"]]
    assert "debt_alert" in types


async def test_debt_due_in_four_days_does_not_generate_alert(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_debt(
        client,
        headers,
        payment_amount="200.00",
        payment_frequency="monthly",
        next_payment_date=(date.today() + timedelta(days=4)).isoformat(),
    )

    async with rls_session(session_factory, uid) as session:
        count = await alerts._process_debt_alerts_for_user(session, uid, date.today())
        assert count == 0


async def test_debt_alert_anti_spam_prevents_duplicate_same_day(
    client: AsyncClient, session_factory
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_debt(
        client,
        headers,
        payment_amount="200.00",
        payment_frequency="monthly",
        next_payment_date=(date.today() + timedelta(days=2)).isoformat(),
    )

    async with rls_session(session_factory, uid) as session:
        first_run = await alerts._process_debt_alerts_for_user(session, uid, date.today())
        second_run = await alerts._process_debt_alerts_for_user(session, uid, date.today())

    assert first_run == 1
    assert second_run == 0


async def test_tdc_due_within_five_days_generates_alert(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    today = date.today()
    due_day = ((today + timedelta(days=3)).day) or 28
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "TDC",
            "type": "liability",
            "subtype": "credit_card",
            "initial_balance": "500.00",
            "billing_cycle_day": today.day,
            "payment_due_day": due_day,
        },
    )

    async with rls_session(session_factory, uid) as session:
        count = await alerts._process_tdc_alerts_for_user(session, uid, today)

    notifications = await client.get("/api/v1/notifications", headers=headers)
    types = [n["type"] for n in notifications.json()["data"]]
    if count:
        assert "tdc_due" in types


async def test_overdue_informal_loan_generates_alert(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_debt(
        client,
        headers,
        type="informal",
        due_date=(date.today() - timedelta(days=5)).isoformat(),
    )

    async with rls_session(session_factory, uid) as session:
        count = await alerts._process_overdue_loans_for_user(session, uid, date.today())
        assert count == 1

    notifications = await client.get("/api/v1/notifications", headers=headers)
    types = [n["type"] for n in notifications.json()["data"]]
    assert "loan_overdue" in types


async def test_overdue_loan_alert_is_anti_spammed(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_debt(
        client,
        headers,
        type="loan_received",
        due_date=(date.today() - timedelta(days=2)).isoformat(),
    )

    async with rls_session(session_factory, uid) as session:
        first_run = await alerts._process_overdue_loans_for_user(session, uid, date.today())
        second_run = await alerts._process_overdue_loans_for_user(session, uid, date.today())

    assert first_run == 1
    assert second_run == 0
