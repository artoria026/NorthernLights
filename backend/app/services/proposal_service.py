"""AI proposals: everything the advisor wants to register waits here until the user
confirms it.

The advisor model has no write tools. It calls `propose_actions`, which lands in
`create_proposal` (validates every item and stores them exactly as they will run).
The user sees the stored items and confirms or cancels; only then does the SERVER
run those stored items (`confirm_proposal`) -- the model regenerates nothing, so
what was shown is what is saved, and the context doesn't depend on the model's
memory of an earlier turn.
"""

import copy
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.write_tools import MAX_PROPOSAL_ITEMS, execute_write_tool, prepare_write_tool
from app.core.json_utils import json_safe
from app.models.ai_proposal import AiProposal
from app.services import cache_service

PROPOSE_ACTIONS_TOOL_NAME = "propose_actions"
# A proposal that nobody answered is not valid forever: dates, accounts and balances
# move on. After this it can no longer be confirmed (ask the advisor again).
PROPOSAL_TTL = timedelta(hours=24)
# Errors returned to the model are capped so a bad batch doesn't flood its context.
MAX_REPORTED_ERRORS = 10

# How the model sees each state of a proposal in the conversation history.
_STATUS_FOR_MODEL = {
    "pending": "PENDIENTE: el usuario aun no confirma ni cancela; NO esta registrada",
    "confirmed": "CONFIRMADA por el usuario y ya registrada por el sistema",
    "cancelled": "CANCELADA por el usuario; no se registro nada",
    "failed": "FALLO al registrar; no se registro nada",
    "expired": "EXPIRO sin respuesta; no se registro nada",
    "superseded": "REEMPLAZADA por una propuesta corregida; no se registro nada",
}


class _BatchAborted(Exception):
    """Raised inside the savepoint to roll the whole batch back."""


def effective_status(proposal: AiProposal) -> str:
    """The stored status, except that a proposal left pending past its TTL reads as
    expired (computed on read: nothing has to run to expire it)."""
    if proposal.status == "pending":
        created = proposal.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        if datetime.now(UTC) - created > PROPOSAL_TTL:
            return "expired"
    return proposal.status


