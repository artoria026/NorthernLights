from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.redis import get_redis
from app.models.account import Account
from app.models.debt import InstallmentPlan
from app.models.transaction import JournalEntry, JournalLine
from app.schemas.transaction import (
    InstallmentInfo,
    JournalLineIn,
    SplitExpenseCreate,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from app.services import account_service, cache_service, category_service

INVERSE_LINE_TYPE = {"debit": "credit", "credit": "debit"}


async def get_category_name_map(
    session: AsyncSession, entries: list[JournalEntry]
) -> dict[UUID, str]:
    ids = list({e.category_id for e in entries if e.category_id is not None})
    return await category_service.get_names_by_ids(session, ids)


async def _get_installment_map(
    session: AsyncSession, entries: list[JournalEntry]
) -> dict[UUID, InstallmentInfo]:
    entry_ids = [e.id for e in entries]
    if not entry_ids:
        return {}
    result = await session.execute(
        select(InstallmentPlan).where(InstallmentPlan.journal_entry_id.in_(entry_ids))
    )
    plans = {p.journal_entry_id: p for p in result.scalars().all()}
    if not plans:
        return {}

    entries_by_id = {e.id: e for e in entries}
    today = date.today()
    out: dict[UUID, InstallmentInfo] = {}
    for entry_id, plan in plans.items():
        entry = entries_by_id[entry_id]
        elapsed = relativedelta(today, entry.date)
        months_elapsed = max(elapsed.years * 12 + elapsed.months, 0)
        monthly_amount = (
            ((entry.amount or Decimal("0")) / plan.total_installments)
            .quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        )
        out[entry_id] = InstallmentInfo(
            total_installments=plan.total_installments,
            paid_installments=min(months_elapsed, plan.total_installments),
            monthly_amount=monthly_amount,
        )
    return out


async def to_transaction_out_list(
    session: AsyncSession, entries: list[JournalEntry]
) -> list[TransactionOut]:
    names = await get_category_name_map(session, entries)
    installments = await _get_installment_map(session, entries)
    out = []
    for entry in entries:
        item = TransactionOut.model_validate(entry)
        item.category_name = names.get(entry.category_id) if entry.category_id else None
        item.installment = installments.get(entry.id)
        out.append(item)
    return out


async def _validate_category(
    session: AsyncSession, user_id: UUID, entry_type: str, category_id: UUID | None
) -> None:
    requires_category = entry_type in ("income", "expense")
    if requires_category:
        if category_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "income/expense requieren category_id")
        category = await category_service.get_category(session, user_id, category_id)
        if category.type != entry_type:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"category.type='{category.type}' no coincide con entry_type='{entry_type}'",
            )
    elif category_id is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"entry_type='{entry_type}' no acepta category_id "
            "(transfer/loan/adjustment son movimientos contables)",
        )


async def _apply_lines(session: AsyncSession, lines: list[JournalLine]) -> None:
    for line in lines:
        await account_service.update_account_balance(
            session, line.account_id, line.amount, line.type
        )


async def _revert_lines(session: AsyncSession, lines: list[JournalLine]) -> None:
    for line in lines:
        await account_service.update_account_balance(
            session, line.account_id, line.amount, INVERSE_LINE_TYPE[line.type]
        )


def _display_amount(lines: list[JournalLineIn]) -> Decimal:
    return sum((line.amount for line in lines if line.type == "debit"), Decimal(0))


