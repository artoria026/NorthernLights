import asyncio
import json
from collections.abc import AsyncGenerator

from anthropic import (
    AnthropicError,
    APIConnectionError,
    AsyncAnthropic,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    OverloadedError,
    PermissionDeniedError,
    RateLimitError,
)

from app.ai.base import AIProvider, AIProviderError
from app.ai.parsing import extract_json
from app.ai.prompts import (
    generate_insights_prompt,
    generate_report_insights_prompt,
    review_insight_prompt,
)
from app.core.config import settings


def _translate_error(exc: AnthropicError) -> AIProviderError:
    if isinstance(exc, APIConnectionError):
        return AIProviderError(
            "No se pudo conectar con el proveedor de IA (Claude). "
            "Revisa tu conexion e intenta de nuevo."
        )
    if isinstance(exc, RateLimitError):
        return AIProviderError(
            "Se alcanzo el limite de uso de la IA (Claude) por ahora. "
            "Intenta de nuevo en unos minutos."
        )
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return AIProviderError(
            "El asesor no esta disponible por un problema de configuracion "
            "(credenciales de Claude invalidas). Avisa al administrador.",
            retryable=False,
        )
    if isinstance(exc, (OverloadedError, InternalServerError)):
        return AIProviderError(
            "El proveedor de IA (Claude) esta sobrecargado en este momento. "
            "Intenta de nuevo en unos minutos."
        )
    if isinstance(exc, BadRequestError):
        return AIProviderError(
            f"La IA rechazo la solicitud ({exc.message}). "
            "Intenta reformular tu mensaje o revisa el archivo adjunto."
        )
    return AIProviderError(
        "El proveedor de IA (Claude) no pudo procesar la solicitud. Intenta de nuevo en un momento."
    )


class ClaudeProvider(AIProvider):
    def __init__(self):
        self._client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        def open_stream():
            return self._client.messages.stream(
                model=settings.CLAUDE_MODEL,
                max_tokens=settings.AI_MAX_TOKENS,
                system=system,
                messages=messages,
                tools=tools,
            )

        # One more retry, with a longer pause than the SDK does on its
        # own, for short overload spikes (529/500). Only
        # covers opening the connection (__aenter__) -- never mid-turn, to
        # avoid repeating text that's already been sent.
        stream_cm = open_stream()
        try:
            try:
                stream = await stream_cm.__aenter__()
            except (OverloadedError, InternalServerError):
                await asyncio.sleep(3)
                stream_cm = open_stream()
                stream = await stream_cm.__aenter__()

            try:
                current_tool: dict | None = None
                tool_json = ""
                async for event in stream:
                    is_tool_start = (
                        event.type == "content_block_start"
                        and event.content_block.type == "tool_use"
                    )
                    if is_tool_start:
                        current_tool = {
                            "id": event.content_block.id,
                            "name": event.content_block.name,
                        }
                        tool_json = ""
                    elif event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            yield {"type": "text", "text": event.delta.text}
                        elif event.delta.type == "input_json_delta":
                            tool_json += event.delta.partial_json
                    elif event.type == "content_block_stop" and current_tool is not None:
                        yield {
                            "type": "tool_use",
                            "id": current_tool["id"],
                            "name": current_tool["name"],
                            "input": json.loads(tool_json) if tool_json else {},
                        }
                        current_tool = None
                    elif event.type == "message_delta" and event.delta.stop_reason == "max_tokens":
                        yield {"type": "truncated"}
            finally:
                await stream_cm.__aexit__(None, None, None)
        except AnthropicError as e:
            raise _translate_error(e) from e

    async def generate_insights(self, snapshot: dict) -> list[dict]:
        prompt = generate_insights_prompt(snapshot)
        response = await self._client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=settings.AI_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        return extract_json(response.content[0].text)

    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        prompt = review_insight_prompt(insight, snapshot)
        response = await self._client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        return extract_json(response.content[0].text)

    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        prompt = generate_report_insights_prompt(summary, period_label)
        response = await self._client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=settings.AI_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        return extract_json(response.content[0].text)
