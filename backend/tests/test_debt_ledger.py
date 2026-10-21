"""The per-person ledger of a debt: every loan and repayment, with why and when."""

import importlib.util
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import BACKEND_ROOT
from tests.test_debts import _create_account, _register_and_login

pytestmark = pytest.mark.asyncio


async def _lend(client, headers, account_id, **overrides):
    payload = {
        "name": "Emanuel",
        "type": "informal",
        "direction": "owed_to_me",
        "total_amount": "500.00",
        "funding_account_id": account_id,
        "start_date": "2026-10-01",
        "concept": "Cena de cumpleaños",
    }
    payload.update(overrides)
    return await client.post("/api/v1/debts", headers=headers, json=payload)


async def _movements(client, headers, debt_id):
    response = await client.get(f"/api/v1/debts/{debt_id}/movements", headers=headers)
    assert response.status_code == 200
    return response.json()["data"]


async def test_a_person_debt_grows_with_more_loans_and_shrinks_with_repayments(
    client: AsyncClient,
):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    efectivo = await _create_account(client, headers, name="Efectivo", initial_balance="0")

    created = await _lend(client, headers, santander)
    assert created.status_code == 201
    debt_id = created.json()["data"]["id"]

    more = await client.post(
        f"/api/v1/debts/{debt_id}/loans",
        headers=headers,
        json={
            "account_id": santander,
            "amount": "1000.00",
            "date": "2026-10-05",
            "concept": "Reparación del coche",
        },
    )
    assert more.status_code == 201
    assert more.json()["data"]["delta"] == "1000.00"
    assert more.json()["data"]["balance_after"] == "1500.00"

    paid = await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={
            "account_id": efectivo,
            "amount": "300.00",
            "date": "2026-10-10",
            "notes": "Abono en efectivo",
        },
    )
    assert paid.status_code == 201

    movements = await _movements(client, headers, debt_id)
    assert [(m["kind"], m["delta"], m["balance_after"]) for m in movements] == [
        ("loan", "500.00", "500.00"),
        ("loan", "1000.00", "1500.00"),
        ("payment", "-300.00", "1200.00"),
    ]
    assert [m["concept"] for m in movements] == [
        "Cena de cumpleaños",
        "Reparación del coche",
        "Abono en efectivo",
    ]
    assert [m["account_name"] for m in movements] == ["Santander", "Santander", "Efectivo"]
    assert all(m["created_at"] and m["journal_entry_id"] for m in movements)

    # One debt per person, and the real accounts moved: 1,500 lent out, 300 collected.
    debt = (await client.get(f"/api/v1/debts/{debt_id}", headers=headers)).json()["data"]
    assert debt["current_balance"] == "1200.00"
    assert debt["total_amount"] == "1500.00"
    balances = {
        name: (await client.get(f"/api/v1/accounts/{aid}", headers=headers)).json()["data"][
            "balance"
        ]
        for name, aid in (("santander", santander), ("efectivo", efectivo))
    }
    assert balances == {"santander": "3500.00", "efectivo": "300.00"}

    # The concept travels to the transaction too.
    listed = await client.get("/api/v1/transactions?per_page=50", headers=headers)
    descriptions = {t["description"] for t in listed.json()["data"]}
    assert "Préstamo a Emanuel — Reparación del coche" in descriptions


async def test_a_second_debt_for_the_same_person_is_rejected(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    assert (await _lend(client, headers, santander)).status_code == 201

    again = await _lend(client, headers, santander, name="  emanuel ", total_amount="100.00")
    assert again.status_code == 409
    assert "Prestar más" in again.json()["error"]


async def test_lending_again_reopens_a_debt_that_was_paid_off(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    debt_id = (await _lend(client, headers, santander)).json()["data"]["id"]
    await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={"account_id": santander, "amount": "500.00", "date": "2026-10-03"},
    )
    assert (await client.get(f"/api/v1/debts/{debt_id}", headers=headers)).json()["data"][
        "status"
    ] == "completed"

    await client.post(
        f"/api/v1/debts/{debt_id}/loans",
        headers=headers,
        json={
            "account_id": santander,
            "amount": "200.00",
            "date": "2026-10-08",
            "concept": "Otra vez",
        },
    )
    debt = (await client.get(f"/api/v1/debts/{debt_id}", headers=headers)).json()["data"]
    assert debt["status"] == "active"
    assert debt["current_balance"] == "200.00"
    # and a new debt with that name is allowed again only after this one is paid off
    movements = await _movements(client, headers, debt_id)
    assert movements[-1]["balance_after"] == "200.00"


async def test_a_debt_that_already_existed_opens_with_its_balance_and_corrections_are_logged(
    client: AsyncClient,
):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Franco Andrade",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": "15000.00",
            "start_date": "2026-01-01",
        },
    )
    debt_id = created.json()["data"]["id"]

    corrected = await client.put(
        f"/api/v1/debts/{debt_id}", headers=headers, json={"current_balance": "10000.00"}
    )
    assert corrected.status_code == 200

    movements = await _movements(client, headers, debt_id)
    assert [(m["kind"], m["delta"], m["balance_after"], m["account_id"]) for m in movements] == [
        ("opening", "15000.00", "15000.00", None),
        ("adjustment", "-5000.00", "10000.00", None),
    ]
    assert movements[0]["concept"] == "Saldo inicial"
    assert movements[1]["concept"] == "Corrección de saldo"


