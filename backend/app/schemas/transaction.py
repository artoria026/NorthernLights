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
    # Forma simple (recomendada para income/expense): el front nunca ve ni
    # elige la cuenta contable interna de la categoria, el backend la resuelve
    # solo -- ver account_service.get_or_create_category_ledger_account.
    account_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    # Forma explicita (requerida para transfer/prestamos, disponible para
    # cualquier caso de uso avanzado): el caller arma los renglones el mismo.
    lines: list[JournalLineIn] | None = None

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
        return self


class TransactionUpdate(BaseModel):
    date: date_type | None = None
    description: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    category_id: UUID | None = None
    # Forma simple (expense/income): igual que en TransactionCreate, el front
    # nunca ve ni elige la cuenta contable interna de la categoria -- ver
    # transaction_service.update_transaction, que la resuelve el mismo.
    account_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    # Forma explicita (requerida para transfer): igual que en create.
    lines: list[JournalLineIn] | None = None


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

    model_config = {"from_attributes": True}


class SplitDebtor(BaseModel):
    # Se resuelve/crea sola en Deudas (direction=owed_to_me) por nombre, igual
    # que un prestamo directo -- el front nunca elige una cuenta para esto.
    person_name: str = Field(min_length=1, max_length=120)
    amount: Decimal = Field(gt=0)


class SplitExpenseCreate(BaseModel):
    date: date_type
    description: str = Field(min_length=1)
    notes: str | None = None
    category_id: UUID
    paying_account_id: UUID  # cuenta que absorbe el cargo completo (banco/TDC)
    my_share: Decimal = Field(gt=0)
    debtors: list[SplitDebtor] = Field(min_length=1)
