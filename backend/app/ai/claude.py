import asyncio
import json
from collections.abc import AsyncGenerator

from anthropic import AsyncAnthropic, InternalServerError, OverloadedError

from app.ai.base import AIProvider
from app.ai.parsing import extract_json
from app.ai.prompts import (
    generate_insights_prompt,
    generate_report_insights_prompt,
    review_insight_prompt,
)
from app.core.config import settings


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

        # Un reintento mas, con una pausa mas larga que la que hace el SDK
        # solo, para picos de sobrecarga de pocos segundos (529/500). Solo
        # cubre abrir la conexion (__aenter__) -- nunca a medio turno, para
        # no repetir texto que ya se haya mandado.
        stream_cm = open_stream()
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
                if event.type == "content_block_start" and event.content_block.type == "tool_use":
                    current_tool = {"id": event.content_block.id, "name": event.content_block.name}
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
