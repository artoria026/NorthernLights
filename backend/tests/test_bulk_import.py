import uuid
from io import BytesIO

import pytest
from httpx import AsyncClient
from openpyxl import Workbook, load_workbook

pytestmark = pytest.mark.asyncio


async def _register_and_login(client: AsyncClient) -> str:
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
    return login.json()["data"]["access_token"]


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Santander", "type": "asset", "subtype": "checking", "initial_balance": "0"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201
    return response.json()["data"]["id"]


def _build_upload(rows: list[dict]) -> bytes:
    """rows: [{'block': 'income'|'expense', 'amount', 'description', 'date',
    'account', 'category'}] -- builds an .xlsx with the same layout that
    build_template_workbook generates (Income in A-E, Expenses in G-K, data starting
    from row 3)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Transacciones"
    ws["A2"] = "Monto"
    ws["G2"] = "Monto"

    row_num = 3
    for row in rows:
        start_col = "A" if row["block"] == "income" else "G"
        cols = [chr(ord(start_col) + i) for i in range(5)]
        ws[f"{cols[0]}{row_num}"] = row["amount"]
        ws[f"{cols[1]}{row_num}"] = row["description"]
        ws[f"{cols[2]}{row_num}"] = row["date"]
        ws[f"{cols[3]}{row_num}"] = row["account"]
        ws[f"{cols[4]}{row_num}"] = row["category"]
        if "tags" in row:
            ws[f"L{row_num}"] = row["tags"]  # optional "Etiquetas" column of the Expenses block
        row_num += 1

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_download_template_is_valid_xlsx_with_dropdowns(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)

    response = await client.get("/api/v1/bulk-import/template", headers=headers)
    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]

    wb = load_workbook(BytesIO(response.content))
    assert "Transacciones" in wb.sheetnames
    assert "Listas" in wb.sheetnames
    ws = wb["Transacciones"]
    assert ws["A2"].value == "Monto"
    assert ws["G2"].value == "Monto"
    assert len(ws.data_validations.dataValidation) == 4


async def test_upload_creates_valid_rows_and_reports_row_errors(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers, name="Santander")

    content = _build_upload(
        [
            {
                "block": "income",
                "amount": 2807,
                "description": "Pago nomina",
                "date": "2026-08-01",
                "account": "Santander",
                "category": "Empleo principal",
            },
            {
                "block": "expense",
                "amount": 35,
                "description": "Burritos",
                "date": "2026-08-01",
                "account": "Santander",
                "category": "Comida y Bebidas",
            },
            {
                "block": "expense",
                "amount": 100,
                "description": "Cuenta invalida",
                "date": "2026-08-02",
                "account": "Cuenta que no existe",
                "category": "Comida y Bebidas",
            },
            {
                "block": "expense",
                "amount": 50,
                "description": "Categoria invalida",
                "date": "2026-08-02",
                "account": "Santander",
                "category": "Categoria que no existe",
            },
            {
                "block": "expense",
                "amount": -10,
                "description": "Monto invalido",
                "date": "2026-08-02",
                "account": "Santander",
                "category": "Comida y Bebidas",
            },
        ]
    )

    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={
            "file": (
                "carga.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["created"] == 2
    reasons = {e["reason"] for e in data["errors"]}
    assert any("no existe" in r and "Cuenta" in r for r in reasons)
    assert any("no existe" in r and "categor" in r.lower() for r in reasons)
    assert any("Monto inválido" in r for r in reasons)

    transactions = await client.get("/api/v1/transactions?per_page=10", headers=headers)
    descriptions = {t["description"] for t in transactions.json()["data"]}
    assert descriptions == {"Pago nomina", "Burritos"}


async def test_upload_missing_sheet_reports_clear_error(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    wb = Workbook()
    wb.active.title = "OtraHoja"
    buf = BytesIO()
    wb.save(buf)

    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={
            "file": (
                "malo.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["created"] == 0
    assert len(data["errors"]) == 1
    assert "Transacciones" in data["errors"][0]["reason"]


async def test_upload_rls_isolation(client: AsyncClient):
    token_a = await _register_and_login(client)
    token_b = await _register_and_login(client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    await _create_account(client, headers_b, name="Cuenta de B")

    content = _build_upload(
        [
            {
                "block": "expense",
                "amount": 10,
                "description": "Gasto de A intentando usar cuenta de B",
                "date": "2026-08-01",
                "account": "Cuenta de B",
                "category": "Comida y Bebidas",
            }
        ]
    )
    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers_a,
        files={
            "file": (
                "carga.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["created"] == 0  # A can't see B's account


async def _get_category_names(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    return response.json()["data"][0]["name"]


async def _create_tag(client: AsyncClient, headers: dict, name: str) -> str:
    response = await client.post("/api/v1/tags", headers=headers, json={"name": name})
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def test_template_has_the_tags_column_and_suggests_the_users_tags(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)
    await _create_tag(client, headers, "Reparación choque")

    response = await client.get("/api/v1/bulk-import/template", headers=headers)
    wb = load_workbook(BytesIO(response.content))
    ws = wb["Transacciones"]
    assert ws["L2"].value == "Etiquetas"
    assert len(ws.data_validations.dataValidation) == 5
    assert wb["Listas"]["D1"].value == "Reparación choque"


async def test_upload_puts_the_tags_of_each_expense(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)
    category = await _get_category_names(client, headers, "expense")
    await _create_tag(client, headers, "Viaje Mty")
    await _create_tag(client, headers, "Con pareja")

    content = _build_upload(
        [
            {
                "block": "expense",
                "amount": 100,
                "description": "Cena",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
                "tags": "viaje mty, Con pareja",
            },
            {
                "block": "expense",
                "amount": 50,
                "description": "Taxi",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
                "tags": " Viaje Mty ; viaje mty ",
            },
            {
                "block": "expense",
                "amount": 30,
                "description": "Sin etiquetas",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
            },
        ]
    )
    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={"file": ("lote.xlsx", content, "application/octet-stream")},
    )
    assert response.json()["data"] == {"created": 3, "errors": []}

    listed = await client.get("/api/v1/transactions?per_page=50", headers=headers)
    tags = {t["description"]: sorted(x["name"] for x in t["tags"]) for t in listed.json()["data"]}
    assert tags == {"Cena": ["Con pareja", "Viaje Mty"], "Taxi": ["Viaje Mty"], "Sin etiquetas": []}


async def test_upload_rejects_the_row_with_an_unknown_tag_and_loads_the_rest(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)
    category = await _get_category_names(client, headers, "expense")
    await _create_tag(client, headers, "Viaje Mty")

    content = _build_upload(
        [
            {
                "block": "expense",
                "amount": 100,
                "description": "Bien",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
                "tags": "Viaje Mty",
            },
            {
                "block": "expense",
                "amount": 40,
                "description": "Typo",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
                "tags": "Viaje Mtyy",
            },
        ]
    )
    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={"file": ("lote.xlsx", content, "application/octet-stream")},
    )
    data = response.json()["data"]
    assert data["created"] == 1
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 4 and "Viaje Mtyy" in data["errors"][0]["reason"]
    listed = await client.get("/api/v1/transactions?per_page=50", headers=headers)
    assert [t["description"] for t in listed.json()["data"]] == ["Bien"]


async def test_tags_of_one_user_are_not_usable_by_another(client: AsyncClient):
    other = {"Authorization": f"Bearer {await _register_and_login(client)}"}
    await _create_tag(client, other, "Secreta")
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    await _create_account(client, headers)
    category = await _get_category_names(client, headers, "expense")

    content = _build_upload(
        [
            {
                "block": "expense",
                "amount": 10,
                "description": "Ajena",
                "date": "2026-10-12",
                "account": "Santander",
                "category": category,
                "tags": "Secreta",
            }
        ]
    )
    response = await client.post(
        "/api/v1/bulk-import/upload",
        headers=headers,
        files={"file": ("lote.xlsx", content, "application/octet-stream")},
    )
    assert response.json()["data"]["created"] == 0
    assert "Secreta" in response.json()["data"]["errors"][0]["reason"]
