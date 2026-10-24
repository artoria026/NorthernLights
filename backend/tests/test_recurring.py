import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.transaction import JournalEntry
from app.services import recurring_service
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


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "0"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def _get_category_id(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    return response.json()["data"][0]["id"]


async def _create_recurring_item(client: AsyncClient, headers: dict, **overrides) -> dict:
    bank_id = overrides.pop("account_id", None) or await _create_account(
        client, headers, initial_balance="1000"
    )
    category_id = overrides.pop("category_id", None) or await _get_category_id(
        client, headers, "expense"
    )

    payload = {
        "name": "Spotify",
        "item_type": "subscription",
        "amount": "239.00",
        "frequency": "monthly",
        "account_id": bank_id,
        "category_id": category_id,
        "next_date": date.today().isoformat(),
    }
    payload.update(overrides)
    response = await client.post("/api/v1/recurring-items", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def test_monthly_equivalent_all_frequencies():
    assert recurring_service.monthly_equivalent(Decimal("100"), "monthly") == Decimal("100.00")
    assert recurring_service.monthly_equivalent(Decimal("100"), "weekly") == (
        Decimal("100") * Decimal("52") / 12
    ).quantize(Decimal("0.01"))
    assert recurring_service.monthly_equivalent(Decimal("100"), "biweekly") == (
        Decimal("100") * Decimal("26") / 12
    ).quantize(Decimal("0.01"))
    assert recurring_service.monthly_equivalent(Decimal("100"), "bimonthly") == Decimal("50.00")
    assert recurring_service.monthly_equivalent(Decimal("120"), "annual") == Decimal("10.00")


async def test_utility_item_gets_critical_urgency(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(
        client, headers, name="Internet Telmex", item_type="utility"
    )
    assert item["alert_urgency"] == "critical"


async def test_subscription_defaults_to_normal_urgency(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers, item_type="subscription")
    assert item["alert_urgency"] == "normal"


async def test_an_item_without_an_icon_has_none_and_the_user_can_pick_and_clear_one(
    client: AsyncClient,
):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)
    assert item["icon"] is None

    picked = await client.put(
        f"/api/v1/recurring-items/{item['id']}", headers=headers, json={"icon": "spotify"}
    )
    assert picked.json()["data"]["icon"] == "spotify"

    cleared = await client.put(
        f"/api/v1/recurring-items/{item['id']}", headers=headers, json={"icon": None}
    )
    assert cleared.json()["data"]["icon"] is None


async def test_an_icon_can_be_set_when_creating_the_item(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers, icon="netflix")
    assert item["icon"] == "netflix"


async def test_explicit_alert_urgency_overrides_default(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers, item_type="utility", alert_urgency="high")
    assert item["alert_urgency"] == "high"


async def test_pause_and_cancel(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)

    paused = await client.patch(f"/api/v1/recurring-items/{item['id']}/pause", headers=headers)
    assert paused.json()["data"]["status"] == "paused"

    cancelled = await client.patch(f"/api/v1/recurring-items/{item['id']}/cancel", headers=headers)
    assert cancelled.json()["data"]["status"] == "cancelled"
    assert cancelled.json()["data"]["cancelled_at"] == date.today().isoformat()


async def test_update_recurring_item_changes_amount_and_frequency(client: AsyncClient):
    """PUT /{item_id} existed in the backend before but the frontend never
    consumed it -- now it's the "Edit" path in /recurring-items, so
    it needs its own direct coverage."""
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers, item_type="service", amount="500.00")

    updated = await client.put(
        f"/api/v1/recurring-items/{item['id']}",
        headers=headers,
        json={"amount": "650.00", "frequency": "biweekly", "alert_urgency": "high"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()["data"]
    assert body["amount"] == "650.00"
    assert body["frequency"] == "biweekly"
    assert body["alert_urgency"] == "high"
    # What isn't sent doesn't change.
    assert body["name"] == item["name"]
    assert body["next_date"] == item["next_date"]


async def test_update_recurring_item_rejects_other_users_item(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    item = await _create_recurring_item(client, headers_a)

    response = await client.put(
        f"/api/v1/recurring-items/{item['id']}",
        headers=headers_b,
        json={"amount": "1.00"},
    )
    assert response.status_code == 404


async def test_resume_reactivates_paused_item_and_fixes_stale_next_date(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(
        client, headers, next_date=(date.today() - timedelta(days=40)).isoformat()
    )
    await client.patch(f"/api/v1/recurring-items/{item['id']}/pause", headers=headers)

    resumed = await client.patch(f"/api/v1/recurring-items/{item['id']}/resume", headers=headers)
    assert resumed.status_code == 200
    data = resumed.json()["data"]
    assert data["status"] == "active"
    # next_date was 40 days in the past -- it jumps forward to today instead of
    # letting Celery generate all the "overdue" charges at once.
    assert data["next_date"] == date.today().isoformat()


async def test_resume_clears_cancelled_at(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)
    await client.patch(f"/api/v1/recurring-items/{item['id']}/cancel", headers=headers)

    resumed = await client.patch(f"/api/v1/recurring-items/{item['id']}/resume", headers=headers)
    data = resumed.json()["data"]
    assert data["status"] == "active"
    assert data["cancelled_at"] is None


async def test_resume_rejects_already_active_item(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)

    response = await client.patch(f"/api/v1/recurring-items/{item['id']}/resume", headers=headers)
    assert response.status_code == 400


async def test_upcoming_filters_by_days_ahead(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_recurring_item(
        client, headers, name="Pronto", next_date=(date.today() + timedelta(days=5)).isoformat()
    )
    await _create_recurring_item(
        client, headers, name="Lejos", next_date=(date.today() + timedelta(days=60)).isoformat()
    )

    upcoming = await client.get("/api/v1/recurring-items/upcoming?days_ahead=10", headers=headers)
    names = [i["name"] for i in upcoming.json()["data"]]
    assert names == ["Pronto"]


async def test_process_due_generates_pending_entry(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers, item_type="utility")

    async with rls_session(session_factory, uuid.UUID(user_id)) as session:
        generated = await recurring_service.process_due_recurring_items(
            session, uuid.UUID(user_id), date.today()
        )
        assert len(generated) == 1
        assert generated[0].status == "pending"
        assert generated[0].recurring_id == uuid.UUID(item["id"])

    pending = await client.get("/api/v1/recurring-items/pending", headers=headers)
    assert pending.json()["meta"]["total"] == 1
    assert pending.json()["data"][0]["status"] == "pending"


async def test_process_due_deduplicates_pending_per_period(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)

    async with rls_session(session_factory, uid) as session:
        first_run = await recurring_service.process_due_recurring_items(session, uid, date.today())
        assert len(first_run) == 1

        # Simulates a second Celery run before the cycle advances
        # (e.g. a retry after a partial failure): next_date becomes overdue again.
        db_item = await recurring_service.get_recurring_item(session, uid, uuid.UUID(item["id"]))
        db_item.next_date = date.today()
        await session.flush()

        second_run = await recurring_service.process_due_recurring_items(session, uid, date.today())
        assert second_run == []

        count = await session.execute(
            select(JournalEntry).where(
                JournalEntry.recurring_id == uuid.UUID(item["id"]), JournalEntry.status == "pending"
            )
        )
        assert len(count.scalars().all()) == 1


async def test_confirm_pending_applies_balance(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)
    bank_id = item["account_id"]

    async with rls_session(session_factory, uid) as session:
        generated = await recurring_service.process_due_recurring_items(session, uid, date.today())
        entry_id = generated[0].id

    before = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    assert before.json()["data"]["balance"] == "1000.00"

    confirm = await client.post(f"/api/v1/transactions/{entry_id}/confirm", headers=headers)
    assert confirm.status_code == 200
    assert confirm.json()["data"]["status"] == "confirmed"

    after = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    assert after.json()["data"]["balance"] == "761.00"


async def test_reject_pending(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_recurring_item(client, headers)

    async with rls_session(session_factory, uid) as session:
        generated = await recurring_service.process_due_recurring_items(session, uid, date.today())
        entry_id = generated[0].id

    reject = await client.post(f"/api/v1/transactions/{entry_id}/reject", headers=headers)
    assert reject.status_code == 200
    assert reject.json()["data"]["status"] == "rejected"

    pending = await client.get("/api/v1/recurring-items/pending", headers=headers)
    assert pending.json()["meta"]["total"] == 0


async def test_remind_pending_critical_alerts_from_day_zero(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_recurring_item(client, headers, item_type="utility")

    async with rls_session(session_factory, uid) as session:
        await recurring_service.process_due_recurring_items(session, uid, date.today())
        reminders = await recurring_service.remind_pending_recurring(session, uid, date.today())
        assert len(reminders) == 1
        assert reminders[0]["alert_urgency"] == "critical"


async def test_remind_pending_normal_urgency_waits_three_days(client: AsyncClient, session_factory):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_recurring_item(client, headers, item_type="subscription")

    async with rls_session(session_factory, uid) as session:
        await recurring_service.process_due_recurring_items(session, uid, date.today())

        no_reminder_yet = await recurring_service.remind_pending_recurring(
            session, uid, date.today() + timedelta(days=1)
        )
        assert no_reminder_yet == []

        reminder_at_day_3 = await recurring_service.remind_pending_recurring(
            session, uid, date.today() + timedelta(days=3)
        )
        assert len(reminder_at_day_3) == 1


async def test_summary_groups_by_category(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    income_category_id = await _get_category_id(client, headers, "income")
    await _create_recurring_item(
        client, headers, name="Spotify", amount="239.00", frequency="monthly"
    )
    await _create_recurring_item(
        client,
        headers,
        name="Nomina",
        item_type="income",
        amount="1000.00",
        category_id=income_category_id,
    )

    summary = await client.get("/api/v1/recurring-items/summary", headers=headers)
    assert summary.status_code == 200
    body = summary.json()["data"]
    assert Decimal(body["total_monthly"]) == Decimal("1239.00")


async def test_summary_exclude_income_query_param(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    income_category_id = await _get_category_id(client, headers, "income")
    await _create_recurring_item(
        client, headers, name="Spotify", amount="239.00", frequency="monthly"
    )
    await _create_recurring_item(
        client,
        headers,
        name="Nomina",
        item_type="income",
        amount="1000.00",
        category_id=income_category_id,
    )

    summary = await client.get(
        "/api/v1/recurring-items/summary?exclude_income=true", headers=headers
    )
    assert Decimal(summary.json()["data"]["total_monthly"]) == Decimal("239.00")


async def test_summary_item_type_query_param_scopes_to_subscriptions(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_recurring_item(
        client, headers, name="Spotify", item_type="subscription", amount="239.00"
    )
    await _create_recurring_item(
        client, headers, name="Internet", item_type="service", amount="500.00"
    )

    summary = await client.get(
        "/api/v1/recurring-items/summary?item_type=subscription", headers=headers
    )
    assert Decimal(summary.json()["data"]["total_monthly"]) == Decimal("239.00")


async def test_rls_isolates_recurring_items_between_users(client: AsyncClient):
    token_a, _ = await _register_and_login(client)
    token_b, _ = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    item = await _create_recurring_item(client, headers_a)

    get_b = await client.get(f"/api/v1/recurring-items/{item['id']}", headers=headers_b)
    assert get_b.status_code == 404


# -- registering the charge of an item followed by hand ---------------------------------------


async def _manual_item(client: AsyncClient, headers: dict, **overrides) -> dict:
    return await _create_recurring_item(
        client,
        headers,
        name="Hetzner",
        amount="209.08",
        auto_generate=False,
        next_date="2026-10-14",
        **overrides,
    )


async def test_registering_a_manual_charge_records_it_and_moves_the_date(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _manual_item(client, headers)

    response = await client.post(
        f"/api/v1/recurring-items/{item['id']}/register",
        headers=headers,
        json={"date": "2026-10-15"},
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["item"]["next_date"] == "2026-11-14"
    assert data["transaction"]["status"] == "confirmed"
    assert data["transaction"]["is_recurring"] is True
    assert data["transaction"]["description"] == "Hetzner"
    assert data["transaction"]["amount"] == "209.08"
    assert data["transaction"]["date"] == "2026-10-15"

    balance = (await client.get(f"/api/v1/accounts/{item['account_id']}", headers=headers)).json()[
        "data"
    ]["balance"]
    assert balance == "790.92"


async def test_the_date_defaults_to_today(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _manual_item(client, headers)
    response = await client.post(f"/api/v1/recurring-items/{item['id']}/register", headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["data"]["transaction"]["date"] == date.today().isoformat()


async def test_a_paused_item_cannot_register_a_charge(client: AsyncClient):
    token, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _manual_item(client, headers)
    await client.patch(f"/api/v1/recurring-items/{item['id']}/pause", headers=headers)
    response = await client.post(f"/api/v1/recurring-items/{item['id']}/register", headers=headers)
    assert response.status_code == 400


async def test_an_automatic_item_with_a_waiting_draft_is_not_charged_twice(
    client: AsyncClient, session_factory
):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    item = await _create_recurring_item(client, headers)

    # The scheduled job leaves a draft; registering by hand on top would count the charge twice.
    async with rls_session(session_factory, uid) as session:
        await recurring_service.process_due_recurring_items(session, uid, date.today())
    response = await client.post(f"/api/v1/recurring-items/{item['id']}/register", headers=headers)
    assert response.status_code == 409
