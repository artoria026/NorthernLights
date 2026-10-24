"""What the advisor can propose beyond plain expenses -- tickets split by group, transfers
and card payments, debt payments and loans, shared expenses, balance reconciliation -- and
the read-only lookups it uses to avoid duplicates. Same rule as ever: nothing is written
until the user confirms the proposal."""

import pytest
from httpx import AsyncClient

from tests.test_ai_proposals import (
    _chat,
    _proposal_calls,
    _propose,
    _proposed_id,
    _provider,
    _setup,
    _transactions,
)

pytestmark = pytest.mark.asyncio


async def _account(client: AsyncClient, headers: dict, **body) -> None:
    response = await client.post("/api/v1/accounts", headers=headers, json=body)
    assert response.status_code in (200, 201), response.json()


async def _balances(client: AsyncClient, headers: dict) -> dict[str, float]:
    accounts = (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
    return {a["name"]: float(a["balance"]) for a in accounts}


async def _debts(client: AsyncClient, headers: dict) -> dict[str, dict]:
    debts = (await client.get("/api/v1/debts", headers=headers)).json()["data"]
    return {d["name"]: d for d in debts}


async def _propose_and_confirm(client, headers, monkeypatch, items, summary="Registrar"):
    _provider(monkeypatch, [[_propose(items, summary)], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.json()["data"]["status"] == "confirmed", response.json()


async def test_a_receipt_split_in_two_registers_the_whole_total_from_cash(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _account(
        client, headers, name="Efectivo", type="asset", subtype="cash", initial_balance=1000
    )
    common = {
        "date": "2026-10-24",
        "entry_type": "expense",
        "account_name": "Efectivo",
        "notes": "Ticket Walmart",
    }
    items = [
        {
            "action": "create_transaction",
            "arguments": {
                **common,
                "amount": 578,
                "description": "Despensa - Walmart",
                "category_name": "Despensa y Mandado",
            },
        },
        {
            "action": "create_transaction",
            "arguments": {
                **common,
                "amount": 209,
                "description": "Mascotas - Walmart",
                "category_name": "Mascotas",
            },
        },
    ]
    await _propose_and_confirm(client, headers, monkeypatch, items, "Ticket Walmart en dos partes")

    registered = {
        t["description"]: float(t["amount"]) for t in await _transactions(client, headers)
    }
    assert registered == {"Despensa - Walmart": 578.0, "Mascotas - Walmart": 209.0}
    assert (await _balances(client, headers))["Efectivo"] == 213.0


async def test_a_card_payment_is_a_transfer_not_an_expense(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _account(
        client,
        headers,
        name="Tarjeta",
        type="liability",
        subtype="credit_card",
        initial_balance=1000,
    )
    items = [
        {
            "action": "create_transfer",
            "arguments": {
                "date": "2026-10-24",
                "amount": 400,
                "from_account_name": "Santander",
                "to_account_name": "Tarjeta",
                "description": "Pago TDC",
            },
        }
    ]
    before = await _balances(client, headers)
    await _propose_and_confirm(client, headers, monkeypatch, items)

    after = await _balances(client, headers)
    assert after["Santander"] == before["Santander"] - 400
    assert after["Tarjeta"] == before["Tarjeta"] - 400
    assert [t["entry_type"] for t in await _transactions(client, headers)] == ["transfer"]


async def test_a_transfer_to_the_same_account_is_rejected(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    item = {
        "action": "create_transfer",
        "arguments": {
            "date": "2026-10-24",
            "amount": 10,
            "from_account_name": "Santander",
            "to_account_name": "Santander",
        },
    }
    _provider(monkeypatch, [[_propose([item])], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    assert "misma" in (await _proposal_calls(client, headers))[0]["error"]


async def test_a_loan_to_a_person_can_grow_and_be_collected(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    loan = {
        "action": "create_debt",
        "arguments": {
            "name": "Emanuel",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": 100,
            "funding_account_name": "Santander",
            "start_date": "2026-10-20",
        },
    }
    await _propose_and_confirm(client, headers, monkeypatch, [loan], "Prestamo a Emanuel")
    assert (await _debts(client, headers))["Emanuel"]["current_balance"] in (100, "100.00")

    more = [
        {
            "action": "increase_debt",
            "arguments": {
                "debt_name": "Emanuel",
                "account_name": "Santander",
                "amount": 50,
                "date": "2026-10-22",
            },
        },
        {
            "action": "register_debt_payment",
            "arguments": {
                "debt_name": "Emanuel",
                "account_name": "Santander",
                "amount": 30,
                "date": "2026-10-23",
            },
        },
    ]
    await _propose_and_confirm(client, headers, monkeypatch, more, "Mas prestamo y un cobro")

    assert float((await _debts(client, headers))["Emanuel"]["current_balance"]) == 120.0
    # +30 collected, -100 and -50 lent
    assert (await _balances(client, headers))["Santander"] == -120.0
    # a loan and its collection are not spending
    assert not [t for t in await _transactions(client, headers) if t["entry_type"] == "expense"]


async def test_paying_a_debt_that_does_not_exist_is_reported_to_the_model(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    item = {
        "action": "register_debt_payment",
        "arguments": {
            "debt_name": "Nadie",
            "account_name": "Santander",
            "amount": 10,
            "date": "2026-10-24",
        },
    }
    _provider(monkeypatch, [[_propose([item])], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    assert "Nadie" in (await _proposal_calls(client, headers))[0]["error"]


async def test_a_shared_expense_keeps_only_my_share_as_spending(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    item = {
        "action": "create_split_expense",
        "arguments": {
            "date": "2026-10-24",
            "description": "Cena - La Casona",
            "category_name": "Comida y Bebidas",
            "paying_account_name": "Santander",
            "my_share": 300,
            "debtors": [
                {"person_name": "Ana", "amount": 300},
                {"person_name": "Beto", "amount": 200},
            ],
        },
    }
    await _propose_and_confirm(client, headers, monkeypatch, [item])

    assert (await _balances(client, headers))["Santander"] == -800.0
    debts = await _debts(client, headers)
    assert float(debts["Ana"]["current_balance"]) == 300.0
    assert float(debts["Beto"]["current_balance"]) == 200.0


async def test_reconciling_cash_records_an_adjustment(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _account(
        client, headers, name="Efectivo", type="asset", subtype="cash", initial_balance=500
    )
    item = {
        "action": "reconcile_account",
        "arguments": {"account_name": "Efectivo", "real_balance": 450, "date": "2026-10-24"},
    }
    await _propose_and_confirm(client, headers, monkeypatch, [item])

    assert (await _balances(client, headers))["Efectivo"] == 450.0
    assert [t["entry_type"] for t in await _transactions(client, headers)] == ["adjustment_out"]


async def test_reconciling_a_bank_card_is_not_allowed(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _account(client, headers, name="Tarjeta", type="liability", subtype="credit_card")
    item = {
        "action": "reconcile_account",
        "arguments": {"account_name": "Tarjeta", "real_balance": 10, "date": "2026-10-24"},
    }
    _provider(monkeypatch, [[_propose([item])], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    assert "liquida" in (await _proposal_calls(client, headers))[0]["error"]


async def test_a_recurring_item_can_skip_automatic_generation(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    item = {
        "action": "create_recurring_item",
        "arguments": {
            "name": "Hetzner",
            "item_type": "subscription",
            "amount": 209.08,
            "frequency": "monthly",
            "account_name": "Santander",
            "category_name": "Ocio y Entretenimiento",
            "next_date": "2026-11-14",
            "auto_generate": False,
        },
    }
    await _propose_and_confirm(client, headers, monkeypatch, [item])
    items = (await client.get("/api/v1/recurring-items", headers=headers)).json()["data"]
    assert [i["auto_generate"] for i in items if i["name"] == "Hetzner"] == [False]


async def test_an_expense_can_carry_notes_and_installments(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _account(client, headers, name="Tarjeta", type="liability", subtype="credit_card")
    item = {
        "action": "create_transaction",
        "arguments": {
            "date": "2026-10-24",
            "entry_type": "expense",
            "amount": 6000,
            "description": "Laptop - Amazon",
            "account_name": "Tarjeta",
            "category_name": "Otro Gasto",
            "notes": "A 6 meses sin intereses",
            "installment_total": 6,
        },
    }
    await _propose_and_confirm(client, headers, monkeypatch, [item])
    [tx] = await _transactions(client, headers)
    assert tx["notes"] == "A 6 meses sin intereses"
    assert tx["installment"]["total_installments"] == 6


async def test_an_unknown_tag_is_reported_and_nothing_is_stored(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    item = {
        "action": "create_transaction",
        "arguments": {
            "date": "2026-10-24",
            "entry_type": "expense",
            "amount": 10,
            "description": "Cafe - Starbucks",
            "account_name": "Santander",
            "category_name": "Comida y Bebidas",
            "tag_names": ["Viaje que no existe"],
        },
    }
    _provider(monkeypatch, [[_propose([item])], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    assert "etiqueta" in (await _proposal_calls(client, headers))[0]["error"]


# -- read-only lookups ---------------------------------------------------------


def _lookup(name: str, **tool_input) -> dict:
    return {"type": "tool_use", "id": f"l-{name}", "name": name, "input": tool_input}


async def _lookup_result(client: AsyncClient, headers: dict, name: str) -> dict:
    history = await client.get("/api/v1/ai/history?per_page=100", headers=headers)
    for message in history.json()["data"]:
        for call in message["tool_calls"] or []:
            if call["tool"] == name:
                return call["result"]
    raise AssertionError(f"{name} was never called")


async def test_search_transactions_finds_what_is_already_registered(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    await _propose_and_confirm(
        client,
        headers,
        monkeypatch,
        [
            {
                "action": "create_transaction",
                "arguments": {
                    "date": "2026-10-24",
                    "entry_type": "expense",
                    "amount": 787,
                    "description": "Despensa - Walmart",
                    "account_name": "Santander",
                    "category_name": "Despensa y Mandado",
                },
            }
        ],
    )
    _provider(
        monkeypatch,
        [
            [
                _lookup(
                    "search_transactions", date_from="2026-10-24", amount_min=787, amount_max=787
                )
            ],
            [{"type": "text", "text": "ya esta"}],
        ],
    )
    await _chat(client, headers, "busca el ticket")
    result = await _lookup_result(client, headers, "search_transactions")
    assert result["total_matches"] == 1
    assert result["transactions"][0]["description"] == "Despensa - Walmart"
    assert result["transactions"][0]["category"] == "Despensa y Mandado"


async def test_the_advisor_can_look_up_categories_recurring_items_and_debt_history(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    loan = {
        "action": "create_debt",
        "arguments": {
            "name": "Emanuel",
            "type": "informal",
            "direction": "owed_to_me",
            "total_amount": 100,
            "funding_account_name": "Santander",
        },
    }
    await _propose_and_confirm(client, headers, monkeypatch, [loan])
    _provider(
        monkeypatch,
        [
            [
                _lookup("list_categories_and_tags"),
                _lookup("list_recurring_items"),
                _lookup("get_debt_movements", debt_name="Emanuel"),
            ],
            [{"type": "text", "text": "listo"}],
        ],
    )
    await _chat(client, headers, "dame contexto")

    categories = await _lookup_result(client, headers, "list_categories_and_tags")
    assert any("Mascotas" in c for c in categories["expense_categories"])
    assert (await _lookup_result(client, headers, "list_recurring_items"))["recurring_items"] == []
    movements = await _lookup_result(client, headers, "get_debt_movements")
    assert movements["direction"] == "owed_to_me"
    assert [m["kind"] for m in movements["movements"]] == ["loan"]
    assert movements["movements"][0]["account"] == "Santander"


async def test_the_new_actions_are_proposed_not_offered_as_direct_tools(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    tools: list = []
    _provider(monkeypatch, [[{"type": "text", "text": "Hola."}]], captured_tools=tools)
    await _chat(client, headers, "Hola")
    offered = set(tools[0])
    assert {
        "search_transactions",
        "list_categories_and_tags",
        "list_recurring_items",
        "get_debt_movements",
    } <= offered
    assert not offered & {
        "create_transfer",
        "register_debt_payment",
        "increase_debt",
        "create_split_expense",
        "reconcile_account",
    }
