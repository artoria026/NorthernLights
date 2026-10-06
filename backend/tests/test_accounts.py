import uuid

import pytest
from httpx import AsyncClient

from app.core.redis import get_redis
from app.services import cache_service

pytestmark = pytest.mark.asyncio


async def _register_and_login(client: AsyncClient) -> str:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Test", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    return login.json()["data"]["access_token"]


async def test_create_and_list_account(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "Banco Santander",
            "type": "asset",
            "subtype": "checking",
            "initial_balance": "1000.00",
        },
    )
    assert create.status_code == 201
    account = create.json()["data"]
    assert account["balance"] == "1000.00"

    listing = await client.get("/api/v1/accounts", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()["data"]) == 1


async def test_delete_account_with_balance_conflicts(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "50.00"},
    )
    account_id = create.json()["data"]["id"]

    response = await client.delete(f"/api/v1/accounts/{account_id}", headers=headers)
    assert response.status_code == 409


async def test_summary_computes_net_worth(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "1000"},
    )
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "TDC",
            "type": "liability",
            "subtype": "credit_card",
            "initial_balance": "400",
        },
    )

    response = await client.get("/api/v1/accounts/summary", headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total_assets"] == "1000.00"
    assert data["total_liabilities"] == "400.00"
    assert data["net_worth"] == "600.00"


async def test_reconcile_creates_adjustment_out_when_real_balance_lower(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "1000.00"},
    )
    account_id = create.json()["data"]["id"]

    response = await client.post(
        f"/api/v1/accounts/{account_id}/reconcile",
        headers=headers,
        json={"real_balance": "650.00", "notes": "conte mi cartera"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["adjusted"] is True
    assert data["previous_balance"] == "1000.00"
    assert data["new_balance"] == "650.00"
    assert data["delta"] == "-350.00"
    assert data["transaction"]["entry_type"] == "adjustment_out"
    assert data["transaction"]["amount"] == "350.00"
    assert data["transaction"]["category_id"] is None

    account = await client.get(f"/api/v1/accounts/{account_id}", headers=headers)
    assert account.json()["data"]["balance"] == "650.00"


async def test_reconcile_creates_adjustment_in_when_real_balance_higher(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "500.00"},
    )
    account_id = create.json()["data"]["id"]

    response = await client.post(
        f"/api/v1/accounts/{account_id}/reconcile",
        headers=headers,
        json={"real_balance": "620.00"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["adjusted"] is True
    assert data["delta"] == "120.00"
    assert data["transaction"]["entry_type"] == "adjustment_in"
    assert data["transaction"]["amount"] == "120.00"


async def test_reconcile_is_noop_when_balance_already_matches(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Ahorro", "type": "asset", "subtype": "savings", "initial_balance": "300.00"},
    )
    account_id = create.json()["data"]["id"]

    response = await client.post(
        f"/api/v1/accounts/{account_id}/reconcile",
        headers=headers,
        json={"real_balance": "300.00"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["adjusted"] is False
    assert data["transaction"] is None

    transactions = await client.get("/api/v1/transactions", headers=headers)
    assert transactions.json()["meta"]["total"] == 0


async def test_reconcile_rejects_non_liquid_account(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "TDC",
            "type": "liability",
            "subtype": "credit_card",
            "initial_balance": "400.00",
        },
    )
    account_id = create.json()["data"]["id"]

    response = await client.post(
        f"/api/v1/accounts/{account_id}/reconcile",
        headers=headers,
        json={"real_balance": "100.00"},
    )
    assert response.status_code == 400


async def test_reconcile_adjustment_excluded_from_category_budget(client: AsyncClient):
    """A balance adjustment must never inflate the expense of a real category --
    see Notion 'Dev Environment, Stack y Setup Guide' reconciliation best
    practices section. budget_service filters by entry_type ==
    'expense', so an adjustment_out must stay out of it without touching anything
    there; this test makes it explicit so it doesn't regress by accident."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "500.00"},
    )
    account_id = create.json()["data"]["id"]

    await client.post(
        f"/api/v1/accounts/{account_id}/reconcile",
        headers=headers,
        json={"real_balance": "200.00"},
    )

    budget = await client.get("/api/v1/budget/current", headers=headers)
    assert budget.status_code == 200
    for category in budget.json()["data"]["variable_categories"]:
        assert category["spent"] == "0.00"


async def test_rls_isolates_accounts_between_users(client: AsyncClient):
    token_a = await _register_and_login(client)
    token_b = await _register_and_login(client)

    created = await client.post(
        "/api/v1/accounts",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"name": "Cuenta de A", "type": "asset", "subtype": "cash"},
    )
    account_id = created.json()["data"]["id"]

    # User B must not be able to see A's account
    listing_b = await client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token_b}"})
    assert listing_b.json()["data"] == []

    get_b = await client.get(
        f"/api/v1/accounts/{account_id}", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert get_b.status_code == 404

    # User A does see it
    get_a = await client.get(
        f"/api/v1/accounts/{account_id}", headers={"Authorization": f"Bearer {token_a}"}
    )
    assert get_a.status_code == 200


async def test_create_account_invalidates_financial_snapshot_cache(client: AsyncClient):
    """account_service.create_account wasn't invalidating the cached snapshot
    (pre-existing gap, also affected debt_service/recurring_service) --
    this confirms that creating an account no longer leaves the cache stale until
    its 5-minute TTL expires."""
    token = await _register_and_login(client)
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = uuid.UUID(me.json()["data"]["id"])
    redis = await get_redis()

    await cache_service.cache_financial_snapshot(redis, user_id, {"net_worth": "0.00"})
    assert await cache_service.get_financial_snapshot(redis, user_id) is not None

    create = await client.post(
        "/api/v1/accounts",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Banco Santander", "type": "asset", "subtype": "checking"},
    )
    assert create.status_code == 201

    assert await cache_service.get_financial_snapshot(redis, user_id) is None


async def test_update_initial_balance_recalculates_balance_with_existing_transactions(
    client: AsyncClient,
):
    """Changing initial_balance must not override the effect of already
    confirmed transactions -- the balance shifts by the same delta, preserving the
    invariant balance = initial_balance + sum of deltas."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "1000.00"},
    )
    account_id = create.json()["data"]["id"]

    categories = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": categories[0]["id"],
            "account_id": account_id,
            "amount": "200.00",
        },
    )
    before = await client.get(f"/api/v1/accounts/{account_id}", headers=headers)
    assert before.json()["data"]["balance"] == "800.00"

    updated = await client.put(
        f"/api/v1/accounts/{account_id}", headers=headers, json={"initial_balance": "1500.00"}
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["initial_balance"] == "1500.00"
    # 800 (with the expense already applied) + the initial_balance delta (1500-1000).
    assert updated.json()["data"]["balance"] == "1300.00"


async def test_update_initial_balance_invalidates_financial_snapshot_cache(client: AsyncClient):
    token = await _register_and_login(client)
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = uuid.UUID(me.json()["data"]["id"])
    redis = await get_redis()

    create = await client.post(
        "/api/v1/accounts",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "1000.00"},
    )
    account_id = create.json()["data"]["id"]

    await cache_service.cache_financial_snapshot(redis, user_id, {"net_worth": "0.00"})
    assert await cache_service.get_financial_snapshot(redis, user_id) is not None

    updated = await client.put(
        f"/api/v1/accounts/{account_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"initial_balance": "2000.00"},
    )
    assert updated.status_code == 200

    assert await cache_service.get_financial_snapshot(redis, user_id) is None


async def test_export_all_accounts_includes_config_and_logo_without_internal(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    logo = "data:image/png;base64,iVBORw0KGgo="

    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "Tarjeta Oro",
            "type": "liability",
            "subtype": "credit_card",
            "last_4_digits": "1234",
            "logo_data_url": logo,
            "credit_limit": "20000.00",
            "interest_rate": "0.4500",
            "billing_cycle_day": 5,
            "payment_due_day": 25,
        },
    )
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "50.00"},
    )

    response = await client.get("/api/v1/accounts/export", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert "attachment" in response.headers["content-disposition"]

    body = response.json()
    assert body["format"] == "northernlights.accounts"
    assert body["version"] == 1
    assert [a["name"] for a in body["accounts"]] == ["Tarjeta Oro", "Efectivo"]
    card = body["accounts"][0]
    assert card["logo_data_url"] == logo
    assert card["credit_limit"] == "20000.00"
    assert card["billing_cycle_day"] == 5
    assert card["payment_due_day"] == 25
    assert card["last_4_digits"] == "1234"
    assert "id" not in card and "user_id" not in card


async def test_export_single_account(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Ahorros", "type": "asset", "subtype": "savings", "initial_balance": "10.00"},
    )
    account_id = created.json()["data"]["id"]

    response = await client.get(f"/api/v1/accounts/{account_id}/export", headers=headers)
    assert response.status_code == 200
    accounts = response.json()["accounts"]
    assert len(accounts) == 1
    assert accounts[0]["name"] == "Ahorros"
    assert accounts[0]["initial_balance"] == "10.00"


async def test_export_account_of_another_user_is_404(client: AsyncClient):
    owner_headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    other_headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    created = await client.post(
        "/api/v1/accounts",
        headers=owner_headers,
        json={"name": "Privada", "type": "asset", "subtype": "cash"},
    )
    account_id = created.json()["data"]["id"]

    response = await client.get(f"/api/v1/accounts/{account_id}/export", headers=other_headers)
    assert response.status_code == 404


async def test_export_then_import_roundtrip_into_empty_user(client: AsyncClient):
    source = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    logo = "data:image/png;base64,iVBORw0KGgo="
    await client.post(
        "/api/v1/accounts",
        headers=source,
        json={
            "name": "Tarjeta Oro", "type": "liability", "subtype": "credit_card",
            "last_4_digits": "1234", "logo_data_url": logo, "initial_balance": "300.00",
            "credit_limit": "20000.00", "interest_rate": "0.4500",
            "billing_cycle_day": 5, "payment_due_day": 25,
        },
    )
    await client.post(
        "/api/v1/accounts",
        headers=source,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "50.00"},
    )
    exported = (await client.get("/api/v1/accounts/export", headers=source)).json()

    target = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    response = await client.post("/api/v1/accounts/import", headers=target, json=exported)
    assert response.status_code == 201
    assert response.json()["data"] == {"created": 2, "skipped": []}

    accounts = (await client.get("/api/v1/accounts", headers=target)).json()["data"]
    card = next(a for a in accounts if a["name"] == "Tarjeta Oro")
    assert card["logo_data_url"] == logo
    assert card["credit_limit"] == "20000.00"
    assert card["billing_cycle_day"] == 5
    assert card["balance"] == "300.00"
    assert card["id"] != exported["accounts"][0].get("id")


