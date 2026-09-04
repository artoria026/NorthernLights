from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.account import ACCOUNT_SUBTYPES, ACCOUNT_TYPES
from app.schemas.common import IMAGE_DATA_URL_MAX_LENGTH, IMAGE_DATA_URL_PATTERN
from app.schemas.transaction import TransactionOut


class AccountCreate(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(pattern=f"^({'|'.join(ACCOUNT_TYPES)})$")
    subtype: str | None = Field(default=None, pattern=f"^({'|'.join(ACCOUNT_SUBTYPES)})$")
    last_4_digits: str | None = Field(default=None, min_length=4, max_length=4)
    currency: str = "MXN"
    color: str = "#6366F1"
    notes: str | None = None
    logo_data_url: str | None = Field(
        default=None, max_length=IMAGE_DATA_URL_MAX_LENGTH, pattern=IMAGE_DATA_URL_PATTERN
    )
    initial_balance: Decimal = Decimal(0)
    credit_limit: Decimal | None = None
    interest_rate: Decimal | None = None
    billing_cycle_day: int | None = Field(default=None, ge=1, le=31)
    payment_due_day: int | None = Field(default=None, ge=1, le=31)


class AccountUpdate(BaseModel):
    name: str | None = None
    last_4_digits: str | None = Field(default=None, min_length=4, max_length=4)
    currency: str | None = None
    color: str | None = None
    notes: str | None = None
    logo_data_url: str | None = Field(
        default=None, max_length=IMAGE_DATA_URL_MAX_LENGTH, pattern=IMAGE_DATA_URL_PATTERN
    )
    # Editable even if transactions already exist -- update_account adjusts
    # `balance` by the same delta to avoid breaking the invariant
    # balance = initial_balance + sum of confirmed deltas. The front must
    # warn/confirm before sending this if the account already has
    # transactions (see Accounts.tsx), the backend doesn't block it.
    initial_balance: Decimal | None = None
    credit_limit: Decimal | None = None
    interest_rate: Decimal | None = None
    billing_cycle_day: int | None = Field(default=None, ge=1, le=31)
    payment_due_day: int | None = Field(default=None, ge=1, le=31)


class AccountOut(BaseModel):
    id: UUID
    name: str
    type: str
    subtype: str | None
    last_4_digits: str | None
    currency: str
    color: str
    notes: str | None
    logo_data_url: str | None
    balance: Decimal
    initial_balance: Decimal
    is_active: bool
    credit_limit: Decimal | None
    interest_rate: Decimal | None
    billing_cycle_day: int | None
    payment_due_day: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AccountSummary(BaseModel):
    total_assets: Decimal
    total_liabilities: Decimal
    net_worth: Decimal


class AccountReconcileRequest(BaseModel):
    real_balance: Decimal
    date: date_type | None = None
    notes: str | None = None


class AccountReconcileResult(BaseModel):
    adjusted: bool
    previous_balance: Decimal
    new_balance: Decimal
    delta: Decimal
    transaction: TransactionOut | None = None


class TdcCycle(BaseModel):
    statement_balance: Decimal
    current_cycle_balance: Decimal
    total_balance: Decimal
    available_credit: Decimal | None
    payment_due_date: date_type | None
    days_until_due: int | None
    billing_cycle_day: int | None
    payment_due_day: int | None
