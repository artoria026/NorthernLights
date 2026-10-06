import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, and_, case, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, column_property, mapped_column

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
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "idx_categories_system",
            "type",
            "sort_order",
            postgresql_where="user_id IS NULL",
        ),
        # Slug/English name only exist on system categories (user_id NULL).
        CheckConstraint(
            "user_id IS NULL OR (slug IS NULL AND name_en IS NULL)",
            name="ck_categories_i18n_system_only",
        ),
        Index(
            "uq_categories_system_slug",
            "slug",
            unique=True,
            postgresql_where="slug IS NOT NULL",
        ),
        Index("idx_categories_parent", "parent_id", postgresql_where="parent_id IS NOT NULL"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # System categories only: stable identifier + English name. `name` stays the
    # Spanish, canonical value; read `display_name` to get the one in the user's
    # language.
    slug: Mapped[str | None] = mapped_column(String, nullable=True)
    name_en: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str] = mapped_column(String, default="#6366F1")

    is_system: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )


# The name in the language of whoever is reading: English when the session's
# `app.locale` is 'en' (set next to app.current_user_id, see
# core.database.apply_rls_context) and the category has an English name,
# otherwise `name`. A SQL expression, so it works in any query and rides along
# every ORM load of Category; user-created categories always fall to `name`.
Category.display_name = column_property(  # type: ignore[attr-defined]
    case(
        (
            and_(
                func.current_setting("app.locale", True) == "en",
                Category.__table__.c.name_en.is_not(None),
            ),
            Category.__table__.c.name_en,
        ),
        else_=Category.__table__.c.name,
    )
)
