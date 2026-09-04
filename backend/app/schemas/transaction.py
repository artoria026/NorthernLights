from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.models.transaction import ENTRY_TYPES


class JournalLineIn(BaseModel):
    account_id: UUID
    amount: Decimal = Field(gt=0)
    type: str = Field(pattern="^(debit|credit)$")


class JournalLineOut(BaseModel):
    id: UUID
    account_id: UUID
    amount: Decimal
    type: str

    model_config = {"from_attributes": True}


class TransactionCreate(BaseModel):
    date: date_type
    description: str = Field(min_length=1)
    notes: str | None = None
    tags: list[str] = []
    entry_type: str = Field(pattern=f"^({'|'.join(ENTRY_TYPES)})$")
    category_id: UUID | None = None
    # Simple form (recommended for income/expense): the front never sees or
    # picks the category's internal ledger account, the backend resolves it
    # on its own -- see account_service.get_or_create_category_ledger_account.
    account_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    # Explicit form (required for transfer/loans, available for any
    # advanced use case): the caller builds the lines itself.
    lines: list[JournalLineIn] | None = None
    # Only for entry_type='expense' in simple form, paying with a credit
    # card: marks the purchase as interest-free installments -- see
    # transaction_service.create_transaction, which validates the account and
    # creates the InstallmentPlan. How many installments are paid and the
    # monthly amount are computed on the fly from this transaction, never
    # stored separately.
    installment_total: int | None = Field(default=None, ge=2)

    @model_validator(mode="after")
    def validate_shape(self) -> "TransactionCreate":
        if self.lines is not None:
            if len(self.lines) < 2:
                raise ValueError("lines requiere al menos 2 renglones")
            debits = sum(line.amount for line in self.lines if line.type == "debit")
            credits = sum(line.amount for line in self.lines if line.type == "credit")
            if debits != credits:
                raise ValueError(f"Debitos ({debits}) deben igualar creditos ({credits})")
        elif self.entry_type in ("income", "expense", "adjustment_in", "adjustment_out"):
            if self.account_id is None or self.amount is None:
                raise ValueError("account_id y amount son requeridos sin 'lines'")
        else:
            raise ValueError(f"entry_type='{self.entry_type}' requiere 'lines' explicitas")

        if self.installment_total is not None and (
            self.entry_type != "expense" or self.account_id is None
        ):
            raise ValueError(
                "installment_total solo aplica a entry_type='expense' en forma simple "
                "(account_id/amount, no 'lines')"
            )
        return self


class TransactionUpdate(BaseModel):
    date: date_type | None = None
    description: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    category_id: UUID | None = None
    # Simple form (expense/income): same as in TransactionCreate, the front
    # never sees or picks the category's internal ledger account -- see
    # transaction_service.update_transaction, which resolves it on its own.
    account_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    # Explicit form (required for transfer): same as in create.
    lines: list[JournalLineIn] | None = None


class InstallmentInfo(BaseModel):
    total_installments: int
    paid_installments: int
    monthly_amount: Decimal


class TransactionOut(BaseModel):
    id: UUID
    date: date_type
    description: str
    notes: str | None
    tags: list[str] | None
    amount: Decimal | None
    entry_type: str
    category_id: UUID | None
    category_name: str | None = None
    status: str
    is_recurring: bool
    created_at: datetime
    lines: list[JournalLineOut] = []
    installment: InstallmentInfo | None = None

    model_config = {"from_attributes": True}


class SplitDebtor(BaseModel):
    # Resolved/created on its own in Debts (direction=owed_to_me) by name,
    # same as a direct loan -- the front never picks an account for this.
    person_name: str = Field(min_length=1, max_length=120)
    amount: Decimal = Field(gt=0)


class SplitExpenseCreate(BaseModel):
    date: date_type
    description: str = Field(min_length=1)
    notes: str | None = None
    category_id: UUID
    paying_account_id: UUID  # account that absorbs the full charge (bank/credit card)
    my_share: Decimal = Field(gt=0)
    debtors: list[SplitDebtor] = Field(min_length=1)