async def test_import_is_idempotent_and_skips_existing(client: AsyncClient):
    headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Efectivo", "type": "asset", "subtype": "cash"},
    )
    exported = (await client.get("/api/v1/accounts/export", headers=headers)).json()

    response = await client.post("/api/v1/accounts/import", headers=headers, json=exported)
    assert response.json()["data"] == {"created": 0, "skipped": ["Efectivo"]}
    assert len((await client.get("/api/v1/accounts", headers=headers)).json()["data"]) == 1


async def test_import_can_start_from_initial_balance(client: AsyncClient):
    headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    payload = {
        "format": "northernlights.accounts",
        "version": 1,
        "accounts": [
            {"name": "Ahorros", "type": "asset", "subtype": "savings",
             "initial_balance": "100.00", "balance": "250.00"},
        ],
    }
    await client.post(
        "/api/v1/accounts/import", headers=headers, params={"use_current_balance": "false"},
        json=payload,
    )
    account = (await client.get("/api/v1/accounts", headers=headers)).json()["data"][0]
    assert account["balance"] == "100.00"


@pytest.mark.parametrize(
    "mutation",
    [
        {"format": "other"},
        {"version": 99},
        {"accounts": [{"name": "X", "type": "expense"}]},
        {"accounts": [{"name": "X", "type": "asset", "logo_data_url": "javascript:alert(1)"}]},
    ],
)
async def test_import_rejects_invalid_files(client: AsyncClient, mutation: dict):
    headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    body = {"format": "northernlights.accounts", "version": 1, "accounts": []} | mutation
    response = await client.post("/api/v1/accounts/import", headers=headers, json=body)
    assert response.status_code == 422
