import calendar
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.models.budget import BudgetLimit, BudgetPeriod
from app.models.category import Category
from app.models.transaction import JournalEntry
from app.schemas.budget import BudgetLimitIn
from app.services import cache_service, category_service, engine_service

logger = structlog.get_logger(__name__)

ALERT_THRESHOLD = Decimal("0.8")


def _week_ranges(year: int, month: int) -> list[tuple[date, date]]:
    last_day = calendar.monthrange(year, month)[1]
    ranges = []
    start = 1
    while start <= last_day:
        end = min(start + 6, last_day)
        ranges.append((date(year, month, start), date(year, month, end)))
        start = end + 1
    return ranges


async def get_limits(session: AsyncSession, user_id: UUID) -> list[dict]:
    result = await session.execute(
        select(BudgetLimit, Category.name)
        .join(Category, Category.id == BudgetLimit.category_id)
        .where(BudgetLimit.user_id == user_id)
        .order_by(Category.sort_order)
    )
    return [
        {
            "category_id": limit.category_id,
            "category_name": name,
            "monthly_limit": limit.monthly_limit,
        }
        for limit, name in result.all()
    ]


async def get_limit_suggestions(session: AsyncSession, user_id: UUID) -> list[dict]:
    """Para la pantalla de 'definir limites en bloque': a diferencia de
    get_current_budget (que solo trae categorias que YA tienen limite o
    movimiento este mes), esto trae TODAS las categorias de gasto visibles
    para el usuario -- incluidas las que nunca se han limitado -- junto con
    su promedio de gasto de los ultimos 3 meses, para poder sugerir un monto
    de entrada aunque el usuario nunca le haya puesto tope a esa categoria."""
    cat_result = await session.execute(
        select(Category.id, Category.name, Category.color, Category.sort_order)
        .where(
            or_(Category.user_id.is_(None), Category.user_id == user_id),
            Category.type == "expense",
            Category.is_active.is_(True),
            Category.parent_id.is_(None),
        )
        .order_by(Category.sort_order)
    )
    categories = cat_result.all()
    category_ids = {row.id for row in categories}

    limits_result = await session.execute(
        select(BudgetLimit.category_id, BudgetLimit.monthly_limit).where(
            BudgetLimit.user_id == user_id
        )
    )
    limits_by_category = {row.category_id: row.monthly_limit for row in limits_result.all()}

    averages = await _average_spent_by_category(session, user_id, category_ids)

    return [
        {
            "category_id": row.id,
            "category_name": row.name,
            "color": row.color,
            "current_limit": limits_by_category.get(row.id),
            "average_last_3_months": averages.get(row.id, Decimal("0")),
        }
        for row in categories
    ]


async def set_limits(
    session: AsyncSession, user_id: UUID, limits: list[BudgetLimitIn]
) -> list[dict]:
    today = date.today()
    for item in limits:
        category = await category_service.get_category(session, user_id, item.category_id)
        if category.parent_id is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "El presupuesto se define en la categoria padre, no en la subcategoria -- "
                "el gasto de las subcategorias sube automaticamente al presupuesto del padre",
            )
        stmt = (
            pg_insert(BudgetLimit)
            .values(
                id=uuid4(),
                user_id=user_id,
                category_id=item.category_id,
                monthly_limit=item.monthly_limit,
            )
            .on_conflict_do_update(
                index_elements=[BudgetLimit.user_id, BudgetLimit.category_id],
                set_={"monthly_limit": item.monthly_limit},
            )
        )
        await session.execute(stmt)

        # Regla M07 #2: cambiar un limite actualiza el mes en curso; los meses
        # anteriores (budget_periods.budgeted ya escrito) quedan intactos.
        period_stmt = (
            pg_insert(BudgetPeriod)
            .values(
                id=uuid4(),
                user_id=user_id,
                category_id=item.category_id,
                year=today.year,
                month=today.month,
                budgeted=item.monthly_limit,
                spent=Decimal("0"),
            )
            .on_conflict_do_update(
                index_elements=[
                    BudgetPeriod.user_id,
                    BudgetPeriod.category_id,
                    BudgetPeriod.year,
                    BudgetPeriod.month,
                ],
                set_={"budgeted": item.monthly_limit},
            )
        )
        await session.execute(period_stmt)

    await session.flush()

    redis = await get_redis()
    await cache_service.invalidate_budget_cache(redis, user_id)

    return await get_limits(session, user_id)


