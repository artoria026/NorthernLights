import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

NOTIFICATION_TYPES = (
    "report_ready",
    "insight_generated",
    "insight_reviewed",
    "debt_alert",
    "budget_alert",
    "tdc_due",
    "pending_payment",
    "pending_payment_reminder",
    "subscription_alert",
    "loan_overdue",
    "feedback_status_changed",
)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(f"type IN {NOTIFICATION_TYPES}", name="ck_notifications_type"),
        Index(
            "idx_notifications_user_unread",
            "user_id",
            "created_at",
            postgresql_where="is_read = FALSE",
        ),
        Index("idx_notifications_user_all", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)

    is_read: Mapped[bool] = mapped_column(default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    action_url: Mapped[str | None] = mapped_column(String, nullable=True)
    related_entity_type: Mapped[str | None] = mapped_column(String, nullable=True)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
