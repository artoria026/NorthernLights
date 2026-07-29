import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin

ITEM_TYPES = ("subscription", "service", "utility", "income")
FREQUENCIES = ("weekly", "biweekly", "monthly", "bimonthly", "annual")
RECURRING_STATUSES = ("active", "paused", "cancelled")
ALERT_URGENCIES = ("normal", "high", "critical")

# item_type -> alert_urgency por defecto al crear (el usuario puede sobreescribirlo).
DEFAULT_ALERT_URGENCY = {
    "subscription": "normal",
    "service": "high",
    "utility": "critical",
    "income": "normal",
}


class RecurringItem(Base, TimestampMixin, SoftDeleteMixin):
    """Suscripciones, servicios y cobros periodicos sin saldo que liquidar.

    Celery los detecta en su `next_date` y genera un journal_entry con
    status='pending' (M04) — nunca 'confirmed' directo. El usuario confirma
    o rechaza desde el endpoint estandar de transacciones.
    """

    __tablename__ = "recurring_items"
    __table_args__ = (
        CheckConstraint(f"item_type IN {ITEM_TYPES}", name="ck_recurring_items_item_type"),
        CheckConstraint(f"frequency IN {FREQUENCIES}", name="ck_recurring_items_frequency"),
        CheckConstraint(f"status IN {RECURRING_STATUSES}", name="ck_recurring_items_status"),
        CheckConstraint(
            f"alert_urgency IN {ALERT_URGENCIES}", name="ck_recurring_items_alert_urgency"
        ),
        CheckConstraint("amount > 0", name="ck_recurring_items_amount_positive"),
        Index(
            "idx_recurring_next",
            "user_id",
            "next_date",
            postgresql_where="status = 'active' AND deleted_at IS NULL",
        ),
        Index(
            "idx_recurring_user_type",
            "user_id",
            "item_type",
            postgresql_where="status = 'active' AND deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_type: Mapped[str] = mapped_column(String, nullable=False, default="subscription")

    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    frequency: Mapped[str] = mapped_column(String, nullable=False)
    frequency_day: Mapped[int | None] = mapped_column(nullable=True)

    # Cuenta de cobro/pago (banco, efectivo o TDC) y su contrapartida contable
    # (cuenta type=expense o type=income). El spec de Notion solo modela un
    # account_id; aqui hacen falta dos porque M04 exige doble entrada real
    # (ver el mismo patron en Debt.initial_charge / debt_service.py).
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )
    contra_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False
    )

    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    cancelled_at: Mapped[date_type | None] = mapped_column(nullable=True)

    alert_urgency: Mapped[str] = mapped_column(String, nullable=False, default="normal")

    auto_generate: Mapped[bool] = mapped_column(default=True)
    last_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    next_date: Mapped[date_type] = mapped_column(nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
