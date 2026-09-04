import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CategoryHide(Base):
    """Per-user deactivation of a system category -- never
    touches the shared row in `categories`. No row here = visible."""

    __tablename__ = "category_hides"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )
    hidden_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
