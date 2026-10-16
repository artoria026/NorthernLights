"""Tags: labels the user creates to group expenses across categories."""

import pytest
from httpx import AsyncClient

from tests.test_transactions import _create_account, _get_category_id, _register_and_login

pytestmark = pytest.mark.asyncio


async def _setup(client: AsyncClient) -> dict:
    headers = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    account_id = await _create_account(
        client, headers, name="Banco", type="asset", subtype="checking", initial_balance="5000"
    )
    return {
        "headers": headers,
        "account_id": account_id,
        "expense_category": await _get_category_id(client, headers, "expense"),
        "income_category": await _get_category_id(client, headers, "income"),
    }


async def _tag(client: AsyncClient, ctx: dict, name: str, **extra) -> dict:
    response = await client.post(
        "/api/v1/tags", headers=ctx["headers"], json={"name": name, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _expense(
    client: AsyncClient, ctx: dict, description: str, amount: str, date: str = "2026-10-10", **extra
) -> dict:
    response = await client.post(
        "/api/v1/transactions",
        headers=ctx["headers"],
        json={
            "date": date,
            "description": description,
            "entry_type": "expense",
            "category_id": ctx["expense_category"],
            "account_id": ctx["account_id"],
            "amount": amount,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _transactions(client: AsyncClient, ctx: dict, query: str = "") -> list[dict]:
    response = await client.get(f"/api/v1/transactions?per_page=500{query}", headers=ctx["headers"])
    return response.json()["data"]


async def test_create_rename_and_names_are_unique_ignoring_case(client: AsyncClient):
    ctx = await _setup(client)
    tag = await _tag(client, ctx, "Viaje Mty Concierto X", color="#e85d9c")
    assert tag["color"] == "#e85d9c"

    duplicate = await client.post(
        "/api/v1/tags", headers=ctx["headers"], json={"name": "viaje mty concierto x"}
    )
    assert duplicate.status_code == 409
    bad_color = await client.post(
        "/api/v1/tags", headers=ctx["headers"], json={"name": "X", "color": "rojo"}
    )
    assert bad_color.status_code == 422

    other = await _tag(client, ctx, "Negocios CDMX")
    clash = await client.patch(
        f"/api/v1/tags/{other['id']}",
        headers=ctx["headers"],
        json={"name": "VIAJE MTY CONCIERTO X"},
    )
    assert clash.status_code == 409
    renamed = await client.patch(
        f"/api/v1/tags/{tag['id']}", headers=ctx["headers"], json={"name": "Mty 2026"}
    )
    assert renamed.json()["data"]["name"] == "Mty 2026"


async def test_an_expense_carries_several_tags_and_can_be_filtered_by_them(client: AsyncClient):
    ctx = await _setup(client)
    mty = await _tag(client, ctx, "Viaje Mty")
    pareja = await _tag(client, ctx, "Con pareja")
    work = await _tag(client, ctx, "Negocios")

    both = await _expense(client, ctx, "Cena", "500", tag_ids=[mty["id"], pareja["id"]])
    await _expense(client, ctx, "Taxi", "200", tag_ids=[work["id"]])
    await _expense(client, ctx, "Super", "300")

    assert sorted(t["name"] for t in both["tags"]) == ["Con pareja", "Viaje Mty"]

    mty_only = await _transactions(client, ctx, f"&tag_ids={mty['id']}")
    assert [t["description"] for t in mty_only] == ["Cena"]
    either = await _transactions(client, ctx, f"&tag_ids={mty['id']},{work['id']}")
    assert sorted(t["description"] for t in either) == ["Cena", "Taxi"]
    assert len(await _transactions(client, ctx)) == 3


async def test_editing_a_transaction_keeps_its_tags_unless_told_otherwise(client: AsyncClient):
    ctx = await _setup(client)
    mty = await _tag(client, ctx, "Viaje Mty")
    other = await _tag(client, ctx, "Otro")
    tx = await _expense(client, ctx, "Cena", "500", tag_ids=[mty["id"]])

    # an amount change rebuilds the entry internally: the tag must follow it
    edited = await client.put(
        f"/api/v1/transactions/{tx['id']}", headers=ctx["headers"], json={"amount": "650"}
    )
    assert [t["name"] for t in edited.json()["data"]["tags"]] == ["Viaje Mty"]
    assert len(await _transactions(client, ctx, f"&tag_ids={mty['id']}")) == 1

    swapped = await client.put(
        f"/api/v1/transactions/{edited.json()['data']['id']}",
        headers=ctx["headers"],
        json={"tag_ids": [other["id"]]},
    )
    assert [t["name"] for t in swapped.json()["data"]["tags"]] == ["Otro"]
    cleared = await client.put(
        f"/api/v1/transactions/{swapped.json()['data']['id']}",
        headers=ctx["headers"],
        json={"tag_ids": []},
    )
    assert cleared.json()["data"]["tags"] == []


async def test_tags_only_go_on_expenses_and_only_the_users_own(client: AsyncClient):
    ctx = await _setup(client)
    tag = await _tag(client, ctx, "Viaje Mty")

    income = await client.post(
        "/api/v1/transactions",
        headers=ctx["headers"],
        json={
            "date": "2026-10-10",
            "description": "Nomina",
            "entry_type": "income",
            "category_id": ctx["income_category"],
            "account_id": ctx["account_id"],
            "amount": "1000",
            "tag_ids": [tag["id"]],
        },
    )
    assert income.status_code == 400

    stranger = await _setup(client)
    foreign = await client.post(
        "/api/v1/transactions",
        headers=stranger["headers"],
        json={
            "date": "2026-10-10",
            "description": "Cena",
            "entry_type": "expense",
            "category_id": stranger["expense_category"],
            "account_id": stranger["account_id"],
            "amount": "10",
            "tag_ids": [tag["id"]],
        },
    )
    assert foreign.status_code == 404
    assert (
        await client.get(f"/api/v1/tags/{tag['id']}/summary", headers=stranger["headers"])
    ).status_code == 404
    assert (await client.get("/api/v1/tags", headers=stranger["headers"])).json()["data"] == []


async def test_bulk_tagging_adds_and_removes_on_many_expenses(client: AsyncClient):
    ctx = await _setup(client)
    mty = await _tag(client, ctx, "Viaje Mty")
    old = await _tag(client, ctx, "Provisional")
    first = await _expense(client, ctx, "Cena", "500", tag_ids=[old["id"]])
    second = await _expense(client, ctx, "Taxi", "200")
    untouched = await _expense(client, ctx, "Super", "300")

    result = await client.post(
        "/api/v1/tags/bulk",
        headers=ctx["headers"],
        json={
            "transaction_ids": [first["id"], second["id"]],
            "add_tag_ids": [mty["id"]],
            "remove_tag_ids": [old["id"]],
        },
    )
    assert result.json()["data"] == {"updated": 2}

    by_description = {
        t["description"]: [x["name"] for x in t["tags"]] for t in await _transactions(client, ctx)
    }
    assert by_description == {"Cena": ["Viaje Mty"], "Taxi": ["Viaje Mty"], "Super": []}
    assert untouched["id"]


async def test_bulk_tagging_is_all_or_nothing(client: AsyncClient):
    ctx = await _setup(client)
    tag = await _tag(client, ctx, "Viaje Mty")
    expense = await _expense(client, ctx, "Cena", "500")
    income = await client.post(
        "/api/v1/transactions",
        headers=ctx["headers"],
        json={
            "date": "2026-10-10",
            "description": "Nomina",
            "entry_type": "income",
            "category_id": ctx["income_category"],
            "account_id": ctx["account_id"],
            "amount": "1000",
        },
    )
    response = await client.post(
        "/api/v1/tags/bulk",
        headers=ctx["headers"],
        json={
            "transaction_ids": [expense["id"], income.json()["data"]["id"]],
            "add_tag_ids": [tag["id"]],
        },
    )
    assert response.status_code == 400
    assert await _transactions(client, ctx, f"&tag_ids={tag['id']}") == []


async def test_summary_totals_by_category_and_day_ignoring_deleted_and_other_tags(
    client: AsyncClient,
):
    ctx = await _setup(client)
    mty = await _tag(client, ctx, "Viaje Mty")
    other = await _tag(client, ctx, "Otro")
    await _expense(client, ctx, "Cena", "500", date="2026-10-10", tag_ids=[mty["id"]])
    await _expense(client, ctx, "Taxi", "100", date="2026-10-10", tag_ids=[mty["id"]])
    await _expense(client, ctx, "Hotel", "900", date="2026-10-11", tag_ids=[mty["id"]])
    gone = await _expense(client, ctx, "Cancelado", "999", date="2026-10-11", tag_ids=[mty["id"]])
    await _expense(client, ctx, "Ajeno", "50", tag_ids=[other["id"]])
    await client.delete(f"/api/v1/transactions/{gone['id']}", headers=ctx["headers"])

    summary = (
        await client.get(f"/api/v1/tags/{mty['id']}/summary", headers=ctx["headers"])
    ).json()["data"]
    assert summary["transaction_count"] == 3
    assert float(summary["total_spent"]) == 1500
    assert float(summary["average_per_transaction"]) == 500
    assert (summary["first_date"], summary["last_date"]) == ("2026-10-10", "2026-10-11")
    assert [(d["date"], float(d["amount"])) for d in summary["by_day"]] == [
        ("2026-10-10", 600),
        ("2026-10-11", 900),
    ]
    assert sum(float(c["amount"]) for c in summary["by_category"]) == 1500
    assert sum(c["count"] for c in summary["by_category"]) == 3

    ranged = (
        await client.get(
            f"/api/v1/tags/{mty['id']}/summary?date_from=2026-10-11", headers=ctx["headers"]
        )
    ).json()["data"]
    assert float(ranged["total_spent"]) == 900


async def test_list_shows_each_tags_totals_and_deleting_one_keeps_the_transactions(
    client: AsyncClient,
):
    ctx = await _setup(client)
    mty = await _tag(client, ctx, "Viaje Mty")
    empty = await _tag(client, ctx, "Sin gastos")
    await _expense(client, ctx, "Cena", "500", tag_ids=[mty["id"]])
    await _expense(client, ctx, "Hotel", "900", date="2026-10-12", tag_ids=[mty["id"]])

    tags = {
        t["name"]: t
        for t in (await client.get("/api/v1/tags", headers=ctx["headers"])).json()["data"]
    }
    assert tags["Viaje Mty"]["transaction_count"] == 2
    assert float(tags["Viaje Mty"]["total_spent"]) == 1400
    assert tags["Viaje Mty"]["last_date"] == "2026-10-12"
    assert tags["Sin gastos"]["transaction_count"] == 0 and empty["id"]

    assert (
        await client.delete(f"/api/v1/tags/{mty['id']}", headers=ctx["headers"])
    ).status_code == 204
    remaining = await _transactions(client, ctx)
    assert sorted(t["description"] for t in remaining) == ["Cena", "Hotel"]
    assert all(t["tags"] == [] for t in remaining)
