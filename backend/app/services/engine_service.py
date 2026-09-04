from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.constants import LIQUID_SUBTYPES
from app.models.account import Account
from app.models.budget import BudgetPeriod
from app.models.category import Category
from app.models.debt import Debt, DebtPayment
from app.models.recurring import RecurringItem
from app.models.transaction import JournalEntry, JournalLine
from app.schemas.engine import SimulationRequest
from app.services import account_service, debt_service, recurring_service

__all__ = ["LIQUID_SUBTYPES"]

# Reference targets used by calculate_health_score: DTI, savings rate,
# emergency coverage and credit utilization values considered "healthy"
# (100 points), and the weight of each sub-score in the composite score.
HEALTH_SCORE_DTI_TARGET = Decimal("0.80")
HEALTH_SCORE_SAVINGS_RATE_TARGET = Decimal("0.20")
HEALTH_SCORE_EMERGENCY_COVERAGE_TARGET_MONTHS = Decimal("6")
HEALTH_SCORE_CREDIT_UTILIZATION_TARGET = Decimal("0.90")
HEALTH_SCORE_WEIGHT_DTI = Decimal("0.30")
HEALTH_SCORE_WEIGHT_SAVINGS_RATE = Decimal("0.25")
HEALTH_SCORE_WEIGHT_EMERGENCY_COVERAGE = Decimal("0.25")
HEALTH_SCORE_WEIGHT_CREDIT_UTILIZATION = Decimal("0.20")


async def _accounts(session: AsyncSession, user_id: UUID) -> list[Account]:
    result = await session.execute(
        select(Account).where(
            Account.user_id == user_id, Account.is_active.is_(True), Account.deleted_at.is_(None)
        )
    )
    return list(result.scalars().all())


def _liquid_balance(accounts: list[Account]) -> Decimal:
    return sum(
        (a.balance for a in accounts if a.type == "asset" and a.subtype in LIQUID_SUBTYPES),
        Decimal("0"),
    )


async def calculate_net_worth(session: AsyncSession, user_id: UUID) -> dict:
    """M08 #1. Reuses M02: account_service.get_summary() already computes exactly this."""
    return await account_service.get_summary(session, user_id)


async def get_monthly_committed(session: AsyncSession, user_id: UUID) -> Decimal:
    """Fixed monthly commitments: active debts (M05) + non-income recurring items (M06)."""
    debt_summary = await debt_service.get_summary(session, user_id)
    recurring_summary = await recurring_service.get_summary(session, user_id, exclude_income=True)
    return debt_summary["monthly_committed"] + recurring_summary["total_monthly"]


async def get_income_estimates(session: AsyncSession, user_id: UUID) -> dict:
    """M08 #2. Two methods: declared recurring base vs. real historical
    average over 3 months. Uses the historical one only if there are 3+
    months of data; otherwise falls back to the recurring base. Always
    returns both numbers for transparency."""
    recurring_summary = await recurring_service.get_summary(session, user_id, income_only=True)
    recurring_monthly = recurring_summary["total_monthly"]

    three_months_ago = date.today().replace(day=1) - relativedelta(months=3)
    result = await session.execute(
        select(JournalEntry.date, JournalEntry.amount).where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_type == "income",
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= three_months_ago,
        )
    )
    entries = result.all()
    months_with_income = {(entry_date.year, entry_date.month) for entry_date, _ in entries}
    total_historical = sum((amount for _, amount in entries), Decimal("0"))
    months_of_data = max(len(months_with_income), 1)
    historical_avg = (total_historical / months_of_data).quantize(Decimal("0.01"))

    if len(months_with_income) >= 3:
        estimated = historical_avg
        quality = "historical"
    else:
        estimated = recurring_monthly
        quality = "recurring_base"

    return {
        "recurring_base": recurring_monthly,
        "historical_avg_3m": historical_avg,
        "estimated_monthly": estimated,
        "data_quality": quality,
    }


async def _spent_this_month(session: AsyncSession, user_id: UUID) -> Decimal:
    today = date.today()
    result = await session.execute(
        select(BudgetPeriod.spent).where(
            BudgetPeriod.user_id == user_id,
            BudgetPeriod.year == today.year,
            BudgetPeriod.month == today.month,
        )
    )
    return sum((row[0] for row in result.all()), Decimal("0"))


