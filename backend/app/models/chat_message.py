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

    # default de Python (no server_default=func.now()) a proposito: el turno
    # user+assistant de un chat se guarda en la MISMA transaccion (ver
    # advisor.chat) y func.now() devuelve la hora de inicio de la transaccion
    # -- ambas filas quedarian con el mismo created_at, y el ORDER BY
    # created_at DESC de list_history ya no distinguiria cual fue primero
    # (bug real: el mensaje del usuario podia salir "despues" del de la IA).
    # datetime.now(UTC) evaluado en Python le da a cada fila su propio
    # timestamp real, aunque sea por microsegundos.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