async def _resolve_lines(
    session: AsyncSession, user_id: UUID, data: TransactionCreate
) -> list[JournalLineIn]:
    """Si el caller ya mando 'lines' (transfer/prestamos), se usan tal cual.
    Si no (income/expense simple), el backend resuelve la cuenta contable
    interna de la categoria y arma el asiento el solo -- el front nunca elige
    ni ve esa cuenta. La validacion de TransactionCreate ya garantiza que
    account_id/amount vienen presentes en este caso."""
    if data.lines is not None:
        return data.lines

    ledger_account = await account_service.get_or_create_category_ledger_account(
        session, user_id, data.entry_type
    )
    # adjustment_in se comporta como income (aumenta el saldo de la cuenta
    # real) y adjustment_out como expense (lo disminuye) -- misma mecanica de
    # debito/credito, solo cambia la cuenta contable interna del otro lado
    # (ver get_or_create_category_ledger_account).
    is_increase = data.entry_type in ("income", "adjustment_in")
    paying = JournalLineIn(
        account_id=data.account_id,  # type: ignore[arg-type]
        amount=data.amount,  # type: ignore[arg-type]
        type="debit" if is_increase else "credit",
    )
    ledger = JournalLineIn(
        account_id=ledger_account.id,
        amount=data.amount,  # type: ignore[arg-type]
        type="credit" if is_increase else "debit",
    )
    return [paying, ledger] if is_increase else [ledger, paying]


async def _validate_line_accounts(
    session: AsyncSession, user_id: UUID, lines: list[JournalLineIn]
) -> None:
    """Sin este chequeo, un account_id de otro usuario (mandado a mano o via
    linked_account_id/funding_account_id de deudas/recurrentes) pasaria de
    largo y update_account_balance moveria el saldo real de una cuenta ajena:
    esa funcion hace session.get(Account, account_id) sin filtrar por
    user_id, y las policies RLS de Postgres no protegen aqui porque el rol
    con el que corre la app es OWNER de las tablas (RLS no aplica al owner
    salvo que la tabla tenga FORCE ROW LEVEL SECURITY)."""
    account_ids = {line.account_id for line in lines}
    result = await session.execute(
        select(func.count())
        .select_from(Account)
        .where(Account.id.in_(account_ids), Account.user_id == user_id)
    )
    if result.scalar_one() != len(account_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cuenta no encontrada")


async def _validate_installment_account(
    session: AsyncSession, user_id: UUID, account_id: UUID
) -> None:
    account = await account_service.get_account(session, user_id, account_id)
    if account.type != "liability" or account.subtype != "credit_card":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Una compra a meses sin intereses solo aplica pagando con una tarjeta de credito",
        )


async def _invalidate_cache(user_id: UUID) -> None:
    """M09: invalidar snapshot/reportes cacheados en cada transaccion confirmed
    (creacion, edicion, borrado o confirmacion de un draft/pending)."""
    redis = await get_redis()
    await cache_service.invalidate_user_current(redis, user_id)


async def _on_confirmed(session: AsyncSession, entry: JournalEntry, amount: Decimal) -> None:
    """Hook exportado para M07: solo transacciones `confirmed` de tipo
    'expense' con category_id mueven `budget_periods.spent` -- el presupuesto
    variable es exclusivamente de gasto por categoria. Sin el filtro de
    entry_type, un ingreso categorizado (income/adjustment_in con categoria)
    tambien escribia aqui y se colaba en el desglose de presupuesto como si
    fuera gasto, inflando variable_total_spent y el card "Gastado" -- bug
    real detectado en produccion local el 2026-08-09 (ver migracion
    de limpieza de datos correspondiente). Import local para evitar el ciclo
    transaction_service -> budget_service -> recurring_service -> transaction_service."""
    if entry.category_id is None or entry.entry_type != "expense":
        return
    from app.services import budget_service

    await budget_service.upsert_period_spent(
        session, entry.user_id, entry.category_id, entry.date, amount
    )


