from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.redis import get_redis
from app.models.debt import Debt, DebtPayment, UnplannedDebt
from app.models.transaction import JournalEntry
from app.schemas.debt import (
    DebtActivationRequest,
    DebtCreate,
    DebtPaymentCreate,
    DebtSimulateRequest,
    DebtUpdate,
    UnplannedDebtCreate,
    UnplannedDebtUpdate,
)
from app.schemas.transaction import JournalLineIn, TransactionCreate
from app.services import account_service, cache_service, transaction_service

logger = structlog.get_logger(__name__)

FREQUENCY_FACTORS = {
    "weekly": Decimal("52") / 12,
    "biweekly": Decimal("26") / 12,
    "monthly": Decimal("1"),
    "irregular": Decimal("1"),
}


def monthly_equivalent(payment_amount: Decimal | None, frequency: str | None) -> Decimal:
    if payment_amount is None or frequency is None:
        return Decimal("0")
    result = payment_amount * FREQUENCY_FACTORS[frequency]
    return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _advance_date(current: date, frequency: str | None) -> date | None:
    if frequency == "weekly":
        return current + relativedelta(weeks=1)
    if frequency == "biweekly":
        return current + relativedelta(weeks=2)
    if frequency == "monthly":
        return current + relativedelta(months=1)
    return None  # irregular: can't be projected automatically


# ---------------------------------------------------------------------------
# Unplanned debts
# ---------------------------------------------------------------------------


