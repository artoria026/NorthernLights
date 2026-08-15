import uuid

import pytest
from httpx import AsyncClient

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


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "0"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def _get_category_id(client: AsyncClient, headers: dict, type_: str) -> str:
    response = await client.get(f"/api/v1/categories?type={type_}", headers=headers)
    categories = response.json()["data"]
    assert categories, f"No hay categorias sembradas de tipo {type_}"
    return categories[0]["id"]


async def test_simple_expense_updates_balances(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    checking_id = await _create_account(
        client, headers, name="Banco", type="asset", subtype="checking", initial_balance="1000"
    )
    expense_account_id = await _create_account(
        client, headers, name="Gastos", type="expense", subtype=None, initial_balance="0"
    )
    category_id = await _get_category_id(client, headers, "expense")

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {"account_id": expense_account_id, "amount": "250.00", "type": "debit"},
                {"account_id": checking_id, "amount": "250.00", "type": "credit"},
            ],
        },
    )
    assert response.status_code == 201

    checking = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    assert checking.json()["data"]["balance"] == "750.00"

    expense = await client.get(f"/api/v1/accounts/{expense_account_id}", headers=headers)
    assert expense.json()["data"]["balance"] == "250.00"


async def test_unbalanced_lines_rejected(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    checking_id = await _create_account(client, headers)
    expense_account_id = await _create_account(client, headers, type="expense", subtype=None)
    category_id = await _get_category_id(client, headers, "expense")

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Desbalanceado",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {"account_id": expense_account_id, "amount": "250.00", "type": "debit"},
                {"account_id": checking_id, "amount": "100.00", "type": "credit"},
            ],
        },
    )
    assert response.status_code == 422


async def test_transfer_is_neutral_and_uncategorized(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    origin_id = await _create_account(client, headers, name="Origen", initial_balance="500")
    dest_id = await _create_account(client, headers, name="Destino", initial_balance="0")

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Transferencia",
            "entry_type": "transfer",
            "lines": [
                {"account_id": dest_id, "amount": "200.00", "type": "debit"},
                {"account_id": origin_id, "amount": "200.00", "type": "credit"},
            ],
        },
    )
    assert response.status_code == 201

    origin = await client.get(f"/api/v1/accounts/{origin_id}", headers=headers)
    dest = await client.get(f"/api/v1/accounts/{dest_id}", headers=headers)
    assert origin.json()["data"]["balance"] == "300.00"
    assert dest.json()["data"]["balance"] == "200.00"


async def test_transfer_with_category_rejected(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    origin_id = await _create_account(client, headers, initial_balance="500")
    dest_id = await _create_account(client, headers, initial_balance="0")
    category_id = await _get_category_id(client, headers, "expense")

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Transferencia invalida",
            "entry_type": "transfer",
            "category_id": category_id,
            "lines": [
                {"account_id": dest_id, "amount": "200.00", "type": "debit"},
                {"account_id": origin_id, "amount": "200.00", "type": "credit"},
            ],
        },
    )
    assert response.status_code == 400


async def test_adjustment_in_simple_form_increases_balance(client: AsyncClient):
    """El endpoint de reconciliacion (test_accounts.py) usa exactamente esta
    forma simple internamente -- este test cubre el entry_type nuevo de
    forma aislada, sin pasar por /accounts/{id}/reconcile."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    cash_id = await _create_account(
        client, headers, name="Efectivo", subtype="cash", initial_balance="100"
    )

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Ajuste de saldo",
            "entry_type": "adjustment_in",
            "account_id": cash_id,
            "amount": "50.00",
        },
    )
    assert response.status_code == 201
    assert response.json()["data"]["category_id"] is None

    cash = await client.get(f"/api/v1/accounts/{cash_id}", headers=headers)
    assert cash.json()["data"]["balance"] == "150.00"


async def test_adjustment_out_simple_form_decreases_balance(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    cash_id = await _create_account(
        client, headers, name="Efectivo", subtype="cash", initial_balance="100"
    )

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Ajuste de saldo",
            "entry_type": "adjustment_out",
            "account_id": cash_id,
            "amount": "30.00",
        },
    )
    assert response.status_code == 201

    cash = await client.get(f"/api/v1/accounts/{cash_id}", headers=headers)
    assert cash.json()["data"]["balance"] == "70.00"


async def test_adjustment_with_category_rejected(client: AsyncClient):
    """Igual que transfer/loan (test_transfer_with_category_rejected):
    adjustment_in/out son movimientos contables, no aceptan category_id --
    si se mezclaran con una categoria real se distorsionaria el historial de
    gasto/ingreso de esa categoria (ver Notion, buenas practicas de
    conciliacion)."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    cash_id = await _create_account(client, headers, subtype="cash", initial_balance="100")
    category_id = await _get_category_id(client, headers, "expense")

    response = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Ajuste invalido",
            "entry_type": "adjustment_out",
            "category_id": category_id,
            "account_id": cash_id,
            "amount": "30.00",
        },
    )
    assert response.status_code == 400


