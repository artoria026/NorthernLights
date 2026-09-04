import calendar
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import LIQUID_SUBTYPES
from app.models.account import Account
from app.models.transaction import JournalEntry, JournalLine
from app.schemas.account import AccountCreate, AccountUpdate
from app.services import cache_service

# Account types whose balance grows with a debit (standard accounting rule).
# The rest (liability, income, equity) grow with a credit.
DEBIT_NORMAL_TYPES = {"asset", "expense"}

__all__ = ["DEBIT_NORMAL_TYPES", "LIQUID_SUBTYPES"]


def balance_delta(account_type: str, line_type: str, amount: Decimal) -> Decimal:
    is_debit_normal = account_type in DEBIT_NORMAL_TYPES
    return amount if (line_type == "debit") == is_debit_normal else -amount


async def update_account_balance(
    session: AsyncSession, account_id: UUID, amount: Decimal, line_type: str
) -> None:
    """Exclusive use of the transaction service (M04), within the same DB tx."""
    account = await session.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cuenta no encontrada")
    account.balance += balance_delta(account.type, line_type, amount)


async def create_account(session: AsyncSession, user_id: UUID, data: AccountCreate) -> Account:
    account = Account(
        user_id=user_id,
        name=data.name,
        type=data.type,
        subtype=data.subtype,
        last_4_digits=data.last_4_digits,
        currency=data.currency,
        color=data.color,
        notes=data.notes,
        logo_data_url=data.logo_data_url,
        balance=data.initial_balance,
        initial_balance=data.initial_balance,
        credit_limit=data.credit_limit,
        interest_rate=data.interest_rate,
        billing_cycle_day=data.billing_cycle_day,
        payment_due_day=data.payment_due_day,
    )
    session.add(account)
    await session.flush()
    await cache_service.invalidate_snapshot_for(user_id)
    return account


async def list_accounts(session: AsyncSession, user_id: UUID) -> list[Account]:
    """Only the user's real accounts (asset/liability). Internal accounting
    engine accounts (categories, informal debt ledger) are never exposed
    here -- see 'Creacion Asistida de Cuentas' in Notion,
    get_or_create_category_ledger_account and get_or_create_debt_ledger_account."""
    result = await session.execute(
        select(Account)
        .where(
            Account.user_id == user_id,
            Account.type.in_(("asset", "liability")),
            Account.is_active.is_(True),
            Account.is_internal.is_(False),
            Account.deleted_at.is_(None),
        )
        .order_by(Account.created_at)
    )
    return list(result.scalars().all())


_LEDGER_ACCOUNT_NAME = {"income": "Ingresos", "expense": "Gastos"}
# adjustment_in/adjustment_out share a SINGLE internal accounting account
# type=equity ("Ajustes de saldo") regardless of direction -- unlike
# income/expense (where Account.type == entry_type identifies the account 1
# to 1), here both entry_type values resolve to the same account type. It's
# the same place traditional accounting absorbs reconciliation differences
# (just like an "Opening Balance Equity" in QuickBooks/Quicken).
_ADJUSTMENT_LEDGER_TYPE = "equity"
_ADJUSTMENT_LEDGER_NAME = "Ajustes de saldo"


async def get_or_create_category_ledger_account(
    session: AsyncSession, user_id: UUID, entry_type: str
) -> Account:
    """Internal accounting account used as the counterpart in the double
    entry engine for simple transactions (income/expense/adjustment_*). The
    user never sees it, picks it, or creates it -- it resolves itself here,
    one per user per type, the first time it's needed. Deliberately excluded
    from net worth (get_summary/engine_service only sum
    type in asset/liability)."""
    is_adjustment = entry_type in ("adjustment_in", "adjustment_out")
    account_type = _ADJUSTMENT_LEDGER_TYPE if is_adjustment else entry_type
    account_name = _ADJUSTMENT_LEDGER_NAME if is_adjustment else _LEDGER_ACCOUNT_NAME[entry_type]

    result = await session.execute(
        select(Account)
        .where(
            Account.user_id == user_id,
            Account.type == account_type,
            Account.is_internal.is_(True),
            Account.deleted_at.is_(None),
        )
        .order_by(Account.created_at)
        .limit(1)
    )
    account = result.scalar_one_or_none()
    if account is not None:
        return account

    account = Account(user_id=user_id, name=account_name, type=account_type, is_internal=True)
    session.add(account)
    await session.flush()
    return account


_DEBT_LEDGER = {
    # owed_by_me: what I owe -> liability. owed_to_me: what's owed to me -> asset.
    "owed_by_me": {"name": "Préstamos por pagar", "type": "liability", "subtype": "informal_debt"},
    "owed_to_me": {"name": "Préstamos por cobrar", "type": "asset", "subtype": "loan_receivable"},
}


