from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.recurring import ALERT_URGENCIES, FREQUENCIES, ITEM_TYPES


class RecurringItemCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    item_type: str = Field(pattern=f"^({'|'.join(ITEM_TYPES)})$")

    amount: Decimal = Field(gt=0)
    frequency: str = Field(pattern=f"^({'|'.join(FREQUENCIES)})$")
    frequency_day: int | None = Field(default=None, ge=0, le=31)

    account_id: UUID
    category_id: UUID

    alert_urgency: str | None = Field(default=None, pattern=f"^({'|'.join(ALERT_URGENCIES)})$")
    auto_generate: bool = True
    next_date: date_type

    notes: str | None = None
    url: str | None = None


class RecurringItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    frequency: str | None = Field(default=None, pattern=f"^({'|'.join(FREQUENCIES)})$")
    frequency_day: int | None = Field(default=None, ge=0, le=31)
    account_id: UUID | None = None
    category_id: UUID | None = None
    alert_urgency: str | None = Field(default=None, pattern=f"^({'|'.join(ALERT_URGENCIES)})$")
    auto_generate: bool | None = None
    next_date: date_type | None = None
    notes: str | None = None
    url: str | None = None


class RecurringItemOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    item_type: str
    amount: Decimal
    frequency: str
    frequency_day: int | None
    account_id: UUID
    contra_account_id: UUID
    category_id: UUID
    status: str
    cancelled_at: date_type | None
    alert_urgency: str
    auto_generate: bool
    last_generated_at: datetime | None
    next_date: date_type
    notes: str | None
    url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecurringSummaryCategory(BaseModel):
    category_id: UUID
    category_name: str
    monthly_total: Decimal


class RecurringSummary(BaseModel):
    total_monthly: Decimal
    by_category: list[RecurringSummaryCategory]
