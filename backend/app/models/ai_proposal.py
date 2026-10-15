import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

PROPOSAL_STATUSES = ("pending", "confirmed", "cancelled", "failed", "expired", "superseded")


class AiProposal(Base):
    """Something the AI advisor wants to register (transactions, accounts, debts,
    recurring items) and that nothing happens with until the user confirms it.

    The advisor never writes: it stores the proposal here, exactly as it will be
    executed (`items`), the user sees it and confirms or cancels, and only then
    does the server run those stored items -- the model doesn't regenerate
    anything on confirmation, so what was shown is what gets saved."""

    __tablename__ = "ai_proposals"
    __table_args__ = (
        CheckConstraint(f"status IN {PROPOSAL_STATUSES}", name="ck_ai_proposals_status"),
        Index("idx_ai_proposals_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # [{"action": "create_transaction", "arguments": {...}, "fields": [{"key", "value"}]}]
    items: Mapped[list] = mapped_column(JSONB, nullable=False)
    # Per-item outcome once confirmed ([{"action", "result"}]) or the errors if it failed.
    results: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