async def calculate_health_score(session: AsyncSession, user_id: UUID) -> dict:
    """M08 #3. Score 0-100 composed of 4 weighted sub-scores. Can
    legitimately drop to 0 (informational, not blocking)."""
    accounts = await _accounts(session, user_id)
    income = await get_income_estimates(session, user_id)
    estimated_income = income["estimated_monthly"]
    committed_monthly = await get_monthly_committed(session, user_id)

    # DTI
    if estimated_income > 0:
        dti = committed_monthly / estimated_income
    else:
        dti = Decimal("1") if committed_monthly > 0 else Decimal("0")
    dti_score = max(Decimal("0"), Decimal("100") - (dti / HEALTH_SCORE_DTI_TARGET) * 100)
    dti_score = min(dti_score, Decimal("100"))

    # Savings rate
    spent_this_month = await _spent_this_month(session, user_id)
    if estimated_income > 0:
        savings_rate = (estimated_income - spent_this_month) / estimated_income
    else:
        savings_rate = Decimal("0")
    savings_score = min(
        Decimal("100"),
        max(Decimal("0"), (savings_rate / HEALTH_SCORE_SAVINGS_RATE_TARGET) * 100),
    )

    # Emergency coverage
    liquid_assets = _liquid_balance(accounts)
    coverage_months = liquid_assets / committed_monthly if committed_monthly > 0 else Decimal("99")
    emergency_score = min(
        Decimal("100"),
        (coverage_months / HEALTH_SCORE_EMERGENCY_COVERAGE_TARGET_MONTHS) * 100,
    )

    # Credit utilization
    tdc_accounts = [a for a in accounts if a.type == "liability" and a.subtype == "credit_card"]
    total_balance = sum((a.balance for a in tdc_accounts), Decimal("0"))
    total_limit = sum((a.credit_limit for a in tdc_accounts if a.credit_limit), Decimal("0"))
    if not tdc_accounts or total_limit == 0:
        credit_score = Decimal("100")
    else:
        utilization = total_balance / total_limit
        credit_score = max(
            Decimal("0"),
            Decimal("100") - (utilization / HEALTH_SCORE_CREDIT_UTILIZATION_TARGET) * 100,
        )

    overall = (
        dti_score * HEALTH_SCORE_WEIGHT_DTI
        + savings_score * HEALTH_SCORE_WEIGHT_SAVINGS_RATE
        + emergency_score * HEALTH_SCORE_WEIGHT_EMERGENCY_COVERAGE
        + credit_score * HEALTH_SCORE_WEIGHT_CREDIT_UTILIZATION
    )

    def _round(value: Decimal) -> float:
        return float(value.quantize(Decimal("0.1")))

    return {
        "score": _round(overall),
        "components": {
            "dti": {"value": float(dti), "score": _round(dti_score)},
            "savings_rate": {"value": float(savings_rate), "score": _round(savings_score)},
            "emergency_coverage_months": {
                "value": float(coverage_months),
                "score": _round(emergency_score),
            },
            "credit_utilization": {
                "value": float(total_balance / total_limit) if total_limit else 0.0,
                "score": _round(credit_score),
            },
        },
    }


async def _commitments_due_in_range(
    session: AsyncSession, user_id: UUID, start: date, end: date
) -> Decimal:
    debts_result = await session.execute(
        select(Debt.payment_amount).where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.next_payment_date.is_not(None),
            Debt.next_payment_date >= start,
            Debt.next_payment_date <= end,
            Debt.deleted_at.is_(None),
        )
    )
    recurring_result = await session.execute(
        select(RecurringItem.amount).where(
            RecurringItem.user_id == user_id,
            RecurringItem.status == "active",
            RecurringItem.item_type != "income",
            RecurringItem.next_date >= start,
            RecurringItem.next_date <= end,
            RecurringItem.deleted_at.is_(None),
        )
    )
    total = sum((amount for (amount,) in debts_result.all() if amount), Decimal("0"))
    total += sum((amount for (amount,) in recurring_result.all()), Decimal("0"))
    return total


async def _income_remaining_this_month(session: AsyncSession, user_id: UUID) -> Decimal:
    today = date.today()
    month_end = (today.replace(day=1) + relativedelta(months=1)) - timedelta(days=1)
    result = await session.execute(
        select(RecurringItem.amount).where(
            RecurringItem.user_id == user_id,
            RecurringItem.status == "active",
            RecurringItem.item_type == "income",
            RecurringItem.next_date >= today,
            RecurringItem.next_date <= month_end,
            RecurringItem.deleted_at.is_(None),
        )
    )
    return sum((amount for (amount,) in result.all()), Decimal("0"))


