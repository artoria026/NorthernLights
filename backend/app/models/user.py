import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin

PAY_CYCLES = ("weekly", "biweekly", "monthly")
THEMES = ("dark", "light")


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),
        CheckConstraint("auth_provider IN ('email', 'google')", name="ck_users_auth_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="user")
    auth_provider: Mapped[str] = mapped_column(String, nullable=False, default="email")
    google_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)

    # 1:1 con user_preferences (M01 es dueno de identidad/auth; las
    # preferencias de comportamiento -- tema, notificaciones, ciclo de pago --
    # las consumen M06/M11/M13/M14 y viven en su propia tabla a proposito.
    # lazy="selectin" para que cualquier fetch de User la traiga sola, sin
    # tener que acordarse de un selectinload() en cada call site.
    preferences: Mapped["UserPreferences"] = relationship(
        back_populates="user", uselist=False, lazy="selectin", cascade="all, delete-orphan"
    )


class UserPreferences(Base, TimestampMixin):
    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(f"pay_cycle IN {PAY_CYCLES}", name="ck_user_preferences_pay_cycle"),
        CheckConstraint(f"theme IN {THEMES}", name="ck_user_preferences_theme"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[str] = mapped_column(String, nullable=False, default="dark")
    pay_cycle: Mapped[str] = mapped_column(String, nullable=False, default="monthly")
    email_notifications: Mapped[bool] = mapped_column(default=True)
    push_notifications: Mapped[bool] = mapped_column(default=True)
    # Apagado por defecto a proposito: la seccion de "deuda sin plan" en /debts
    # (boton, stat card, listado) y el tool de advisor get_problem_debts solo
    # se activan si el usuario indica explicitamente que tiene una deuda
    # vencida o con problemas de pago -- no queremos que sea lo primero que
    # ve alguien sin ese problema.
    debt_trouble_mode: Mapped[bool] = mapped_column(default=False)
    # Version del changelog (frontend/src/lib/changelog.ts) que el usuario ya
    # vio -- NULL para cuentas creadas antes de esta feature o que nunca
    # cerraron el modal. Comparado contra la version mas reciente del array
    # en el frontend, no hay tabla de releases en el backend.
    last_seen_changelog_version: Mapped[str | None] = mapped_column(String, nullable=True)
    # Version del aviso de privacidad (docs/legal/DISCLAIMER.md en la raiz del
    # repo, texto real en frontend/src/lib/disclaimer.ts) que el usuario acepto --
    # NULL para cuentas creadas antes de esta feature. A diferencia de
    # last_seen_changelog_version (solo informativo), este SI se hace cumplir:
    # DisclaimerGate en el frontend bloquea toda la app hasta que coincida con
    # settings.DISCLAIMER_VERSION, y /auth/register no crea la cuenta sin
    # aceptarlo. Se guarda server-side (POST /auth/accept-disclaimer, ver
    # auth_service.accept_disclaimer) en vez de aceptar el string desde el
    # cliente como last_seen_changelog_version -- es un campo de cumplimiento,
    # no se puede confiar en que el cliente diga la verdad de si lo acepto.
    accepted_disclaimer_version: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped["User"] = relationship(back_populates="preferences")


class Device(Base, TimestampMixin):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("device_type IN ('web', 'ios', 'android')", name="ck_devices_device_type"),
        Index("idx_devices_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_name: Mapped[str | None] = mapped_column(String, nullable=True)
    device_type: Mapped[str] = mapped_column(String, nullable=False)
    push_token: Mapped[str | None] = mapped_column(String, nullable=True)

    refresh_token: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    is_active: Mapped[bool] = mapped_column(default=True)
