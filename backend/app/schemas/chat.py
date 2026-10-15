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


class ProposalItemOut(BaseModel):
    action: str
    # [{"key": "amount", "value": "530"}]: raw values under stable keys; the app
    # translates the labels and formats money/dates itself.
    fields: list[dict[str, str]]


class ProposalOut(BaseModel):
    id: UUID
    status: str
    summary: str
    items: list[ProposalItemOut]
    error: str | None
    created_at: datetime
    resolved_at: datetime | None