async def available_spending(session: AsyncSession, user_id: UUID, period: str) -> dict:
    """M08 #4. Money available for today|week|month."""
    accounts = await _accounts(session, user_id)
    liquid = _liquid_balance(accounts)
    today = date.today()

    if period == "today":
        committed = await _commitments_due_in_range(session, user_id, today, today)
    elif period == "week":
        committed = await _commitments_due_in_range(
            session, user_id, today, today + timedelta(days=7)
        )
    else:  # month
        income_remaining = await _income_remaining_this_month(session, user_id)
        liquid = liquid + income_remaining
        committed = await get_monthly_committed(session, user_id)

    available = max(Decimal("0"), liquid - committed)
    return {
        "liquid_balance": liquid,
        "committed_in_period": committed,
        "available": available,
        "period": period,
    }


def calculate_runway(liquid_balance: Decimal, monthly_fixed: Decimal) -> dict:
    """M08 #6. How many days the liquid money lasts at the fixed-expense burn rate."""
    if monthly_fixed <= 0:
        return {"days": 9999, "months": 999.0, "label": "Sin compromisos fijos"}
    daily_burn = monthly_fixed / 30
    days = int(liquid_balance / daily_burn)
    months = round(days / 30, 1)
    return {"days": days, "months": months, "label": f"{days} dias ({months} meses)"}


async def cash_flow_projection(session: AsyncSession, user_id: UUID, days: int = 30) -> list[dict]:
    """M08 #5. Day-by-day projection using each debt/recurring item's single
    known next occurrence (doesn't project future cycles beyond next_date)."""
    today = date.today()
    accounts = await _accounts(session, user_id)
    balance = _liquid_balance(accounts)
    range_end = today + timedelta(days=days)

    debts_result = await session.execute(
        select(Debt.name, Debt.next_payment_date, Debt.payment_amount).where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.next_payment_date.is_not(None),
            Debt.next_payment_date >= today,
            Debt.next_payment_date <= range_end,
            Debt.payment_amount.is_not(None),
            Debt.deleted_at.is_(None),
        )
    )
    recurring_result = await session.execute(
        select(
            RecurringItem.name,
            RecurringItem.next_date,
            RecurringItem.amount,
            RecurringItem.item_type,
        ).where(
            RecurringItem.user_id == user_id,
            RecurringItem.status == "active",
            RecurringItem.next_date >= today,
            RecurringItem.next_date <= range_end,
            RecurringItem.deleted_at.is_(None),
        )
    )

    events_by_day: dict[date, list[dict]] = {}
    for name, due_date, amount in debts_result.all():
        events_by_day.setdefault(due_date, []).append(
            {"name": name, "amount": -amount, "type": "debt"}
        )
    for name, next_date, amount, item_type in recurring_result.all():
        signed = amount if item_type == "income" else -amount
        events_by_day.setdefault(next_date, []).append(
            {"name": name, "amount": signed, "type": item_type}
        )

    projections = []
    running_balance = balance
    for day_offset in range(days + 1):
        day = today + timedelta(days=day_offset)
        day_events = events_by_day.get(day, [])
        for event in day_events:
            running_balance += event["amount"]
        projections.append(
            {"date": day.isoformat(), "balance": running_balance, "events": day_events}
        )

    return projections


async def get_upcoming_payments(session: AsyncSession, user_id: UUID, days: int = 7) -> list[dict]:
    projections = await cash_flow_projection(session, user_id, days)
    upcoming = []
    for day in projections:
        for event in day["events"]:
            upcoming.append({"date": day["date"], **event})
    return upcoming


async def build_financial_snapshot(session: AsyncSession, user_id: UUID) -> dict:
    """M08 #7. The module's most important output: consumed by M09 (cache),
    M10 (AI advisor) and M13 (insights)."""
    income = await get_income_estimates(session, user_id)
    committed = await get_monthly_committed(session, user_id)
    net_worth = await calculate_net_worth(session, user_id)
    health = await calculate_health_score(session, user_id)
    available_week = await available_spending(session, user_id, "week")
    upcoming = await get_upcoming_payments(session, user_id, days=7)
    spent_this_month = await _spent_this_month(session, user_id)
    runway = calculate_runway(available_week["liquid_balance"], committed)

    return {
        "as_of": date.today().isoformat(),
        "net_worth": net_worth,
        "income": income,
        "committed_monthly": committed,
        "spent_this_month": spent_this_month,
        "health_score": health,
        "available_this_week": available_week,
        "upcoming_7_days": upcoming,
        "runway": runway,
    }


