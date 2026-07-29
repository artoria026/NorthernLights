import calendar
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.category_hide import CategoryHide
from app.models.transaction import JournalEntry
from app.schemas.category import CategoryCreate, CategoryUpdate


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
    query = query.order_by(Category.user_id.is_not(None), Category.sort_order, Category.name)
    result = await session.execute(query)
    return list(result.scalars().all())


async def list_hidden_categories(
    session: AsyncSession, user_id: UUID, type_: str | None = None
) -> list[Category]:
    """Categorias de sistema que este usuario desactivo -- para la seccion
    de 'reactivar' del frontend. Nunca incluye categorias propias (esas se
    eliminan, no se ocultan)."""
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
    return category


async def delete_category(session: AsyncSession, user_id: UUID, category_id: UUID) -> None:
    """Elimina (soft-delete) una categoria propia y desvincula sus
    transacciones -- category_id queda en NULL en vez de bloquear el borrado
    (antes: 409 si tenia transacciones asociadas). Si tiene subcategorias
    propias, se eliminan en cascada (mismo trato: transacciones desvinculadas,
    no bloqueo) para no dejar subcategorias huerfanas de un padre borrado."""
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
    """Oculta una categoria de sistema solo para este usuario (reversible
    con reactivate_category) y desvincula sus transacciones -- nunca toca la
    fila compartida de `categories`, asi que no afecta a otros usuarios."""
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
    """Revierte deactivate_category -- la categoria vuelve a listarse para
    este usuario. Las transacciones que se desvincularon al desactivarla NO
    se restauran (esa asociacion se perdio)."""
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
    """Nombres de categoria para mostrar en listas de transacciones -- RLS ya
    filtra por visibilidad (propias + del sistema), no hace falta user_id aqui."""
    if not category_ids:
        return {}
    result = await session.execute(
        select(Category.id, Category.name).where(Category.id.in_(category_ids))
    )
    return {row.id: row.name for row in result.all()}


async def get_month_summary(
    session: AsyncSession, user_id: UUID, year: int, month: int
) -> dict[UUID, float]:
    """Total por categoria (ingreso o gasto) en el mes dado, solo transacciones
    confirmadas. Usado por la pantalla de Categorias para mostrar cuanto lleva
    cada una -- no toca budget_periods, es un agregado directo sobre el diario."""
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
