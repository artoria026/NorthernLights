"""The native, immutable «Ajustes de saldo» category: every balance adjustment lives under it."""

import importlib.util
import uuid
from datetime import date
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import BACKEND_ROOT
from tests.test_debts import _create_account, _register_and_login

pytestmark = pytest.mark.asyncio


async def _adjustment_category(client, headers) -> dict:
    categories = (await client.get("/api/v1/categories", headers=headers)).json()["data"]
    return next(c for c in categories if c["slug"] == "balance_adjustment")


async def _setup(client):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    account = await _create_account(client, headers, name="Santander", initial_balance="1000")
    return headers, account


async def test_the_category_is_native_and_has_its_own_type(client: AsyncClient):
    headers, _ = await _setup(client)
    category = await _adjustment_category(client, headers)
    assert category["name"] == "Ajustes de saldo"
    assert category["type"] == "adjustment"
    assert category["is_system"] is True
    assert category["user_id"] is None

    # it is never offered where an income or an expense is picked
    for type_ in ("expense", "income"):
        listed = (await client.get(f"/api/v1/categories?type={type_}", headers=headers)).json()
        assert all(c["slug"] != "balance_adjustment" for c in listed["data"])


async def test_every_adjustment_goes_under_it_and_shows_its_name(client: AsyncClient):
    headers, account = await _setup(client)
    category = await _adjustment_category(client, headers)

    out = await client.post(
        f"/api/v1/accounts/{account}/reconcile",
        headers=headers,
        json={"real_balance": "900.00", "date": "2026-09-10", "notes": "No sé en qué"},
    )
    assert out.json()["data"]["transaction"]["category_id"] == category["id"]
    back = await client.post(
        f"/api/v1/accounts/{account}/reconcile",
        headers=headers,
        json={"real_balance": "950.00", "date": "2026-09-12"},
    )
    assert back.json()["data"]["transaction"]["category_id"] == category["id"]

    listed = (await client.get("/api/v1/transactions?per_page=50", headers=headers)).json()["data"]
    adjustments = [t for t in listed if t["entry_type"].startswith("adjustment")]
    assert len(adjustments) == 2
    assert {t["category_name"] for t in adjustments} == {"Ajustes de saldo"}
    # and the category filter gathers them
    by_category = await client.get(
        f"/api/v1/transactions?category_id={category['id']}&per_page=50", headers=headers
    )
    assert len(by_category.json()["data"]) == 2


async def test_an_adjustment_cannot_be_given_another_category_nor_the_other_way(
    client: AsyncClient,
):
    headers, account = await _setup(client)
    category = await _adjustment_category(client, headers)
    expense = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]

    wrong = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-10-01",
            "description": "Ajuste",
            "entry_type": "adjustment_out",
            "account_id": account,
            "amount": "10.00",
            "category_id": expense[0]["id"],
        },
    )
    assert wrong.status_code == 400
    # an expense cannot use the adjustments category either
    reverse = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-10-01",
            "description": "Gasto",
            "entry_type": "expense",
            "account_id": account,
            "amount": "10.00",
            "category_id": category["id"],
        },
    )
    assert reverse.status_code == 400
    # without a category, the app assigns it
    plain = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-10-01",
            "description": "Ajuste",
            "entry_type": "adjustment_out",
            "account_id": account,
            "amount": "10.00",
        },
    )
    assert plain.status_code == 201
    assert plain.json()["data"]["category_id"] == category["id"]


async def test_the_category_cannot_be_edited_deleted_hidden_or_created(client: AsyncClient):
    headers, _ = await _setup(client)
    category = await _adjustment_category(client, headers)
    cid = category["id"]

    assert (
        await client.put(f"/api/v1/categories/{cid}", headers=headers, json={"name": "Otra cosa"})
    ).status_code == 403
    assert (await client.delete(f"/api/v1/categories/{cid}", headers=headers)).status_code == 403
    hide = await client.post(f"/api/v1/categories/{cid}/deactivate", headers=headers)
    assert hide.status_code == 403
    create = await client.post(
        "/api/v1/categories",
        headers=headers,
        json={"name": "Mi ajuste", "type": "adjustment"},
    )
    assert create.status_code == 422
    # still there, still named the same
    assert (await _adjustment_category(client, headers))["name"] == "Ajustes de saldo"


