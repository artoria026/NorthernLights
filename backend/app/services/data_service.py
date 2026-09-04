from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.core.security import verify_password
from app.models.account import Account
from app.models.budget import BudgetLimit, BudgetPeriod
from app.models.chat_message import ChatMessage
from app.models.debt import Debt, UnplannedDebt
from app.models.insight import Insight
from app.models.notification import Notification
from app.models.recurring import RecurringItem
from app.models.report import Report
from app.models.transaction import JournalEntry
from app.models.user import User
from app.services import cache_service

# Fixed order, respects FK dependencies regardless of which subset the
# user requests -- see each _erase_* for the reason behind each step:
#   recurring/transactions before debts/categories/accounts (they reference them)
#   transactions before accounts (journal_lines.account_id)
#   categories after transactions/recurring/budgets (best-effort deletion)
ERASE_ORDER = (
    "notifications",
    "chat",
    "reports",
    "insights",
    "budgets",
    "recurring",
    "debts",
    "transactions",
    "categories",
    "accounts",
)


async def _erase_notifications(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(Notification).where(Notification.user_id == user_id))


async def _erase_chat(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(ChatMessage).where(ChatMessage.user_id == user_id))


async def _erase_reports(session: AsyncSession, user_id: UUID) -> None:
    # report_insights fall via ON DELETE CASCADE.
    await session.execute(delete(Report).where(Report.user_id == user_id))


async def _erase_insights(session: AsyncSession, user_id: UUID) -> None:
    # insight_reviews fall via ON DELETE CASCADE.
    await session.execute(delete(Insight).where(Insight.user_id == user_id))


async def _erase_budgets(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(BudgetPeriod).where(BudgetPeriod.user_id == user_id))
    await session.execute(delete(BudgetLimit).where(BudgetLimit.user_id == user_id))


async def _erase_recurring(session: AsyncSession, user_id: UUID) -> None:
    # journal_entries.recurring_id has no ON DELETE -- if there are
    # transactions that won't be deleted in this same pass, they need to be
    # unlinked first or the DELETE below breaks.
    await session.execute(
        update(JournalEntry).where(JournalEntry.user_id == user_id).values(recurring_id=None)
    )
    await session.execute(delete(RecurringItem).where(RecurringItem.user_id == user_id))


async def _erase_debts(session: AsyncSession, user_id: UUID) -> None:
    # unplanned_debts.converted_to_debt_id and debts.unplanned_debt_id
    # reference each other in a circle (see comment in the original
    # migration) -- break the unplanned->debt side before deleting debts.
    await session.execute(
        update(UnplannedDebt)
        .where(UnplannedDebt.user_id == user_id)
        .values(converted_to_debt_id=None)
    )
    await session.execute(delete(Debt).where(Debt.user_id == user_id))  # cascades debt_payments
    await session.execute(delete(UnplannedDebt).where(UnplannedDebt.user_id == user_id))


async def _erase_transactions(session: AsyncSession, user_id: UUID) -> None:
    # debt_payments.journal_entry_id has no ON DELETE -- if debts aren't
    # being deleted in this same pass, the payment needs to be unlinked from
    # the entry before journal_entries can be deleted (the payment itself stays).
    await session.execute(
        text(
            "UPDATE debt_payments SET journal_entry_id = NULL "
            "WHERE user_id = :uid AND journal_entry_id IS NOT NULL"
        ),
        {"uid": str(user_id)},
    )
    await session.execute(delete(JournalEntry).where(JournalEntry.user_id == user_id))
    # Without journal lines, each account's "real" balance is its initial
    # balance -- if the accounts are also going to be deleted this is a
    # harmless extra step (they get deleted afterward anyway).
    await session.execute(
        update(Account).where(Account.user_id == user_id).values(balance=Account.initial_balance)
    )


async def _erase_categories(session: AsyncSession, user_id: UUID) -> None:
    # Best-effort: only deletes the user's own categories (never system
    # ones) that nothing is using anymore. If the user requested only this
    # without deleting transactions/recurring items/budgets, the ones still
    # in use stay -- that doesn't break the whole operation.
    await session.execute(
        text(
            """
            DELETE FROM categories
            WHERE user_id = :uid AND is_system = false
            AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.category_id = categories.id)
            AND NOT EXISTS (SELECT 1 FROM recurring_items ri WHERE ri.category_id = categories.id)
            AND NOT EXISTS (SELECT 1 FROM budget_limits bl WHERE bl.category_id = categories.id)
            AND NOT EXISTS (SELECT 1 FROM budget_periods bp WHERE bp.category_id = categories.id)
            """
        ),
        {"uid": str(user_id)},
    )


async def _erase_accounts(session: AsyncSession, user_id: UUID) -> None:
    # debts.linked_account_id has no ON DELETE -- if debts weren't deleted
    # in this pass, they get unlinked (the debt stays, without an account).
    await session.execute(
        update(Debt).where(Debt.user_id == user_id).values(linked_account_id=None)
    )
    await session.execute(delete(Account).where(Account.user_id == user_id))


_ERASERS = {
    "notifications": _erase_notifications,
    "chat": _erase_chat,
    "reports": _erase_reports,
    "insights": _erase_insights,
    "budgets": _erase_budgets,
    "recurring": _erase_recurring,
    "debts": _erase_debts,
    "transactions": _erase_transactions,
    "categories": _erase_categories,
    "accounts": _erase_accounts,
}


async def erase_user_data(
    session: AsyncSession, user_id: UUID, categories: list[str], password: str | None
) -> list[str]:
    """Selective deletion by category, in a fixed order that never breaks
    on FKs regardless of which subset is requested. 'accounts' also forces
    'transactions' and 'recurring' because both reference it with NOT NULL --
    there's no way to delete an account and leave them orphaned."""
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    if user.password_hash is not None:
        if not password or not verify_password(password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Contraseña incorrecta")

    requested = set(categories)
    if "accounts" in requested:
        requested |= {"transactions", "recurring"}

    processed = [cat for cat in ERASE_ORDER if cat in requested]
    for cat in processed:
        await _ERASERS[cat](session, user_id)

    await session.flush()

    redis = await get_redis()
    await cache_service.invalidate_user_current(redis, user_id)
    await cache_service.invalidate_debt_progress(redis, user_id)
    await cache_service.invalidate_budget_cache(redis, user_id)
    await cache_service.invalidate_report_historical(redis, user_id)

    return processed