async def create_transaction(
    session: AsyncSession,
    user_id: UUID,
    data: TransactionCreate,
    entry_status: str = "confirmed",
    is_recurring: bool = False,
    recurring_id: UUID | None = None,
    debt_id: UUID | None = None,
) -> JournalEntry:
    await _validate_category(session, user_id, data.entry_type, data.category_id)
    if data.installment_total is not None:
        await _validate_installment_account(session, user_id, data.account_id)  # type: ignore[arg-type]
    resolved_lines = await _resolve_lines(session, user_id, data)
    await _validate_line_accounts(session, user_id, resolved_lines)

    entry = JournalEntry(
        user_id=user_id,
        date=data.date,
        description=data.description,
        notes=data.notes,
        tags=data.tags,
        amount=_display_amount(resolved_lines),
        entry_type=data.entry_type,
        category_id=data.category_id,
        status=entry_status,
        is_recurring=is_recurring,
        recurring_id=recurring_id,
        debt_id=debt_id,
    )
    session.add(entry)
    await session.flush()

    lines = [
        JournalLine(
            entry_id=entry.id,
            account_id=line_in.account_id,
            amount=line_in.amount,
            type=line_in.type,
        )
        for line_in in resolved_lines
    ]
    session.add_all(lines)
    await session.flush()

    if data.installment_total is not None:
        session.add(
            InstallmentPlan(
                user_id=user_id,
                journal_entry_id=entry.id,
                total_installments=data.installment_total,
            )
        )
        await session.flush()

    if entry_status == "confirmed":
        await _apply_lines(session, lines)
        await _on_confirmed(session, entry, entry.amount or Decimal("0"))
        await _invalidate_cache(user_id)

    await session.refresh(entry, attribute_names=["lines"])
    return entry


async def split_expense(
    session: AsyncSession, user_id: UUID, data: SplitExpenseCreate
) -> JournalEntry:
    """Mi parte real se debita contra la cuenta contable interna de gasto,
    igual que cualquier gasto simple -- el front nunca elige esa cuenta. La
    parte de cada deudor sube su saldo 'me deben' en Deudas (direction=
    owed_to_me), resuelto/creado solo por nombre -- import local de
    debt_service para evitar el ciclo transaction_service -> debt_service ->
    transaction_service (misma razon que _on_confirmed con budget_service)."""
    from app.services import debt_service

    ledger_account = await account_service.get_or_create_category_ledger_account(
        session, user_id, "expense"
    )
    receivable_ledger = await account_service.get_or_create_debt_ledger_account(
        session, user_id, "owed_to_me"
    )
    total = data.my_share + sum(d.amount for d in data.debtors)
    lines = [
        JournalLineIn(account_id=ledger_account.id, amount=data.my_share, type="debit"),
        *[
            JournalLineIn(account_id=receivable_ledger.id, amount=d.amount, type="debit")
            for d in data.debtors
        ],
        JournalLineIn(account_id=data.paying_account_id, amount=total, type="credit"),
    ]
    tx_data = TransactionCreate(
        date=data.date,
        description=data.description,
        notes=data.notes,
        entry_type="expense",
        category_id=data.category_id,
        lines=lines,
    )
    entry = await create_transaction(session, user_id, tx_data)

    for debtor in data.debtors:
        debt = await debt_service.get_or_create_informal_debt(
            session, user_id, "owed_to_me", debtor.person_name
        )
        debt.current_balance += debtor.amount
        debt.total_amount += debtor.amount
        debt.status = "active"

    return entry


