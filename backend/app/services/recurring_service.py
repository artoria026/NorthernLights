from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.recurring import DEFAULT_ALERT_URGENCY, RecurringItem
from app.models.transaction import JournalEntry
from app.schemas.recurring import RecurringItemCreate, RecurringItemUpdate
from app.schemas.transaction import JournalLineIn, TransactionCreate
from app.services import account_service, cache_service, category_service, transaction_service

logger = structlog.get_logger(__name__)

FREQUENCY_FACTORS = {
    "weekly": Decimal("52") / 12,
    "biweekly": Decimal("26") / 12,
    "monthly": Decimal("1"),
    "bimonthly": Decimal("1") / 2,
    "annual": Decimal("1") / 12,
}

# item_type == 'utility' escalates daily starting day 1; 'high' starting
# day 3; 'normal' every 3 days. 'income' doesn't apply (income doesn't get reminders).
_REMINDER_INTERVAL_DAYS = {"critical": 1, "high": 1, "normal": 3}
_REMINDER_START_DAY = {"critical": 0, "high": 3, "normal": 3}


def monthly_equivalent(amount: Decimal, frequency: str) -> Decimal:
    result = amount * FREQUENCY_FACTORS[frequency]
    return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compute_next_date(current: date, frequency: str) -> date:
    if frequency == "weekly":
        return current + relativedelta(weeks=1)
    if frequency == "biweekly":
        return current + relativedelta(weeks=2)
    if frequency == "monthly":
        return current + relativedelta(months=1)
    if frequency == "bimonthly":
        return current + relativedelta(months=2)
    return current + relativedelta(years=1)  # annual


async def list_recurring_items(
    session: AsyncSession, user_id: UUID, status_: str | None = None, item_type: str | None = None
) -> list[RecurringItem]:
    query = select(RecurringItem).where(
        RecurringItem.user_id == user_id, RecurringItem.deleted_at.is_(None)
    )
    if status_:
        query = query.where(RecurringItem.status == status_)
    if item_type:
        query = query.where(RecurringItem.item_type == item_type)
    result = await session.execute(query.order_by(RecurringItem.next_date))
    return list(result.scalars().all())


