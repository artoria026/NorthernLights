import calendar
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.category_hide import CategoryHide
from app.models.transaction import JournalEntry
from app.schemas.category import (
    CATEGORY_EXPORT_FORMAT,
    CATEGORY_EXPORT_VERSION,
    CategoryCreate,
    CategoryExport,
    CategoryExportItem,
    CategoryImportRequest,
    CategoryUpdate,
)


async def list_categories(
    session: AsyncSession, user_id: UUID, type_: str | None = None
) -> list[Category]:
    hidden = select(CategoryHide.category_id).where(CategoryHide.user_id == user_id)
    query = select(Category).where(
        or_(
            Category.user_id == user_id,
            (Category.user_id.is_(None)) & Category.id.not_in(hidden),
        ),
        Category.is_active.is_(True),
        Category.deleted_at.is_(None),
    )
    if type_:
        query = query.where(Category.type == type_)
    query = query.order_by(
        Category.user_id.is_not(None), Category.sort_order, Category.display_name
    )
    result = await session.execute(query)
    return list(result.scalars().all())


async def list_hidden_categories(
    session: AsyncSession, user_id: UUID, type_: str | None = None
) -> list[Category]:
    """System categories this user deactivated -- for the frontend's
    'reactivate' section. Never includes the user's own categories (those
    get deleted, not hidden)."""
    query = (
        select(Category)
        .join(CategoryHide, CategoryHide.category_id == Category.id)
        .where(CategoryHide.user_id == user_id, Category.deleted_at.is_(None))
    )
    if type_:
        query = query.where(Category.type == type_)
    query = query.order_by(Category.type, Category.sort_order, Category.name)
    result = await session.execute(query)
    return list(result.scalars().all())


