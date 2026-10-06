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


async def _auth(client: AsyncClient) -> dict:
    return {"Authorization": f"Bearer {await _register_and_login(client)}"}


async def _setup_custom_categories(client: AsyncClient, headers: dict) -> None:
    """A hidden system category, an own top-level category with a subcategory
    under it, and a subcategory under a system parent."""
    system = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    food = next(c for c in system if c["name"] == "Comida y Bebidas")
    pets = next(c for c in system if c["name"] == "Mascotas")
    await client.post(f"/api/v1/categories/{pets['id']}/deactivate", headers=headers)

    gym = (
        await client.post(
            "/api/v1/categories",
            headers=headers,
            json={"name": "Gimnasio", "type": "expense", "icon": "dumbbell", "color": "#112233"},
        )
    ).json()["data"]
    await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Suplementos", "type": "expense", "parent_id": gym["id"]},
    )
    await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Super", "type": "expense", "parent_id": food["id"]},
    )
    await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Bonos", "type": "income"}
    )


async def test_export_categories_has_system_state_and_own_tree(client: AsyncClient):
    headers = await _auth(client)
    await _setup_custom_categories(client, headers)

    response = await client.get("/api/v1/categories/export", headers=headers)
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    body = response.json()
    assert body["format"] == "northernlights.categories"
    by_name = {c["name"]: c for c in body["categories"]}

    # 12 system + 4 own
    assert len(body["categories"]) == 16
    assert by_name["Mascotas"]["is_system"] and by_name["Mascotas"]["hidden"]
    assert not by_name["Comida y Bebidas"]["hidden"]
    assert by_name["Gimnasio"]["icon"] == "dumbbell" and by_name["Gimnasio"]["color"] == "#112233"
    assert by_name["Suplementos"]["parent_name"] == "Gimnasio"
    assert by_name["Suplementos"]["parent_is_system"] is False
    assert by_name["Super"]["parent_name"] == "Comida y Bebidas"
    assert by_name["Super"]["parent_is_system"] is True
    assert "id" not in by_name["Gimnasio"] and "user_id" not in by_name["Gimnasio"]
    assert by_name["Bonos"]["type"] == "income"
    # parents always before their subcategories
    names = [c["name"] for c in body["categories"]]
    assert names.index("Gimnasio") < names.index("Suplementos")


async def test_export_then_import_roundtrip_into_fresh_user(client: AsyncClient):
    source = await _auth(client)
    await _setup_custom_categories(client, source)
    exported = (await client.get("/api/v1/categories/export", headers=source)).json()

    target = await _auth(client)
    response = await client.post("/api/v1/categories/import", headers=target, json=exported)
    assert response.status_code == 201
    assert response.json()["data"] == {"created": 4, "hidden": 1, "skipped": [], "unmatched": []}

    listing = (await client.get("/api/v1/categories", headers=target)).json()["data"]
    names = {c["name"]: c for c in listing}
    assert "Mascotas" not in names  # hidden for this user
    assert names["Gimnasio"]["color"] == "#112233"
    assert names["Suplementos"]["parent_id"] == names["Gimnasio"]["id"]
    assert names["Super"]["parent_id"] == names["Comida y Bebidas"]["id"]
    assert names["Bonos"]["type"] == "income"


async def test_import_categories_is_idempotent(client: AsyncClient):
    headers = await _auth(client)
    await _setup_custom_categories(client, headers)
    exported = (await client.get("/api/v1/categories/export", headers=headers)).json()

    response = await client.post("/api/v1/categories/import", headers=headers, json=exported)
    data = response.json()["data"]
    assert data["created"] == 0
    assert sorted(data["skipped"]) == ["Bonos", "Gimnasio", "Super", "Suplementos"]
    assert data["unmatched"] == []


async def test_import_reports_unmatched_system_and_missing_parent(client: AsyncClient):
    headers = await _auth(client)
    body = {
        "format": "northernlights.categories",
        "version": 1,
        "categories": [
            {"name": "Categoria Renombrada", "type": "expense", "is_system": True, "hidden": True},
            {"name": "Huerfana", "type": "expense", "parent_name": "No Existe",
             "parent_is_system": False},
        ],
    }
    response = await client.post("/api/v1/categories/import", headers=headers, json=body)
    assert response.json()["data"] == {
        "created": 0,
        "hidden": 0,
        "skipped": [],
        "unmatched": ["Categoria Renombrada", "No Existe > Huerfana"],
    }


@pytest.mark.parametrize(
    "mutation",
    [
        {"format": "other"},
        {"version": 99},
        {"categories": [{"name": "X", "type": "transfer"}]},
        {"categories": [{"name": "", "type": "expense"}]},
    ],
)
async def test_import_categories_rejects_invalid_files(client: AsyncClient, mutation: dict):
    headers = await _auth(client)
    body = {"format": "northernlights.categories", "version": 1, "categories": []} | mutation
    response = await client.post("/api/v1/categories/import", headers=headers, json=body)
    assert response.status_code == 422


async def _set_locale(client: AsyncClient, headers: dict, locale: str) -> None:
    response = await client.put("/api/v1/auth/settings", headers=headers, json={"locale": locale})
    assert response.status_code == 200


