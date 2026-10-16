from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.tag import JournalEntryTag, Tag
from app.models.transaction import JournalEntry
from app.schemas.tag import (
    BulkTagRequest,
    TagCategoryTotal,
    TagCreate,
    TagDayTotal,
    TagOut,
    TagSummary,
    TagUpdate,
    TagWithStats,
)
from app.services.transaction_service import resolve_tags


def _counts_toward_totals(user_id: UUID):
    """Confirmed expenses that haven't been deleted: what a tag has really spent."""
    return and_(
        JournalEntry.user_id == user_id,
        JournalEntry.entry_type == "expense",
        JournalEntry.status == "confirmed",
        JournalEntry.deleted_at.is_(None),
    )


async def get_tag(session: AsyncSession, user_id: UUID, tag_id: UUID) -> Tag:
    tag = (
        await session.execute(select(Tag).where(Tag.id == tag_id, Tag.user_id == user_id))
    ).scalar_one_or_none()
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Etiqueta no encontrada")
    return tag


async def _ensure_name_is_free(
    session: AsyncSession, user_id: UUID, name: str, ignore_id: UUID | None = None
) -> None:
    query = select(Tag.id).where(Tag.user_id == user_id, func.lower(Tag.name) == name.lower())
    if ignore_id is not None:
        query = query.where(Tag.id != ignore_id)
    if (await session.execute(query)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Ya existe una etiqueta '{name}'")


async def list_tags(session: AsyncSession, user_id: UUID) -> list[TagWithStats]:
    rows = await session.execute(
        select(
            Tag,
            func.count(JournalEntry.id),
            func.coalesce(func.sum(JournalEntry.amount), 0),
            func.min(JournalEntry.date),
            func.max(JournalEntry.date),
        )
        .outerjoin(JournalEntryTag, JournalEntryTag.tag_id == Tag.id)
        .outerjoin(
            JournalEntry,
            and_(JournalEntry.id == JournalEntryTag.entry_id, _counts_toward_totals(user_id)),
        )
        .where(Tag.user_id == user_id)
        .group_by(Tag.id)
        .order_by(func.max(JournalEntry.date).desc().nulls_last(), Tag.name)
    )
    return [
        TagWithStats(
            id=tag.id,
            name=tag.name,
            color=tag.color,
            transaction_count=count,
            total_spent=Decimal(total),
            first_date=first,
            last_date=last,
        )
        for tag, count, total, first, last in rows.all()
    ]


async def create_tag(session: AsyncSession, user_id: UUID, data: TagCreate) -> Tag:
    name = data.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El nombre no puede estar vacio")
    await _ensure_name_is_free(session, user_id, name)
    tag = Tag(user_id=user_id, name=name, color=data.color)
    session.add(tag)
    await session.flush()
    return tag


async def update_tag(session: AsyncSession, user_id: UUID, tag_id: UUID, data: TagUpdate) -> Tag:
    tag = await get_tag(session, user_id, tag_id)
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "El nombre no puede estar vacio"
            )
        await _ensure_name_is_free(session, user_id, name, ignore_id=tag.id)
        tag.name = name
    if data.color is not None:
        tag.color = data.color
    await session.flush()
    return tag


async def delete_tag(session: AsyncSession, user_id: UUID, tag_id: UUID) -> None:
    """Only the label goes away; the transactions that carried it stay."""
    tag = await get_tag(session, user_id, tag_id)
    await session.delete(tag)
    await session.flush()


async def get_summary(
    session: AsyncSession,
    user_id: UUID,
    tag_id: UUID,
    date_from: date | None = None,
    date_to: date | None = None,
) -> TagSummary:
    tag = await get_tag(session, user_id, tag_id)
    conditions = [
        _counts_toward_totals(user_id),
        JournalEntry.id.in_(
            select(JournalEntryTag.entry_id).where(JournalEntryTag.tag_id == tag.id)
        ),
    ]
    if date_from:
        conditions.append(JournalEntry.date >= date_from)
    if date_to:
        conditions.append(JournalEntry.date <= date_to)

    count, total, first, last = (
        await session.execute(
            select(
                func.count(JournalEntry.id),
                func.coalesce(func.sum(JournalEntry.amount), 0),
                func.min(JournalEntry.date),
                func.max(JournalEntry.date),
            ).where(*conditions)
        )
    ).one()
    total = Decimal(total)

    by_category_rows = await session.execute(
        select(
            Category.display_name,
            func.sum(JournalEntry.amount),
            func.count(JournalEntry.id),
        )
        .join(Category, JournalEntry.category_id == Category.id)
        .where(*conditions)
        .group_by(Category.display_name)
        .order_by(func.sum(JournalEntry.amount).desc())
    )
    by_day_rows = await session.execute(
        select(JournalEntry.date, func.sum(JournalEntry.amount))
        .where(*conditions)
        .group_by(JournalEntry.date)
        .order_by(JournalEntry.date)
    )
    return TagSummary(
        tag=TagOut.model_validate(tag),
        date_from=date_from,
        date_to=date_to,
        transaction_count=count,
        total_spent=total,
        average_per_transaction=(total / count).quantize(Decimal("0.01")) if count else Decimal(0),
        first_date=first,
        last_date=last,
        by_category=[
            TagCategoryTotal(category=name, amount=amount, count=n)
            for name, amount, n in by_category_rows.all()
        ],
        by_day=[TagDayTotal(date=day, amount=amount) for day, amount in by_day_rows.all()],
    )


async def apply_bulk(session: AsyncSession, user_id: UUID, data: BulkTagRequest) -> int:
    """Adds and/or removes tags on many expenses at once. Nothing changes if any of
    the transactions isn't the user's own expense."""
    ids = list(dict.fromkeys(data.transaction_ids))
    entries = (
        (
            await session.execute(
                select(JournalEntry).where(
                    JournalEntry.user_id == user_id,
                    JournalEntry.deleted_at.is_(None),
                    JournalEntry.id.in_(ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(entries) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alguna transaccion no existe")
    if any(entry.entry_type != "expense" for entry in entries):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Las etiquetas solo se pueden poner a gastos"
        )

    to_add = await resolve_tags(session, user_id, "expense", data.add_tag_ids)
    to_remove = await resolve_tags(session, user_id, "expense", data.remove_tag_ids)

    if to_add:
        await session.execute(
            insert(JournalEntryTag)
            .values([{"entry_id": i, "tag_id": t.id} for i in ids for t in to_add])
            .on_conflict_do_nothing()
        )
    if to_remove:
        await session.execute(
            delete(JournalEntryTag).where(
                JournalEntryTag.entry_id.in_(ids),
                JournalEntryTag.tag_id.in_([t.id for t in to_remove]),
            )
        )
    await session.flush()
    session.expire_all()  # the selectin-loaded `tags` of these entries are stale now
    return len(ids)
