from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from app.core.config import settings


class AIProviderError(Exception):
    """Error del proveedor de IA (Claude/Gemini) ya traducido a un mensaje
    listo para mostrarle al usuario. Cada AIProvider concreto atrapa las
    excepciones propias de su SDK (google-genai, anthropic) y las relanza
    como esta -- asi advisor.py nunca necesita conocer los tipos de
    excepcion concretos de cada SDK (mismo DIP que el resto de esta clase:
    solo conoce esta interfaz, no un proveedor especifico)."""

    def __init__(self, user_message: str, *, retryable: bool = True):
        super().__init__(user_message)
        self.user_message = user_message
        self.retryable = retryable


class AIProvider(ABC):
    """M10: abstraccion intercambiable (Claude/Gemini) usada por el chat (M10)
    y por la generacion/revision de insights (M13). Cambiar de proveedor (o
    agregar uno nuevo) es: una clase que implemente este contrato + una rama
    en get_ai_provider() -- app/ai/advisor.py nunca conoce el proveedor
    concreto, solo esta interfaz (DIP)."""

    @abstractmethod
    def chat_stream(
        self, messages: list[dict], tools: list[dict], system: str
    ) -> AsyncGenerator[dict, None]:
        """Chat conversacional con streaming. Cada item emitido es
        {'type': 'text', 'text': str}, {'type': 'tool_use', 'name': str,
        'input': dict, 'id': str, 'provider_state': Any | None}, o
        {'type': 'truncated'} si el proveedor corto la respuesta por llegar
        al limite de AI_MAX_TOKENS (finish_reason='MAX_TOKENS' en Gemini,
        stop_reason='max_tokens' en Claude) -- sin este chequeo, un corte asi
        no lanza excepcion y el llamador lo trataria como una respuesta
        completa y exitosa. Al terminar el stream, el llamador debe poder
        recuperar el mensaje final completo (ver ClaudeProvider).

        `provider_state` es un campo opaco: cada implementacion decide si lo
        usa y para que (ej. GeminiProvider guarda ahi su "thought signature"
        para poder re-enviarla en el siguiente turno). El orquestador
        (advisor.py) solo lo pasa de ida y vuelta sin interpretarlo -- asi
        ningun detalle especifico de un proveedor concreto se filtra al
        codigo compartido. ClaudeProvider simplemente no lo llena (None)."""

    @abstractmethod
    async def generate_insights(self, snapshot: dict) -> list[dict]:
        """Genera insights financieros desde un snapshot. Cada item:
        {'title', 'description', 'category', 'priority'}."""

    @abstractmethod
    async def review_insight(self, insight: dict, snapshot: dict) -> dict:
        """Evalua la evolucion de un insight activo. Retorna
        {'trend': 'improved'|'worsened'|'stable', 'ai_assessment': str}."""

    @abstractmethod
    async def generate_report_insights(self, summary: dict, period_label: str) -> list[dict]:
        """Genera puntos sobre un periodo YA CERRADO (mes o anio) a partir del
        `summary` de un Report (M15). A diferencia de `generate_insights`, cada
        item se etiqueta con 'flow_type' para poder filtrar por ingreso/gasto.
        Cada item: {'title', 'description', 'flow_type', 'category_name'}."""


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
