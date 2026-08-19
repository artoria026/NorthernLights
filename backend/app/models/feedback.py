import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class Feedback(Base, TimestampMixin):
    """Reporte de bug o sugerencia de feature, mandado desde el modal de
    novedades. `status` lo administra un admin desde /admin -- ver la policy
    rls_feedback (migracion 293528f67338): a diferencia del resto de las
    tablas, un admin ve y puede actualizar CUALQUIER fila, no solo la
    propia."""

    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint("type IN ('bug', 'feature')", name="ck_feedback_type"),
        CheckConstraint(
            "status IN ('new', 'read', 'considered', 'discarded')", name="ck_feedback_status"
        ),
        Index("idx_feedback_status", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="new")
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
