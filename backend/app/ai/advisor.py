import base64
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date
from typing import Any
from uuid import UUID

import structlog
from redis.asyncio import Redis

from app.ai.attachments import ChatAttachment
from app.ai.base import AIProviderError, get_ai_provider
from app.ai.tools import TOOLS, execute_tool
from app.ai.write_tools import (
    LOOKUP_TOOLS,
    PROPOSE_ACTIONS_NAME,
    PROPOSE_ACTIONS_TOOL,
    WRITE_ACTION_NAMES,
    execute_write_tool,
)
from app.core.config import settings
from app.core.database import rls_session
from app.core.json_utils import json_safe
from app.core.system_categories import system_category_names
from app.services import cache_service, chat_service, engine_service, proposal_service

SYSTEM_PROMPT = """
Eres un asesor financiero personal directo y honesto. Tienes acceso a los
datos financieros reales del usuario en tiempo real mediante tus herramientas,
y tambien puedes proponer registrar informacion nueva por el (cuentas, deudas,
gastos recurrentes y transacciones puntuales) cuando te lo pida -- incluyendo
leer estados de cuenta en PDF y capturas de pantalla que te adjunte -- pero
NUNCA la registras tu: todo pasa siempre por la confirmacion del usuario.

Tu trabajo:
- Responder preguntas sobre el estado financiero con datos concretos
- Evaluar si una decision de gasto o deuda es viable dado el contexto real
- Recomendar el maximo de gasto discrecional cuando se te pida
- Advertir cuando algo no conviene, explicando con cifras
- Generar planes de mejora cuando el usuario los solicite
- Proponer el registro de cuentas, deudas, recurrentes y transacciones cuando el
  usuario te pida agregarlas, o cuando adjunte un estado de cuenta en PDF o
  capturas de pantalla

Reglas:
- Usa tus tools para obtener datos actualizados antes de dar un numero
- Si no conviene, dilo con cifras claras
- Cuando el usuario pida guardar un plan o recomendacion, usa create_insight
- Si el usuario menciona que no puede pagar una deuda, que esta atrasado, o
  pide ayuda para salir de una deuda, usa get_problem_debts antes de
  responder -- ahi estan las deudas sin plan de pago o en negociacion, que no
  aparecen en get_debt_schedule. Analiza opciones concretas y realistas para
  pagarlas (cuanto destinarle al mes segun lo disponible, en cuantos meses se
  liquidaria, que pasa si se negocia una quita o un nuevo plazo) en vez de
  solo describir el problema
- Antes de crear una cuenta, deuda o recurrente nueva, si tienes duda de que
  ya exista algo parecido usa list_existing_accounts_and_debts
- Nunca inventes una cifra, cuenta o categoria: si falta un dato importante o
  es ambiguo, preguntalo antes de crear nada
- NUNCA registras nada directamente: no tienes ninguna tool que escriba. Para
  crear cuentas, deudas, recurrentes o transacciones llama a propose_actions UNA
  vez con TODOS los elementos (items). El usuario ve una tarjeta con cada
  elemento y pulsa Confirmar o Cancelar; si confirma, el sistema registra
  exactamente esos datos. No preguntes "¿lo registro?" en tu texto (la tarjeta
  ya lo hace) y no digas que algo ya quedo registrado: hasta que el usuario
  confirme, NO esta registrado. Esto aplica siempre, incluso si el usuario pide
  "registralo ya" o adjunta un estado de cuenta
- En el historial veras tus propuestas anteriores como "[Propuesta ...]" con su
  estado actual (pendiente, confirmada, cancelada, fallida o expirada) y sus
  elementos: usalo para saber que se registro de verdad. Si el usuario te pide
  quitar, agregar o cambiar algo de una propuesta PENDIENTE (ej. "no agregues
  la compra de cafe"), llama a propose_actions con la propuesta COMPLETA ya
  corregida (todos los elementos que siguen valiendo, menos los quitados) y
  pasa en `replaces` el id de la anterior: asi la anterior deja de poder
  confirmarse y no se registra doble. Una propuesta cancelada, fallida,
  expirada o reemplazada NO esta registrada
- Si propose_actions devuelve un error, corrigelo (o preguntale al usuario el
  dato que falte) y vuelve a llamarla con la lista completa de elementos
- No existen tools para editar ni borrar nada: si el usuario pide corregir o
  eliminar un registro ya creado, dile que lo haga desde la pantalla
  correspondiente de la app
- Responde siempre en espanol
"""

