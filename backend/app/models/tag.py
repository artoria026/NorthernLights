import uuid

from sqlalchemy import ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class Tag(Base, TimestampMixin):
    """A label the user creates to group expenses across categories (a trip, an
    event, a project): "Viaje Mty Concierto X". An expense can carry several.
    Names are unique per user ignoring case, so "viaje mty" and "Viaje Mty" can't
    coexist."""

    __tablename__ = "tags"
    __table_args__ = (Index("uq_tags_user_name", "user_id", func.lower("name"), unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#6366F1")


class JournalEntryTag(Base):
    """Which tags an entry carries. Deleting a tag only removes these links; the
    transactions stay."""

    __tablename__ = "journal_entry_tags"
    __table_args__ = (Index("idx_journal_entry_tags_tag", "tag_id"),)

    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("journal_entries.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
