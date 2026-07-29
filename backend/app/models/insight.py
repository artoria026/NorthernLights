import uuid
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin

INSIGHT_CATEGORIES = ("spending", "debt", "savings", "income", "budget", "general")
INSIGHT_PRIORITIES = ("high", "medium", "low")
INSIGHT_GENERATED_BY = ("auto_celery", "user_chat")
INSIGHT_STATUSES = ("active", "dismissed", "resolved")
INSIGHT_REVIEW_FREQUENCIES = ("weekly", "biweekly", "monthly")
INSIGHT_TRENDS = ("improved", "worsened", "stable")

MAX_ACTIVE_INSIGHTS_PER_USER = 10


class Insight(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "insights"
    __table_args__ = (
        CheckConstraint(f"category IN {INSIGHT_CATEGORIES}", name="ck_insights_category"),
        CheckConstraint(f"priority IN {INSIGHT_PRIORITIES}", name="ck_insights_priority"),
        CheckConstraint(f"generated_by IN {INSIGHT_GENERATED_BY}", name="ck_insights_generated_by"),
        CheckConstraint(f"status IN {INSIGHT_STATUSES}", name="ck_insights_status"),
        CheckConstraint(
            f"review_frequency IN {INSIGHT_REVIEW_FREQUENCIES}",
            name="ck_insights_review_frequency",
        ),
        Index(
            "idx_insights_user_status", "user_id", "status", postgresql_where="deleted_at IS NULL"
        ),
        Index(
            "idx_insights_review_due",
            "next_review_at",
            postgresql_where="status = 'active' AND deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False, default="medium")

    generated_by: Mapped[str] = mapped_column(String, nullable=False)
    ai_provider: Mapped[str] = mapped_column(String, nullable=False)
    ai_context: Mapped[dict] = mapped_column(JSONB, nullable=False)
    metrics_at_creation: Mapped[dict] = mapped_column(JSONB, nullable=False)
    metrics_at_last_review: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(String, nullable=False, default="active")

    review_frequency: Mapped[str] = mapped_column(String, nullable=False, default="monthly")
    next_review_at: Mapped[date_type] = mapped_column(nullable=False)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    review_count: Mapped[int] = mapped_column(default=0)

    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class InsightReview(Base):
    __tablename__ = "insight_reviews"
    __table_args__ = (
        CheckConstraint(f"trend IN {INSIGHT_TRENDS}", name="ck_insight_reviews_trend"),
        Index("idx_insight_reviews_insight", "insight_id", "reviewed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    insight_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("insights.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False)
    trend: Mapped[str] = mapped_column(String, nullable=False)
    ai_assessment: Mapped[str] = mapped_column(Text, nullable=False)
    next_review_at: Mapped[date_type] = mapped_column(nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
