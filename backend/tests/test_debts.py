import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.services import debt_service
from tests.conftest import rls_session

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


async def _register_and_login_with_id(client: AsyncClient) -> tuple[str, uuid.UUID]:
    token = await _register_and_login(client)
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    return token, uuid.UUID(me.json()["data"]["id"])


async def _create_account(client: AsyncClient, headers: dict, **overrides) -> str:
    payload = {"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "0"}
    payload.update(overrides)
    response = await client.post("/api/v1/accounts", headers=headers, json=payload)
    assert response.status_code == 201
    return response.json()["data"]["id"]


async def test_create_and_list_unplanned_debt(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        "/api/v1/debts/unplanned",
        headers=headers,
        json={"name": "Nu - TDC", "creditor": "Nu", "amount": "47000.00"},
    )
    assert created.status_code == 201

    listing = await client.get("/api/v1/debts/unplanned", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()["data"]) == 1
    assert listing.json()["data"][0]["name"] == "Nu - TDC"


async def test_activate_unplanned_debt_preserves_quita(client: AsyncClient):
    """Escenario real: BBVA TDC $34,318 negociada a $1,720 via SERTEC."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    unplanned = await client.post(
        "/api/v1/debts/unplanned",
        headers=headers,
        json={"name": "BBVA TDC", "creditor": "BBVA", "amount": "34318.04"},
    )
    unplanned_id = unplanned.json()["data"]["id"]

    activated = await client.post(
        f"/api/v1/debts/unplanned/{unplanned_id}/activate",
        headers=headers,
        json={
            "agreed_amount": "1720.00",
            "payment_amount": "1720.00",
            "payment_frequency": "monthly",
            "start_date": "2026-07-01",
        },
    )
    assert activated.status_code == 201
    debt = activated.json()["data"]
    assert debt["original_amount"] == "34318.04"
    assert debt["agreed_amount"] == "1720.00"
    assert debt["total_amount"] == "1720.00"
    assert debt["current_balance"] == "1720.00"

    # La deuda sin plan ya no aparece en la lista de pendientes
    listing = await client.get("/api/v1/debts/unplanned", headers=headers)
    assert listing.json()["data"] == []


async def test_activate_twice_rejected(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    unplanned = await client.post(
        "/api/v1/debts/unplanned",
        headers=headers,
        json={"name": "Deuda X", "amount": "1000.00"},
    )
    unplanned_id = unplanned.json()["data"]["id"]
    plan = {"payment_amount": "100.00", "payment_frequency": "monthly", "start_date": "2026-07-01"}

    first = await client.post(
        f"/api/v1/debts/unplanned/{unplanned_id}/activate", headers=headers, json=plan
    )
    assert first.status_code == 201

    second = await client.post(
        f"/api/v1/debts/unplanned/{unplanned_id}/activate", headers=headers, json=plan
    )
    assert second.status_code == 400


async def test_register_payment_updates_balances_and_creates_journal_entry(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    payable_id = await _create_account(client, headers, name="Prestamo vinculado", initial_balance="0")
    bank_id = await _create_account(client, headers, name="Banco", initial_balance="5000")

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo Franco",
            "type": "personal_loan",
            "total_amount": "4000.00",
            "current_balance": "4000.00",
            "linked_account_id": payable_id,
            "payment_amount": "1000.00",
            "payment_frequency": "monthly",
            "next_payment_date": "2026-08-01",
        },
    )
    assert debt.status_code == 201
    debt_id = debt.json()["data"]["id"]

    payment = await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={"account_id": bank_id, "amount": "1000.00", "date": "2026-08-01"},
    )
    assert payment.status_code == 201
    assert payment.json()["data"]["journal_entry_id"]

    updated_debt = await client.get(f"/api/v1/debts/{debt_id}", headers=headers)
    assert updated_debt.json()["data"]["current_balance"] == "3000.00"
    assert updated_debt.json()["data"]["paid_installments"] == 1

    bank = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    assert bank.json()["data"]["balance"] == "4000.00"


async def test_payment_that_clears_balance_completes_debt(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    tdc_id = await _create_account(client, headers, type="liability", subtype="credit_card")
    bank_id = await _create_account(client, headers, initial_balance="500")

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Deuda pequeña",
            "type": "personal_loan",
            "total_amount": "500.00",
            "current_balance": "500.00",
            "linked_account_id": tdc_id,
        },
    )
    debt_id = debt.json()["data"]["id"]

    payment = await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={"account_id": bank_id, "amount": "500.00", "date": "2026-08-01"},
    )
    assert payment.status_code == 201

    updated = await client.get(f"/api/v1/debts/{debt_id}", headers=headers)
    assert updated.json()["data"]["status"] == "completed"
    assert updated.json()["data"]["current_balance"] == "0.00"


async def test_informal_debt_payment_works_without_linked_account(client: AsyncClient):
    """Antes esto se rechazaba (la deuda informal no tenia forma de "ser" una
    cuenta) -- ahora usa el ledger oculto de deudas informales, no requiere
    linked_account_id. Solo TDC (la deuda ES la cuenta real) lo exige."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank_id = await _create_account(client, headers, initial_balance="500")

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Sin cuenta vinculada",
            "type": "informal",
            "total_amount": "500.00",
        },
    )
    debt_id = debt.json()["data"]["id"]

    payment = await client.post(
        f"/api/v1/debts/{debt_id}/payments",
        headers=headers,
        json={"account_id": bank_id, "amount": "100.00", "date": "2026-08-01"},
    )
    assert payment.status_code == 201

    bank = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    assert bank.json()["data"]["balance"] == "400.00"