async def get_recurring_item(session: AsyncSession, user_id: UUID, item_id: UUID) -> RecurringItem:
    result = await session.execute(
        select(RecurringItem).where(
            RecurringItem.id == item_id,
            RecurringItem.user_id == user_id,
            RecurringItem.deleted_at.is_(None),
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gasto recurrente no encontrado")
    return item


async def create_recurring_item(
    session: AsyncSession, user_id: UUID, data: RecurringItemCreate
) -> RecurringItem:
    # The item generates an expense/income journal_entry (M04): the category
    # must match that type or create_transaction will reject the generation.
    expected_entry_type = "income" if data.item_type == "income" else "expense"
    category = await category_service.get_category(session, user_id, data.category_id)
    if category.type != expected_entry_type:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"category.type='{category.type}' no coincide con el tipo de entrada "
            f"'{expected_entry_type}' que genera item_type='{data.item_type}'",
        )

    # Accounting counterpart (income/expense): the user never picks it, it
    # resolves itself -- same as in simple transactions and shared expense.
    ledger_account = await account_service.get_or_create_category_ledger_account(
        session, user_id, expected_entry_type
    )

    alert_urgency = data.alert_urgency or DEFAULT_ALERT_URGENCY[data.item_type]
    item = RecurringItem(
        user_id=user_id,
        name=data.name,
        description=data.description,
        item_type=data.item_type,
        amount=data.amount,
        frequency=data.frequency,
        frequency_day=data.frequency_day,
        account_id=data.account_id,
        contra_account_id=ledger_account.id,
        category_id=data.category_id,
        alert_urgency=alert_urgency,
        auto_generate=data.auto_generate,
        next_date=data.next_date,
        notes=data.notes,
        url=data.url,
    )
    session.add(item)
    await session.flush()
    await cache_service.invalidate_snapshot_for(user_id)
    return item


async def update_recurring_item(
    session: AsyncSession, user_id: UUID, item_id: UUID, data: RecurringItemUpdate
) -> RecurringItem:
    item = await get_recurring_item(session, user_id, item_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await session.flush()
    return item


async def pause_recurring_item(
    session: AsyncSession, user_id: UUID, item_id: UUID
) -> RecurringItem:
    item = await get_recurring_item(session, user_id, item_id)
    item.status = "paused"
    await session.flush()
    return item


async def cancel_recurring_item(
    session: AsyncSession, user_id: UUID, item_id: UUID
) -> RecurringItem:
    item = await get_recurring_item(session, user_id, item_id)
    item.status = "cancelled"
    item.cancelled_at = date.today()
    await session.flush()
    return item


async def resume_recurring_item(
    session: AsyncSession, user_id: UUID, item_id: UUID
) -> RecurringItem:
    """Reactivates a paused or cancelled item. If `next_date` ended up in
    the past (paused/cancelled for a while), it's advanced to today --
    otherwise Celery would generate all at once every charge that "came
    due" while it was inactive."""
    item = await get_recurring_item(session, user_id, item_id)
    if item.status == "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este item ya esta activo")
    item.status = "active"
    item.cancelled_at = None
    if item.next_date < date.today():
        item.next_date = date.today()
    await session.flush()
    return item


async def get_upcoming(
    session: AsyncSession, user_id: UUID, days_ahead: int = 30
) -> list[RecurringItem]:
    today = date.today()
    limit_date = today + relativedelta(days=days_ahead)
    result = await session.execute(
        select(RecurringItem)
        .where(
            RecurringItem.user_id == user_id,
            RecurringItem.status == "active",
            RecurringItem.next_date >= today,
            RecurringItem.next_date <= limit_date,
            RecurringItem.deleted_at.is_(None),
        )
        .order_by(RecurringItem.next_date)
    )
    return list(result.scalars().all())


async def get_pending(session: AsyncSession, user_id: UUID) -> list[JournalEntry]:
    entries, _total = await transaction_service.list_transactions(
        session, user_id, status_="pending", is_recurring=True, per_page=100
    )
    return entries


async def get_summary(
    session: AsyncSession,
    user_id: UUID,
    *,
    exclude_income: bool = False,
    income_only: bool = False,
    item_type: str | None = None,
) -> dict:
    query = select(RecurringItem).where(
        RecurringItem.user_id == user_id,
        RecurringItem.status == "active",
        RecurringItem.deleted_at.is_(None),
    )
    if item_type:
        query = query.where(RecurringItem.item_type == item_type)
    elif income_only:
        query = query.where(RecurringItem.item_type == "income")
    elif exclude_income:
        query = query.where(RecurringItem.item_type != "income")

    result = await session.execute(query)
    items = list(result.scalars().all())

    totals_by_category: dict[UUID, Decimal] = {}
    total_monthly = Decimal("0")
    for item in items:
        monthly = monthly_equivalent(item.amount, item.frequency)
        total_monthly += monthly
        totals_by_category[item.category_id] = (
            totals_by_category.get(item.category_id, Decimal("0")) + monthly
        )

    by_category = []
    if totals_by_category:
        cat_result = await session.execute(
            select(Category.id, Category.name).where(Category.id.in_(totals_by_category))
        )
        names: dict[UUID, str] = {row[0]: row[1] for row in cat_result.all()}
        by_category = [
            {"category_id": cat_id, "category_name": names.get(cat_id, ""), "monthly_total": total}
            for cat_id, total in totals_by_category.items()
        ]

    return {"total_monthly": total_monthly, "by_category": by_category}


async def process_due_recurring_items(
    session: AsyncSession, user_id: UUID, today: date
) -> list[JournalEntry]:
    """Celery task `recurring.process_due` (per user). Generates a
    `pending` journal_entry for each overdue item; dedup: if a pending
    already exists for that recurring_id, it doesn't generate another one
    in the same period."""
    result = await session.execute(
        select(RecurringItem).where(
            RecurringItem.user_id == user_id,
            RecurringItem.status == "active",
            RecurringItem.auto_generate.is_(True),
            RecurringItem.next_date <= today,
            RecurringItem.deleted_at.is_(None),
        )
    )
    due_items = list(result.scalars().all())

    generated = []
    for item in due_items:
        existing = await session.execute(
            select(JournalEntry.id).where(
                JournalEntry.recurring_id == item.id,
                JournalEntry.status == "pending",
                JournalEntry.deleted_at.is_(None),
            )
        )
        if existing.scalar_one_or_none() is not None:
            item.next_date = compute_next_date(item.next_date, item.frequency)
            await session.flush()
            continue

        entry_type = "income" if item.item_type == "income" else "expense"
        if entry_type == "expense":
            lines = [
                JournalLineIn(account_id=item.contra_account_id, amount=item.amount, type="debit"),
                JournalLineIn(account_id=item.account_id, amount=item.amount, type="credit"),
            ]
        else:
            lines = [
                JournalLineIn(account_id=item.account_id, amount=item.amount, type="debit"),
                JournalLineIn(account_id=item.contra_account_id, amount=item.amount, type="credit"),
            ]

        entry = await transaction_service.create_transaction(
            session,
            user_id,
            TransactionCreate(
                date=today,
                description=item.name,
                entry_type=entry_type,
                category_id=item.category_id,
                lines=lines,
            ),
            entry_status="pending",
            is_recurring=True,
            recurring_id=item.id,
        )
        generated.append(entry)

        item.last_generated_at = datetime.now(UTC)
        item.next_date = compute_next_date(item.next_date, item.frequency)
        await session.flush()

        logger.info(
            "recurring_pending_generated",
            user_id=str(user_id),
            recurring_id=str(item.id),
            entry_id=str(entry.id),
            item_type=item.item_type,
        )

    return generated


async def remind_pending_recurring(session: AsyncSession, user_id: UUID, today: date) -> list[dict]:
    """Celery task `recurring.remind_pending` (per user). M14 (Notifications)
    doesn't exist yet: logs a structured entry for each reminder that would
    need to be sent, instead of writing to a nonexistent notifications table."""
    pending_entries = await get_pending(session, user_id)

    reminders = []
    for entry in pending_entries:
        if entry.recurring_id is None:
            continue
        item = await session.get(RecurringItem, entry.recurring_id)
        if item is None:
            continue

        days_pending = (today - entry.date).days
        start_day = _REMINDER_START_DAY[item.alert_urgency]
        interval = _REMINDER_INTERVAL_DAYS[item.alert_urgency]
        should_alert = days_pending >= start_day and (
            item.alert_urgency in ("critical", "high") or days_pending % interval == 0
        )
        if not should_alert:
            continue

        reminder = {
            "entry_id": entry.id,
            "recurring_id": item.id,
            "name": item.name,
            "days_pending": days_pending,
            "alert_urgency": item.alert_urgency,
        }
        reminders.append(reminder)
        logger.warning(
            "recurring_pending_reminder",
            user_id=str(user_id),
            recurring_id=str(item.id),
            entry_id=str(entry.id),
            days_pending=days_pending,
            alert_urgency=item.alert_urgency,
        )

    return reminders
