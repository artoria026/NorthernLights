import uuid

import pytest
from httpx import AsyncClient

from app.services import notification_service
from tests.conftest import rls_session

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


async def test_create_list_and_unread_count(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    async with rls_session(session_factory, uid) as session:
        await notification_service.create(
            session, user_id=uid, type_="debt_alert", title="Pago proximo", body="Vence en 3 dias"
        )
        await notification_service.create(
            session, user_id=uid, type_="budget_alert", title="80% usado"
        )

    listing = await client.get("/api/v1/notifications", headers=headers)
    assert listing.status_code == 200
    assert listing.json()["meta"]["total"] == 2

    unread = await client.get("/api/v1/notifications/unread-count", headers=headers)
    assert unread.json()["data"]["unread_count"] == 2


async def test_mark_read_and_read_all(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    async with rls_session(session_factory, uid) as session:
        n1 = await notification_service.create(session, user_id=uid, type_="debt_alert", title="A")
        await notification_service.create(session, user_id=uid, type_="debt_alert", title="B")
        n1_id = n1.id

    read = await client.patch(f"/api/v1/notifications/{n1_id}/read", headers=headers)
    assert read.status_code == 200
    assert read.json()["data"]["is_read"] is True

    unread = await client.get("/api/v1/notifications/unread-count", headers=headers)
    assert unread.json()["data"]["unread_count"] == 1

    await client.patch("/api/v1/notifications/read-all", headers=headers)
    unread_after = await client.get("/api/v1/notifications/unread-count", headers=headers)
    assert unread_after.json()["data"]["unread_count"] == 0


async def test_delete_notification(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    async with rls_session(session_factory, uid) as session:
        n1 = await notification_service.create(session, user_id=uid, type_="debt_alert", title="A")
        n1_id = n1.id

    deleted = await client.delete(f"/api/v1/notifications/{n1_id}", headers=headers)
    assert deleted.status_code == 200

    listing = await client.get("/api/v1/notifications", headers=headers)
    assert listing.json()["meta"]["total"] == 0


async def test_budget_alert_creates_real_notification(client: AsyncClient):
    """M07 (_check_budget_alert) ahora crea una notificacion real via M14 en
    vez de solo loguear -- confirma la integracion end-to-end."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    category = await client.get("/api/v1/categories?type=expense", headers=headers)
    category_id = category.json()["data"][0]["id"]

    await client.put(
        "/api/v1/budget/limits",
        headers=headers,
        json={"limits": [{"category_id": category_id, "monthly_limit": "1000.00"}]},
    )
    expense_account = await client.post(
        "/api/v1/accounts", headers=headers, json={"name": "Gasto", "type": "expense"}
    )
    bank = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "10000"},
    )
    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-08-01",
            "description": "Gasto grande",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {
                    "account_id": expense_account.json()["data"]["id"],
                    "type": "debit",
                    "amount": "900.00",
                },
                {"account_id": bank.json()["data"]["id"], "type": "credit", "amount": "900.00"},
            ],
        },
    )

    notifications = await client.get("/api/v1/notifications", headers=headers)
    types = [n["type"] for n in notifications.json()["data"]]
    assert "budget_alert" in types


async def test_email_notification_respects_user_preference(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    await client.put("/api/v1/auth/settings", headers=headers, json={"email_notifications": False})

    async with rls_session(session_factory, uid) as session:
        # No debe lanzar ni intentar enviar: solo retorna sin hacer nada.
        await notification_service.send_email_notification(session, uid, "Asunto", "<p>Hola</p>")


async def test_rls_isolates_notifications_between_users(client: AsyncClient, session_factory):
    token_a, user_id_a = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    async with rls_session(session_factory, uuid.UUID(user_id_a)) as session:
        await notification_service.create(
            session, user_id=uuid.UUID(user_id_a), type_="debt_alert", title="Solo para A"
        )

    listing_b = await client.get("/api/v1/notifications", headers=headers_b)
    assert listing_b.json()["meta"]["total"] == 0
