from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.debt import DEBT_DIRECTIONS, DEBT_TYPES, PAYMENT_FREQUENCIES


class UnplannedDebtCreate(BaseModel):
    name: str = Field(min_length=1)
    creditor: str | None = None
    amount: Decimal = Field(gt=0)
    direction: str = Field(default="owed_by_me", pattern=f"^({'|'.join(DEBT_DIRECTIONS)})$")
    notes: str | None = None


class UnplannedDebtUpdate(BaseModel):
    name: str | None = None
    creditor: str | None = None
    amount: Decimal | None = None
    notes: str | None = None


class UnplannedDebtOut(BaseModel):
    id: UUID
    name: str
    creditor: str | None
    amount: Decimal
    direction: str
    notes: str | None
    status: str
    converted_to_debt_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DebtActivationRequest(BaseModel):
    agreed_amount: Decimal | None = None
    payment_amount: Decimal = Field(gt=0)
    payment_frequency: str = Field(pattern=f"^({'|'.join(PAYMENT_FREQUENCIES)})$")
    payment_day: int | None = Field(default=None, ge=0, le=31)
    total_installments: int | None = None
    linked_account_id: UUID | None = None
    # Real account where the cash for this loan already came in/out (if
    # applicable) -- the transaction is recorded exactly once, here, never
    # on the unplanned debt (that one never touches balances by design).
    funding_account_id: UUID | None = None
    # Account that each periodic payment comes from/goes to. Without this,
    # the debt stays in a 100% manual flow -- with it, debts.process_due_payments
    # generates the draft only when it's due.
    payment_source_account_id: UUID | None = None
    start_date: date_type
    due_date: date_type | None = None


class DebtCreate(BaseModel):
    name: str = Field(min_length=1)
    creditor: str | None = None
    type: str = Field(pattern=f"^({'|'.join(DEBT_TYPES)})$")
    direction: str = Field(default="owed_by_me", pattern=f"^({'|'.join(DEBT_DIRECTIONS)})$")

    original_amount: Decimal | None = None
    agreed_amount: Decimal | None = None
    total_amount: Decimal = Field(gt=0)
    current_balance: Decimal | None = None  # default = total_amount if not specified

    interest_rate: Decimal = Decimal("0")
    payment_amount: Decimal | None = None
    payment_frequency: str | None = Field(
        default=None, pattern=f"^({'|'.join(PAYMENT_FREQUENCIES)})$"
    )
    payment_day: int | None = Field(default=None, ge=0, le=31)
    total_installments: int | None = None

    linked_account_id: UUID | None = None
    # Real account where the cash came in/out when this debt originated
    # (e.g. your bank account when someone lends to you, or the one it
    # leaves from when you lend). Optional: a debt you already had before
    # using the app doesn't need this.
    funding_account_id: UUID | None = None
    # Account that each periodic payment comes from/goes to. Without this,
    # the debt stays in a 100% manual flow -- with it, debts.process_due_payments
    # generates the draft only when it's due.
    payment_source_account_id: UUID | None = None
    start_date: date_type | None = None
    estimated_end_date: date_type | None = None
    next_payment_date: date_type | None = None
    due_date: date_type | None = None

    is_shared: bool = False
    responsible_party: str | None = None
    notes: str | None = None


class DebtUpdate(BaseModel):
    name: str | None = None
    payment_amount: Decimal | None = None
    payment_frequency: str | None = Field(
        default=None, pattern=f"^({'|'.join(PAYMENT_FREQUENCIES)})$"
    )
    payment_day: int | None = None
    next_payment_date: date_type | None = None
    linked_account_id: UUID | None = None
    payment_source_account_id: UUID | None = None
    notes: str | None = None
    # Manual correction of the outstanding balance -- there's no separate
    # "initial_balance" like in Account, current_balance IS the single
    # source of truth for a debt's balance, so this is a direct adjustment
    # (not a delta). Meant to fix the balance after a historical backfill
    # of old payments/transactions.
    current_balance: Decimal | None = Field(default=None, ge=0)


class DebtOut(BaseModel):
    id: UUID
    unplanned_debt_id: UUID | None
    name: str
    creditor: str | None
    type: str
    direction: str
    original_amount: Decimal | None
    agreed_amount: Decimal | None
    total_amount: Decimal
    current_balance: Decimal
    interest_rate: Decimal
    payment_amount: Decimal | None
    payment_frequency: str | None
    payment_day: int | None
    total_installments: int | None
    paid_installments: int
    status: str
    linked_account_id: UUID | None
    payment_source_account_id: UUID | None
    start_date: date_type | None
    estimated_end_date: date_type | None
    next_payment_date: date_type | None
    due_date: date_type | None
    is_shared: bool
    responsible_party: str | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DebtPaymentCreate(BaseModel):
    account_id: UUID  # account the money comes from (bank/cash)
    amount: Decimal = Field(gt=0)
    date: date_type
    notes: str | None = None


class DebtPaymentOut(BaseModel):
    id: UUID
    debt_id: UUID
    amount: Decimal
    date: date_type
    payment_number: int | None
    journal_entry_id: UUID | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DebtScheduleItem(BaseModel):
    installment_number: int
    due_date: date_type
    amount: Decimal
    remaining_balance: Decimal


class DebtSimulateRequest(BaseModel):
    payment_amount: Decimal = Field(gt=0)
    payment_frequency: str = Field(pattern=f"^({'|'.join(PAYMENT_FREQUENCIES)})$")
    duration_months: int | None = None


class DebtSimulateResponse(BaseModel):
    current_monthly_committed: Decimal
    new_monthly_committed: Decimal
    delta: Decimal
    note: str = (
        "Impacto calculado solo sobre compromisos de deuda activos; no incorpora tu "
        "presupuesto por categoria ni tus gastos recurrentes, asi que no es un calculo "
        "completo de margen disponible."
    )


class DebtSummary(BaseModel):
    total_owed_by_me: Decimal
    total_owed_to_me: Decimal
    monthly_committed: Decimal
    active_count: int
    unplanned_owed_by_me: Decimal
    unplanned_owed_to_me: Decimal