async def test_two_adjustments_share_same_hidden_ledger_account(client: AsyncClient):
    """adjustment_in y adjustment_out deben resolver a LA MISMA cuenta
    contable interna equity ('Ajustes de saldo'), a diferencia de
    income/expense que tienen una cuenta interna cada uno -- ver
    account_service.get_or_create_category_ledger_account."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    cash_id = await _create_account(client, headers, subtype="cash", initial_balance="100")

    for entry_type, amount in (("adjustment_in", "20.00"), ("adjustment_out", "10.00")):
        response = await client.post(
            "/api/v1/transactions",
            headers=headers,
            json={
                "date": "2026-07-01",
                "description": "Ajuste",
                "entry_type": entry_type,
                "account_id": cash_id,
                "amount": amount,
            },
        )
        assert response.status_code == 201

    accounts = await client.get("/api/v1/accounts", headers=headers)
    # La cuenta interna 'Ajustes de saldo' es is_internal=True -- no debe
    # listarse junto a las cuentas reales del usuario.
    names = {a["name"] for a in accounts.json()["data"]}
    assert names == {"Cuenta"}


async def test_delete_transaction_reverts_balances(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    checking_id = await _create_account(client, headers, initial_balance="1000")
    expense_account_id = await _create_account(client, headers, type="expense", subtype=None)
    category_id = await _get_category_id(client, headers, "expense")

    created = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": category_id,
            "lines": [
                {"account_id": expense_account_id, "amount": "250.00", "type": "debit"},
                {"account_id": checking_id, "amount": "250.00", "type": "credit"},
            ],
        },
    )
    entry_id = created.json()["data"]["id"]

    delete = await client.delete(f"/api/v1/transactions/{entry_id}", headers=headers)
    assert delete.status_code == 200

    checking = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    assert checking.json()["data"]["balance"] == "1000.00"


async def test_split_expense_charges_full_amount_and_tracks_receivables(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    paying_id = await _create_account(
        client, headers, name="TDC", type="liability", subtype="credit_card", initial_balance="0"
    )
    category_id = await _get_category_id(client, headers, "expense")

    response = await client.post(
        "/api/v1/transactions/split",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Cena grupal",
            "category_id": category_id,
            "paying_account_id": paying_id,
            "my_share": "100.00",
            "debtors": [{"person_name": "Amigo", "amount": "400.00"}],
        },
    )
    assert response.status_code == 201
    lines = response.json()["data"]["lines"]
    my_share_line = next(line for line in lines if line["account_id"] != paying_id)

    paying = await client.get(f"/api/v1/accounts/{paying_id}", headers=headers)
    expense = await client.get(f"/api/v1/accounts/{my_share_line['account_id']}", headers=headers)
    debts = (await client.get("/api/v1/debts?direction=owed_to_me", headers=headers)).json()["data"]

    assert paying.json()["data"]["balance"] == "500.00"  # cargo completo a la TDC
    assert expense.json()["data"]["balance"] == "100.00"  # mi parte, cuenta interna resuelta sola
    assert len(debts) == 1
    assert debts[0]["name"] == "Amigo"
    assert debts[0]["current_balance"] == "400.00"  # lo que me debe el amigo -- vive en Deudas

    # El ledger interno "Préstamos por cobrar" nunca se lista como cuenta del usuario.
    accounts = (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
    assert not any(a["name"] == "Préstamos por cobrar" for a in accounts)


async def test_split_expense_accumulates_same_person(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    paying_id = await _create_account(client, headers, initial_balance="0")
    category_id = await _get_category_id(client, headers, "expense")

    for _ in range(2):
        response = await client.post(
            "/api/v1/transactions/split",
            headers=headers,
            json={
                "date": "2026-07-01",
                "description": "Cena",
                "category_id": category_id,
                "paying_account_id": paying_id,
                "my_share": "50.00",
                "debtors": [{"person_name": "erick", "amount": "50.00"}],
            },
        )
        assert response.status_code == 201

    debts = (await client.get("/api/v1/debts?direction=owed_to_me", headers=headers)).json()["data"]
    assert len(debts) == 1  # "erick" repetido no crea una deuda nueva
    assert debts[0]["current_balance"] == "100.00"


async def test_update_transaction_changes_amount_and_account(client: AsyncClient):
    """PUT con account_id/amount sueltos (forma simple) cambia de cuenta Y de
    monto sin que el front tenga que conocer la cuenta contable interna de la
    categoria -- se resuelve igual que en create (_resolve_lines)."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    banco_a = await _create_account(client, headers, name="Banco A", initial_balance="1000")
    banco_b = await _create_account(client, headers, name="Banco B", initial_balance="500")
    category_id = await _get_category_id(client, headers, "expense")

    created = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Super",
            "entry_type": "expense",
            "category_id": category_id,
            "account_id": banco_a,
            "amount": "100.00",
        },
    )
    assert created.status_code == 201
    entry_id = created.json()["data"]["id"]

    assert (await client.get(f"/api/v1/accounts/{banco_a}", headers=headers)).json()["data"][
        "balance"
    ] == "900.00"

    updated = await client.put(
        f"/api/v1/transactions/{entry_id}",
        headers=headers,
        json={"account_id": banco_b, "amount": "150.00"},
    )
    assert updated.status_code == 200

    # Banco A recupera su saldo (se revirtio el delta viejo)...
    banco_a_after = await client.get(f"/api/v1/accounts/{banco_a}", headers=headers)
    assert banco_a_after.json()["data"]["balance"] == "1000.00"
    # ...y Banco B absorbe el nuevo monto.
    banco_b_after = await client.get(f"/api/v1/accounts/{banco_b}", headers=headers)
    assert banco_b_after.json()["data"]["balance"] == "350.00"


