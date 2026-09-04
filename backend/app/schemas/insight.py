from datetime import date as date_type
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.insight import INSIGHT_CATEGORIES, INSIGHT_PRIORITIES


class InsightCreateFromChat(BaseModel):
    """Payload for the `create_insight` tool from M10."""

    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    category: str = Field(pattern=f"^({'|'.join(INSIGHT_CATEGORIES)})$")
    priority: str = Field(default="medium", pattern=f"^({'|'.join(INSIGHT_PRIORITIES)})$")


class InsightOut(BaseModel):
    id: UUID
    title: str
    description: str
    category: str
    priority: str
    generated_by: str
    ai_provider: str
    metrics_at_creation: dict[str, Any]
    metrics_at_last_review: dict[str, Any] | None
    status: str
    review_frequency: str
    next_review_at: date_type
    last_reviewed_at: datetime | None
    review_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class InsightReviewOut(BaseModel):
    id: UUID
    reviewed_at: datetime
    metrics: dict[str, Any]
    trend: str
    ai_assessment: str
    next_review_at: date_type

    model_config = {"from_attributes": True}
