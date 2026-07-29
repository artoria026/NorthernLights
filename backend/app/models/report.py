import uuid
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

REPORT_TYPES = ("monthly_auto", "monthly_manual", "yearly_auto", "yearly_manual", "custom")
REPORT_STATUSES = ("generating", "ready", "error")
REPORT_GENERATED_BY = ("auto", "user")
REPORT_INSIGHT_FLOW_TYPES = ("income", "expense", "general")


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(f"type IN {REPORT_TYPES}", name="ck_reports_type"),
        CheckConstraint(f"status IN {REPORT_STATUSES}", name="ck_reports_status"),
        CheckConstraint(f"generated_by IN {REPORT_GENERATED_BY}", name="ck_reports_generated_by"),
        Index(
            "idx_reports_user_period",
            "user_id",
            "period_start",
            "period_end",
            "type",
            unique=True,
        ),
        Index("idx_reports_user_date", "user_id", "period_start"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    type: Mapped[str] = mapped_column(String, nullable=False)
    period_start: Mapped[date_type] = mapped_column(Date, nullable=False)
    period_end: Mapped[date_type] = mapped_column(Date, nullable=False)

    status: Mapped[str] = mapped_column(String, nullable=False, default="generating")
    summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    generated_by: Mapped[str] = mapped_column(String, nullable=False)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    insights: Mapped[list["ReportInsight"]] = relationship(
        "ReportInsight", back_populates="report", order_by="ReportInsight.created_at"
    )


class ReportInsight(Base):
    """Puntos generados por IA sobre un periodo YA CERRADO (mes o año) -- a
    diferencia de `Insight` (M13), estos son historial de solo lectura, sin
    dismiss/resolve ni review periodico, y siempre atados a un `Report`."""

    __tablename__ = "report_insights"
    __table_args__ = (
        CheckConstraint(
            f"flow_type IN {REPORT_INSIGHT_FLOW_TYPES}", name="ck_report_insights_flow_type"
        ),
        Index("idx_report_insights_report", "report_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )

    flow_type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category_name: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    report: Mapped["Report"] = relationship("Report", back_populates="insights")
