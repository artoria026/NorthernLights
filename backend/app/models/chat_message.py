import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

CHAT_ROLES = ("user", "assistant")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(f"role IN {CHAT_ROLES}", name="ck_chat_messages_role"),
        Index("idx_chat_messages_user_date", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_provider: Mapped[str | None] = mapped_column(String, nullable=True)

    # Python-side default (not server_default=func.now()) on purpose: a chat's
    # user+assistant turn is saved in the SAME transaction (see
    # advisor.chat) and func.now() returns the transaction's start time
    # -- both rows would end up with the same created_at, and list_history's
    # ORDER BY created_at DESC would no longer distinguish which came first
    # (real bug: the user's message could show up "after" the AI's).
    # datetime.now(UTC) evaluated in Python gives each row its own
    # real timestamp, even if only by microseconds.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
