from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ChatMessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    tool_calls: list[dict[str, Any]] | None
    ai_provider: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AiUsageOut(BaseModel):
    used_today: int
    remaining_today: int
    limit_per_day: int
    unlimited: bool = False
