import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from app.models.category import Category

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


async def test_list_categories_includes_system_seed(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert response.status_code == 200
    categories = response.json()["data"]
    assert any(c["is_system"] for c in categories)
    assert len(categories) == 9


async def test_create_own_category(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Hobbies", "type": "expense", "icon": "puzzle"},
    )
    assert response.status_code == 201
    assert response.json()["data"]["is_system"] is False


async def test_cannot_edit_or_delete_system_category(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    system_category_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    edit = await client.put(
        f"/api/v1/categories/{system_category_id}", headers=headers, json={"name": "Hackeada"}
    )
    assert edit.status_code == 403

    delete = await client.delete(f"/api/v1/categories/{system_category_id}", headers=headers)
    assert delete.status_code == 403


async def _create_expense_transaction(client: AsyncClient, headers: dict, category_id: str) -> str:
    checking = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Banco", "type": "asset", "subtype": "checking", "initial_balance": "100"},
    )
    expense_acc = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Gastos", "type": "expense", "initial_balance": "0"},
    )
    tx = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Gasto",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {
                    "account_id": expense_acc.json()["data"]["id"],
                    "amount": "10.00",
                    "type": "debit",
                },
                {
                    "account_id": checking.json()["data"]["id"],
                    "amount": "10.00",
                    "type": "credit",
                },
            ],
        },
    )
    return tx.json()["data"]["id"]


async def test_delete_category_unlinks_transactions_instead_of_blocking(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    category = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Propia", "type": "expense"},
    )
    category_id = category.json()["data"]["id"]
    tx_id = await _create_expense_transaction(client, headers, category_id)

    delete = await client.delete(f"/api/v1/categories/{category_id}", headers=headers)
    assert delete.status_code == 200

    tx = await client.get(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert tx.json()["data"]["category_id"] is None

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert category_id not in {c["id"] for c in listing.json()["data"]}


async def test_deactivate_system_category_hides_it_only_for_that_user(client: AsyncClient):
    token_a = await _register_and_login(client)
    token_b = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers_a)
    system_category_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    deactivate = await client.post(
        f"/api/v1/categories/{system_category_id}/deactivate", headers=headers_a
    )
    assert deactivate.status_code == 200

    listing_a = await client.get("/api/v1/categories?type=expense", headers=headers_a)
    assert system_category_id not in {c["id"] for c in listing_a.json()["data"]}

    listing_b = await client.get("/api/v1/categories?type=expense", headers=headers_b)
    assert system_category_id in {c["id"] for c in listing_b.json()["data"]}


async def test_deactivate_system_category_unlinks_transactions(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    system_category_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])
    tx_id = await _create_expense_transaction(client, headers, system_category_id)

    await client.post(f"/api/v1/categories/{system_category_id}/deactivate", headers=headers)

    tx = await client.get(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert tx.json()["data"]["category_id"] is None


async def test_reactivate_category_restores_visibility(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    system_category_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    await client.post(f"/api/v1/categories/{system_category_id}/deactivate", headers=headers)
    hidden = await client.get("/api/v1/categories/hidden?type=expense", headers=headers)
    assert system_category_id in {c["id"] for c in hidden.json()["data"]}

    reactivate = await client.post(
        f"/api/v1/categories/{system_category_id}/reactivate", headers=headers
    )
    assert reactivate.status_code == 200

    listing_after = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert system_category_id in {c["id"] for c in listing_after.json()["data"]}

    hidden_after = await client.get("/api/v1/categories/hidden?type=expense", headers=headers)
    assert system_category_id not in {c["id"] for c in hidden_after.json()["data"]}


async def test_cannot_deactivate_own_category(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    category = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Propia", "type": "expense"}
    )
    category_id = category.json()["data"]["id"]

    deactivate = await client.post(f"/api/v1/categories/{category_id}/deactivate", headers=headers)
    assert deactivate.status_code == 400


async def test_create_subcategory_under_system_parent(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    parent_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    sub = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Restaurantes", "type": "expense", "parent_id": parent_id},
    )
    assert sub.status_code == 201
    data = sub.json()["data"]
    assert data["parent_id"] == parent_id
    assert data["is_system"] is False

    listing_after = await client.get("/api/v1/categories?type=expense", headers=headers)
    assert data["id"] in {c["id"] for c in listing_after.json()["data"]}


async def test_cannot_nest_subcategory_two_levels_deep(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    parent_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    sub = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Restaurantes", "type": "expense", "parent_id": parent_id},
    )
    sub_id = sub.json()["data"]["id"]

    grandchild = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Comida rapida", "type": "expense", "parent_id": sub_id},
    )
    assert grandchild.status_code == 400


async def test_subcategory_type_must_match_parent(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    expense_parent_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    mismatched = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Bono", "type": "income", "parent_id": expense_parent_id},
    )
    assert mismatched.status_code == 400


async def test_delete_parent_category_cascades_to_subcategories(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    parent = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Suscripciones", "type": "expense"}
    )
    parent_id = parent.json()["data"]["id"]
    sub = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Streaming", "type": "expense", "parent_id": parent_id},
    )
    sub_id = sub.json()["data"]["id"]
    tx_id = await _create_expense_transaction(client, headers, sub_id)

    delete = await client.delete(f"/api/v1/categories/{parent_id}", headers=headers)
    assert delete.status_code == 200

    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    remaining_ids = {c["id"] for c in listing.json()["data"]}
    assert parent_id not in remaining_ids
    assert sub_id not in remaining_ids

    tx = await client.get(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert tx.json()["data"]["category_id"] is None


async def test_subcategory_requires_user_id_at_db_level(client: AsyncClient, session_factory):
    """ck_categories_subcategory_user_scoped: a subcategory (non-null
    parent_id) can never be a system row (user_id NULL), not even by
    bypassing category_service with a direct INSERT -- RLS alone wouldn't have
    blocked it (rls_categories allows user_id IS NULL regardless of the
    session), so this is a real second layer, not redundant."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    listing = await client.get("/api/v1/categories?type=expense", headers=headers)
    parent_id = next(c["id"] for c in listing.json()["data"] if c["is_system"])

    async with session_factory() as session:
        session.add(
            Category(
                user_id=None,
                name="Subcategoria de sistema invalida",
                type="expense",
                is_system=True,
                parent_id=uuid.UUID(parent_id),
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
