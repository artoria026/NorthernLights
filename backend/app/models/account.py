import uuid
from decimal import Decimal

from sqlalchemy import CHAR, CheckConstraint, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin

ACCOUNT_TYPES = ("asset", "liability", "income", "expense", "equity")
ACCOUNT_SUBTYPES = (
    "cash",
    "checking",
    "savings",
    "credit_card",
    "payroll_loan",
    "personal_loan",
    "store_credit",
    "informal_debt",
    "loan_payable",
    "loan_receivable",
    "installment",
    "civic",
)


class Account(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(f"type IN {ACCOUNT_TYPES}", name="ck_accounts_type"),
        CheckConstraint(f"subtype IN {ACCOUNT_SUBTYPES}", name="ck_accounts_subtype"),
        CheckConstraint(
            "billing_cycle_day IS NULL OR billing_cycle_day BETWEEN 1 AND 31",
            name="ck_accounts_billing_cycle_day",
        ),
        CheckConstraint(
            "payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31",
            name="ck_accounts_payment_due_day",
        ),
        Index(
            "idx_accounts_user_active",
            "user_id",
            postgresql_where="is_active = TRUE AND deleted_at IS NULL",
        ),
        Index(
            "idx_accounts_user_type",
            "user_id",
            "type",
            postgresql_where="is_active = TRUE AND deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    subtype: Mapped[str | None] = mapped_column(String, nullable=True)
    last_4_digits: Mapped[str | None] = mapped_column(CHAR(4), nullable=True)
    currency: Mapped[str] = mapped_column(String, default="MXN")
    color: Mapped[str] = mapped_column(String, default="#6366F1")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Logo subido por el usuario (el suyo, bajo su propio riesgo -- la app
    # nunca redistribuye logos de bancos reales). Se normaliza en el frontend
    # a un PNG 128x128 antes de subirlo, por eso Text basta sin montar storage.
    logo_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Balance: cache desnormalizado. Fuente de verdad = journal_lines.
    balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    initial_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)

    is_active: Mapped[bool] = mapped_column(default=True)
    # Cuenta contable interna (categorias income/expense, ledger de deudas
    # informales) que el motor de doble entrada resuelve/crea solo -- nunca
    # se le muestra al usuario. list_accounts() la excluye siempre.
    is_internal: Mapped[bool] = mapped_column(default=False)

    # Campos especificos de TDC (subtype=credit_card)
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    interest_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    billing_cycle_day: Mapped[int | None] = mapped_column(nullable=True)
    payment_due_day: Mapped[int | None] = mapped_column(nullable=True)

    # Sync offline (mobile, Fase 4)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