async def test_shared_debt_fields_ignored_for_non_admin(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo Franco",
            "type": "loan_received",
            "total_amount": "5000.00",
            "is_shared": True,
            "responsible_party": "Franco Andrade",
        },
    )
    assert debt.status_code == 201
    assert debt.json()["data"]["is_shared"] is False
    assert debt.json()["data"]["responsible_party"] is None


async def test_delete_debt_with_balance_conflicts(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Deuda activa", "type": "personal_loan", "total_amount": "100.00"},
    )
    debt_id = debt.json()["data"]["id"]

    response = await client.delete(f"/api/v1/debts/{debt_id}", headers=headers)
    assert response.status_code == 409


async def test_update_debt_corrects_current_balance(client: AsyncClient):
    """current_balance es la unica fuente de verdad del saldo de una deuda
    (a diferencia de Account, que tiene initial_balance separado) -- pensado
    para corregir el saldo despues de un backfill historico de pagos viejos,
    sin tener que registrar cada pago uno a uno."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Prestamo viejo", "type": "personal_loan", "total_amount": "20000.00"},
    )
    debt_id = debt.json()["data"]["id"]
    assert debt.json()["data"]["current_balance"] == "20000.00"

    updated = await client.put(
        f"/api/v1/debts/{debt_id}", headers=headers, json={"current_balance": "12500.00"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["current_balance"] == "12500.00"

    fetched = await client.get(f"/api/v1/debts/{debt_id}", headers=headers)
    assert fetched.json()["data"]["current_balance"] == "12500.00"


async def test_update_debt_rejects_negative_current_balance(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Prestamo", "type": "personal_loan", "total_amount": "1000.00"},
    )
    debt_id = debt.json()["data"]["id"]

    response = await client.put(
        f"/api/v1/debts/{debt_id}", headers=headers, json={"current_balance": "-1"}
    )
    assert response.status_code == 422


async def test_simulate_and_summary(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo nomina",
            "type": "payroll_loan",
            "total_amount": "38014.04",
            "payment_amount": "593.82",
            "payment_frequency": "weekly",
        },
    )

    summary = await client.get("/api/v1/debts/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["data"]["active_count"] == 1

    simulate = await client.post(
        "/api/v1/debts/simulate",
        headers=headers,
        json={"payment_amount": "1000.00", "payment_frequency": "monthly"},
    )
    assert simulate.status_code == 200
    body = simulate.json()["data"]
    assert body["delta"] == "1000.00"
    assert Decimal(body["new_monthly_committed"]) - Decimal(
        body["current_monthly_committed"]
    ) == Decimal("1000.00")


async def test_rls_isolates_debts_between_users(client: AsyncClient):
    token_a = await _register_and_login(client)
    token_b = await _register_and_login(client)

    created = await client.post(
        "/api/v1/debts",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"name": "Deuda de A", "type": "informal", "total_amount": "100.00"},
    )
    debt_id = created.json()["data"]["id"]

    get_b = await client.get(
        f"/api/v1/debts/{debt_id}", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert get_b.status_code == 404


async def test_owed_to_me_debt_funds_and_collects(client: AsyncClient):
    """Prestarle a alguien (direction=owed_to_me) con funding_account_id: se
    mueve efectivo real de una cuenta tuya al ledger oculto 'Prestamos por
    cobrar', y el patrimonio total no cambia -- solo se mueve de bolsillo."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    checking_id = await _create_account(client, headers, name="Santander", initial_balance="1000")

    created = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Erick",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": "300.00",
            "funding_account_id": checking_id,
            "start_date": "2026-08-01",
        },
    )
    assert created.status_code == 201
    debt = created.json()["data"]
    assert debt["direction"] == "owed_to_me"

    checking = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    assert checking.json()["data"]["balance"] == "700.00"

    # El ledger 'Prestamos por cobrar' nunca aparece en Cuentas.
    accounts = (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
    assert not any(a["name"] == "Préstamos por cobrar" for a in accounts)

    collection = await client.post(
        f"/api/v1/debts/{debt['id']}/payments",
        headers=headers,
        json={"account_id": checking_id, "amount": "300.00", "date": "2026-08-15"},
    )
    assert collection.status_code == 201

    checking_after = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    debt_after = await client.get(f"/api/v1/debts/{debt['id']}", headers=headers)
    assert checking_after.json()["data"]["balance"] == "1000.00"
    assert debt_after.json()["data"]["current_balance"] == "0.00"
    assert debt_after.json()["data"]["status"] == "completed"


async def test_unplanned_debt_direction_and_activation_funding(client: AsyncClient):
    """Deuda sin plan (owed_by_me: alguien me presta) nunca toca balances --
    solo al activarla con un plan y una cuenta de fondeo entra el efectivo."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    checking_id = await _create_account(client, headers, initial_balance="0")

    unplanned = await client.post(
        "/api/v1/debts/unplanned",
        headers=headers,
        json={"name": "Mireya", "amount": "1000.00", "direction": "owed_by_me"},
    )
    assert unplanned.status_code == 201
    assert unplanned.json()["data"]["direction"] == "owed_by_me"

    unchanged = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    assert unchanged.json()["data"]["balance"] == "0.00"  # sin plan no mueve dinero

    activated = await client.post(
        f"/api/v1/debts/unplanned/{unplanned.json()['data']['id']}/activate",
        headers=headers,
        json={
            "payment_amount": "100.00",
            "payment_frequency": "monthly",
            "funding_account_id": checking_id,
            "start_date": "2026-08-01",
        },
    )
    assert activated.status_code == 201
    assert activated.json()["data"]["direction"] == "owed_by_me"

    funded = await client.get(f"/api/v1/accounts/{checking_id}", headers=headers)
    assert funded.json()["data"]["balance"] == "1000.00"  # el efectivo prestado aterrizo aqui


async def test_debt_summary_splits_by_direction(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={"name": "Banco", "type": "personal_loan", "total_amount": "47000.00"},
    )
    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Erick",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": "300.00",
        },
    )

    summary = (await client.get("/api/v1/debts/summary", headers=headers)).json()["data"]
    assert summary["total_owed_by_me"] == "47000.00"
    assert summary["total_owed_to_me"] == "300.00"


async def test_process_due_debt_payments_generates_pending_without_touching_balance(
    client: AsyncClient, session_factory
):
    token, uid = await _register_and_login_with_id(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank_id = await _create_account(client, headers, name="Banco", initial_balance="5000")

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo nomina",
            "type": "payroll_loan",
            "total_amount": "12000.00",
            "payment_amount": "1000.00",
            "payment_frequency": "monthly",
            "payment_source_account_id": bank_id,
            "next_payment_date": "2026-08-01",
        },
    )
    debt_id = debt.json()["data"]["id"]

    async with rls_session(session_factory, uid) as session:
        generated = await debt_service.process_due_debt_payments(session, uid, date(2026, 8, 5))
    assert len(generated) == 1
    assert generated[0].status == "pending"
    assert generated[0].debt_id == uuid.UUID(debt_id)

    # El borrador no debe mover nada todavia -- ver docstring de _apply_payment.
    bank = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    assert bank.json()["data"]["balance"] == "5000.00"
    debt_after = await client.get(f"/api/v1/debts/{debt_id}", headers=headers)
    assert debt_after.json()["data"]["current_balance"] == "12000.00"
    assert debt_after.json()["data"]["next_payment_date"] == "2026-09-01"  # ya avanzo

    pending = await client.get("/api/v1/debts/pending", headers=headers)
    assert pending.json()["meta"]["total"] == 1
    assert pending.json()["data"][0]["description"] == "Pago Prestamo nomina"


async def test_process_due_debt_payments_is_idempotent_same_day(
    client: AsyncClient, session_factory
):
    token, uid = await _register_and_login_with_id(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank_id = await _create_account(client, headers, name="Banco", initial_balance="5000")

    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo nomina",
            "type": "payroll_loan",
            "total_amount": "12000.00",
            "payment_amount": "1000.00",
            "payment_frequency": "monthly",
            "payment_source_account_id": bank_id,
            "next_payment_date": "2026-08-01",
        },
    )

    async with rls_session(session_factory, uid) as session:
        first = await debt_service.process_due_debt_payments(session, uid, date(2026, 8, 5))
        second = await debt_service.process_due_debt_payments(session, uid, date(2026, 8, 6))

    assert len(first) == 1
    assert len(second) == 0  # ya habia un pending, no duplica

    pending = await client.get("/api/v1/debts/pending", headers=headers)
    assert pending.json()["meta"]["total"] == 1


async def test_process_due_debt_payments_skips_debt_without_payment_source(
    client: AsyncClient, session_factory
):
    token, uid = await _register_and_login_with_id(client)
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Sin cuenta de pago",
            "type": "informal",
            "total_amount": "1000.00",
            "payment_amount": "100.00",
            "payment_frequency": "monthly",
            "next_payment_date": "2026-08-01",
        },
    )

    async with rls_session(session_factory, uid) as session:
        generated = await debt_service.process_due_debt_payments(session, uid, date(2026, 8, 5))
    assert generated == []


async def test_rejecting_pending_debt_payment_does_not_change_balance(
    client: AsyncClient, session_factory
):
    token, uid = await _register_and_login_with_id(client)
    headers = {"Authorization": f"Bearer {token}"}
    bank_id = await _create_account(client, headers, name="Banco", initial_balance="5000")

    debt = await client.post(
        "/api/v1/debts",
        headers=headers,
        json={
            "name": "Prestamo nomina",
            "type": "payroll_loan",
            "total_amount": "12000.00",
            "payment_amount": "1000.00",
            "payment_frequency": "monthly",
            "payment_source_account_id": bank_id,
            "next_payment_date": "2026-08-01",
        },
    )
    debt_id = debt.json()["data"]["id"]

    async with rls_session(session_factory, uid) as session:
        await debt_service.process_due_debt_payments(session, uid, date(2026, 8, 5))

    pending = (await client.get("/api/v1/debts/pending", headers=headers)).json()["data"]
    entry_id = pending[0]["id"]

    reject = await client.post(f"/api/v1/transactions/{entry_id}/reject", headers=headers)
    assert reject.status_code == 200

    bank = await client.get(f"/api/v1/accounts/{bank_id}", headers=headers)
    debt_after = await client.get(f"/api/v1/debts/{debt_id}", headers=headers)
    assert bank.json()["data"]["balance"] == "5000.00"
    assert debt_after.json()["data"]["current_balance"] == "12000.00"
    assert debt_after.json()["data"]["paid_installments"] == 0
