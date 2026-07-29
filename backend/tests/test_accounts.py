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
    """Un ajuste de saldo nunca debe inflar el gasto de una categoria real --
    ver Notion 'Dev Environment, Stack y Setup Guide' seccion de buenas
    practicas de conciliacion. budget_service filtra por entry_type ==
    'expense', asi que un adjustment_out debe quedar afuera sin tocar nada
    ahi; este test lo deja explicito para no regresarlo por accidente."""
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

    # Usuario B no debe poder ver la cuenta de A
    listing_b = await client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token_b}"})
    assert listing_b.json()["data"] == []

    get_b = await client.get(
        f"/api/v1/accounts/{account_id}", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert get_b.status_code == 404

    # Usuario A si la ve
    get_a = await client.get(
        f"/api/v1/accounts/{account_id}", headers={"Authorization": f"Bearer {token_a}"}
    )
    assert get_a.status_code == 200


async def test_create_account_invalidates_financial_snapshot_cache(client: AsyncClient):
    """account_service.create_account no invalidaba el snapshot cacheado
    (gap preexistente, tambien afectaba a debt_service/recurring_service) --
    esto confirma que crear una cuenta ya no deja el cache stale hasta que
    expire su TTL de 5 min."""
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
    """Cambiar initial_balance no debe pisar el efecto de las transacciones ya
    confirmadas -- el balance se desplaza por el mismo delta, preservando el
    invariante balance = initial_balance + suma de deltas."""
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
    # 800 (con el gasto ya aplicado) + el delta de initial_balance (1500-1000).
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
