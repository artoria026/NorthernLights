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

    # 1:1 with user_preferences (M01 owns identity/auth; behavioral
    # preferences -- theme, notifications, pay cycle -- are
    # consumed by M06/M11/M13/M14 and live in their own table on purpose.
    # lazy="selectin" so that any User fetch brings it along automatically,
    # without having to remember a selectinload() at every call site.
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
    # Off by default on purpose: the "debt in trouble" section in /debts
    # (button, stat card, listing) and the advisor's get_problem_debts tool only
    # activate if the user explicitly indicates they have an overdue debt
    # or one with payment problems -- we don't want that to be the first thing
    # someone without that problem sees.
    debt_trouble_mode: Mapped[bool] = mapped_column(default=False)
    # Changelog version (frontend/src/lib/changelog.ts) the user has already
    # seen -- NULL for accounts created before this feature or that never
    # closed the modal. Compared against the most recent version in the
    # frontend's array, there's no releases table in the backend.
    last_seen_changelog_version: Mapped[str | None] = mapped_column(String, nullable=True)
    # Privacy disclaimer version (docs/legal/DISCLAIMER.md at the repo root,
    # actual text in frontend/src/lib/disclaimer.ts) that the user accepted --
    # NULL for accounts created before this feature. Unlike
    # last_seen_changelog_version (informational only), this one IS enforced:
    # DisclaimerGate in the frontend blocks the whole app until it matches
    # settings.DISCLAIMER_VERSION, and /auth/register won't create the account without
    # accepting it. Saved server-side (POST /auth/accept-disclaimer, see
    # auth_service.accept_disclaimer) instead of trusting the string from the
    # client like last_seen_changelog_version -- it's a compliance field,
    # the client can't be trusted to tell the truth about whether it was accepted.
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