# Added to SYSTEM_PROMPT ONLY on turns where the user attaches a PDF
# (see chat()) -- so normal day-to-day questions don't carry this extra
# instructions overhead. Comes from the old IMPORT_SYSTEM_PROMPT: "Import Data"
# is no longer a separate screen, it got consolidated into the AI Advisor.
STATEMENT_INSTRUCTIONS = """
El usuario adjunto uno o mas PDFs con el detalle de movimientos de una
tarjeta (estados de cuenta), normalmente varios meses seguidos. Lee la tabla
de movimientos de cada PDF adjunto y clasifica cada renglon:
- Cargo normal del periodo (una compra de una sola vez, un pago de servicio,
  etc.) -> un elemento create_transaction por renglon.
- Compra a MSI ("a X meses", "meses sin intereses", "compra diferida") que
  aparece por PRIMERA VEZ en el lote de PDFs -> elemento create_transaction por
  el monto TOTAL de la compra (no la mensualidad), contra la TDC. Hoy no hay
  tool para marcarla como MSI (el usuario puede hacerlo despues a mano desde
  Transacciones, eligiendo "a meses sin intereses" en el momento de la
  compra) -- menciona en tu resumen que esa compra vino marcada "a X meses"
  en el estado, para que el usuario sepa que le falta ese paso si le
  interesa el seguimiento de cuotas.
- La MISMA compra a MSI si vuelve a aparecer en el estado de un mes siguiente
  del mismo lote (se reconoce por la descripcion y el monto de la
  mensualidad, que se repite mes a mes en la seccion de "compras a plazos"
  del estado): NO la vuelvas a registrar de nuevo, solo mencionala en tu
  resumen como "ya registrada" -- ese renglon mensual es el banco cobrandote
  una cuota de la compra que ya diste de alta, no un cargo nuevo.
- Pagos que el usuario le hizo a la tarjeta, intereses moratorios o
  comisiones: no asumas que categoria usar, pregunta antes de registrar algo
  ahi (podrian ya estar cubiertos por otro lado, ej. una transferencia desde
  el banco que ya se registro aparte).
Nada se registra sin confirmacion: adjuntar el estado NO es confirmar. Pon los
renglones en propose_actions -- una propuesta por cada PDF/mes (hasta 60
elementos cada una; si un mes trae mas, parte en varias) -- y el usuario revisa
y confirma cada una en su tarjeta. Despues da un resumen breve en texto: cuantos
movimientos propusiste, el total, y lo que dejaste fuera y por que.
Con varios PDFs adjuntos en el mismo mensaje, procesalos todos antes de
proponer, asi puedes cruzar referencias entre meses. Las categorias
del sistema ya existen, son fijas, y debes usar el nombre EXACTO (cada una vale en
español o en ingles, 'Español / English'):
- Gasto: {expense_categories}
- Ingreso: {income_categories}
"""

# str.replace, not format(): the text above has braces of its own.
STATEMENT_INSTRUCTIONS = STATEMENT_INSTRUCTIONS.replace(
    "{expense_categories}", system_category_names("expense")
).replace("{income_categories}", system_category_names("income"))