async def _check_budget_alert(
    session: AsyncSession,
    user_id: UUID,
    category_id: UUID,
    category_name: str,
    spent: Decimal,
    budgeted: Decimal,
) -> None:
    """Alerta al 80% con anti-spam (M09): una notificacion por categoria por dia."""
    if budgeted <= 0:
        return
    pct = spent / budgeted
    if pct < ALERT_THRESHOLD:
        return

    try:
        redis = await get_redis()
        if await cache_service.budget_alert_already_sent(redis, user_id, category_id):
            return
        await cache_service.mark_budget_alert_sent(redis, user_id, category_id)

        from app.services import notification_service

        await notification_service.create(
            session,
            user_id=user_id,
            type_="budget_alert",
            title=f"{category_name}: {round(float(pct) * 100)}% del presupuesto usado",
            body=f"Llevas ${spent:,.0f} de ${budgeted:,.0f} este mes.",
        )
    except Exception:
        # El anti-spam/notificacion es un side-effect no critico: si Redis o
        # la notificacion fallan no debe tumbar la confirmacion de la transaccion.
        logger.warning(
            "budget_alert_check_failed", user_id=str(user_id), category_id=str(category_id)
        )


async def upsert_period_spent(
    session: AsyncSession, user_id: UUID, category_id: UUID, date_: date, amount: Decimal
) -> None:
    """Punto de integracion exportado para M04: llamar en cada transaccion
    `confirmed` con category_id (creacion directa o confirmacion de draft/
    pending). `amount` negativo revierte (edicion o borrado de una `confirmed`).

    El presupuesto vive siempre en la categoria padre (decision de producto):
    si category_id es una subcategoria, el gasto sube automaticamente al
    budget_period de su padre en vez de crear uno propio -- las subcategorias
    nunca tienen presupuesto independiente, ver set_limits."""
    category = await session.get(Category, category_id)
    if category is not None and category.parent_id is not None:
        effective_category_id = category.parent_id
        effective_category = await session.get(Category, category.parent_id)
    else:
        effective_category_id = category_id
        effective_category = category

    limit_result = await session.execute(
        select(BudgetLimit.monthly_limit).where(
            BudgetLimit.user_id == user_id, BudgetLimit.category_id == effective_category_id
        )
    )
    current_limit = limit_result.scalar_one_or_none() or Decimal("0")

    stmt = (
        pg_insert(BudgetPeriod)
        .values(
            id=uuid4(),
            user_id=user_id,
            category_id=effective_category_id,
            year=date_.year,
            month=date_.month,
            budgeted=current_limit,
            spent=amount,
        )
        .on_conflict_do_update(
            index_elements=[
                BudgetPeriod.user_id,
                BudgetPeriod.category_id,
                BudgetPeriod.year,
                BudgetPeriod.month,
            ],
            set_={"spent": BudgetPeriod.spent + amount},
        )
    )
    await session.execute(stmt)
    await session.flush()

    period_result = await session.execute(
        select(BudgetPeriod).where(
            BudgetPeriod.user_id == user_id,
            BudgetPeriod.category_id == effective_category_id,
            BudgetPeriod.year == date_.year,
            BudgetPeriod.month == date_.month,
        )
    )
    period = period_result.scalar_one()
    if period.spent > 0:
        await _check_budget_alert(
            session,
            user_id,
            effective_category_id,
            effective_category.name if effective_category else "",
            period.spent,
            period.budgeted,
        )


