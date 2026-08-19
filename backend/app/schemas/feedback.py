from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    type: str = Field(pattern="^(bug|feature)$")
    message: str = Field(min_length=3, max_length=2000)


class FeedbackOut(BaseModel):
    id: UUID
    type: str
    message: str
    status: str
    admin_note: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FeedbackAdminOut(FeedbackOut):
    user_id: UUID
    user_name: str
    user_email: str
    updated_at: datetime


class FeedbackStatusUpdate(BaseModel):
    status: str = Field(pattern="^(new|read|considered|discarded)$")
    admin_note: str | None = Field(default=None, max_length=2000)
