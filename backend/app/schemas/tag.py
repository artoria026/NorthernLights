from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
MAX_TAGS_PER_TRANSACTION = 20
MAX_BULK_TRANSACTIONS = 500


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default="#6366F1", pattern=COLOR_PATTERN)


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)


class TagOut(BaseModel):
    id: UUID
    name: str
    color: str

    model_config = {"from_attributes": True}


class TagWithStats(TagOut):
    """What the tag has gathered so far: confirmed expenses only."""

    transaction_count: int = 0
    total_spent: Decimal = Decimal(0)
    first_date: date | None = None
    last_date: date | None = None


class TagCategoryTotal(BaseModel):
    category: str
    amount: Decimal
    count: int


class TagDayTotal(BaseModel):
    date: date
    amount: Decimal


class TagSummary(BaseModel):
    tag: TagOut
    date_from: date | None
    date_to: date | None
    transaction_count: int
    total_spent: Decimal
    average_per_transaction: Decimal
    first_date: date | None
    last_date: date | None
    by_category: list[TagCategoryTotal]
    by_day: list[TagDayTotal]


class BulkTagRequest(BaseModel):
    transaction_ids: list[UUID] = Field(min_length=1, max_length=MAX_BULK_TRANSACTIONS)
    add_tag_ids: list[UUID] = Field(default=[], max_length=MAX_TAGS_PER_TRANSACTION)
    remove_tag_ids: list[UUID] = Field(default=[], max_length=MAX_TAGS_PER_TRANSACTION)


class BulkTagResult(BaseModel):
    updated: int