async def list_unplanned_debts(session: AsyncSession, user_id: UUID) -> list[UnplannedDebt]:
    result = await session.execute(
        select(UnplannedDebt).where(
            UnplannedDebt.user_id == user_id,
            UnplannedDebt.status == "pending",
            UnplannedDebt.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def get_unplanned_debt(session: AsyncSession, user_id: UUID, id_: UUID) -> UnplannedDebt:
    result = await session.execute(
        select(UnplannedDebt).where(
            UnplannedDebt.id == id_,
            UnplannedDebt.user_id == user_id,
            UnplannedDebt.deleted_at.is_(None),
        )
    )
    unplanned = result.scalar_one_or_none()
    if unplanned is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deuda sin plan no encontrada")
    return unplanned


async def create_unplanned_debt(
    session: AsyncSession, user_id: UUID, data: UnplannedDebtCreate
) -> UnplannedDebt:
    unplanned = UnplannedDebt(
        user_id=user_id,
        name=data.name,
        creditor=data.creditor,
        amount=data.amount,
        direction=data.direction,
        notes=data.notes,
    )
    session.add(unplanned)
    await session.flush()
    await cache_service.invalidate_snapshot_for(user_id)
    return unplanned


async def update_unplanned_debt(
    session: AsyncSession, user_id: UUID, id_: UUID, data: UnplannedDebtUpdate
) -> UnplannedDebt:
    unplanned = await get_unplanned_debt(session, user_id, id_)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(unplanned, field, value)
    await session.flush()
    return unplanned


async def delete_unplanned_debt(session: AsyncSession, user_id: UUID, id_: UUID) -> None:
    unplanned = await get_unplanned_debt(session, user_id, id_)
    unplanned.deleted_at = datetime.now(UTC)


async def get_or_create_informal_debt(
    session: AsyncSession, user_id: UUID, direction: str, name: str
) -> Debt:
    """Informal debt per person (one per name, case-insensitive, not an
    Account) -- used by Shared expense and by direct loans with no plan.
    If an active one already exists with that name/direction it's reused
    and the caller adds the new amount to it; otherwise it's created at zero."""
    clean_name = name.strip()
    result = await session.execute(
        select(Debt).where(
            Debt.user_id == user_id,
            Debt.direction == direction,
            Debt.type == "informal",
            Debt.status == "active",
            Debt.deleted_at.is_(None),
            func.lower(Debt.name) == clean_name.lower(),
        )
    )
    debt = result.scalar_one_or_none()
    if debt is not None:
        return debt

    debt = Debt(
        user_id=user_id,
        name=clean_name,
        type="informal",
        direction=direction,
        total_amount=Decimal("0"),
        current_balance=Decimal("0"),
    )
    session.add(debt)
    await session.flush()
    return debt


async def _fund_debt(
    session: AsyncSession,
    user_id: UUID,
    direction: str,
    funding_account_id: UUID,
    amount: Decimal,
    date_: date,
    name: str,
) -> None:
    """Records the real cash movement when a debt originates with money
    actually changing hands (someone lends you money that lands in an
    account of yours, or you lend and it leaves an account of yours). The
    other leg is ALWAYS the hidden informal debt ledger (one account per
    user per direction, never one per person) -- see
    account_service.get_or_create_debt_ledger_account."""
    ledger = await account_service.get_or_create_debt_ledger_account(session, user_id, direction)
    if direction == "owed_by_me":
        lines = [
            JournalLineIn(account_id=funding_account_id, amount=amount, type="debit"),
            JournalLineIn(account_id=ledger.id, amount=amount, type="credit"),
        ]
        description = f"Préstamo recibido — {name}"
        entry_type = "loan_received"
    else:
        lines = [
            JournalLineIn(account_id=ledger.id, amount=amount, type="debit"),
            JournalLineIn(account_id=funding_account_id, amount=amount, type="credit"),
        ]
        description = f"Préstamo a {name}"
        entry_type = "loan_given"

    await transaction_service.create_transaction(
        session,
        user_id,
        TransactionCreate(date=date_, description=description, entry_type=entry_type, lines=lines),
    )


async def activate_unplanned_debt(
    session: AsyncSession, user_id: UUID, id_: UUID, plan: DebtActivationRequest
) -> Debt:
    unplanned = await get_unplanned_debt(session, user_id, id_)
    if unplanned.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta deuda ya fue activada")

    total = plan.agreed_amount if plan.agreed_amount is not None else unplanned.amount
    debt = Debt(
        user_id=user_id,
        unplanned_debt_id=unplanned.id,
        name=unplanned.name,
        creditor=unplanned.creditor,
        type="informal",
        direction=unplanned.direction,
        original_amount=unplanned.amount,
        agreed_amount=plan.agreed_amount,
        total_amount=total,
        current_balance=total,
        payment_amount=plan.payment_amount,
        payment_frequency=plan.payment_frequency,
        payment_day=plan.payment_day,
        total_installments=plan.total_installments,
        linked_account_id=plan.linked_account_id,
        payment_source_account_id=plan.payment_source_account_id,
        start_date=plan.start_date,
        next_payment_date=plan.start_date,
        due_date=plan.due_date,
        notes=unplanned.notes,
    )
    session.add(debt)
    await session.flush()

    if plan.funding_account_id:
        await _fund_debt(
            session,
            user_id,
            unplanned.direction,
            plan.funding_account_id,
            total,
            plan.start_date,
            debt.name,
        )

    unplanned.status = "converted"
    unplanned.converted_to_debt_id = debt.id
    await session.flush()
    return debt


# ---------------------------------------------------------------------------
# Debts
# ---------------------------------------------------------------------------


async def list_debts(
    session: AsyncSession, user_id: UUID, status_: str | None = None, direction: str | None = None
) -> list[Debt]:
    query = select(Debt).where(Debt.user_id == user_id, Debt.deleted_at.is_(None))
    if status_:
        query = query.where(Debt.status == status_)
    if direction:
        query = query.where(Debt.direction == direction)
    result = await session.execute(query.order_by(Debt.created_at))
    return list(result.scalars().all())


async def get_debt(session: AsyncSession, user_id: UUID, debt_id: UUID) -> Debt:
    result = await session.execute(
        select(Debt).where(Debt.id == debt_id, Debt.user_id == user_id, Debt.deleted_at.is_(None))
    )
    debt = result.scalar_one_or_none()
    if debt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deuda no encontrada")
    return debt


async def create_debt(
    session: AsyncSession, user_id: UUID, data: DebtCreate, current_user_role: str
) -> Debt:
    # Shared debts: only admin can write is_shared/responsible_party.
    is_shared = data.is_shared
    responsible_party = data.responsible_party
    if (is_shared or responsible_party) and current_user_role != "admin":
        is_shared = False
        responsible_party = None

    debt = Debt(
        user_id=user_id,
        name=data.name,
        creditor=data.creditor,
        type=data.type,
        direction=data.direction,
        original_amount=data.original_amount,
        agreed_amount=data.agreed_amount,
        total_amount=data.total_amount,
        current_balance=(
            data.current_balance if data.current_balance is not None else data.total_amount
        ),
        interest_rate=data.interest_rate,
        payment_amount=data.payment_amount,
        payment_frequency=data.payment_frequency,
        payment_day=data.payment_day,
        total_installments=data.total_installments,
        linked_account_id=data.linked_account_id,
        payment_source_account_id=data.payment_source_account_id,
        start_date=data.start_date,
        estimated_end_date=data.estimated_end_date,
        next_payment_date=data.next_payment_date,
        due_date=data.due_date,
        is_shared=is_shared,
        responsible_party=responsible_party,
        notes=data.notes,
    )
    session.add(debt)
    await session.flush()

    if data.funding_account_id:
        await _fund_debt(
            session,
            user_id,
            data.direction,
            data.funding_account_id,
            data.total_amount,
            data.start_date or date.today(),
            debt.name,
        )

    # Unconditional even though funding_account_id already invalidates the
    # cache via transaction_service.create_transaction: without it (the
    # common case), create_debt by itself didn't touch the cached snapshot.
    await cache_service.invalidate_snapshot_for(user_id)
    return debt


async def update_debt(
    session: AsyncSession, user_id: UUID, debt_id: UUID, data: DebtUpdate
) -> Debt:
    debt = await get_debt(session, user_id, debt_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(debt, field, value)
    await session.flush()
    return debt


async def delete_debt(session: AsyncSession, user_id: UUID, debt_id: UUID) -> None:
    debt = await get_debt(session, user_id, debt_id)
    if debt.current_balance != 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"No se puede eliminar una deuda con saldo pendiente (balance={debt.current_balance})",
        )
    debt.deleted_at = datetime.now(UTC)


async def _resolve_debt_side_account(session: AsyncSession, user_id: UUID, debt: Debt) -> UUID:
    """If the debt has a real linked account (the user assigned it
    explicitly, e.g. to track where each payment comes from) the payment
    goes straight against it -- so its balance really goes down too, not
    just the number in Debts. Without a linked account (the normal case for
    informal debts/loans) it uses the hidden ledger as the other leg of the
    entry."""
    if debt.linked_account_id is not None:
        return debt.linked_account_id
    ledger = await account_service.get_or_create_debt_ledger_account(
        session, user_id, debt.direction
    )
    return ledger.id


def _build_payment_lines(
    debt: Debt, debt_side_account_id: UUID, real_account_id: UUID, amount: Decimal
) -> tuple[list[JournalLineIn], str, str]:
    if debt.direction == "owed_by_me":
        # You pay your debt: money leaves your real account, liability goes down.
        lines = [
            JournalLineIn(account_id=debt_side_account_id, amount=amount, type="debit"),
            JournalLineIn(account_id=real_account_id, amount=amount, type="credit"),
        ]
        return lines, f"Pago {debt.name}", "loan_repayment"
    # You get paid/collect: money enters your real account, what's owed to you goes down.
    lines = [
        JournalLineIn(account_id=real_account_id, amount=amount, type="debit"),
        JournalLineIn(account_id=debt_side_account_id, amount=amount, type="credit"),
    ]
    return lines, f"Pago recibido — {debt.name}", "loan_collection"


async def _apply_payment(
    session: AsyncSession,
    user_id: UUID,
    debt: Debt,
    journal_entry_id: UUID,
    amount: Decimal,
    date_: date,
    notes: str | None,
) -> DebtPayment:
    """Effect of a payment ALREADY recorded (transaction already created):
    lowers balance, raises paid installments, marks completed if
    applicable. Does NOT touch next_payment_date -- each caller decides that
    (register_debt_payment advances it immediately; a draft generated by
    process_due_debt_payments already advanced it when generated, confirming
    it must not advance it again)."""
    new_balance = debt.current_balance - amount
    payment = DebtPayment(
        debt_id=debt.id,
        user_id=user_id,
        amount=amount,
        date=date_,
        payment_number=debt.paid_installments + 1,
        journal_entry_id=journal_entry_id,
        notes=notes,
    )
    session.add(payment)

    debt.current_balance = new_balance
    debt.paid_installments += 1

    if new_balance <= 0:
        debt.status = "completed"
        debt.current_balance = Decimal("0")
        debt.next_payment_date = None
    elif debt.payment_amount and debt.payment_amount > 0:
        remaining_installments = new_balance / debt.payment_amount
        factor = FREQUENCY_FACTORS.get(debt.payment_frequency or "monthly", Decimal("1"))
        months_left = remaining_installments / factor if factor else remaining_installments
        debt.estimated_end_date = date.today() + relativedelta(
            months=int(months_left) + (1 if months_left % 1 else 0)
        )

    await session.flush()

    redis = await get_redis()
    await cache_service.invalidate_debt_progress(redis, user_id)

    return payment


async def register_debt_payment(
    session: AsyncSession, user_id: UUID, debt_id: UUID, data: DebtPaymentCreate
) -> DebtPayment:
    debt = await get_debt(session, user_id, debt_id)
    if debt.status != "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se pagan deudas activas")

    debt_side_account_id = await _resolve_debt_side_account(session, user_id, debt)
    lines, description, entry_type = _build_payment_lines(
        debt, debt_side_account_id, data.account_id, data.amount
    )

    entry = await transaction_service.create_transaction(
        session,
        user_id,
        TransactionCreate(
            date=data.date, description=description, entry_type=entry_type, lines=lines
        ),
    )

    if debt.next_payment_date:
        debt.next_payment_date = _advance_date(debt.next_payment_date, debt.payment_frequency)

    return await _apply_payment(
        session, user_id, debt, entry.id, data.amount, data.date, data.notes
    )


async def apply_confirmed_payment(session: AsyncSession, entry: JournalEntry) -> None:
    """Called by transaction_service.confirm_draft when the draft being
    confirmed is a debt payment generated by process_due_debt_payments. The
    schedule (next_payment_date) already advanced when the draft was
    generated -- here only the money effect (balance/installments/payment
    record) gets applied."""
    debt = await get_debt(session, entry.user_id, entry.debt_id)
    if debt.status != "active":
        # It got completed/cancelled between the draft being generated and
        # confirmed -- the transaction was already applied via
        # _apply_lines, nothing more to do.
        return
    await _apply_payment(
        session, entry.user_id, debt, entry.id, entry.amount or Decimal("0"), entry.date, None
    )


async def get_pending(session: AsyncSession, user_id: UUID) -> list[JournalEntry]:
    result = await session.execute(
        select(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.status == "pending",
            JournalEntry.debt_id.is_not(None),
            JournalEntry.deleted_at.is_(None),
        )
        .options(selectinload(JournalEntry.lines))
        .order_by(JournalEntry.date)
    )
    return list(result.scalars().all())


async def process_due_debt_payments(
    session: AsyncSession, user_id: UUID, today: date
) -> list[JournalEntry]:
    """Celery task `debts.process_due_payments` (per user). Generates a
    `pending` journal_entry for each overdue debt that has a payment
    account configured (payment_source_account_id) -- without that there's
    nowhere to pull the money from, it stays in the manual flow. Dedup same
    as recurring: if a pending already exists for that debt, it doesn't
    generate another one, just advances the date."""
    result = await session.execute(
        select(Debt).where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.payment_source_account_id.is_not(None),
            Debt.payment_amount.is_not(None),
            Debt.payment_frequency.is_not(None),
            Debt.next_payment_date.is_not(None),
            Debt.next_payment_date <= today,
            Debt.deleted_at.is_(None),
        )
    )
    due_debts = list(result.scalars().all())

    generated = []
    for debt in due_debts:
        existing = await session.execute(
            select(JournalEntry.id).where(
                JournalEntry.debt_id == debt.id,
                JournalEntry.status == "pending",
                JournalEntry.deleted_at.is_(None),
            )
        )
        if existing.scalar_one_or_none() is not None:
            debt.next_payment_date = _advance_date(debt.next_payment_date, debt.payment_frequency)
            await session.flush()
            continue

        debt_side_account_id = await _resolve_debt_side_account(session, user_id, debt)
        amount = (
            min(debt.payment_amount, debt.current_balance)
            if debt.current_balance > 0
            else debt.payment_amount
        )
        lines, description, entry_type = _build_payment_lines(
            debt, debt_side_account_id, debt.payment_source_account_id, amount
        )

        entry = await transaction_service.create_transaction(
            session,
            user_id,
            TransactionCreate(
                date=today, description=description, entry_type=entry_type, lines=lines
            ),
            entry_status="pending",
            debt_id=debt.id,
        )
        generated.append(entry)

        debt.next_payment_date = _advance_date(debt.next_payment_date, debt.payment_frequency)
        await session.flush()

        logger.info(
            "debt_pending_payment_generated",
            user_id=str(user_id),
            debt_id=str(debt.id),
            entry_id=str(entry.id),
        )

    return generated


