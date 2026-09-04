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

# Without thinking_config, gemini-flash-latest thinks with an
# "automatic" budget (thinking_budget unset == -1) -- that internal thinking
# comes out of the SAME pool as max_output_tokens, not a separate one. On a
# heavy turn (e.g. extracting several rows from a PDF bank statement, see
# STATEMENT_INSTRUCTIONS in advisor.py) the model can spend ALL of
# AI_MAX_TOKENS thinking and end up with finish_reason=MAX_TOKENS without having
# written a single visible word or a tool_call -- a silent truncation,
# indistinguishable in the chat from "nothing happened". Capping the thinking
# budget guarantees the rest for the actual output.
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
    """Translates the generic format (shared with ClaudeProvider, see
    advisor.py) into `types.Content`. Gemini only knows the 'user'/'model' roles
    and has no 'tool' role: tool results are sent as
    Content(role='user', parts=[Part.from_function_response(...)]).

    The `tool_result` blocks from advisor.py only carry `tool_use_id`, not the
    tool name -- we recover it from the matching `tool_use` we already
    saw earlier in the same history."""
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
                    # Anthropic's native shape (advisor.py builds it this way so
                    # that Claude doesn't need translation) -- here it does
                    # need converting to Gemini's Part. Without this branch, an
                    # attachment would be silently ignored (the for loop above has
                    # no `else`).
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
            # google-genai already retries internally (tenacity) before
            # giving up -- this is ONE more retry, with a longer pause,
            # specific to short demand spikes ("Spikes in
            # demand are usually temporary" is the literal 503 message).
            # Only applies BEFORE any chunk arrives (opening the
            # stream), never mid-turn, to avoid repeating text already
            # sent.
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
                # finish_reason comes in the final chunk, which sometimes has no
                # `content` (that's why this check goes BEFORE the `continue`
                # below -- if it were after, an empty chunk with only the
                # finish_reason would get skipped without anyone ever checking it).
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
                            # See AIProvider.chat_stream docstring: opaque
                            # field, specific to Gemini, that the orchestrator
                            # just forwards without interpreting it.
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