async def test_an_adjustment_does_not_touch_the_expense_budget_or_the_expense_total(
    client: AsyncClient,
):
    headers, account = await _setup(client)
    await client.post(
        f"/api/v1/accounts/{account}/reconcile", headers=headers, json={"real_balance": "400.00"}
    )
    budget = await client.get("/api/v1/budget/current", headers=headers)
    for category in budget.json()["data"]["variable_categories"]:
        assert category["spent"] == "0.00"
    weeks = await client.get("/api/v1/budget/weekly", headers=headers)
    if weeks.status_code == 200:
        for week in weeks.json()["data"]["weeks"]:
            assert week["spent_by_category"] == {}


def _load_migration():
    path = next(
        (BACKEND_ROOT / "alembic" / "versions").glob("*_add_balance_adjustments_category.py")
    )
    spec = importlib.util.spec_from_file_location("add_balance_adjustments_migration", Path(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_existing_adjustments_are_moved_under_the_category_by_the_migration(db_connection):
    """Runs the migration's own downgrade/upgrade inside the test's rolled-back transaction."""
    migration = _load_migration()

    def run(sync_conn, step):
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(migration, step)()

    user_id = uuid.uuid4()
    old_out, old_in, expense = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    await db_connection.run_sync(run, "downgrade")
    await db_connection.execute(
        text("INSERT INTO users (id, email, name, role) VALUES (:id, :email, 'T', 'user')"),
        {"id": user_id, "email": f"{user_id}@example.com"},
    )
    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    for entry_id, entry_type in (
        (old_out, "adjustment_out"),
        (old_in, "adjustment_in"),
        (expense, "expense"),
    ):
        await db_connection.execute(
            text(
                "INSERT INTO journal_entries (id, user_id, date, description, entry_type, status) "
                "VALUES (:id, :uid, :d, 'x', :t, 'confirmed')"
            ),
            {"id": entry_id, "uid": user_id, "d": date(2026, 1, 1), "t": entry_type},
        )
    await db_connection.execute(text("SELECT set_config('app.current_user_id', '', true)"))

    await db_connection.run_sync(run, "upgrade")

    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    rows = (
        await db_connection.execute(
            text(
                "SELECT e.id, c.slug FROM journal_entries e "
                "LEFT JOIN categories c ON c.id = e.category_id WHERE e.user_id = :u"
            ),
            {"u": user_id},
        )
    ).all()
    by_id = dict(rows)
    assert by_id[old_out] == "balance_adjustment"
    assert by_id[old_in] == "balance_adjustment"
    assert by_id[expense] is None  # nothing else is touched


async def test_the_report_gives_the_adjustments_month_by_month(client: AsyncClient):
    headers, account = await _setup(client)
    today = date.today()
    this_month = today.replace(day=1)

    await client.post(
        f"/api/v1/accounts/{account}/reconcile",
        headers=headers,
        json={"real_balance": "900.00", "date": this_month.isoformat()},
    )
    await client.post(
        f"/api/v1/accounts/{account}/reconcile",
        headers=headers,
        json={"real_balance": "950.00", "date": this_month.isoformat()},
    )
    expense = (await client.get("/api/v1/categories?type=expense", headers=headers)).json()["data"]
    await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": this_month.isoformat(),
            "description": "Comida",
            "entry_type": "expense",
            "account_id": account,
            "amount": "150.00",
            "category_id": expense[0]["id"],
        },
    )

    response = await client.get("/api/v1/reports/adjustments?months=3", headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["months"]) == 3  # the months without adjustments are there, at zero
    current = data["months"][-1]
    assert current["month"] == this_month.strftime("%Y-%m")
    assert current["total_out"] == "100.00"
    assert current["total_in"] == "50.00"
    assert current["net"] == "-50.00"
    assert current["count"] == 2
    assert current["expenses"] == "150.00"
    # 100 of the 250 that left was unidentified
    assert current["unidentified_share"] == pytest.approx(0.4)
    assert data["months"][0]["count"] == 0 and data["months"][0]["net"] == "0"
    assert data["total"]["net"] == "-50.00" and data["total"]["count"] == 2