async def get_schedule(
    session: AsyncSession, user_id: UUID, debt_id: UUID, count: int = 12
) -> list[dict]:
    debt = await get_debt(session, user_id, debt_id)
    if not debt.next_payment_date or not debt.payment_amount:
        return []

    schedule = []
    balance = debt.current_balance
    current_date = debt.next_payment_date
    installment_number = debt.paid_installments + 1

    for _ in range(count):
        if balance <= 0:
            break
        amount = min(debt.payment_amount, balance)
        balance -= amount
        schedule.append(
            {
                "installment_number": installment_number,
                "due_date": current_date,
                "amount": amount,
                "remaining_balance": balance,
            }
        )
        installment_number += 1
        next_date = _advance_date(current_date, debt.payment_frequency)
        if next_date is None:
            break
        current_date = next_date

    return schedule


async def get_upcoming(session: AsyncSession, user_id: UUID, days_ahead: int = 30) -> list[Debt]:
    today = date.today()
    limit_date = today + relativedelta(days=days_ahead)
    result = await session.execute(
        select(Debt)
        .where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.next_payment_date.is_not(None),
            Debt.next_payment_date >= today,
            Debt.next_payment_date <= limit_date,
            Debt.deleted_at.is_(None),
        )
        .order_by(Debt.next_payment_date)
    )
    return list(result.scalars().all())