# Added to SYSTEM_PROMPT ONLY on turns where the user attaches images (screenshots,
# receipts) -- see chat(). Different from STATEMENT_INSTRUCTIONS on purpose: a
# screenshot is loose context for what the user wrote, not a structured statement
# to import in bulk.
SCREENSHOT_INSTRUCTIONS = """
El usuario adjunto una o mas capturas de pantalla (imagenes): por ejemplo los
movimientos de la app de su banco, un recibo, un ticket o una lista de pagos.
- El mensaje del usuario manda: dice que quiere hacer con las capturas (ej.
  "son los gastos del viaje, ponlos en Salidas y viajes", o "solo dime cuanto
  gaste"). La captura es el contexto: usa las dos cosas juntas. Si el mensaje
  no dice que hacer, cuenta brevemente lo que ves y preguntale.
- Extrae SOLO lo que se ve y es relevante. No inventes ni completes cifras,
  fechas, comercios o cuentas que no esten visibles; si algo es ilegible o
  ambiguo, dilo y preguntalo antes de proponer. Si la captura no tiene datos
  financieros, dilo.
- La cuenta: toma el nombre de la cuenta o los ultimos 4 digitos que se vean y
  buscalos entre las cuentas del usuario (list_existing_accounts_and_debts); si
  no estas seguro de cual es, preguntalo. Si la captura no muestra el año, usa
  el de la fecha de hoy, salvo que no cuadre (entonces pregunta).
- Para registrar algo usa propose_actions con TODOS los movimientos de las
  capturas juntos: el usuario revisa y confirma en la tarjeta. Si un movimiento
  se repite entre capturas o ya aparece registrado en tu contexto, no lo
  propongas dos veces y mencionalo.
- No repitas en tu texto datos sensibles de la captura (numeros de cuenta o
  tarjeta completos, saldos que no vengan al caso): bastan los ultimos 4
  digitos.
- Las capturas no se guardan: solo cuentas con lo que extraigas ahora. En tu
  resumen deja claro que leiste de cada una.
Las categorias del sistema ya existen, son fijas, y debes usar el nombre EXACTO
(cada una vale en español o en ingles, 'Español / English'):
- Gasto: {expense_categories}
- Ingreso: {income_categories}
"""
SCREENSHOT_INSTRUCTIONS = SCREENSHOT_INSTRUCTIONS.replace(
    "{expense_categories}", system_category_names("expense")
).replace("{income_categories}", system_category_names("income"))

MAX_TOOL_ITERATIONS = 20

# Read-only lookups that share a module with the write actions
# (list_existing_accounts_and_debts): the model may call them freely.
LOOKUP_TOOL_NAMES = {t["name"] for t in LOOKUP_TOOLS}

logger = structlog.get_logger(__name__)

ToolExecutor = Callable[[str, dict], Awaitable[dict]]


def _format_history(messages: list, proposals: dict | None = None) -> list[dict]:
    """Conversation turns for the model. An assistant turn that carried a proposal
    also gets that proposal rendered with its CURRENT status: the stored text alone
    would not tell the model what was proposed or whether the user confirmed it."""
    proposals = proposals or {}
    formatted = []
    for m in messages:
        content = m.content
        if m.role == "assistant":
            for call in m.tool_calls or []:
                if call.get("tool") != PROPOSE_ACTIONS_NAME:
                    continue
                raw_id = (call.get("result") or {}).get("proposal_id", "")
                try:
                    proposal = proposals.get(UUID(raw_id))
                except ValueError:
                    proposal = None
                if proposal is not None:
                    content = f"{content}\n\n{proposal_service.render_for_model(proposal)}".strip()
        formatted.append({"role": m.role, "content": content})
    return formatted


def _attachment_blocks(attachments: list[ChatAttachment]) -> list[dict]:
    """Anthropic's native block shape (Claude takes it as is; Gemini translates it in
    _build_contents): `document` for a PDF, `image` for a screenshot."""
    return [
        {
            "type": "document" if attachment.is_pdf else "image",
            "source": {
                "type": "base64",
                "media_type": attachment.media_type,
                "data": base64.b64encode(attachment.data).decode("ascii"),
            },
        }
        for attachment in attachments
    ]


