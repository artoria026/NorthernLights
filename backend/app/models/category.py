import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import SoftDeleteMixin, TimestampMixin


class Category(Base, TimestampMixin, SoftDeleteMixin):
    """user_id NULL = system category, visible to everyone via RLS.
    parent_id NULL = top-level category; if it has a value, it's a
    subcategory (a single level of nesting, validated in category_service).
    Transactions can point to either level."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("type IN ('income', 'expense')", name="ck_categories_type"),
        # A subcategory (non-null parent_id) ALWAYS requires user_id -- there
        # can't be a system subcategory shared across all
        # users. Enforced at the database level, not just in
        # category_service.create_category.
        CheckConstraint(
            "parent_id IS NULL OR user_id IS NOT NULL",
            name="ck_categories_subcategory_user_scoped",
        ),
        Index(
            "idx_categories_user_type",
            "user_id",
            "type",
            postgresql_where="is_active = TRUE AND deleted_at IS NULL",
        ),
        Index(
            "idx_categories_system",
            "type",
            "sort_order",
            postgresql_where="user_id IS NULL AND is_active = TRUE",
        ),
        Index("idx_categories_parent", "parent_id", postgresql_where="parent_id IS NOT NULL"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str] = mapped_column(String, default="#6366F1")

    is_system: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