async def test_update_transaction_lines_for_transfer(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    origin_id = await _create_account(client, headers, name="Origen", initial_balance="500")
    dest_id = await _create_account(client, headers, name="Destino", initial_balance="0")
    dest2_id = await _create_account(client, headers, name="Destino 2", initial_balance="0")

    created = await client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "date": "2026-07-01",
            "description": "Transferencia",
            "entry_type": "transfer",
            "lines": [
                {"account_id": dest_id, "amount": "200.00", "type": "debit"},
                {"account_id": origin_id, "amount": "200.00", "type": "credit"},
            ],
        },
    )
    assert created.status_code == 201
    entry_id = created.json()["data"]["id"]

    updated = await client.put(
        f"/api/v1/transactions/{entry_id}",
        headers=headers,
        json={
            "lines": [
                {"account_id": dest2_id, "amount": "200.00", "type": "debit"},
                {"account_id": origin_id, "amount": "200.00", "type": "credit"},
            ]
        },
    )
    assert updated.status_code == 200

    origin = await client.get(f"/api/v1/accounts/{origin_id}", headers=headers)
    dest = await client.get(f"/api/v1/accounts/{dest_id}", headers=headers)
    dest2 = await client.get(f"/api/v1/accounts/{dest2_id}", headers=headers)
    assert origin.json()["data"]["balance"] == "300.00"  # sin cambio neto (200 salio, sigue saliendo)
    assert dest.json()["data"]["balance"] == "0.00"  # se revirtio, ya no recibio nada
    assert dest2.json()["data"]["balance"] == "200.00"  # ahora recibe el destino nuevo