async def get_transaction(session: AsyncSession, user_id: UUID, entry_id: UUID) -> JournalEntry:
    result = await session.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines))
        .where(
            JournalEntry.id == entry_id,
            JournalEntry.user_id == user_id,
            JournalEntry.deleted_at.is_(None),
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaccion no encontrada")
    return entry


async def list_transactions(
    session: AsyncSession,
    user_id: UUID,
    *,
    page: int = 1,
    per_page: int = 20,
    entry_type: str | None = None,
    category_id: UUID | None = None,
    account_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status_: str | None = None,
    is_recurring: bool | None = None,
    tags: list[str] | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    q: str | None = None,
) -> tuple[list[JournalEntry], int]:
    query = select(JournalEntry).where(
        JournalEntry.user_id == user_id, JournalEntry.deleted_at.is_(None)
    )
    if entry_type:
        query = query.where(JournalEntry.entry_type == entry_type)
    if category_id:
        query = query.where(JournalEntry.category_id == category_id)
    if account_id:
        query = query.where(
            JournalEntry.id.in_(
                select(JournalLine.entry_id).where(JournalLine.account_id == account_id)
            )
        )
    if date_from:
        query = query.where(JournalEntry.date >= date_from)
    if date_to:
        query = query.where(JournalEntry.date <= date_to)
    if status_:
        query = query.where(JournalEntry.status == status_)
    if is_recurring is not None:
        query = query.where(JournalEntry.is_recurring == is_recurring)
    if tags:
        query = query.where(JournalEntry.tags.overlap(tags))
    if amount_min is not None:
        query = query.where(JournalEntry.amount >= amount_min)
    if amount_max is not None:
        query = query.where(JournalEntry.amount <= amount_max)
    if q:
        query = query.where(JournalEntry.description.ilike(f"%{q}%"))

    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()

    query = (
        query.options(selectinload(JournalEntry.lines))
        .order_by(JournalEntry.date.desc(), JournalEntry.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await session.execute(query)
    return list(result.scalars().all()), total


async def update_transaction(
    session: AsyncSession, user_id: UUID, entry_id: UUID, data: TransactionUpdate
) -> JournalEntry:
    """No se editan las lines directamente: se revierte y soft-deletea la entrada
    anterior y se crea una nueva, preservando el historial."""
    old_entry = await get_transaction(session, user_id, entry_id)
    if old_entry.status != "confirmed":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Solo se editan transacciones confirmadas; usa confirm/reject para borradores",
        )

    if data.lines is not None:
        debits = sum(line.amount for line in data.lines if line.type == "debit")
        credits = sum(line.amount for line in data.lines if line.type == "credit")
        if debits != credits:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debitos deben igualar creditos")

    new_entry_type = old_entry.entry_type
    new_category_id = data.category_id if data.category_id is not None else old_entry.category_id
    await _validate_category(session, user_id, new_entry_type, new_category_id)

    await _revert_lines(session, old_entry.lines)
    if old_entry.category_id is not None:
        await _on_confirmed(session, old_entry, -(old_entry.amount or Decimal("0")))
    old_entry.deleted_at = datetime.now(UTC)
    await _invalidate_cache(user_id)

    new_account_id: UUID | None = None
    new_amount: Decimal | None = None
    new_lines: list[JournalLineIn] | None
    if data.lines is not None:
        new_lines = data.lines
    elif data.account_id is not None or data.amount is not None:
        # Cambio de monto/cuenta en la forma simple (expense/income): se
        # resuelve igual que en create_transaction (_resolve_lines), asi el
        # front nunca necesita conocer la cuenta contable interna de la
        # categoria. Esa cuenta ledger es la misma para todo el entry_type
        # (no depende de la categoria), asi que basta excluirla de las lines
        # viejas para recuperar cual era la cuenta "real" antes de este cambio.
        if new_entry_type not in ("income", "expense", "adjustment_in", "adjustment_out"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"entry_type='{new_entry_type}' no acepta account_id/amount sueltos, usa 'lines'",
            )
        ledger = await account_service.get_or_create_category_ledger_account(
            session, user_id, new_entry_type
        )
        old_real_line = next(line for line in old_entry.lines if line.account_id != ledger.id)
        new_account_id = data.account_id or old_real_line.account_id
        new_amount = data.amount or old_real_line.amount
        new_lines = None
    else:
        new_lines = [
            JournalLineIn(account_id=line.account_id, amount=line.amount, type=line.type)
            for line in old_entry.lines
        ]

    new_data = TransactionCreate(
        date=data.date or old_entry.date,
        description=data.description or old_entry.description,
        notes=data.notes if data.notes is not None else old_entry.notes,
        tags=data.tags if data.tags is not None else (old_entry.tags or []),
        entry_type=new_entry_type,
        category_id=new_category_id,
        account_id=new_account_id,
        amount=new_amount,
        lines=new_lines,
    )
    return await create_transaction(session, user_id, new_data, is_recurring=old_entry.is_recurring)


async def delete_transaction(session: AsyncSession, user_id: UUID, entry_id: UUID) -> None:
    entry = await get_transaction(session, user_id, entry_id)
    if entry.status == "confirmed":
        await _revert_lines(session, entry.lines)
        if entry.category_id is not None:
            await _on_confirmed(session, entry, -(entry.amount or Decimal("0")))
        await _invalidate_cache(user_id)
    entry.deleted_at = datetime.now(UTC)


async def confirm_draft(
    session: AsyncSession, user_id: UUID, entry_id: UUID, edits: TransactionUpdate | None = None
) -> JournalEntry:
    """Confirma un `draft` (creado a mano, M04) o un `pending` (generado por
    Celery, M06) — mismo endpoint para ambos, per spec de M06."""
    entry = await get_transaction(session, user_id, entry_id)
    if entry.status not in ("draft", "pending"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Solo se pueden confirmar borradores o pendientes"
        )

    if edits:
        if edits.date is not None:
            entry.date = edits.date
        if edits.description is not None:
            entry.description = edits.description
        if edits.notes is not None:
            entry.notes = edits.notes
        if edits.tags is not None:
            entry.tags = edits.tags
        if edits.category_id is not None:
            await _validate_category(session, user_id, entry.entry_type, edits.category_id)
            entry.category_id = edits.category_id
        if edits.lines is not None:
            debits = sum(line.amount for line in edits.lines if line.type == "debit")
            credits = sum(line.amount for line in edits.lines if line.type == "credit")
            if debits != credits:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debitos deben igualar creditos")
            for old_line in list(entry.lines):
                await session.delete(old_line)
            await session.flush()
            entry.lines = [
                JournalLine(
                    entry_id=entry.id,
                    account_id=line.account_id,
                    amount=line.amount,
                    type=line.type,
                )
                for line in edits.lines
            ]
            await session.flush()
            entry.amount = _display_amount(edits.lines)

    entry.status = "confirmed"
    await session.flush()
    await session.refresh(entry, attribute_names=["lines"])
    await _apply_lines(session, entry.lines)
    await _on_confirmed(session, entry, entry.amount or Decimal("0"))
    if entry.debt_id is not None:
        # Import local para evitar el ciclo transaction_service ->
        # debt_service -> transaction_service (misma razon que split_expense).
        from app.services import debt_service

        await debt_service.apply_confirmed_payment(session, entry)
    await _invalidate_cache(user_id)
    return entry


async def reject_draft(session: AsyncSession, user_id: UUID, entry_id: UUID) -> JournalEntry:
    entry = await get_transaction(session, user_id, entry_id)
    if entry.status not in ("draft", "pending"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Solo se pueden rechazar borradores o pendientes"
        )
    entry.status = "rejected"
    return entry


async def reconcile_account(
    session: AsyncSession,
    user_id: UUID,
    account_id: UUID,
    real_balance: Decimal,
    entry_date: date,
    notes: str | None,
) -> dict:
    """Concilia el saldo registrado de una cuenta liquida (efectivo/debito/
    ahorro) contra lo que el usuario cuenta/observa fisicamente. La
    diferencia se registra como adjustment_in/adjustment_out -- nunca como
    income/expense contra una categoria real, para no distorsionar el
    historial de gasto/ingreso por categoria ni el presupuesto (que ya
    filtra por entry_type == 'expense', asi que un adjustment_out queda
    excluido sin tocar budget_service). Solo aplica a cuentas liquidas: en
    una TDC "lo que tienes fisicamente" no aplica igual, se concilia contra
    el estado de cuenta del banco (fuera de alcance por ahora)."""
    account = await account_service.get_account(session, user_id, account_id)
    if account.type != "asset" or account.subtype not in account_service.LIQUID_SUBTYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "La conciliacion de saldo solo aplica a cuentas liquidas (efectivo, debito, ahorro)",
        )

    previous_balance = account.balance
    delta = real_balance - previous_balance
    if delta == 0:
        return {
            "adjusted": False,
            "previous_balance": previous_balance,
            "new_balance": previous_balance,
            "delta": Decimal("0"),
            "transaction": None,
        }

    entry_type = "adjustment_in" if delta > 0 else "adjustment_out"
    tx_data = TransactionCreate(
        date=entry_date,
        description=notes or "Ajuste de saldo",
        entry_type=entry_type,
        account_id=account_id,
        amount=abs(delta),
    )
    entry = await create_transaction(session, user_id, tx_data)
    return {
        "adjusted": True,
        "previous_balance": previous_balance,
        "new_balance": account.balance,
        "delta": delta,
        "transaction": entry,
    }