async def simulate(session: AsyncSession, user_id: UUID, data: DebtSimulateRequest) -> dict:
    # Only debts YOU owe commit your budget -- what's owed to you isn't a
    # monthly expense of yours.
    result = await session.execute(
        select(Debt.payment_amount, Debt.payment_frequency).where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.direction == "owed_by_me",
            Debt.deleted_at.is_(None),
        )
    )
    current_total = sum(
        (monthly_equivalent(amount, freq) for amount, freq in result.all()), Decimal("0")
    )
    new_commitment = monthly_equivalent(data.payment_amount, data.payment_frequency)
    new_total = current_total + new_commitment

    return {
        "current_monthly_committed": current_total,
        "new_monthly_committed": new_total,
        "delta": new_commitment,
    }


async def get_summary(session: AsyncSession, user_id: UUID) -> dict:
    debts_result = await session.execute(
        select(
            Debt.current_balance,
            Debt.payment_amount,
            Debt.payment_frequency,
            Debt.status,
            Debt.direction,
        ).where(Debt.user_id == user_id, Debt.deleted_at.is_(None))
    )
    rows = debts_result.all()
    active_rows = [r for r in rows if r.status == "active"]

    total_owed_by_me = sum(
        (
            r.current_balance
            for r in rows
            if r.status != "completed" and r.direction == "owed_by_me"
        ),
        Decimal("0"),
    )
    total_owed_to_me = sum(
        (
            r.current_balance
            for r in rows
            if r.status != "completed" and r.direction == "owed_to_me"
        ),
        Decimal("0"),
    )
    # Only what YOU owe commits your monthly budget.
    monthly_committed = sum(
        (
            monthly_equivalent(r.payment_amount, r.payment_frequency)
            for r in active_rows
            if r.direction == "owed_by_me"
        ),
        Decimal("0"),
    )

    unplanned_result = await session.execute(
        select(UnplannedDebt.direction, func.coalesce(func.sum(UnplannedDebt.amount), 0))
        .where(
            UnplannedDebt.user_id == user_id,
            UnplannedDebt.status == "pending",
            UnplannedDebt.deleted_at.is_(None),
        )
        .group_by(UnplannedDebt.direction)
    )
    unplanned_totals = dict(unplanned_result.all())

    return {
        "total_owed_by_me": total_owed_by_me,
        "total_owed_to_me": total_owed_to_me,
        "monthly_committed": monthly_committed,
        "active_count": len(active_rows),
        "unplanned_owed_by_me": unplanned_totals.get("owed_by_me", Decimal("0")),
        "unplanned_owed_to_me": unplanned_totals.get("owed_to_me", Decimal("0")),
    }