async def get_or_create_debt_ledger_account(
    session: AsyncSession, user_id: UUID, direction: str
) -> Account:
    """Internal accounting counterpart for informal debts (M05): ONE hidden
    account per user per direction (not one per person -- the person/amount
    lives in `debts.current_balance`, not here). This way the double entry
    engine balances and the balance enters the net worth calculation
    (account_service.get_summary sums by type asset/liability regardless of
    is_internal) without the user ever seeing this account in Accounts
    (list_accounts filters out is_internal)."""
    meta = _DEBT_LEDGER[direction]
    result = await session.execute(
        select(Account)
        .where(
            Account.user_id == user_id,
            Account.type == meta["type"],
            Account.is_internal.is_(True),
            Account.subtype == meta["subtype"],
            Account.deleted_at.is_(None),
        )
        .order_by(Account.created_at)
        .limit(1)
    )
    account = result.scalar_one_or_none()
    if account is not None:
        return account

    account = Account(
        user_id=user_id,
        name=meta["name"],
        type=meta["type"],
        subtype=meta["subtype"],
        is_internal=True,
    )
    session.add(account)
    await session.flush()
    return account


async def get_account(session: AsyncSession, user_id: UUID, account_id: UUID) -> Account:
    result = await session.execute(
        select(Account).where(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cuenta no encontrada")
    return account


async def update_account(
    session: AsyncSession, user_id: UUID, account_id: UUID, data: AccountUpdate
) -> Account:
    account = await get_account(session, user_id, account_id)
    updates = data.model_dump(exclude_unset=True)

    if "initial_balance" in updates:
        new_initial = updates.pop("initial_balance")
        if new_initial is not None and new_initial != account.initial_balance:
            # Shift the current balance by the same delta -- preserves the
            # effect of all confirmed transactions, only changes the
            # starting point (same invariant data_service.py uses when
            # resetting: balance = initial_balance + sum of deltas).
            account.balance += new_initial - account.initial_balance
            account.initial_balance = new_initial
            await cache_service.invalidate_snapshot_for(user_id)

    for field, value in updates.items():
        setattr(account, field, value)
    await session.flush()
    return account


async def delete_account(session: AsyncSession, user_id: UUID, account_id: UUID) -> None:
    account = await get_account(session, user_id, account_id)
    if account.balance != 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No se puede eliminar una cuenta con saldo distinto de cero "
            f"(balance={account.balance})",
        )
    account.is_active = False


async def get_summary(session: AsyncSession, user_id: UUID) -> dict:
    result = await session.execute(
        select(
            func.coalesce(func.sum(case((Account.type == "asset", Account.balance), else_=0)), 0),
            func.coalesce(
                func.sum(case((Account.type == "liability", Account.balance), else_=0)), 0
            ),
        ).where(
            Account.user_id == user_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
    )
    total_assets, total_liabilities = result.one()
    return {
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "net_worth": total_assets - total_liabilities,
    }


def _last_occurrence(today: date, day: int) -> date:
    day = min(day, calendar.monthrange(today.year, today.month)[1])
    candidate = today.replace(day=day)
    if candidate > today:
        prev_month = today.month - 1 or 12
        prev_year = today.year - 1 if today.month == 1 else today.year
        day = min(day, calendar.monthrange(prev_year, prev_month)[1])
        candidate = date(prev_year, prev_month, day)
    return candidate


def _next_occurrence(after: date, day: int) -> date:
    next_month = after.month + 1 if after.month < 12 else 1
    next_year = after.year + 1 if after.month == 12 else after.year
    day = min(day, calendar.monthrange(next_year, next_month)[1])
    candidate = date(next_year, next_month, day)
    same_month_day = min(day, calendar.monthrange(after.year, after.month)[1])
    same_month_candidate = after.replace(day=same_month_day)
    return same_month_candidate if same_month_candidate > after else candidate


async def get_tdc_cycle(session: AsyncSession, account: Account, today: date) -> dict:
    if account.type != "liability" or not account.billing_cycle_day:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El ciclo de TDC solo aplica a cuentas de pasivo con billing_cycle_day configurado",
        )

    boundary = _last_occurrence(today, account.billing_cycle_day)
    signed_amount = case(
        (JournalLine.type == "credit", JournalLine.amount), else_=-JournalLine.amount
    )
    result = await session.execute(
        select(func.coalesce(func.sum(signed_amount), 0))
        .select_from(JournalLine)
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(
            JournalLine.account_id == account.id,
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date > boundary,
        )
    )
    current_cycle_balance = result.scalar_one()
    statement_balance = account.balance - current_cycle_balance

    payment_due_date = None
    days_until_due = None
    if account.payment_due_day:
        payment_due_date = _next_occurrence(boundary, account.payment_due_day)
        days_until_due = (payment_due_date - today).days

    return {
        "statement_balance": statement_balance,
        "current_cycle_balance": current_cycle_balance,
        "total_balance": account.balance,
        "available_credit": (
            account.credit_limit - account.balance if account.credit_limit is not None else None
        ),
        "payment_due_date": payment_due_date,
        "days_until_due": days_until_due,
        "billing_cycle_day": account.billing_cycle_day,
        "payment_due_day": account.payment_due_day,
    }