async def _average_spent_by_category(
    session: AsyncSession, user_id: UUID, category_ids: set[UUID], months: int = 3
) -> dict[UUID, Decimal]:
    """Mismo patron que `engine_service.get_income_estimates` (promedio de los
    ultimos N meses), aplicado a gasto por categoria en vez de ingreso total.
    Sirve para categorias variables (gasolina, alimentacion) donde el usuario
    no quiere fijar un limite a ciegas -- ver que gasto de verdad primero."""
    if not category_ids:
        return {}

    since = date.today().replace(day=1) - relativedelta(months=months)
    # El gasto de una subcategoria cuenta para el promedio de su padre (mismo
    # rollup que upsert_period_spent) -- category_ids aqui son siempre
    # categorias de primer nivel (get_limit_suggestions/get_current_budget ya
    # excluyen subcategorias), asi que se resuelve via join+coalesce en vez
    # de comparar JournalEntry.category_id directo.
    effective_id = func.coalesce(Category.parent_id, Category.id)
    result = await session.execute(
        select(effective_id, JournalEntry.date, JournalEntry.amount)
        .join(Category, Category.id == JournalEntry.category_id)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_type == "expense",
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            effective_id.in_(category_ids),
            JournalEntry.date >= since,
        )
    )
    totals: dict[UUID, Decimal] = {}
    months_seen: dict[UUID, set[tuple[int, int]]] = {}
    for category_id, entry_date, amount in result.all():
        totals[category_id] = totals.get(category_id, Decimal("0")) + amount
        months_seen.setdefault(category_id, set()).add((entry_date.year, entry_date.month))

    return {
        category_id: (
            totals.get(category_id, Decimal("0")) / max(len(months_seen.get(category_id, set())), 1)
        ).quantize(Decimal("0.01"))
        for category_id in category_ids
    }


async def get_current_budget(session: AsyncSession, user_id: UUID, year: int, month: int) -> dict:
    limits = await session.execute(
        select(BudgetLimit.category_id, BudgetLimit.monthly_limit).where(
            BudgetLimit.user_id == user_id
        )
    )
    limits_by_category = {row.category_id: row.monthly_limit for row in limits.all()}

    periods = await session.execute(
        select(BudgetPeriod).where(
            BudgetPeriod.user_id == user_id, BudgetPeriod.year == year, BudgetPeriod.month == month
        )
    )
    periods_by_category = {p.category_id: p for p in periods.scalars().all()}

    candidate_ids = set(limits_by_category) | set(periods_by_category)
    categories = {}
    category_ids: set[UUID] = set()
    if candidate_ids:
        # El presupuesto variable es solo de gasto -- filtrar por
        # Category.type aqui es defensa extra ademas del filtro en el punto
        # de escritura (transaction_service._on_confirmed): set_limits() no
        # valida el type de la categoria, asi que en teoria se podria fijar
        # un "limite" sobre una categoria de ingreso via API directa.
        cat_result = await session.execute(
            select(Category.id, Category.name, Category.sort_order).where(
                Category.id.in_(candidate_ids),
                Category.type == "expense",
                Category.parent_id.is_(None),
            )
        )
        categories = {row.id: (row.name, row.sort_order) for row in cat_result.all()}
        category_ids = set(categories)

    averages = await _average_spent_by_category(session, user_id, category_ids)

    ordered_breakdown: list[tuple[int, dict]] = []
    variable_total_budgeted = Decimal("0")
    variable_total_spent = Decimal("0")
    for category_id in category_ids:
        period = periods_by_category.get(category_id)
        monthly_limit = (
            period.budgeted
            if period is not None
            else limits_by_category.get(category_id, Decimal("0"))
        )
        spent = period.spent if period is not None else Decimal("0")
        percentage = float(spent / monthly_limit * 100) if monthly_limit > 0 else 0.0
        name, sort_order = categories.get(category_id, ("", 0))
        ordered_breakdown.append(
            (
                sort_order,
                {
                    "category_id": category_id,
                    "category_name": name,
                    "monthly_limit": monthly_limit,
                    "spent": spent,
                    "remaining": monthly_limit - spent,
                    "percentage": round(percentage, 1),
                    "alert": percentage >= 80.0,
                    "average_last_3_months": averages.get(category_id, Decimal("0")),
                },
            )
        )
        variable_total_budgeted += monthly_limit
        variable_total_spent += spent

    ordered_breakdown.sort(key=lambda pair: pair[0])
    breakdown = [item for _, item in ordered_breakdown]

    committed_fixed = await engine_service.get_monthly_committed(session, user_id)
    income = await engine_service.get_income_estimates(session, user_id)
    income_estimated = income["estimated_monthly"]
    available = income_estimated - committed_fixed - variable_total_spent

    return {
        "period": {"year": year, "month": month},
        "committed_fixed": committed_fixed,
        "variable_categories": breakdown,
        "variable_total_budgeted": variable_total_budgeted,
        "variable_total_spent": variable_total_spent,
        "income_estimated": income_estimated,
        "available": available,
    }


