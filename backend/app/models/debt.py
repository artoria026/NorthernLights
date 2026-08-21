import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin

DEBT_TYPES = (
    "personal_loan",
    "payroll_loan",
    "informal",
    "civic",
    "loan_received",
)
DEBT_STATUSES = ("active", "completed", "negotiating")
PAYMENT_FREQUENCIES = ("weekly", "biweekly", "monthly", "irregular")
UNPLANNED_STATUSES = ("pending", "converted")
# owed_by_me: dinero que YO debo (Mireya, el banco, mi abuelo). owed_to_me:
# dinero que ME deben (le preste a alguien) -- mismo modelo, misma UI de
# "sin plan"/plan completo, solo cambia quien le debe a quien. Sustituye al
# viejo esquema de cuentas 'loan_receivable' en Accounts (ver migracion
# que agrega esta columna).
DEBT_DIRECTIONS = ("owed_by_me", "owed_to_me")


class UnplannedDebt(Base, TimestampMixin, SoftDeleteMixin):
    """Deuda que existe pero sin plan de pago activo: solo recordatorio.

    No afecta balances, presupuesto ni alertas. Puede migrar a `Debt` via
    activate_unplanned_debt() cuando el usuario negocia un plan.
    """

    __tablename__ = "unplanned_debts"
    __table_args__ = (
        CheckConstraint(f"status IN {UNPLANNED_STATUSES}", name="ck_unplanned_debts_status"),
        CheckConstraint(f"direction IN {DEBT_DIRECTIONS}", name="ck_unplanned_debts_direction"),
        Index(
            "idx_unplanned_debts_user",
            "user_id",
            postgresql_where="status = 'pending' AND deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    creditor: Mapped[str | None] = mapped_column(String, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False, default="owed_by_me")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    # FK a debts declarada aqui (nombre de tabla como string); en la migracion
    # se agrega con ALTER TABLE una vez que `debts` ya existe (referencia circular).
    converted_to_debt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("debts.id"), nullable=True
    )


class Debt(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "debts"
    __table_args__ = (
        CheckConstraint(f"type IN {DEBT_TYPES}", name="ck_debts_type"),
        CheckConstraint(f"status IN {DEBT_STATUSES}", name="ck_debts_status"),
        CheckConstraint(f"direction IN {DEBT_DIRECTIONS}", name="ck_debts_direction"),
        CheckConstraint(
            f"payment_frequency IS NULL OR payment_frequency IN {PAYMENT_FREQUENCIES}",
            name="ck_debts_payment_frequency",
        ),
        Index("idx_debts_user_status", "user_id", "status", postgresql_where="deleted_at IS NULL"),
        Index(
            "idx_debts_upcoming",
            "user_id",
            "next_payment_date",
            postgresql_where=(
                "status = 'active' AND next_payment_date IS NOT NULL AND deleted_at IS NULL"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    unplanned_debt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("unplanned_debts.id"), nullable=True
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    creditor: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False, default="owed_by_me")

    original_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    agreed_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    interest_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0"))
    payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    payment_frequency: Mapped[str | None] = mapped_column(String, nullable=True)
    payment_day: Mapped[int | None] = mapped_column(nullable=True)
    total_installments: Mapped[int | None] = mapped_column(nullable=True)
    paid_installments: Mapped[int] = mapped_column(default=0)

    status: Mapped[str] = mapped_column(String, nullable=False, default="active")

    linked_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=True
    )
    # Cuenta real de la que sale/entra cada pago periodico -- distinta de
    # linked_account_id (esa es "la deuda es esta cuenta", p.ej. la TDC de
    # una MSI). Sin esto no hay de donde generar el pago automatico: solo
    # las deudas con este campo entran a debts.process_due_payments.
    payment_source_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=True
    )

    start_date: Mapped[date_type | None] = mapped_column(nullable=True)
    estimated_end_date: Mapped[date_type | None] = mapped_column(nullable=True)
    next_payment_date: Mapped[date_type | None] = mapped_column(nullable=True)
    due_date: Mapped[date_type | None] = mapped_column(nullable=True)

    is_shared: Mapped[bool] = mapped_column(default=False)
    responsible_party: Mapped[str | None] = mapped_column(String, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    payments: Mapped[list["DebtPayment"]] = relationship(
        back_populates="debt", cascade="all, delete-orphan"
    )


class DebtPayment(Base):
    __tablename__ = "debt_payments"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_debt_payments_amount_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    debt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("debts.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    date: Mapped[date_type] = mapped_column(nullable=False)
    payment_number: Mapped[int | None] = mapped_column(nullable=True)
    journal_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("journal_entries.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    debt: Mapped["Debt"] = relationship(back_populates="payments")


class InstallmentPlan(Base, TimestampMixin):
    """Metadata de una compra a meses sin intereses (MSI) hecha con una TDC.

    1:1 con el journal_entry que representa la compra real -- no duplica su
    monto ni su fecha. `monthly_amount` y en que cuota va se calculan al
    vuelo a partir de esa transaccion (ver transaction_service), nunca se
    guardan aqui, para que nunca puedan desincronizarse de ella.
    """

    __tablename__ = "installment_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("journal_entries.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    total_installments: Mapped[int] = mapped_column(nullable=False)
