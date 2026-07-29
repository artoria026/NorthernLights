import asyncio
import base64
from collections.abc import AsyncGenerator

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.ai.base import AIProvider, AIProviderError
from app.ai.parsing import extract_json
from app.ai.prompts import (
    generate_insights_prompt,
    generate_report_insights_prompt,
    review_insight_prompt,
)
from app.core.config import settings

# Sin thinking_config, gemini-flash-latest piensa con presupuesto
# "automatico" (thinking_budget sin setear == -1) -- ese pensamiento interno
# sale del MISMO pool que max_output_tokens, no de uno aparte. En un turno
# pesado (ej. extraer varias filas de un estado de cuenta en PDF, ver
# STATEMENT_INSTRUCTIONS en advisor.py) el modelo puede gastar TODO
# AI_MAX_TOKENS pensando y terminar con finish_reason=MAX_TOKENS sin haber
# escrito una sola palabra visible ni un tool_call -- un truncado silencioso,
# indistinguible en el chat de "no paso nada". Topar el presupuesto de
# pensamiento deja el resto garantizado para el output real.
THINKING_BUDGET_TOKENS = 1024


def _translate_error(exc: genai_errors.APIError) -> AIProviderError:
    if exc.code == 429:
        return AIProviderError(
            "Se alcanzo el limite de uso de la IA (Gemini) por ahora. "
            "Intenta de nuevo en unos minutos."
        )
    if exc.code in (401, 403):
        return AIProviderError(
            "El asesor no esta disponible por un problema de configuracion "
            "(credenciales de Gemini invalidas). Avisa al administrador.",
            retryable=False,
        )
    if exc.code and exc.code >= 500:
        return AIProviderError(
            "El proveedor de IA (Gemini) no esta disponible en este momento. "
            "Intenta de nuevo en unos minutos."
        )
    return AIProviderError(
        f"La IA rechazo la solicitud ({exc.message or 'motivo desconocido'}). "
        "Intenta reformular tu mensaje o revisa el archivo adjunto."
    )


def _build_tools(tools: list[dict]) -> list[types.Tool]:
    declarations = [
        types.FunctionDeclaration(
            name=tool["name"],
            description=tool["description"],
            parameters_json_schema=tool["input_schema"],
        )
        for tool in tools
    ]
    return [types.Tool(function_declarations=declarations)]


def _build_contents(messages: list[dict]) -> list[types.Content]:
    """Traduce el formato generico (compartido con ClaudeProvider, ver
    advisor.py) a `types.Content`. Gemini solo conoce los roles 'user'/'model'
    y no tiene un rol 'tool': los resultados de tools se mandan como
    Content(role='user', parts=[Part.from_function_response(...)]).

    Los bloques `tool_result` de advisor.py solo traen `tool_use_id`, no el
    nombre de la tool -- lo recuperamos del `tool_use` correspondiente que ya
    vimos antes en el mismo historial."""
    tool_name_by_id: dict[str, str] = {}
    for message in messages:
        if message["role"] != "assistant" or not isinstance(message["content"], list):
            continue
        for block in message["content"]:
            if block.get("type") == "tool_use":
                tool_name_by_id[block["id"]] = block["name"]

    contents = []
    for message in messages:
        role = "model" if message["role"] == "assistant" else "user"
        content = message["content"]
        parts: list[types.Part] = []

        if isinstance(content, str):
            parts.append(types.Part.from_text(text=content))
        else:
            for block in content:
                if block["type"] == "text":
                    parts.append(types.Part.from_text(text=block["text"]))
                elif block["type"] == "tool_use":
                    parts.append(
                        types.Part(
                            function_call=types.FunctionCall(
                                name=block["name"], args=block["input"]
                            ),
                            thought_signature=block.get("provider_state"),
                        )
                    )
                elif block["type"] == "tool_result":
                    name = tool_name_by_id.get(block["tool_use_id"], "unknown_tool")
                    parts.append(
                        types.Part.from_function_response(
                            name=name, response={"result": block["content"]}
                        )
                    )
                elif block["type"] == "document":
                    # Shape nativo de Anthropic (advisor.py lo arma asi para
                    # que Claude no necesite traduccion) -- aqui si hay que
                    # convertirlo al Part de Gemini. Sin esta rama, un
                    # adjunto se ignoraria en silencio (el for de arriba no
                    # tiene `else`).
                    source = block["source"]
                    parts.append(
                        types.Part.from_bytes(
                            data=base64.b64decode(source["data"]),
                            mime_type=source["media_type"],
                        )
                    )
        contents.append(types.Content(role=role, parts=parts))
    return contents


class GeminiProvider(AIProvider):
    def __init__(self):
        self._client = genai.Client(api_key=settings.GOOGLE_AI_API_KEY)

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        contents = _build_contents(messages)
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=_build_tools(tools),
            max_output_tokens=settings.AI_MAX_TOKENS,
            thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET_TOKENS),
        )
        try:
            # google-genai ya reintenta internamente (tenacity) antes de
            # rendirse -- esto es UN reintento mas, con una pausa mas larga,
            # especifico para picos de demanda de pocos segundos ("Spikes in
            # demand are usually temporary" es el mensaje literal del 503).
            # Solo aplica ANTES de que llegue ningun chunk (abrir el
            # stream), nunca a medio turno, para no repetir texto ya
            # mandado.
            try:
                stream = await self._client.aio.models.generate_content_stream(
                    model=settings.GEMINI_MODEL, contents=contents, config=config
                )
            except genai_errors.ServerError:
                await asyncio.sleep(3)
                stream = await self._client.aio.models.generate_content_stream(
                    model=settings.GEMINI_MODEL, contents=contents, config=config
                )
            async for chunk in stream:
                if not chunk.candidates:
                    continue
                candidate = chunk.candidates[0]
                # finish_reason viene en el chunk final, que a veces no trae
                # `content` (por eso este chequeo va ANTES del `continue` de
                # abajo -- si estuviera despues, un chunk vacio con solo el
                # finish_reason se saltaria sin que nadie lo revisara nunca).
                finish_reason = getattr(candidate, "finish_reason", None)
                if (
                    finish_reason is not None
                    and getattr(finish_reason, "name", str(finish_reason)) == "MAX_TOKENS"
                ):
                    yield {"type": "truncated"}
                content = candidate.content
                if content is None or not content.parts:
                    continue
                for part in content.parts:
                    if part.text:
                        yield {"type": "text", "text": part.text}
                    elif part.function_call:
                        call_id = part.function_call.id or part.function_call.name
                        yield {
                            "type": "tool_use",
                            "id": call_id,
                            "name": part.function_call.name,
                            "input": dict(part.function_call.args or {}),
                            # Ver docstring de AIProvider.chat_stream: campo
                            # opaco, especifico de Gemini, que el orquestador
                            # solo reenvia sin interpretarlo.
                            "provider_state": part.thought_signature,
                        }
        except genai_errors.APIError as e:
            raise _translate_error(e) from e

    async def generate_insights(self, snapshot: dict) -> list[dict]:
        prompt = generate_insights_prompt(snapshot)
        response = await self._client.aio.models.generate_content(
            model=settings.GEMINI_MODEL, contents=prompt
        )
        return extract_json(response.text)

    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        prompt = review_insight_prompt(insight, snapshot)
        response = await self._client.aio.models.generate_content(
            model=settings.GEMINI_MODEL, contents=prompt
        )
        return extract_json(response.text)

    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        prompt = generate_report_insights_prompt(summary, period_label)
        response = await self._client.aio.models.generate_content(
            model=settings.GEMINI_MODEL, contents=prompt
        )
        return extract_json(response.text)
