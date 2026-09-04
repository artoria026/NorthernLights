from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from app.core.config import settings


class AIProviderError(Exception):
    """AI provider (Claude/Gemini) error already translated into a message
    ready to show the user. Each concrete AIProvider catches its own
    SDK's exceptions (google-genai, anthropic) and re-raises them
    as this one -- so advisor.py never needs to know the concrete
    exception types of each SDK (same DIP as the rest of this class:
    it only knows this interface, not a specific provider)."""

    def __init__(self, user_message: str, *, retryable: bool = True):
        super().__init__(user_message)
        self.user_message = user_message
        self.retryable = retryable


class AIProvider(ABC):
    """M10: interchangeable abstraction (Claude/Gemini) used by chat (M10)
    and by insight generation/review (M13). Switching provider (or
    adding a new one) is: a class implementing this contract + a branch
    in get_ai_provider() -- app/ai/advisor.py never knows the concrete
    provider, only this interface (DIP)."""

    @abstractmethod
    def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        """Conversational chat with streaming. Each emitted item is
        {'type': 'text', 'text': str}, {'type': 'tool_use', 'name': str,
        'input': dict, 'id': str, 'provider_state': Any | None}, or
        {'type': 'truncated'} if the provider cut the response short by hitting
        the AI_MAX_TOKENS limit (finish_reason='MAX_TOKENS' in Gemini,
        stop_reason='max_tokens' in Claude) -- without this check, such a cutoff
        doesn't raise an exception and the caller would treat it as a
        complete, successful response. When the stream ends, the caller must be able
        to recover the full final message (see ClaudeProvider).

        `provider_state` is an opaque field: each implementation decides whether it
        uses it and for what (e.g. GeminiProvider stores its "thought signature"
        there so it can resend it on the next turn). The orchestrator
        (advisor.py) just passes it back and forth without interpreting it -- that way
        no provider-specific detail leaks into the shared
        code. ClaudeProvider simply leaves it empty (None)."""

    @abstractmethod
    async def generate_insights(self, snapshot: dict) -> list[dict]:
        """Generates financial insights from a snapshot. Each item:
        {'title', 'description', 'category', 'priority'}."""

    @abstractmethod
    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        """Evaluates the evolution of an active insight. Returns
        {'trend': 'improved'|'worsened'|'stable', 'ai_assessment': str}."""

    @abstractmethod
    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        """Generates points about an ALREADY CLOSED period (month or year) from a
        Report's (M15) `summary`. Unlike `generate_insights`, each
        item is tagged with 'flow_type' so it can be filtered by income/expense.
        Each item: {'title', 'description', 'flow_type', 'category_name'}."""


def get_ai_provider() -> AIProvider:
    match settings.AI_PROVIDER:
        case "claude":
            from app.ai.claude import ClaudeProvider

            return ClaudeProvider()
        case "gemini":
            from app.ai.gemini import GeminiProvider

            return GeminiProvider()
        case _:
            raise ValueError(f"Unknown AI provider: {settings.AI_PROVIDER}")