async def get_budget_trend(session: AsyncSession, user_id: UUID, months: int = 6) -> list[dict]:
    """Serie cronologica (mas viejo -> mas reciente) de presupuestado/gastado
    variable por mes, para la grafica de tendencia de 6 meses en Presupuesto.
    Suma directo desde budget_periods (ya filtrado a categorias de gasto)
    en vez de reusar get_current_budget en un loop -- evita recalcular
    income/committed_fixed (engine_service) que esa vista no necesita."""
    cursor = date.today().replace(day=1)
    period_specs: list[tuple[int, int]] = []
    for _ in range(months):
        period_specs.append((cursor.year, cursor.month))
        cursor -= relativedelta(months=1)
    period_specs.reverse()

    result = await session.execute(
        select(
            BudgetPeriod.year,
            BudgetPeriod.month,
            BudgetPeriod.budgeted,
            BudgetPeriod.spent,
        )
        .join(Category, Category.id == BudgetPeriod.category_id)
        .where(BudgetPeriod.user_id == user_id, Category.type == "expense")
    )
    totals: dict[tuple[int, int], dict[str, Decimal]] = {}
    for year, month, budgeted, spent in result.all():
        key = (year, month)
        bucket = totals.setdefault(key, {"budgeted": Decimal("0"), "spent": Decimal("0")})
        bucket["budgeted"] += budgeted
        bucket["spent"] += spent

    trend = []
    for year, month in period_specs:
        bucket = totals.get((year, month), {"budgeted": Decimal("0"), "spent": Decimal("0")})
        budgeted = bucket["budgeted"]
        spent = bucket["spent"]
        percentage = float(spent / budgeted * 100) if budgeted > 0 else 0.0
        trend.append(
            {
                "year": year,
                "month": month,
                "budgeted": budgeted,
                "spent": spent,
                "percentage": round(percentage, 1),
            }
        )
    return trend


async def get_summary(session: AsyncSession, user_id: UUID) -> dict:
    today = date.today()
    current = await get_current_budget(session, user_id, today.year, today.month)
    return {
        "committed_fixed": current["committed_fixed"],
        "variable_total_budgeted": current["variable_total_budgeted"],
        "variable_total_spent": current["variable_total_spent"],
        "income_estimated": current["income_estimated"],
        "available": current["available"],
    }


async def get_weekly_view(session: AsyncSession, user_id: UUID, year: int, month: int) -> dict:
    from app.models.transaction import JournalEntry  # import local: evita ciclo con M04

    current = await get_current_budget(session, user_id, year, month)
    limits_by_category = {
        b["category_id"]: b["monthly_limit"] for b in current["variable_categories"]
    }
    ranges = _week_ranges(year, month)
    weeks_in_month = len(ranges)

    # Mismo rollup que upsert_period_spent: el gasto de una subcategoria
    # cuenta para la referencia semanal de su padre, que es el unico que
    # aparece en limits_by_category.
    effective_id = func.coalesce(Category.parent_id, Category.id)
    entries_result = await session.execute(
        select(effective_id, JournalEntry.date, JournalEntry.amount)
        .join(Category, Category.id == JournalEntry.category_id)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.status == "confirmed",
            JournalEntry.deleted_at.is_(None),
            JournalEntry.category_id.is_not(None),
            JournalEntry.date >= ranges[0][0],
            JournalEntry.date <= ranges[-1][1],
        )
    )
    entries = entries_result.all()

    weeks = []
    for week_num, (date_from, date_to) in enumerate(ranges, 1):
        spent_by_category: dict[str, Decimal] = {}
        for category_id, entry_date, amount in entries:
            if date_from <= entry_date <= date_to:
                key = str(category_id)
                spent_by_category[key] = spent_by_category.get(key, Decimal("0")) + (
                    amount or Decimal("0")
                )

        weeks.append(
            {
                "week": week_num,
                "date_from": date_from,
                "date_to": date_to,
                "spent_by_category": spent_by_category,
                "weekly_limit_reference": {
                    str(cat_id): (limit / weeks_in_month)
                    for cat_id, limit in limits_by_category.items()
                },
            }
        )

    return {"weeks": weeks}