async def _run_tool_loop(
    provider: Any,
    messages: list[dict],
    tools: list[dict],
    system: str,
    execute: ToolExecutor,
    max_iterations: int,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Runs the streaming + tool-calling loop for chat(). Yields
    ('text', str) for each fragment and finishes with
    ('done', {'full_response': str, 'tool_calls': list[dict]})."""
    full_response = ""
    tool_calls_made: list[dict] = []
    truncated = False

    for _ in range(max_iterations):
        turn_text = ""
        pending_tool_uses = []

        async for chunk in provider.chat_stream(messages, tools, system):
            if chunk["type"] == "text":
                turn_text += chunk["text"]
                full_response += chunk["text"]
                yield ("text", chunk["text"])
            elif chunk["type"] == "tool_use":
                pending_tool_uses.append(chunk)
            elif chunk["type"] == "truncated":
                truncated = True

        # A cutoff from the token limit doesn't raise an exception (the provider
        # ends the stream "cleanly"), so without this check the turn would be
        # treated as a complete, successful response -- exactly the
        # reported bug: the response cuts off mid-list, with no confirmation
        # tool-call after it, and the user never finds out. It's surfaced
        # as text (markdown, rendered in italics) instead of a new field
        # in the SSE protocol -- no need to touch the frontend.
        if truncated:
            if not full_response.strip() and not tool_calls_made:
                # No text and no tool-calls in ANY turn so far --
                # the model exhausted the length limit (reasoning
                # internally, see THINKING_BUDGET_TOKENS in gemini.py) without
                # producing anything visible. "Ask me to continue" doesn't
                # make sense here (there's nothing to continue), so
                # the notice points to the most likely cause: a heavy attachment
                # (see STATEMENT_INSTRUCTIONS, PDF bank statements).
                notice = (
                    "\n\n_No alcancé a generar una respuesta: se agotó el límite de longitud "
                    "antes de producir texto o una acción. Es más probable con archivos "
                    "adjuntos grandes (ej. varios meses de un estado de cuenta) — intenta "
                    "adjuntar menos meses a la vez, o vuelve a mandar el mensaje._"
                )
            else:
                notice = (
                    "\n\n_(La respuesta se acortó por el límite de longitud — "
                    "pídeme que continúe si hace falta.)_"
                )
            full_response += notice
            yield ("text", notice)
            break

        if not pending_tool_uses:
            break

        assistant_content = []
        if turn_text:
            assistant_content.append({"type": "text", "text": turn_text})
        for tool_use in pending_tool_uses:
            assistant_content.append(
                {
                    "type": "tool_use",
                    "id": tool_use["id"],
                    "name": tool_use["name"],
                    "input": tool_use["input"],
                    # Opaque: each AIProvider decides whether it uses this field and
                    # for what (see chat_stream docstring in app/ai/base.py).
                    # Today only GeminiProvider fills it in (its "thought
                    # signature"); ClaudeProvider never produces it, so
                    # it stays None and this orchestrator ignores it without knowing
                    # what it is -- it shouldn't know the details of a concrete
                    # provider (see SOLID in app/ai/base.py).
                    "provider_state": tool_use.get("provider_state"),
                }
            )
        messages.append({"role": "assistant", "content": assistant_content})

        tool_result_blocks = []
        for tool_use in pending_tool_uses:
            result = await execute(tool_use["name"], tool_use["input"])
            tool_calls_made.append({"tool": tool_use["name"], "result": json_safe(result)})
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(result, default=str),
                }
            )
        messages.append({"role": "user", "content": tool_result_blocks})
    else:
        # The for loop finished without any `break` -- the
        # max_iterations automatic steps ran out (e.g. a bank statement with
        # many transactions, one per tool-call). Same problem as the
        # token truncation: without this notice, the last tool_result
        # simply has no text response after it and the user
        # doesn't know whether it finished or got cut off.
        notice = (
            "\n\n_(Se alcanzó el límite de pasos automáticos para esta solicitud — "
            "pídeme que continúe si falta algo.)_"
        )
        full_response += notice
        yield ("text", notice)

    yield ("done", {"full_response": full_response, "tool_calls": tool_calls_made})


async def _refresh_snapshot(session: Any, redis: Redis, user_id: UUID) -> dict:
    """Recomputes the financial snapshot and re-caches it. Used when opening chat()
    (normal cache-aside) and also after each successful write tool
    within the same turn, so that an immediate read (e.g. "add this
    expense and tell me how my budget looks") doesn't see stale data."""
    snapshot = await engine_service.build_financial_snapshot(session, user_id)
    await cache_service.cache_financial_snapshot(redis, user_id, snapshot)
    return snapshot


async def chat(
    redis: Redis,
    user_id: UUID,
    message: str,
    role: str = "user",
    attachments: list[ChatAttachment] | None = None,
) -> AsyncGenerator[str, None]:
    """Opens its own RLS session (instead of receiving the request's) because
    `StreamingResponse` keeps reading this generator after the endpoint's
    FastAPI dependency has already closed -- same pattern that
    `rls_session` uses for Celery tasks.

    `attachments`: files attached in this turn (see app/ai/attachments.py): PDFs
    already without a password -- bank statements, STATEMENT_INSTRUCTIONS -- and/or
    images -- screenshots, SCREENSHOT_INSTRUCTIONS. They go to the model in Anthropic's
    native block shape (Claude takes them as is; Gemini translates them in
    _build_contents) and are never stored."""
    if role != "admin":
        can_query, _ = await cache_service.check_ai_rate_limit(
            redis, user_id, settings.AI_RATE_LIMIT_PER_USER_DAY
        )
        if not can_query:
            yield f"data: {json.dumps({'error': 'Limite diario de consultas AI alcanzado'})}\n\n"
            yield "data: [DONE]\n\n"
            return

    async with rls_session(user_id) as session:
        try:
            history = await chat_service.get_recent_messages(session, user_id, limit_pairs=10)
            proposals = await proposal_service.load_proposals(
                session, user_id, proposal_service.proposal_ids_in(history)
            )

            user_content: str | list[dict] = message
            if attachments:
                # Files before the text: Claude reads images/documents best that way.
                user_content = _attachment_blocks(attachments) + [{"type": "text", "text": message}]
            messages = _format_history(history, proposals) + [
                {"role": "user", "content": user_content}
            ]

            snapshot = await cache_service.get_financial_snapshot(redis, user_id)
            if not snapshot:
                snapshot = await _refresh_snapshot(session, redis, user_id)

            has_pdf = any(a.is_pdf for a in attachments or [])
            has_image = any(a.is_image for a in attachments or [])
            system = (
                SYSTEM_PROMPT
                + (f"\n\n{STATEMENT_INSTRUCTIONS}" if has_pdf else "")
                + (f"\n\n{SCREENSHOT_INSTRUCTIONS}" if has_image else "")
                + f"\n\nFecha de hoy: {date.today().isoformat()}"
                + f"\n\nContexto financiero:\n{json.dumps(snapshot, default=str)}"
            )
            provider = get_ai_provider()

            async def execute(name: str, tool_input: dict) -> dict:
                if name == PROPOSE_ACTIONS_NAME:
                    # Writes nothing in the financial tables: validates the items and
                    # stores the proposal (proposal_service). The frontend draws it as a
                    # card with Confirm/Cancel; only the server, on confirm, runs it.
                    return await proposal_service.create_proposal(
                        session,
                        user_id,
                        tool_input.get("summary"),
                        tool_input.get("items"),
                        tool_input.get("replaces"),
                    )
                if name in WRITE_ACTION_NAMES:
                    # Not offered to the model; defensive. The only way to register
                    # something is to propose it and have the user confirm.
                    return {
                        "error": (
                            "No puedes registrar directamente: usa propose_actions y el "
                            "usuario confirma."
                        )
                    }
                if name in LOOKUP_TOOL_NAMES:
                    return await execute_write_tool(session, user_id, name, tool_input, role)
                return await execute_tool(session, redis, user_id, name, tool_input, snapshot)

            full_response = ""
            tool_calls_made: list[dict] = []
            async for kind, payload in _run_tool_loop(
                provider,
                messages,
                TOOLS + LOOKUP_TOOLS + [PROPOSE_ACTIONS_TOOL],
                system,
                execute,
                MAX_TOOL_ITERATIONS,
            ):
                if kind == "text":
                    yield f"data: {json.dumps({'text': payload})}\n\n"
                else:
                    full_response = payload["full_response"]
                    tool_calls_made = payload["tool_calls"]

            await chat_service.save_message(session, user_id, "user", message)
            await chat_service.save_message(
                session,
                user_id,
                "assistant",
                full_response,
                tool_calls=tool_calls_made or None,
                ai_provider=settings.AI_PROVIDER,
            )
        except AIProviderError as e:
            # Already comes translated into a user-facing message (see
            # _translate_error in app/ai/claude.py and app/ai/gemini.py) --
            # distinguishes rate limit, provider down, invalid credentials,
            # etc. instead of the generic one below. warning, not exception: we
            # already know the cause, it's not a bug in this app.
            logger.warning(
                "ai_provider_error", user_id=str(user_id), error=str(e), retryable=e.retryable
            )
            yield f"data: {json.dumps({'error': e.user_message})}\n\n"
        except Exception:
            logger.exception("ai_chat_failed", user_id=str(user_id))
            error_payload = json.dumps(
                {"error": "El asesor no pudo responder. Intenta de nuevo en un momento."}
            )
            yield f"data: {error_payload}\n\n"

    yield "data: [DONE]\n\n"