async def _find_pending_to_replace(
    session: AsyncSession, user_id: UUID, reference: str
) -> AiProposal | None:
    """The user's pending proposal named by `reference` (full id or the 8-character
    prefix the history shows). None if there is no such open proposal."""
    reference = reference.strip().lower()
    if not reference:
        return None
    rows = (
        (
            await session.execute(
                select(AiProposal)
                .where(AiProposal.user_id == user_id, AiProposal.status == "pending")
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    matches = [
        p
        for p in rows
        if str(p.id).startswith(reference) and effective_status(p) == "pending"
    ]
    return matches[0] if len(matches) == 1 else None


async def create_proposal(
    session: AsyncSession,
    user_id: UUID,
    summary: str,
    raw_items: object,
    replaces: str | None = None,
) -> dict:
    """Validates every item (the same checks the real execution will run, without
    writing) and stores the proposal. Returns what the model should see: the id and
    the items on success, or {"error": ...} naming each broken item so it can fix
    them all and call again. Never raises."""
    if not isinstance(summary, str) or not summary.strip():
        return {"error": "Falta 'summary': una frase corta que describa la propuesta."}
    if not isinstance(raw_items, list) or not raw_items:
        return {"error": "Falta 'items': debe ser una lista con al menos un elemento."}
    if len(raw_items) > MAX_PROPOSAL_ITEMS:
        return {
            "error": (
                f"Maximo {MAX_PROPOSAL_ITEMS} elementos por propuesta (mandaste "
                f"{len(raw_items)}). Divide en varias propuestas."
            )
        }

    stored: list[dict] = []
    problems: list[str] = []
    for index, raw in enumerate(raw_items, start=1):
        if not isinstance(raw, dict) or "action" not in raw or "arguments" not in raw:
            problems.append(f"#{index}: cada elemento necesita 'action' y 'arguments'.")
            continue
        prepared = await prepare_write_tool(session, user_id, raw["action"], raw["arguments"])
        if "error" in prepared:
            problems.append(f"#{index} ({raw['action']}): {prepared['error']}")
            continue
        stored.append(
            {
                "action": raw["action"],
                "arguments": json_safe(raw["arguments"]),
                "fields": prepared["fields"],
            }
        )

    if problems:
        shown = problems[:MAX_REPORTED_ERRORS]
        more = len(problems) - len(shown)
        suffix = f" (y {more} mas con errores)" if more > 0 else ""
        return {
            "error": (
                "No guarde la propuesta: hay elementos con errores. Corrigelos y vuelve a "
                "llamar a propose_actions con la lista completa. " + " | ".join(shown) + suffix
            )
        }

    old = None
    if replaces:
        old = await _find_pending_to_replace(session, user_id, str(replaces))
        if old is None:
            return {
                "error": (
                    f"No hay una propuesta PENDIENTE con id '{replaces}' (ya se confirmo, "
                    "cancelo o expiro). Si es una propuesta nueva, llama sin 'replaces'."
                )
            }

    proposal = AiProposal(user_id=user_id, summary=summary.strip(), items=stored)
    if old is not None:
        # The corrected version takes its place: both can never be confirmed.
        old.status = "superseded"
        old.resolved_at = datetime.now(UTC)
    session.add(proposal)
    await session.flush()
    return {
        "proposal_id": str(proposal.id),
        "status": "pending",
        "summary": proposal.summary,
        "items": [{"action": i["action"], "fields": i["fields"]} for i in stored],
    }


async def get_proposal(
    session: AsyncSession, user_id: UUID, proposal_id: UUID, *, for_update: bool = False
) -> AiProposal:
    query = select(AiProposal).where(AiProposal.id == proposal_id, AiProposal.user_id == user_id)
    if for_update:
        query = query.with_for_update()
    proposal = (await session.execute(query)).scalar_one_or_none()
    if proposal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Propuesta no encontrada")
    return proposal


async def confirm_proposal(
    session: AsyncSession, user_id: UUID, proposal_id: UUID, role: str = "user"
) -> AiProposal:
    """Runs the stored items, all or nothing: if any item fails, none of them is
    saved and the proposal is marked failed with the reason. Confirming twice is
    harmless (a confirmed proposal comes back as is, nothing runs again).

    Never raises for a state problem (already cancelled, expired, failed): the caller
    reads `effective_status` of what comes back. An HTTPException here would roll the
    request's transaction back, including the state we want to record."""
    proposal = await get_proposal(session, user_id, proposal_id, for_update=True)
    if proposal.status != "pending" or effective_status(proposal) != "pending":
        return proposal

    results: list[dict] = []
    failure: str | None = None
    try:
        # A savepoint, so a failure at item N undoes items 1..N-1 too.
        async with session.begin_nested():
            for index, item in enumerate(proposal.items, start=1):
                result = await execute_write_tool(
                    session, user_id, item["action"], item["arguments"], role
                )
                if "error" in result:
                    failure = f"#{index} ({item['action']}): {result['error']}"
                    raise _BatchAborted
                results.append({"action": item["action"], "result": json_safe(result)})
    except _BatchAborted:
        pass

    proposal.resolved_at = datetime.now(UTC)
    if failure is not None:
        proposal.status = "failed"
        proposal.error = failure
        proposal.results = None
    else:
        proposal.status = "confirmed"
        proposal.results = results
        proposal.error = None
    await session.flush()
    if failure is None:
        await cache_service.invalidate_snapshot_for(user_id)
    return proposal


async def cancel_proposal(session: AsyncSession, user_id: UUID, proposal_id: UUID) -> AiProposal:
    """Cancelling a pending proposal registers nothing. Cancelling one that is
    already cancelled is harmless; a confirmed one stays confirmed (it was already
    registered: undoing it is done from the screens of the app)."""
    proposal = await get_proposal(session, user_id, proposal_id, for_update=True)
    if proposal.status == "pending" and effective_status(proposal) == "pending":
        proposal.status = "cancelled"
        proposal.resolved_at = datetime.now(UTC)
        await session.flush()
    return proposal


async def load_proposals(
    session: AsyncSession, user_id: UUID, proposal_ids: list[UUID]
) -> dict[UUID, AiProposal]:
    if not proposal_ids:
        return {}
    result = await session.execute(
        select(AiProposal).where(AiProposal.user_id == user_id, AiProposal.id.in_(proposal_ids))
    )
    return {p.id: p for p in result.scalars().all()}


def proposal_ids_in(messages: list) -> list[UUID]:
    """Ids of the proposals the given chat messages carry in their tool_calls."""
    ids: list[UUID] = []
    for message in messages:
        for call in message.tool_calls or []:
            if call.get("tool") == PROPOSE_ACTIONS_TOOL_NAME:
                raw = (call.get("result") or {}).get("proposal_id")
                if raw:
                    try:
                        ids.append(UUID(raw))
                    except ValueError:
                        continue
    return ids


def annotate_tool_calls(tool_calls: list[dict] | None, proposals: dict[UUID, AiProposal]):
    """A copy of a message's tool_calls with the CURRENT status of each proposal in
    it (the stored result only knows it was pending when it was proposed)."""
    if not tool_calls:
        return tool_calls
    annotated = copy.deepcopy(tool_calls)
    for call in annotated:
        if call.get("tool") != PROPOSE_ACTIONS_TOOL_NAME:
            continue
        result = call.get("result") or {}
        try:
            proposal = proposals.get(UUID(result.get("proposal_id", "")))
        except ValueError:
            proposal = None
        if proposal is not None:
            result["status"] = effective_status(proposal)
            result["error"] = proposal.error
            resolved = proposal.resolved_at
            result["resolved_at"] = resolved.isoformat() if resolved else None
    return annotated


def render_for_model(proposal: AiProposal) -> str:
    """The proposal as text for the conversation history, with its current status, so
    that in later turns the model knows exactly what was proposed and what happened
    to it (the chat history otherwise only keeps the text of each message)."""
    state = effective_status(proposal)
    header = f"[Propuesta {str(proposal.id)[:8]}: {proposal.summary} -- {_STATUS_FOR_MODEL[state]}"
    if state == "failed" and proposal.error:
        header += f" ({proposal.error})"
    lines = [header + "]"]
    for index, item in enumerate(proposal.items, start=1):
        details = ", ".join(f"{f['key']}={f['value']}" for f in item["fields"])
        lines.append(f"{index}. {item['action']}: {details}")
    return "\n".join(lines)
