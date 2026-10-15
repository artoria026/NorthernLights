"""The advisor never writes: it proposes (propose_actions), the proposal is stored,
and only the server -- when the user confirms -- runs what was stored."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.ai import advisor
from tests.test_ai import (
    FakeAIProvider,
    _register_and_login,
    _use_test_session,
)

pytestmark = pytest.mark.asyncio


def _tx(description: str, amount: float = 100.0, date: str = "2026-10-01", **extra) -> dict:
    return {
        "action": "create_transaction",
        "arguments": {
            "date": date,
            "entry_type": "expense",
            "amount": amount,
            "description": description,
            "account_name": "Santander",
            "category_name": "Comida y Bebidas",
            **extra,
        },
    }


def _propose(
    items: list[dict], summary: str = "Registrar movimientos", tool_id: str = "t1"
) -> dict:
    return {
        "type": "tool_use",
        "id": tool_id,
        "name": "propose_actions",
        "input": {"summary": summary, "items": items},
    }


async def _setup(client: AsyncClient, session_factory, monkeypatch, *, with_account: bool = True):
    token, user_id = await _register_and_login(client)
    uid = uuid.UUID(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    _use_test_session(monkeypatch, session_factory, uid)
    account_id = None
    if with_account:
        created = await client.post(
            "/api/v1/accounts",
            headers=headers,
            json={"name": "Santander", "type": "asset", "subtype": "checking"},
        )
        account_id = created.json()["data"]["id"]
    return headers, uid, account_id


def _provider(monkeypatch, turns: list[list[dict]], **capture) -> None:
    monkeypatch.setattr(advisor, "get_ai_provider", lambda: FakeAIProvider(turns=turns, **capture))


async def _chat(client: AsyncClient, headers: dict, message: str = "registra esto"):
    response = await client.post("/api/v1/ai/chat", headers=headers, data={"message": message})
    assert response.status_code == 200
    return response


async def _proposal_calls(client: AsyncClient, headers: dict) -> list[dict]:
    """Every propose_actions result in the history, oldest first."""
    history = await client.get("/api/v1/ai/history?per_page=100", headers=headers)
    calls = []
    for message in reversed(history.json()["data"]):
        for call in message["tool_calls"] or []:
            if call["tool"] == "propose_actions":
                calls.append(call["result"])
    return calls


async def _transactions(client: AsyncClient, headers: dict) -> list[dict]:
    response = await client.get("/api/v1/transactions?per_page=100", headers=headers)
    return response.json()["data"]


async def _proposed_id(client: AsyncClient, headers: dict) -> str:
    calls = [c for c in await _proposal_calls(client, headers) if "proposal_id" in c]
    return calls[-1]["proposal_id"]


# -- proposing never writes ---------------------------------------------------


async def test_propose_stores_the_proposal_and_writes_nothing(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(
        monkeypatch,
        [[_propose([_tx("Comida"), _tx("Cena", 250)])], [{"type": "text", "text": "Revisa."}]],
    )
    await _chat(client, headers)

    assert await _transactions(client, headers) == []
    [proposal] = await _proposal_calls(client, headers)
    assert proposal["status"] == "pending"
    assert proposal["summary"] == "Registrar movimientos"
    assert [i["action"] for i in proposal["items"]] == ["create_transaction"] * 2
    first_fields = {f["key"]: f["value"] for f in proposal["items"][0]["fields"]}
    assert first_fields == {
        "date": "2026-10-01",
        "entry_type": "expense",
        "amount": "100.0",
        "description": "Comida",
        "account": "Santander",
        "category": "Comida y Bebidas",
    }


async def test_the_model_is_not_offered_any_write_tool(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    tools: list = []
    _provider(monkeypatch, [[{"type": "text", "text": "Hola."}]], captured_tools=tools)
    await _chat(client, headers, "Hola")

    offered = set(tools[0])
    assert "propose_actions" in offered
    assert "list_existing_accounts_and_debts" in offered
    assert not {n for n in offered if n.startswith("create_") and n != "create_insight"}


async def test_a_direct_write_attempt_is_refused_and_nothing_is_created(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    captured: list = []
    _provider(
        monkeypatch,
        [
            [
                {
                    "type": "tool_use",
                    "id": "t1",
                    "name": "create_account",
                    "input": {"name": "Sneaky", "type": "asset", "subtype": "cash"},
                }
            ],
            [{"type": "text", "text": "No pude."}],
        ],
        captured_messages=captured,
    )
    await _chat(client, headers)

    names = [
        a["name"] for a in (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
    ]
    assert names == ["Santander"]
    tool_result = captured[1][-1]["content"][0]["content"]
    assert "propose_actions" in tool_result


# -- confirming runs exactly what was stored ----------------------------------


async def test_confirm_registers_exactly_the_stored_items(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Comida", 100, "2026-10-01"), _tx("Cena", 250, "2026-10-02")])],
            [{"type": "text", "text": "Revisa."}],
        ],
    )
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "confirmed"

    registered = {
        (t["description"], t["amount"], t["date"]) for t in await _transactions(client, headers)
    }
    assert registered == {("Comida", "100.00", "2026-10-01"), ("Cena", "250.00", "2026-10-02")}
    account = (await client.get("/api/v1/accounts", headers=headers)).json()["data"][0]
    assert account["balance"] == "-350.00"


async def test_history_shows_the_current_status_of_each_proposal(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    assert [c["status"] for c in await _proposal_calls(client, headers)] == ["pending"]

    await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert [c["status"] for c in await _proposal_calls(client, headers)] == ["confirmed"]


async def test_confirming_twice_registers_only_once(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    first = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    second = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert first.json()["data"]["status"] == second.json()["data"]["status"] == "confirmed"
    assert len(await _transactions(client, headers)) == 1


async def test_cancel_registers_nothing_and_it_cannot_be_confirmed_afterwards(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    cancelled = await client.post(f"/api/v1/ai/proposals/{proposal_id}/cancel", headers=headers)
    assert cancelled.json()["data"]["status"] == "cancelled"
    late = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert late.json()["data"]["status"] == "cancelled"
    assert await _transactions(client, headers) == []


async def test_cancelling_a_confirmed_proposal_does_not_undo_it(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)

    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/cancel", headers=headers)
    assert response.json()["data"]["status"] == "confirmed"
    assert len(await _transactions(client, headers)) == 1


async def test_confirm_is_all_or_nothing(client: AsyncClient, session_factory, monkeypatch):
    """The second item stops being valid between proposing and confirming (its
    account was deleted): nothing from the batch may be saved, the first item included."""
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    other = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Otra", "type": "asset", "subtype": "cash"},
    )
    other_id = other.json()["data"]["id"]
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Primero"), _tx("Segundo", account_name="Otra")])],
            [{"type": "text", "text": "Revisa."}],
        ],
    )
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    assert (await client.delete(f"/api/v1/accounts/{other_id}", headers=headers)).status_code == 200

    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    body = response.json()["data"]
    assert body["status"] == "failed"
    assert "#2" in body["error"]
    assert await _transactions(client, headers) == []
    santander = next(
        a
        for a in (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
        if a["name"] == "Santander"
    )
    assert santander["balance"] == "0.00"
    # ...and what the history shows is the failed state, not a pending card.
    assert [c["status"] for c in await _proposal_calls(client, headers)] == ["failed"]


async def test_a_whole_statement_fits_in_one_proposal(
    client: AsyncClient, session_factory, monkeypatch
):
    """Before, every row was one model tool call and the 20-step limit cut a long
    statement short. One proposal carries up to 60 rows."""
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    rows = [_tx(f"Cargo {i}", 10 + i, f"2026-09-{(i % 28) + 1:02d}") for i in range(45)]
    _provider(
        monkeypatch, [[_propose(rows, "Estado de septiembre")], [{"type": "text", "text": "ok"}]]
    )
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.json()["data"]["status"] == "confirmed"
    assert len(await _transactions(client, headers)) == 45


# -- every kind of action goes through a proposal ------------------------------


async def test_every_kind_of_action_can_be_proposed_and_confirmed(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    items = [
        {
            "action": "create_account",
            "arguments": {
                "name": "Cuenta nueva",
                "type": "asset",
                "subtype": "savings",
                "initial_balance": 500,
            },
        },
        {
            "action": "create_unplanned_debt",
            "arguments": {"name": "Nu - TDC", "creditor": "Nu", "amount": 47000},
        },
        {
            "action": "create_debt",
            "arguments": {
                "name": "Prestamo",
                "type": "personal_loan",
                "total_amount": 9000,
                "payment_amount": 900,
                "payment_frequency": "monthly",
            },
        },
        {
            "action": "create_recurring_item",
            "arguments": {
                "name": "Spotify",
                "item_type": "subscription",
                "amount": 239,
                "frequency": "monthly",
                "account_name": "Santander",
                "category_name": "Ocio y Entretenimiento",
                "next_date": "2026-11-01",
            },
        },
        _tx("Comida"),
    ]
    _provider(monkeypatch, [[_propose(items, "Todo junto")], [{"type": "text", "text": "ok"}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.json()["data"]["status"] == "confirmed", response.json()

    accounts = [
        a["name"] for a in (await client.get("/api/v1/accounts", headers=headers)).json()["data"]
    ]
    assert "Cuenta nueva" in accounts
    unplanned = [
        d["name"]
        for d in (await client.get("/api/v1/debts/unplanned", headers=headers)).json()["data"]
    ]
    assert "Nu - TDC" in unplanned
    debts = [d["name"] for d in (await client.get("/api/v1/debts", headers=headers)).json()["data"]]
    assert "Prestamo" in debts
    recurring = [
        r["name"]
        for r in (await client.get("/api/v1/recurring-items", headers=headers)).json()["data"]
    ]
    assert "Spotify" in recurring
    assert len(await _transactions(client, headers)) == 1


# -- validation happens when proposing, and the model can fix it ----------------


@pytest.mark.parametrize(
    ("item", "expected"),
    [
        (_tx("X", account_name="Cuenta que no existe"), "Cuenta que no existe"),
        (
            {"action": "create_account", "arguments": {"name": "Rara", "type": "banco_magico"}},
            "debe ser uno de",
        ),
        (
            {"action": "create_unplanned_debt", "arguments": {"name": "Deuda", "amount": -100}},
            "",
        ),
        (
            {
                "action": "create_recurring_item",
                "arguments": {
                    "name": "Spotify",
                    "item_type": "subscription",
                    "amount": 239,
                    "frequency": "monthly",
                    "account_name": "Santander",
                    "category_name": "Ocio y Entretenimiento",
                },
            },
            "next_date",
        ),
        ({"action": "create_everything", "arguments": {}}, "no es una accion"),
        ({"action": "create_account"}, "action"),
    ],
)
async def test_a_bad_item_is_reported_to_the_model_and_nothing_is_stored(
    client: AsyncClient, session_factory, monkeypatch, item, expected
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    captured: list = []
    _provider(
        monkeypatch,
        [[_propose([item])], [{"type": "text", "text": "Corrijo."}]],
        captured_messages=captured,
    )
    await _chat(client, headers)

    [result] = await _proposal_calls(client, headers)
    assert "error" in result and "proposal_id" not in result
    assert expected.lower() in result["error"].lower()
    # the model got the error as the tool result and answered afterwards
    assert "No guarde la propuesta" in captured[1][-1]["content"][0]["content"]
    assert await _transactions(client, headers) == []


async def test_the_model_can_fix_a_rejected_proposal_in_the_same_turn(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Comida", account_name="Cuenta que no existe")], tool_id="t1")],
            [_propose([_tx("Comida")], tool_id="t2")],
            [{"type": "text", "text": "Listo, revisa la tarjeta."}],
        ],
    )
    await _chat(client, headers)

    results = await _proposal_calls(client, headers)
    assert [bool(r.get("error")) for r in results] == [True, False]
    proposal_id = await _proposed_id(client, headers)
    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.json()["data"]["status"] == "confirmed"


async def test_all_the_broken_items_are_reported_at_once(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    items = [_tx("Ok"), _tx("Mal 1", account_name="Nope"), _tx("Mal 2", category_name="Nada")]
    _provider(monkeypatch, [[_propose(items)], [{"type": "text", "text": "Corrijo."}]])
    await _chat(client, headers)

    [result] = await _proposal_calls(client, headers)
    assert "#2" in result["error"] and "#3" in result["error"] and "#1" not in result["error"]


async def test_a_proposal_over_the_item_limit_is_rejected(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(
        monkeypatch,
        [[_propose([_tx(f"c{i}") for i in range(61)])], [{"type": "text", "text": "x"}]],
    )
    await _chat(client, headers)

    [result] = await _proposal_calls(client, headers)
    assert "Maximo 60" in result["error"]


# -- the model remembers what it proposed --------------------------------------


@pytest.mark.parametrize(
    ("action", "expected_state"),
    [(None, "PENDIENTE"), ("confirm", "CONFIRMADA"), ("cancel", "CANCELADA")],
)
async def test_the_next_turn_shows_the_model_the_proposal_and_its_status(
    client: AsyncClient, session_factory, monkeypatch, action, expected_state
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    captured: list = []
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Comida", 100), _tx("Cena", 250)], "Dos gastos")],
            [{"type": "text", "text": "Revisa la tarjeta."}],
            [{"type": "text", "text": "De nada."}],
        ],
        captured_messages=captured,
    )
    await _chat(client, headers)
    if action:
        proposal_id = await _proposed_id(client, headers)
        await client.post(f"/api/v1/ai/proposals/{proposal_id}/{action}", headers=headers)
    await _chat(client, headers, "gracias")

    history_for_model = captured[-1][:-1]
    assistant_turn = next(m for m in history_for_model if m["role"] == "assistant")["content"]
    assert "[Propuesta" in assistant_turn and "Dos gastos" in assistant_turn
    assert expected_state in assistant_turn
    # the rows themselves, so the model knows exactly what was proposed
    assert "description=Comida" in assistant_turn and "amount=250," in assistant_turn


async def test_a_failed_proposal_tells_the_model_why(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    other = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={"name": "Otra", "type": "asset", "subtype": "cash"},
    )
    captured: list = []
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Segundo", account_name="Otra")])],
            [{"type": "text", "text": "Revisa."}],
            [{"type": "text", "text": "Ok."}],
        ],
        captured_messages=captured,
    )
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    await client.delete(f"/api/v1/accounts/{other.json()['data']['id']}", headers=headers)
    await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    await _chat(client, headers, "¿que paso?")

    assistant_turn = next(m for m in captured[-1][:-1] if m["role"] == "assistant")["content"]
    assert "FALLO" in assistant_turn and "#1" in assistant_turn


async def test_confirmed_registrations_reach_the_next_turns_financial_context(
    client: AsyncClient, session_factory, monkeypatch
):
    """The snapshot cached when the chat opened must not go stale after confirming:
    the next turn has to see the new account in the net worth."""
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    systems: list = []
    _provider(
        monkeypatch,
        [
            [
                _propose(
                    [
                        {
                            "action": "create_account",
                            "arguments": {
                                "name": "Ahorros",
                                "type": "asset",
                                "subtype": "savings",
                                "initial_balance": 7777,
                            },
                        }
                    ]
                )
            ],
            [{"type": "text", "text": "Revisa."}],
            [{"type": "text", "text": "Listo."}],
        ],
        captured_systems=systems,
    )
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    assert "7777" not in systems[0]
    await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    await _chat(client, headers, "¿como voy?")

    assert "7777" in systems[-1]


# -- ownership, expiry, cleanup ------------------------------------------------


async def test_a_proposal_belongs_to_its_user(client: AsyncClient, session_factory, monkeypatch):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    other_token, _ = await _register_and_login(client)
    other = {"Authorization": f"Bearer {other_token}"}
    assert (
        await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=other)
    ).status_code == 404
    assert (
        await client.post(f"/api/v1/ai/proposals/{proposal_id}/cancel", headers=other)
    ).status_code == 404
    assert (
        await client.post(f"/api/v1/ai/proposals/{uuid.uuid4()}/confirm", headers=headers)
    ).status_code == 404
    assert await _transactions(client, headers) == []


async def test_a_stale_proposal_expires_and_cannot_be_confirmed(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, uid, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)
    async with session_factory() as session:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"), {"uid": str(uid)}
        )
        await session.execute(
            text("UPDATE ai_proposals SET created_at = now() - interval '25 hours' WHERE id = :id"),
            {"id": proposal_id},
        )
        await session.commit()

    assert [c["status"] for c in await _proposal_calls(client, headers)] == ["expired"]
    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.json()["data"]["status"] == "expired"
    assert await _transactions(client, headers) == []


async def test_clearing_the_history_removes_the_proposals_too(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    await client.delete("/api/v1/ai/history", headers=headers)
    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.status_code == 404
    assert await _transactions(client, headers) == []


async def test_erasing_the_chat_data_removes_the_proposals_too(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Comida")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    proposal_id = await _proposed_id(client, headers)

    erased = await client.post(
        "/api/v1/data/erase",
        headers=headers,
        json={"categories": ["chat"], "password": "supersecret123"},
    )
    assert erased.status_code == 200
    response = await client.post(f"/api/v1/ai/proposals/{proposal_id}/confirm", headers=headers)
    assert response.status_code == 404


def _refine(items: list[dict], replaces: str) -> dict:
    block = _propose(items, "Sin el cafe", tool_id="t2")
    block["input"]["replaces"] = replaces
    return block


async def test_the_user_can_refine_a_pending_proposal_and_only_the_new_one_registers(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    captured: list = []
    _provider(
        monkeypatch,
        [
            [_propose([_tx("Cafe", 50), _tx("Super", 300), _tx("Cine", 120)], "Tres gastos")],
            [{"type": "text", "text": "Revisa la tarjeta."}],
        ],
        captured_messages=captured,
    )
    await _chat(client, headers, "registra la captura")
    first_id = await _proposed_id(client, headers)

    # the model sees the pending proposal with its id, to be able to replace it
    _provider(
        monkeypatch,
        [
            [_refine([_tx("Super", 300), _tx("Cine", 120)], first_id[:8])],
            [{"type": "text", "text": "Listo, sin el cafe."}],
        ],
        captured_messages=captured,
    )
    await _chat(client, headers, "no agregues la compra de cafe")
    assert first_id[:8] in str(captured[-1])

    calls = await _proposal_calls(client, headers)
    assert [c["status"] for c in calls] == ["superseded", "pending"]
    second_id = calls[1]["proposal_id"]

    old = await client.post(f"/api/v1/ai/proposals/{first_id}/confirm", headers=headers)
    assert old.json()["data"]["status"] == "superseded"
    assert await _transactions(client, headers) == []

    await client.post(f"/api/v1/ai/proposals/{second_id}/confirm", headers=headers)
    descriptions = sorted(t["description"] for t in await _transactions(client, headers))
    assert descriptions == ["Cine", "Super"]


async def test_replacing_a_proposal_that_is_not_pending_is_refused(
    client: AsyncClient, session_factory, monkeypatch
):
    headers, _, _ = await _setup(client, session_factory, monkeypatch)
    _provider(monkeypatch, [[_propose([_tx("Cafe")])], [{"type": "text", "text": "Revisa."}]])
    await _chat(client, headers)
    first_id = await _proposed_id(client, headers)
    await client.post(f"/api/v1/ai/proposals/{first_id}/confirm", headers=headers)

    _provider(
        monkeypatch,
        [
            [_refine([_tx("Cafe")], first_id)],
            [{"type": "text", "text": "No pude."}],
        ],
    )
    await _chat(client, headers, "quita el cafe")
    calls = [c for c in await _proposal_calls(client, headers) if c.get("proposal_id")]
    assert [c["status"] for c in calls] == ["confirmed"]
    assert len(await _transactions(client, headers)) == 1