async def simulate_scenario(
    session: AsyncSession, user_id: UUID, scenario: SimulationRequest
) -> dict:
    """M08 #10. Never writes to the DB: applies the hypothetical change on
    top of already-calculated numbers and returns before/after/delta."""
    committed = await get_monthly_committed(session, user_id)
    income = await get_income_estimates(session, user_id)
    net_worth_before = (await calculate_net_worth(session, user_id))["net_worth"]

    new_committed = committed
    net_worth_after = net_worth_before

    if scenario.type == "new_debt":
        new_committed = committed + (scenario.monthly_amount or Decimal("0"))
    elif scenario.type == "cancel_subscription" and scenario.recurring_id is not None:
        item = await session.get(RecurringItem, scenario.recurring_id)
        if item is not None and item.user_id == user_id and item.item_type != "income":
            new_committed = committed - recurring_service.monthly_equivalent(
                item.amount, item.frequency
            )
    elif (
        scenario.type == "extra_payment"
        and scenario.debt_id is not None
        and scenario.amount is not None
    ):
        debt = await session.get(Debt, scenario.debt_id)
        if debt is not None and debt.user_id == user_id:
            # An extra payment doesn't change the recurring monthly
            # commitment; it advances the payoff, which raises net worth by
            # reducing the liability.
            paid_down = min(scenario.amount, debt.current_balance)
            net_worth_after = net_worth_before + paid_down

    def _dti(committed_amount: Decimal) -> Decimal:
        return (
            committed_amount / income["estimated_monthly"]
            if income["estimated_monthly"] > 0
            else Decimal("0")
        )

    before_dti = _dti(committed)
    after_dti = _dti(new_committed)

    before = {"monthly_committed": committed, "dti": before_dti, "net_worth": net_worth_before}
    after = {"monthly_committed": new_committed, "dti": after_dti, "net_worth": net_worth_after}
    delta = {
        "monthly_committed": new_committed - committed,
        "dti": after_dti - before_dti,
        "net_worth": net_worth_after - net_worth_before,
    }

    return {"before": before, "after": after, "delta": delta}


async def _category_breakdown(
    session: AsyncSession, user_id: UUID, entry_type: str, start: date, end: date
) -> tuple[Decimal, list[dict]]:
    """By top-level category, with its subcategories' expense/income already
    summed in (same rollup as budget_service) and the breakdown of those
    subcategories available separately for reports/charts that want to show
    it (see Reports.tsx) -- a transaction categorized directly on the
    parent (without going through a subcategory) counts toward the
    parent's total but doesn't generate a subcategory row."""
    ParentCategory = aliased(Category)
    effective_id = func.coalesce(Category.parent_id, Category.id)
    result = await session.execute(
        select(
            effective_id,
            func.coalesce(ParentCategory.name, Category.name),
            Category.parent_id,
            Category.name,
            func.sum(JournalEntry.amount),
        )
        .join(Category, JournalEntry.category_id == Category.id)
        .outerjoin(ParentCategory, ParentCategory.id == Category.parent_id)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_type == entry_type,
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= start,
            JournalEntry.date <= end,
        )
        .group_by(effective_id, ParentCategory.name, Category.parent_id, Category.name)
    )

    totals: dict[UUID, Decimal] = {}
    names: dict[UUID, str] = {}
    subcategories: dict[UUID, list[dict]] = {}
    for parent_id, parent_name, row_parent_id, row_name, amount in result.all():
        totals[parent_id] = totals.get(parent_id, Decimal("0")) + amount
        names[parent_id] = parent_name
        if row_parent_id is not None:
            subcategories.setdefault(parent_id, []).append({"category": row_name, "amount": amount})

    by_category = [
        {
            "category": names[pid],
            "amount": amount,
            **(
                {
                    "subcategories": sorted(
                        subcategories[pid], key=lambda r: r["amount"], reverse=True
                    )
                }
                if pid in subcategories
                else {}
            ),
        }
        for pid, amount in totals.items()
    ]
    by_category.sort(key=lambda row: row["amount"], reverse=True)
    total = sum(totals.values(), Decimal("0"))
    return total, by_category


async def _adjustments_breakdown(
    session: AsyncSession, user_id: UUID, start: date, end: date
) -> dict:
    """Balance adjustments (reconciliation) for the period -- no category,
    so unlike _category_breakdown there's no join to Category. Totals/count
    only: the item-by-item detail already lives in Transactions, filterable
    by type (Balance adjustment)."""
    result = await session.execute(
        select(JournalEntry.entry_type, func.sum(JournalEntry.amount))
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_type.in_(("adjustment_in", "adjustment_out")),
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= start,
            JournalEntry.date <= end,
        )
        .group_by(JournalEntry.entry_type)
    )
    totals = {entry_type: amount for entry_type, amount in result.all()}
    total_in = totals.get("adjustment_in", Decimal("0"))
    total_out = totals.get("adjustment_out", Decimal("0"))
    result = await session.execute(
        select(func.count())
        .select_from(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_type.in_(("adjustment_in", "adjustment_out")),
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= start,
            JournalEntry.date <= end,
        )
    )
    count = result.scalar_one()
    return {
        "total_in": total_in,
        "total_out": total_out,
        "net": total_in - total_out,
        "count": count,
    }


