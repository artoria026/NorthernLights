import importlib.util
import uuid
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from openpyxl import Workbook
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.tasks import alerts
from tests.conftest import BACKEND_ROOT, rls_session

pytestmark = pytest.mark.asyncio


async def _register_and_login(client: AsyncClient) -> tuple[dict, uuid.UUID]:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "name": "Test",
            "password": "supersecret123",
            "accept_disclaimer": True,
        },
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    token = login.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    return headers, uuid.UUID(me.json()["data"]["id"])


async def test_a_debt_can_be_a_credit_and_the_type_can_change_to_it(client: AsyncClient):
    headers, _ = await _register_and_login(client)

    created = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Mercado Libre", "type": "credit", "total_amount": "3482.78"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["data"]["type"] == "credit"

    loan = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Klar", "type": "personal_loan", "total_amount": "11433.95"},
    )
    changed = await client.put(
        f"/api/v1/debts/{loan.json()['data']['id']}", headers=headers, json={"type": "credit"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["type"] == "credit"

    invalid = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "X", "type": "tarjeta", "total_amount": "10"},
    )
    assert invalid.status_code == 422


async def test_an_overdue_credit_generates_the_overdue_alert(client: AsyncClient, session_factory):
    headers, uid = await _register_and_login(client)
    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Coppel",
            "type": "credit",
            "total_amount": "18111.00",
            "due_date": (date.today() - timedelta(days=5)).isoformat(),
        },
    )

    async with rls_session(session_factory, uid) as session:
        count = await alerts._process_overdue_loans_for_user(session, uid, date.today())
        assert count == 1


async def test_bulk_import_accepts_the_credit_type(client: AsyncClient):
    headers, _ = await _register_and_login(client)
    await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Santander", "type": "asset", "subtype": "checking", "initial_balance": "0"},
    )
    wb = Workbook()
    ws = wb.active
    ws.title = "Transacciones"
    for col, value in zip(
        ("W", "X", "Y", "Z", "AC", "AI", "AV", "AW"),
        (
            3482.78,
            "Mercado Libre",
            "Saldo inicial",
            date(2025, 10, 12),
            "Debo",
            "Crédito",
            31661.68,
            3482.78,
        ),
        strict=True,
    ):
        ws[f"{col}3"] = value
    buf = BytesIO()
    wb.save(buf)

    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={"file": ("credito.xlsx", buf.getvalue(), "application/octet-stream")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["errors"] == []

    debts = (await client.get("/api/v1/debts", headers=headers)).json()["data"]
    assert [(d["name"], d["type"]) for d in debts] == [("Mercado Libre", "credit")]


def _load_migration():
    path = next((BACKEND_ROOT / "alembic" / "versions").glob("*_add_credit_debt_type.py"))
    spec = importlib.util.spec_from_file_location("add_credit_debt_type_migration", Path(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_migration_turns_credits_back_into_loans_on_downgrade(db_connection):
    migration = _load_migration()

    def run(sync_conn, step):
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(migration, step)()

    user_id, debt_id = uuid.uuid4(), uuid.uuid4()
    await db_connection.execute(
        text("INSERT INTO users (id, email, name, role) VALUES (:id, :email, 'T', 'user')"),
        {"id": user_id, "email": f"{user_id}@example.com"},
    )
    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    await db_connection.execute(
        text(
            "INSERT INTO debts (id, user_id, name, type, total_amount, current_balance) "
            "VALUES (:id, :uid, 'Coppel', 'credit', 100, 100)"
        ),
        {"id": debt_id, "uid": user_id},
    )
    await db_connection.execute(text("SELECT set_config('app.current_user_id', '', true)"))

    await db_connection.run_sync(run, "downgrade")

    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    kind = (
        await db_connection.execute(text("SELECT type FROM debts WHERE id = :id"), {"id": debt_id})
    ).scalar_one()
    assert kind == "personal_loan"

    await db_connection.run_sync(run, "upgrade")
    async with db_connection.begin_nested():
        await db_connection.execute(
            text("UPDATE debts SET type = 'credit' WHERE id = :id"), {"id": debt_id}
        )
    with pytest.raises(DBAPIError):
        async with db_connection.begin_nested():
            await db_connection.execute(
                text("UPDATE debts SET type = 'nope' WHERE id = :id"), {"id": debt_id}
            )