async def test_a_shared_expense_leaves_its_loan_in_the_history(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    tdc = await _create_account(
        client, headers, name="TDC", type="liability", subtype="credit_card", initial_balance="0"
    )
    categories = await client.get("/api/v1/categories?type=expense", headers=headers)
    await client.post(
        "/api/v1/transactions/split",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Cena grupal",
            "category_id": categories.json()["data"][0]["id"],
            "paying_account_id": tdc,
            "my_share": "100.00",
            "debtors": [{"person_name": "Amigo", "amount": "400.00"}],
        },
    )
    debt = (await client.get("/api/v1/debts?direction=owed_to_me", headers=headers)).json()["data"][
        0
    ]
    movements = await _movements(client, headers, debt["id"])
    assert [(m["kind"], m["delta"], m["concept"], m["account_name"]) for m in movements] == [
        ("loan", "400.00", "Cena grupal", "TDC")
    ]


async def test_the_history_is_private(client: AsyncClient):
    token_a = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    santander = await _create_account(client, headers_a, name="Santander", initial_balance="1000")
    debt_id = (await _lend(client, headers_a, santander)).json()["data"]["id"]

    token_b = await _register_and_login(client)
    headers_b = {"Authorization": f"Bearer {token_b}"}
    assert (
        await client.get(f"/api/v1/debts/{debt_id}/movements", headers=headers_b)
    ).status_code == 404
    other = await _create_account(client, headers_b, name="Mia", initial_balance="1000")
    blocked = await client.post(
        f"/api/v1/debts/{debt_id}/loans",
        headers=headers_b,
        json={"account_id": other, "amount": "10.00", "date": "2026-10-09"},
    )
    assert blocked.status_code == 404


def _load_migration():
    path = next((BACKEND_ROOT / "alembic" / "versions").glob("*_add_debt_movements.py"))
    spec = importlib.util.spec_from_file_location("add_debt_movements_migration", Path(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_existing_debts_get_a_history_when_the_migration_runs(db_connection):
    """Runs the migration's own downgrade/upgrade inside the test's rolled-back transaction
    (Postgres DDL is transactional), so nothing outside it changes."""
    migration = _load_migration()

    def run(sync_conn, step):
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(migration, step)()

    user_id = uuid.uuid4()
    paid_off, corrected, plain = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    await db_connection.run_sync(run, "downgrade")
    await db_connection.execute(
        text("INSERT INTO users (id, email, name, role) VALUES (:id, :email, 'T', 'user')"),
        {"id": user_id, "email": f"{user_id}@example.com"},
    )
    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    for debt_id, total, balance, status in (
        (paid_off, "1000.00", "0.00", "completed"),
        (corrected, "15000.00", "10000.00", "active"),
        (plain, "500.00", "500.00", "active"),
    ):
        await db_connection.execute(
            text(
                "INSERT INTO debts (id, user_id, name, type, direction, total_amount, "
                "current_balance, status, start_date) VALUES (:id, :uid, :name, 'informal', "
                "'owed_to_me', :total, :balance, :status, :start)"
            ),
            {
                "id": debt_id,
                "uid": user_id,
                "name": f"P-{str(debt_id)[:4]}",
                "total": total,
                "balance": balance,
                "status": status,
                "start": date(2026, 1, 1),
            },
        )
    for amount, date_ in (("400.00", date(2026, 2, 1)), ("600.00", date(2026, 3, 1))):
        await db_connection.execute(
            text(
                "INSERT INTO debt_payments (debt_id, user_id, amount, date, notes) "
                "VALUES (:d, :uid, :a, :date, 'abono')"
            ),
            {"d": paid_off, "uid": user_id, "a": amount, "date": date_},
        )
    await db_connection.execute(text("SELECT set_config('app.current_user_id', '', true)"))

    await db_connection.run_sync(run, "upgrade")

    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    rows = (
        await db_connection.execute(
            text(
                "SELECT debt_id, kind, delta, concept FROM debt_movements "
                "ORDER BY debt_id, date, kind DESC"
            )
        )
    ).all()
    by_debt: dict[uuid.UUID, list[tuple[str, Decimal]]] = {}
    for debt_id, kind, delta, _concept in rows:
        by_debt.setdefault(debt_id, []).append((kind, delta))

    # paid off: opening 1,000 then two payments, nothing left (no correction needed)
    assert sorted(by_debt[paid_off]) == sorted(
        [
            ("opening", Decimal("1000.00")),
            ("payment", Decimal("-400.00")),
            ("payment", Decimal("-600.00")),
        ]
    )
    # balance edited by hand: opening plus the correction that explains the difference
    assert sorted(by_debt[corrected]) == sorted(
        [("opening", Decimal("15000.00")), ("adjustment", Decimal("-5000.00"))]
    )
    assert by_debt[plain] == [("opening", Decimal("500.00"))]
    # every history closes at the debt's current balance
    for debt_id, balance in ((paid_off, 0), (corrected, 10000), (plain, 500)):
        assert sum(delta for _, delta in by_debt[debt_id]) == balance
