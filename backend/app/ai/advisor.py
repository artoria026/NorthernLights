import base64
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date
from typing import Any
from uuid import UUID

import structlog
from redis.asyncio import Redis

from app.ai.base import AIProviderError, get_ai_provider
from app.ai.tools import TOOLS, execute_tool
from app.ai.write_tools import (
    PROPOSE_ACTION_NAME,
    PROPOSE_ACTION_TOOL,
    WRITE_TOOLS,
    execute_write_tool,
)
from app.core.config import settings
from app.core.database import rls_session
from app.core.json_utils import json_safe
from app.services import cache_service, chat_service, engine_service

SYSTEM_PROMPT = """
Eres un asesor financiero personal directo y honesto. Tienes acceso a los
datos financieros reales del usuario en tiempo real mediante tus herramientas,
y tambien puedes registrar informacion nueva por el (cuentas, deudas, gastos
recurrentes y transacciones puntuales) cuando te lo pida -- incluyendo leer
estados de cuenta en PDF que te adjunte (uno o varios meses de una tarjeta) y
traer ese historico.

Tu trabajo:
- Responder preguntas sobre el estado financiero con datos concretos
- Evaluar si una decision de gasto o deuda es viable dado el contexto real
- Recomendar el maximo de gasto discrecional cuando se te pida
- Advertir cuando algo no conviene, explicando con cifras
- Generar planes de mejora cuando el usuario los solicite
- Registrar cuentas, deudas, recurrentes y transacciones cuando el usuario te
  pida agregarlas, o cuando adjunte un estado de cuenta en PDF

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
- Antes de ejecutar una tool que crea algo (create_transaction, create_account,
  create_debt, create_unplanned_debt, create_recurring_item), llama primero a
  propose_action con un resumen corto y los campos clave (monto, cuenta,
  categoria, fecha, etc.) -- eso le muestra al usuario una tarjeta con botones
  de Confirmar/Cancelar, no hace falta que ademas lo preguntes en tu texto.
  Espera al siguiente turno: si confirma, ejecuta la tool de escritura de
  'action' con esos mismos datos y confirma con el resultado; si cancela, no
  ejecutes nada y dile que no se registro. Excepcion: si el usuario ya te dio
  todos los datos Y pidio explicitamente que lo registres ya (ej. "agrega un
  gasto de 200 en comida hoy"), ejecuta la tool de escritura directo sin pasar
  por propose_action
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
  etc.) -> create_transaction, un llamado por renglon.
- Compra a MSI ("a X meses", "meses sin intereses", "compra diferida") que
  aparece por PRIMERA VEZ en el lote de PDFs -> create_transaction por el
  monto TOTAL de la compra (no la mensualidad), contra la TDC. Hoy no hay
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
Los renglones de un estado de cuenta se registran directo
(create_transaction / create_debt), SIN pasar por propose_action fila por
fila -- adjuntar el estado ya es la confirmacion, y pedir un boton por cada
movimiento haria inutilizable un estado con muchos renglones. Da tu resumen
final en texto normal al terminar.
Con varios PDFs adjuntos en el mismo mensaje, procesalos todos antes de dar
tu resumen final, asi puedes cruzar referencias entre meses. Las categorias
del sistema ya existen, son fijas, y debes usar el nombre EXACTO:
- Gasto: Comida y Bebidas, Transporte y Movilidad, Vivienda y Hogar, Salud y
  Bienestar, Ropa y Cuidado Personal, Ocio y Entretenimiento, Educacion y
  Desarrollo, Mascotas, Otro Gasto
- Ingreso: Empleo principal, Freelance, Otro
"""

MAX_TOOL_ITERATIONS = 20

# Names of the write tools (app/ai/write_tools.py) for dispatch
# in the normal chat() -- see _run_tool_loop.
WRITE_TOOL_NAMES = {t["name"] for t in WRITE_TOOLS}

logger = structlog.get_logger(__name__)

ToolExecutor = Callable[[str, dict], Awaitable[dict]]


def _format_history(messages: list) -> list[dict]:
    return [{"role": m.role, "content": m.content} for m in messages]


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
    attachments: list[bytes] | None = None,
) -> AsyncGenerator[str, None]:
    """Opens its own RLS session (instead of receiving the request's) because
    `StreamingResponse` keeps reading this generator after the endpoint's
    FastAPI dependency has already closed -- same pattern that
    `rls_session` uses for Celery tasks.

    `attachments`: PDFs already without a password (the router strips it before
    reaching here, see app/ai/pdf_utils.py) -- bank statements that the user
    attached in this turn from the same day-to-day chat (see
    STATEMENT_INSTRUCTIONS). They're sent to the model as `document` blocks in
    Anthropic's native shape (Claude passes them through as-is, no translation;
    Gemini translates them to Part.from_bytes in _build_contents)."""
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

            user_content: str | list[dict] = message
            if attachments:
                user_content = [{"type": "text", "text": message}] + [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": base64.b64encode(pdf_bytes).decode("ascii"),
                        },
                    }
                    for pdf_bytes in attachments
                ]
            messages = _format_history(history) + [{"role": "user", "content": user_content}]

            snapshot = await cache_service.get_financial_snapshot(redis, user_id)
            if not snapshot:
                snapshot = await _refresh_snapshot(session, redis, user_id)

            system = (
                SYSTEM_PROMPT
                + (f"\n\n{STATEMENT_INSTRUCTIONS}" if attachments else "")
                + f"\n\nFecha de hoy: {date.today().isoformat()}"
                + f"\n\nContexto financiero:\n{json.dumps(snapshot, default=str)}"
            )
            provider = get_ai_provider()

            async def execute(name: str, tool_input: dict) -> dict:
                nonlocal snapshot
                if name == PROPOSE_ACTION_NAME:
                    # Doesn't touch the database -- just confirms back to the
                    # model that the proposal got recorded in tool_calls
                    # (see frontend: Advisor.tsx detects it there and draws the
                    # card with the buttons, this alone doesn't execute anything).
                    return {"proposed": True, **tool_input}
                if name in WRITE_TOOL_NAMES:
                    result = await execute_write_tool(session, user_id, name, tool_input, role)
                    if "error" not in result:
                        # The snapshot captured in `system` was already sent, but
                        # the following read tools in this same turn
                        # (e.g. get_financial_summary after creating an
                        # expense) must see the fresh data.
                        snapshot = await _refresh_snapshot(session, redis, user_id)
                    return result
                return await execute_tool(session, redis, user_id, name, tool_input, snapshot)

            full_response = ""
            tool_calls_made: list[dict] = []
            async for kind, payload in _run_tool_loop(
                provider,
                messages,
                TOOLS + WRITE_TOOLS + [PROPOSE_ACTION_TOOL],
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
