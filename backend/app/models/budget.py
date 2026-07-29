import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class BudgetLimit(Base, TimestampMixin):
    """Fuente de verdad del limite mensual actual por categoria.

    `budget_periods.budgeted` es un snapshot historico tomado de aqui; cambiar
    un limite nunca reescribe meses anteriores (ver budget_service.set_limits).
    """

    __tablename__ = "budget_limits"
    __table_args__ = (
        UniqueConstraint("user_id", "category_id", name="uq_budget_limits_user_category"),
        CheckConstraint("monthly_limit >= 0", name="ck_budget_limits_monthly_limit_positive"),
        Index("idx_budget_limits_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False
    )
    monthly_limit: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)


class BudgetPeriod(Base, TimestampMixin):
    """Gasto real acumulado por mes y categoria. `budgeted` es el snapshot del
    limite que aplicaba ese mes; `spent` se actualiza con cada transaccion
    confirmada via budget_service.upsert_period_spent (llamado desde M04)."""

    __tablename__ = "budget_periods"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "category_id", "year", "month", name="uq_budget_periods_user_cat_period"
        ),
        Index("idx_budget_periods_user_month", "user_id", "year", "month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False
    )
    year: Mapped[int] = mapped_column(nullable=False)
    month: Mapped[int] = mapped_column(nullable=False)
    budgeted: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    spent: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
