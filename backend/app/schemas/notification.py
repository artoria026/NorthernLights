from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: UUID
    title: str
    body: str | None
    type: str
    is_read: bool
    read_at: datetime | None
    action_url: str | None
    related_entity_type: str | None
    related_entity_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCount(BaseModel):
    unread_count: int
