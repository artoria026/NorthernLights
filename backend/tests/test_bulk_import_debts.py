"""The Deudas block of the bulk import: loans, repayments and opening balances by person."""

from io import BytesIO

import pytest
from httpx import AsyncClient
from openpyxl import Workbook, load_workbook

from tests.test_debts import _create_account, _register_and_login

pytestmark = pytest.mark.asyncio

DEBT_COL = 23  # W: Monto, Persona, Movimiento, Fecha, Cuenta, Concepto; AC (29): Dirección


def _build_debt_upload(rows: list[dict]) -> bytes:
    """rows: [{'amount', 'person', 'kind', 'date', 'account', 'concept', 'direction'}] in the
    debts block (W-AC), data starting from row 3."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Transacciones"
    ws["A2"] = "Monto"
    for offset, header in enumerate(
        ["Monto", "Persona", "Movimiento", "Fecha", "Cuenta", "Concepto"]
    ):
        ws.cell(row=2, column=DEBT_COL + offset, value=header)
    ws.cell(row=2, column=29, value="Dirección")
    for row_num, row in enumerate(rows, start=3):
        ws.cell(row=row_num, column=DEBT_COL, value=row.get("amount"))
        ws.cell(row=row_num, column=DEBT_COL + 1, value=row.get("person"))
        ws.cell(row=row_num, column=DEBT_COL + 2, value=row.get("kind"))
        ws.cell(row=row_num, column=DEBT_COL + 3, value=row.get("date"))
        ws.cell(row=row_num, column=DEBT_COL + 4, value=row.get("account"))
        ws.cell(row=row_num, column=DEBT_COL + 5, value=row.get("concept"))
        if "direction" in row:
            ws.cell(row=row_num, column=29, value=row["direction"])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _post(client, headers, path, content):
    return await client.post(
        f"/api/v1/bulk-import/{path}",
        headers=headers,
        files={"file": ("deudas.xlsx", content, "application/octet-stream")},
    )


async def _debts(client, headers):
    return (await client.get("/api/v1/debts", headers=headers)).json()["data"]


async def _balance(client, headers, account_id):
    response = await client.get(f"/api/v1/accounts/{account_id}", headers=headers)
    return response.json()["data"]["balance"]


async def test_template_has_the_debts_block(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, name="Santander")

    response = await client.get("/api/v1/bulk-import/template", headers=headers)
    ws = load_workbook(BytesIO(response.content))["Transacciones"]
    assert ws["W1"].value == "Deudas"
    assert [ws.cell(row=2, column=c).value for c in range(23, 30)] == [
        "Monto",
        "Persona",
        "Movimiento",
        "Fecha",
        "Cuenta",
        "Concepto",
        "Dirección",
    ]


async def test_loans_and_repayments_build_a_persons_debt_in_date_order(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    efectivo = await _create_account(client, headers, name="Efectivo", initial_balance="0")

    # The repayment comes FIRST in the file, but it is dated after both loans.
    content = _build_debt_upload(
        [
            {
                "amount": 300,
                "person": "Emanuel",
                "kind": "Abono",
                "date": "2026-10-10",
                "account": "Efectivo",
                "concept": "Abono en efectivo",
            },
            {
                "amount": 1000,
                "person": "emanuel",
                "kind": "Préstamo",
                "date": "2026-10-05",
                "account": "Santander",
                "concept": "Reparación del coche",
            },
            {
                "amount": 500,
                "person": "Emanuel",
                "kind": "Prestamo",
                "date": "2026-10-01",
                "account": "Santander",
                "concept": "Cena de cumpleaños",
            },
        ]
    )
    response = await _post(client, headers, "upload", content)
    assert response.json()["data"] == {"created": 3, "errors": []}

    debts = await _debts(client, headers)
    assert len(debts) == 1
    assert debts[0]["name"] == "Emanuel"
    assert debts[0]["direction"] == "owed_to_me"
    assert debts[0]["current_balance"] == "1200.00"
    assert debts[0]["total_amount"] == "1500.00"

    movements = (
        await client.get(f"/api/v1/debts/{debts[0]['id']}/movements", headers=headers)
    ).json()["data"]
    assert [
        (m["kind"], m["delta"], m["balance_after"], m["concept"], m["account_name"])
        for m in movements
    ] == [
        ("loan", "500.00", "500.00", "Cena de cumpleaños", "Santander"),
        ("loan", "1000.00", "1500.00", "Reparación del coche", "Santander"),
        ("payment", "-300.00", "1200.00", "Abono en efectivo", "Efectivo"),
    ]
    # the real accounts moved: 1,500 lent out of Santander, 300 collected in cash
    assert await _balance(client, headers, santander) == "3500.00"
    assert await _balance(client, headers, efectivo) == "300.00"


async def test_opening_balance_needs_no_account_and_direction_debo_is_a_debt_of_mine(
    client: AsyncClient,
):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="1000")

    content = _build_debt_upload(
        [
            {
                "amount": 15000,
                "person": "Franco Andrade",
                "kind": "Saldo inicial",
                "date": "2026-01-01",
                "concept": "Lo que me debía antes de la app",
            },
            {
                "amount": 800,
                "person": "Mireya",
                "kind": "Préstamo",
                "date": "2026-10-02",
                "account": "Santander",
                "concept": "Para la renta",
                "direction": "Debo",
            },
        ]
    )
    response = await _post(client, headers, "upload", content)
    assert response.json()["data"] == {"created": 2, "errors": []}

    by_name = {d["name"]: d for d in await _debts(client, headers)}
    assert by_name["Franco Andrade"]["direction"] == "owed_to_me"
    assert by_name["Franco Andrade"]["current_balance"] == "15000.00"
    assert by_name["Mireya"]["direction"] == "owed_by_me"
    # the opening balance moved no money; what I borrowed from Mireya landed in Santander
    assert await _balance(client, headers, santander) == "1800.00"
    movements = (
        await client.get(
            f"/api/v1/debts/{by_name['Franco Andrade']['id']}/movements", headers=headers
        )
    ).json()["data"]
    assert [(m["kind"], m["account_id"]) for m in movements] == [("opening", None)]


async def test_rows_that_do_not_fit_are_reported_and_the_rest_loads(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, name="Santander", initial_balance="5000")

    content = _build_debt_upload(
        [
            {
                "amount": 500,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-01",
                "account": "Santander",
                "concept": "Cena",
            },
            {
                "amount": 50,
                "person": "Nadie",
                "kind": "Abono",
                "date": "2026-10-02",
                "account": "Santander",
            },  # nobody owes me yet
            {
                "amount": 900,
                "person": "Emanuel",
                "kind": "Abono",
                "date": "2026-10-03",
                "account": "Santander",
            },  # more than he owes
            {
                "amount": 100,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-04",
            },  # no account
            {
                "amount": 100,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-04",
                "account": "Inexistente",
            },
            {
                "amount": 100,
                "person": "Emanuel",
                "kind": "Regalo",
                "date": "2026-10-04",
                "account": "Santander",
            },  # not a movement
            {"amount": 700, "person": "Emanuel", "kind": "Saldo inicial", "date": "2026-10-05"},
        ]
    )
    response = await _post(client, headers, "upload", content)
    data = response.json()["data"]
    assert data["created"] == 1
    reasons = {e["row"]: e["reason"] for e in data["errors"]}
    assert sorted(reasons) == [4, 5, 6, 7, 8, 9]
    assert "No hay una deuda abierta con Nadie" in reasons[4]
    assert "mayor que lo que Emanuel debe" in reasons[5]
    assert "Falta la cuenta" in reasons[6]
    assert "'Inexistente' no existe" in reasons[7]
    assert "Movimiento inválido" in reasons[8]
    assert "Ya existe una deuda abierta con Emanuel" in reasons[9]
    assert all(e["block"] == "Deuda" for e in data["errors"])
    assert (await _debts(client, headers))[0]["current_balance"] == "500.00"


async def test_a_loan_adds_to_a_debt_that_already_exists_and_reopens_a_paid_one(
    client: AsyncClient,
):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    created = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Emanuel",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": "500.00",
            "funding_account_id": santander,
            "start_date": "2026-09-01",
        },
    )
    debt_id = created.json()["data"]["id"]
    await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={"account_id": santander, "amount": "500.00", "date": "2026-09-15"},
    )
    assert (await client.get(f"/api/v1/debts/{debt_id}", headers=headers)).json()["data"][
        "status"
    ] == "completed"

    content = _build_debt_upload(
        [
            {
                "amount": 250,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-01",
                "account": "Santander",
                "concept": "Otra vez",
            }
        ]
    )
    assert (await _post(client, headers, "upload", content)).json()["data"] == {
        "created": 1,
        "errors": [],
    }

    debts = await _debts(client, headers)
    assert len(debts) == 1  # the same debt, not a second one
    assert debts[0]["status"] == "active"
    assert debts[0]["current_balance"] == "250.00"


async def test_preview_summarizes_the_debts_without_saving_and_warns_about_repeats(
    client: AsyncClient,
):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    santander = await _create_account(client, headers, name="Santander", initial_balance="5000")
    content = _build_debt_upload(
        [
            {
                "amount": 500,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-01",
                "account": "Santander",
                "concept": "Cena",
            },
            {
                "amount": 1000,
                "person": "Emanuel",
                "kind": "Préstamo",
                "date": "2026-10-05",
                "account": "Santander",
                "concept": "Coche",
            },
            {
                "amount": 300,
                "person": "Emanuel",
                "kind": "Abono",
                "date": "2026-10-10",
                "account": "Santander",
            },
            {"amount": 15000, "person": "Franco", "kind": "Saldo inicial", "date": "2026-01-01"},
        ]
    )
    data = (await _post(client, headers, "preview", content)).json()["data"]
    assert data["valid_rows"] == 4
    assert data["debts"] == {
        "loans": {"count": 2, "total": "1500"},
        "payments": {"count": 1, "total": "300"},
        "openings": {"count": 1, "total": "15000"},
        "people": 2,
    }
    assert data["income"]["count"] == 0 and data["expense"]["count"] == 0
    assert data["possible_duplicates"]["count"] == 0
    # nothing was saved by the preview
    assert await _debts(client, headers) == []
    assert await _balance(client, headers, santander) == "5000.00"

    await _post(client, headers, "upload", content)
    again = (await _post(client, headers, "preview", content)).json()["data"]
    # a repeat of the file: the loans and the repayment look already loaded (the opening
    # balance fails because Franco's debt is open now)
    assert again["possible_duplicates"]["count"] >= 3