async def export_categories(session: AsyncSession, user_id: UUID) -> CategoryExport:
    """Everything about the user's categories for the JSON download: every
    system category with whether this user hid it, plus all of their own
    categories (subcategories included). Soft-deleted ones are gone for the
    user, so they're not exported."""
    hidden_ids = set(
        (
            await session.execute(
                select(CategoryHide.category_id).where(CategoryHide.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    result = await session.execute(
        select(Category)
        .where(
            or_(Category.user_id == user_id, Category.user_id.is_(None)),
            Category.deleted_at.is_(None),
        )
        .order_by(Category.type, Category.user_id.is_not(None), Category.sort_order, Category.name)
    )
    categories = list(result.scalars().all())
    by_id = {c.id: c for c in categories}

    items = []
    for c in categories:
        parent = by_id.get(c.parent_id) if c.parent_id else None
        items.append(
            CategoryExportItem(
                name=c.name,
                name_en=c.name_en,
                slug=c.slug,
                type=c.type,
                icon=c.icon,
                color=c.color,
                sort_order=c.sort_order,
                is_system=c.user_id is None,
                is_active=c.is_active,
                hidden=c.id in hidden_ids,
                parent_name=parent.name if parent else None,
                parent_slug=parent.slug if parent else None,
                parent_is_system=(parent.user_id is None) if parent else None,
                created_at=c.created_at,
            )
        )
    # Parents before their subcategories, so a reader (or the importer) never
    # meets a child first.
    items.sort(key=lambda i: i.parent_name is not None)
    return CategoryExport(
        format=CATEGORY_EXPORT_FORMAT,
        version=CATEGORY_EXPORT_VERSION,
        exported_at=datetime.now(UTC),
        categories=items,
    )


async def import_categories(
    session: AsyncSession, user_id: UUID, data: CategoryImportRequest
) -> dict[str, object]:
    """Applies a categories export. Additive, never destructive to the
    user's setup:

    - System entries are matched to the current system categories by `slug`
      (stable), or failing that by (type, name) in either language,
      case-insensitive. A `hidden` one gets hidden for this
      user (same effect as deactivate_category, which unlinks its
      transactions); one that isn't hidden is left as it is. A system entry
      that matches nothing (e.g. renamed in a newer seed) is reported in
      `unmatched`, never created.
    - The user's own categories are created (top level first, then
      subcategories under a system or own parent). One that already exists
      with the same type, name and parent is skipped, so importing twice is
      harmless."""
    existing = (
        (
            await session.execute(
                select(Category).where(
                    or_(Category.user_id == user_id, Category.user_id.is_(None)),
                    Category.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    system_rows = [c for c in existing if c.user_id is None]
    system_by_slug = {c.slug: c for c in system_rows if c.slug}
    # Fallback for files without slugs: either language's name.
    system_by_name = {(c.type, c.name.casefold()): c for c in system_rows}
    system_by_name.update(
        {(c.type, c.name_en.casefold()): c for c in system_rows if c.name_en}
    )

    def find_system(slug: str | None, type_: str, name: str | None) -> Category | None:
        if slug and slug in system_by_slug:
            return system_by_slug[slug]
        return system_by_name.get((type_, name.casefold())) if name else None

    # (type, name, parent id) -> category, for the user's own ones.
    own = {(c.type, c.name.casefold(), c.parent_id): c for c in existing if c.user_id is not None}

    created = hidden = 0
    skipped: list[str] = []
    unmatched: list[str] = []

    for item in (i for i in data.categories if i.is_system):
        category = find_system(item.slug, item.type, item.name)
        if category is None:
            unmatched.append(item.name)
        elif item.hidden:
            await deactivate_category(session, user_id, category.id)
            hidden += 1

    own_items = [i for i in data.categories if not i.is_system]
    # Top level first, so a subcategory can find the parent created in this run.
    for item in sorted(own_items, key=lambda i: i.parent_name is not None):
        parent_id: UUID | None = None
        if item.parent_name is not None:
            if item.parent_is_system:
                parent = find_system(item.parent_slug, item.type, item.parent_name)
            else:
                parent = own.get((item.type, item.parent_name.casefold(), None))
            if parent is None:
                unmatched.append(f"{item.parent_name} > {item.name}")
                continue
            parent_id = parent.id

        key = (item.type, item.name.casefold(), parent_id)
        if key in own:
            skipped.append(item.name)
            continue
        category = await create_category(
            session,
            user_id,
            CategoryCreate(
                name=item.name,
                type=item.type,
                icon=item.icon,
                color=item.color,
                parent_id=parent_id,
            ),
        )
        category.sort_order = item.sort_order
        category.is_active = item.is_active
        await session.flush()
        own[key] = category
        created += 1

    return {"created": created, "hidden": hidden, "skipped": skipped, "unmatched": unmatched}


async def get_category(session: AsyncSession, user_id: UUID, category_id: UUID) -> Category:
    result = await session.execute(
        select(Category).where(
            Category.id == category_id,
            or_(Category.user_id.is_(None), Category.user_id == user_id),
            Category.deleted_at.is_(None),
        )
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria no encontrada")
    return category


async def create_category(session: AsyncSession, user_id: UUID, data: CategoryCreate) -> Category:
    if data.parent_id is not None:
        parent = await get_category(session, user_id, data.parent_id)
        if parent.parent_id is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No se pueden anidar mas de un nivel de subcategorias",
            )
        if parent.type != data.type:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "La subcategoria debe tener el mismo tipo (ingreso/gasto) que su categoria padre",
            )

    category = Category(
        user_id=user_id,
        name=data.name,
        type=data.type,
        icon=data.icon,
        color=data.color,
        is_system=False,
        parent_id=data.parent_id,
    )
    session.add(category)
    await session.flush()
    # Loads display_name (a SQL expression) so the caller can serialize it.
    await session.refresh(category)
    return category


async def update_category(
    session: AsyncSession, user_id: UUID, category_id: UUID, data: CategoryUpdate
) -> Category:
    category = await get_category(session, user_id, category_id)
    if category.is_system:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "No se puede editar una categoria del sistema"
        )
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await session.flush()
    await session.refresh(category)
    return category


async def delete_category(session: AsyncSession, user_id: UUID, category_id: UUID) -> None:
    """Deletes (soft-delete) a user's own category and unlinks its
    transactions -- category_id is set to NULL instead of blocking the
    deletion (previously: 409 if it had associated transactions). If it has
    its own subcategories, they're deleted in cascade (same treatment:
    transactions unlinked, no blocking) to avoid leaving orphaned
    subcategories of a deleted parent."""
    category = await get_category(session, user_id, category_id)
    if category.is_system:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "No se puede eliminar una categoria del sistema"
        )

    children_result = await session.execute(
        select(Category.id).where(
            Category.parent_id == category_id, Category.deleted_at.is_(None)
        )
    )
    for child_id in children_result.scalars().all():
        await delete_category(session, user_id, child_id)

    await session.execute(
        update(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.category_id == category_id,
            JournalEntry.deleted_at.is_(None),
        )
        .values(category_id=None)
    )
    category.deleted_at = datetime.now(UTC)


async def deactivate_category(session: AsyncSession, user_id: UUID, category_id: UUID) -> Category:
    """Hides a system category only for this user (reversible with
    reactivate_category) and unlinks its transactions -- never touches the
    shared `categories` row, so it doesn't affect other users."""
    category = await get_category(session, user_id, category_id)
    if not category.is_system:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Las categorias propias se eliminan, no se desactivan"
        )

    existing = await session.execute(
        select(CategoryHide).where(
            CategoryHide.user_id == user_id, CategoryHide.category_id == category_id
        )
    )
    if existing.scalar_one_or_none() is None:
        session.add(CategoryHide(user_id=user_id, category_id=category_id))

    await session.execute(
        update(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.category_id == category_id,
            JournalEntry.deleted_at.is_(None),
        )
        .values(category_id=None)
    )
    await session.flush()
    return category


async def reactivate_category(session: AsyncSession, user_id: UUID, category_id: UUID) -> Category:
    """Reverts deactivate_category -- the category shows up again in this
    user's list. Transactions that were unlinked when it was deactivated
    are NOT restored (that association was lost)."""
    category = await get_category(session, user_id, category_id)
    if not category.is_system:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Solo las categorias de sistema se reactivan"
        )

    await session.execute(
        delete(CategoryHide).where(
            CategoryHide.user_id == user_id, CategoryHide.category_id == category_id
        )
    )
    await session.flush()
    return category


async def get_names_by_ids(session: AsyncSession, category_ids: list[UUID]) -> dict[UUID, str]:
    """Category names to display in transaction lists -- RLS already
    filters by visibility (own + system), no need for user_id here."""
    if not category_ids:
        return {}
    result = await session.execute(
        select(Category.id, Category.display_name).where(Category.id.in_(category_ids))
    )
    return {row[0]: row[1] for row in result.all()}


async def get_month_summary(
    session: AsyncSession, user_id: UUID, year: int, month: int
) -> dict[UUID, float]:
    """Total per category (income or expense) in the given month, confirmed
    transactions only. Used by the Categories screen to show how much each
    one has so far -- doesn't touch budget_periods, it's a direct aggregate
    over the journal."""
    start = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    end = date(year, month, last_day)
    result = await session.execute(
        select(JournalEntry.category_id, func.sum(JournalEntry.amount))
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.category_id.is_not(None),
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= start,
            JournalEntry.date <= end,
        )
        .group_by(JournalEntry.category_id)
    )
    return {row[0]: row[1] for row in result.all()}