async def test_system_categories_in_db_match_the_single_source_of_truth(client: AsyncClient):
    from app.core.system_categories import SYSTEM_CATEGORIES

    headers = await _auth(client)
    listed = (await client.get("/api/v1/categories", headers=headers)).json()["data"]
    by_slug = {c["slug"]: c for c in listed}
    assert set(by_slug) == {c.slug for c in SYSTEM_CATEGORIES}
    for expected in SYSTEM_CATEGORIES:
        row = by_slug[expected.slug]
        assert (row["name"], row["type"], row["icon"], row["color"], row["sort_order"]) == (
            expected.name, expected.type, expected.icon, expected.color, expected.sort_order,
        )


async def test_category_names_follow_the_user_locale(client: AsyncClient):
    headers = await _auth(client)
    spanish = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    assert "Comida y Bebidas" in [c["name"] for c in spanish]

    await _set_locale(client, headers, "en")
    english = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    assert [c["name"] for c in english] == [
        "Food & Drinks", "Transport & Mobility", "Housing & Home", "Health & Wellness",
        "Clothing & Personal Care", "Leisure & Entertainment", "Education & Development",
        "Pets", "Other Expense",
    ]
    # same rows, same slugs -- only the displayed name changes
    assert [c["slug"] for c in english] == [c["slug"] for c in spanish]


async def test_own_categories_are_never_translated(client: AsyncClient):
    headers = await _auth(client)
    await _set_locale(client, headers, "en")
    created = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Gimnasio", "type": "expense"}
    )
    assert created.json()["data"]["name"] == "Gimnasio"
    assert created.json()["data"]["slug"] is None


async def test_transactions_and_budget_show_category_in_user_locale(client: AsyncClient):
    headers = await _auth(client)
    await _set_locale(client, headers, "en")
    account = (
        await client.post(
            "/api/v1/accounts",
            headers=headers,
            json={"name": "Efectivo", "type": "asset", "subtype": "cash", "initial_balance": "100"},
        )
    ).json()["data"]
    food = next(
        c
        for c in (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
        if c["slug"] == "food_drinks"
    )
    tx = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "entry_type": "expense", "description": "Lunch", "amount": "10",
            "date": "2026-10-01", "account_id": account["id"], "category_id": food["id"],
        },
    )
    assert tx.status_code == 201, tx.text
    listing = (await client.get("/api/v1/transactions", headers=headers)).json()["data"]
    assert listing[0]["category_name"] == "Food & Drinks"

    await _set_locale(client, headers, "es")
    listing = (await client.get("/api/v1/transactions", headers=headers)).json()["data"]
    assert listing[0]["category_name"] == "Comida y Bebidas"


async def test_category_import_matches_system_by_slug_and_either_language(client: AsyncClient):
    headers = await _auth(client)
    body = {
        "format": "northernlights.categories",
        "version": 1,
        "categories": [
            # by slug, even though the name is not any of the real ones
            {"name": "x", "slug": "pets", "type": "expense", "is_system": True, "hidden": True},
            # no slug, English name
            {"name": "Other Expense", "type": "expense", "is_system": True, "hidden": True},
            # subcategory under a system parent given by slug
            {"name": "Super", "type": "expense", "parent_name": "?", "parent_slug": "food_drinks",
             "parent_is_system": True},
        ],
    }
    response = await client.post("/api/v1/categories/import", headers=headers, json=body)
    assert response.json()["data"] == {"created": 1, "hidden": 2, "skipped": [], "unmatched": []}
    hidden = (await client.get("/api/v1/categories/hidden", headers=headers)).json()["data"]
    assert {c["slug"] for c in hidden} == {"pets", "other_expense"}


async def test_export_carries_slug_and_english_name(client: AsyncClient):
    headers = await _auth(client)
    exported = (await client.get("/api/v1/categories/export", headers=headers)).json()
    pets = next(c for c in exported["categories"] if c["slug"] == "pets")
    assert (pets["name"], pets["name_en"]) == ("Mascotas", "Pets")
    # canonical Spanish regardless of the reader's language
    await _set_locale(client, headers, "en")
    exported = (await client.get("/api/v1/categories/export", headers=headers)).json()
    assert next(c for c in exported["categories"] if c["slug"] == "pets")["name"] == "Mascotas"


async def test_ai_and_bulk_import_resolve_system_category_in_either_language(
    client: AsyncClient, session_factory
):
    from app.ai.write_tools import _resolve_category_id
    from app.services import category_service
    from app.services.bulk_import_service import _category_lookup
    from tests.conftest import rls_session as rls

    token = await _register_and_login(client)
    me = (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    user_id = uuid.UUID(me["data"]["id"])

    async with rls(session_factory, user_id) as session:
        for wanted in ("Mascotas", "mascotas", "Pets", " pets "):
            assert not isinstance(
                await _resolve_category_id(session, user_id, wanted, "expense"), dict
            )
        assert isinstance(await _resolve_category_id(session, user_id, "Nope", "expense"), dict)

        lookup = _category_lookup(await category_service.list_categories(session, user_id, "income"))
        assert lookup["main job"] == lookup["empleo principal"]
        assert lookup["other income"] == lookup["otro ingreso"]