async def _net_worth_as_of(session: AsyncSession, user_id: UUID, as_of: date) -> Decimal:
    """Rebuilds net worth as of a past date by summing the effect of every
    confirmed journal_line up to that date onto `initial_balance`, instead
    of using `Account.balance` (which always reflects the CURRENT balance)."""
    accounts = await _accounts(session, user_id)
    if not accounts:
        return Decimal("0")
    accounts_by_id = {a.id: a for a in accounts}

    result = await session.execute(
        select(JournalLine.account_id, JournalLine.type, func.sum(JournalLine.amount))
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .where(
            JournalLine.account_id.in_(accounts_by_id.keys()),
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date <= as_of,
        )
        .group_by(JournalLine.account_id, JournalLine.type)
    )
    balances = {
        account_id: account.initial_balance for account_id, account in accounts_by_id.items()
    }
    for account_id, line_type, total in result.all():
        account = accounts_by_id[account_id]
        balances[account_id] += account_service.balance_delta(account.type, line_type, total)

    net_worth = Decimal("0")
    for account_id, balance in balances.items():
        account = accounts_by_id[account_id]
        if account.type == "asset":
            net_worth += balance
        elif account.type == "liability":
            net_worth -= balance
    return net_worth


async def _debts_paid_in_range(
    session: AsyncSession, user_id: UUID, start: date, end: date
) -> Decimal:
    result = await session.execute(
        select(func.coalesce(func.sum(DebtPayment.amount), 0)).where(
            DebtPayment.user_id == user_id, DebtPayment.date >= start, DebtPayment.date <= end
        )
    )
    return result.scalar_one()


async def _recurring_paid_in_range(
    session: AsyncSession, user_id: UUID, start: date, end: date
) -> Decimal:
    result = await session.execute(
        select(func.coalesce(func.sum(JournalEntry.amount), 0)).where(
            JournalEntry.user_id == user_id,
            JournalEntry.is_recurring.is_(True),
            JournalEntry.entry_type != "income",
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.date >= start,
            JournalEntry.date <= end,
        )
    )
    return result.scalar_one()


async def compute_period_summary(
    session: AsyncSession,
    user_id: UUID,
    start: date,
    end: date,
    *,
    previous_health_score: float | None = None,
) -> dict:
    """M15. The `health_score` reflects the account's CURRENT state, not a
    point-in-time historical reconstruction of its 4 sub-scores: for the
    automatic monthly report this is exact (runs on day 1, right after the
    period ended); for manual reports of distant months it's an
    approximation. `previous_health_score` is resolved by the caller (M15
    report_service) reading the previous report -- this module doesn't know
    about the `reports` table."""
    income_total, income_by_category = await _category_breakdown(
        session, user_id, "income", start, end
    )
    expenses_total, expenses_by_category = await _category_breakdown(
        session, user_id, "expense", start, end
    )

    debts_paid = await _debts_paid_in_range(session, user_id, start, end)
    recurring_paid = await _recurring_paid_in_range(session, user_id, start, end)
    adjustments = await _adjustments_breakdown(session, user_id, start, end)

    net_worth_start = await _net_worth_as_of(session, user_id, start - timedelta(days=1))
    net_worth_end = await _net_worth_as_of(session, user_id, end)

    health = await calculate_health_score(session, user_id)
    if previous_health_score is None:
        trend = None
    elif health["score"] > previous_health_score:
        trend = "improved"
    elif health["score"] < previous_health_score:
        trend = "worsened"
    else:
        trend = "stable"

    savings_rate = (
        float((income_total - expenses_total) / income_total) if income_total > 0 else 0.0
    )
    dti = float((debts_paid + recurring_paid) / income_total) if income_total > 0 else 0.0

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "income": {"total": income_total, "by_category": income_by_category},
        "expenses": {"total": expenses_total, "by_category": expenses_by_category},
        "committed": {"debts_paid": debts_paid, "recurring_paid": recurring_paid},
        "adjustments": adjustments,
        "net_worth": {
            "start": net_worth_start,
            "end": net_worth_end,
            "delta": net_worth_end - net_worth_start,
        },
        "health_score": {
            "value": health["score"],
            "previous": previous_health_score,
            "trend": trend,
        },
        "savings_rate": round(savings_rate, 4),
        "dti": round(dti, 4),
    }
