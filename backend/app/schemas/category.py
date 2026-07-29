from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(pattern="^(income|expense)$")
    icon: str | None = None
    color: str = "#6366F1"
    parent_id: UUID | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    color: str | None = None


class CategoryOut(BaseModel):
    id: UUID
    user_id: UUID | None
    name: str
    type: str
    icon: str | None
    color: str
    is_system: bool
    is_active: bool
    sort_order: int
    parent_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CategorySummaryItem(BaseModel):
    category_id: UUID
    total: Decimal
