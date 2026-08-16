import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.cache_keys import CACHE_TTL, report_key
from app.core.config import settings
from app.core.json_utils import json_safe
from app.core.redis import get_redis
from app.models.report import Report, ReportInsight
from app.schemas.report import ReportOut
from app.services import cache_service, engine_service, notification_service, report_insight_service


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end - timedelta(days=1)


def previous_month_bounds() -> tuple[date, date]:
    """Mes calendario completo anterior a hoy -- usado por POST /reports/generate
    cuando el usuario no especifica un rango, y por la tarea de Celery
    `reports.generate_monthly` para el batch automatico del dia 1."""
    prev_month_end = date.today().replace(day=1) - timedelta(days=1)
    return _month_bounds(prev_month_end.year, prev_month_end.month)


def _year_bounds(year: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def previous_year_bounds() -> tuple[date, date]:
    """Año calendario completo anterior a hoy -- usado por la tarea de Celery
    `reports.generate_yearly`, que corre el 1ro de enero."""
    return _year_bounds(date.today().year - 1)


async def _get_existing_report(
    session: AsyncSession, user_id: UUID, period_start: date, period_end: date
) -> Report | None:
    # selectinload: el resultado de aqui puede volver directo al router via
    # ReportOut.model_validate (early-return idempotente) -- sin esto, leer
    # `.insights` en ese camino dispara un lazy-load sync que revienta bajo
    # asyncio (MissingGreenlet).
    result = await session.execute(
        select(Report)
        .options(selectinload(Report.insights))
        .where(
            Report.user_id == user_id,
            Report.period_start == period_start,
            Report.period_end == period_end,
        )
    )
    return result.scalars().first()


async def _previous_health_score(
    session: AsyncSession, user_id: UUID, period_start: date
) -> float | None:
    result = await session.execute(
        select(Report.summary)
        .where(
            Report.user_id == user_id,
            Report.status == "ready",
            Report.period_end < period_start,
        )
        .order_by(Report.period_start.desc())
        .limit(1)
    )
    summary = result.scalars().first()
    if summary is None:
        return None
    return summary.get("health_score", {}).get("value")


async def generate_report(
    session: AsyncSession,
    user_id: UUID,
    period_start: date,
    period_end: date,
    generated_by: str,
    force: bool = False,
) -> Report:
    """Punto de entrada unico para generar un reporte: lo usa tanto el
    endpoint manual (sincrono, un solo usuario) como la tarea de Celery
    `reports.generate_for_user` (un usuario a la vez, dentro del loop del
    batch mensual). No duplica: si ya existe uno 'ready' para el periodo
    exacto, lo retorna sin recalcular (regla de negocio M15 #2 y #3).

    `force=True` salta ese candado y recalcula igual -- pensado para un
    periodo que ya se genero (casi vacio) antes de que el usuario
    backfilleara historial viejo. Antes de recalcular, borra los
    `ReportInsight` que ya tuviera: `report_insight_service.generate_for_report`
    solo hace INSERT, nunca DELETE, asi que sin esto quedarian duplicados."""
    existing = await _get_existing_report(session, user_id, period_start, period_end)
    if existing is not None and existing.status == "ready" and not force:
        return existing

    if existing is not None:
        await session.execute(delete(ReportInsight).where(ReportInsight.report_id == existing.id))
        report = existing
        report.status = "generating"
        report.error_message = None
    else:
        _, month_end = _month_bounds(period_start.year, period_start.month)
        is_full_month = period_start.day == 1 and period_end == month_end
        report_type = "custom"
        if is_full_month:
            report_type = "monthly_auto" if generated_by == "auto" else "monthly_manual"
        report = Report(
            user_id=user_id,
            type=report_type,
            period_start=period_start,
            period_end=period_end,
            status="generating",
            generated_by=generated_by,
        )
        session.add(report)
    await session.flush()

    try:
        previous_score = await _previous_health_score(session, user_id, period_start)
        summary = await engine_service.compute_period_summary(
            session, user_id, period_start, period_end, previous_health_score=previous_score
        )
        report.summary = json_safe(summary)
        report.status = "ready"
        report.generated_at = datetime.now(UTC)
        await session.flush()

        redis = await get_redis()
        cache_key = report_key(
            user_id, "monthly", {"year": period_start.year, "month": period_start.month}
        )
        await redis.set(
            cache_key,
            json.dumps(report.summary, default=str),
            ex=CACHE_TTL["report_monthly_historic"],
        )
        await cache_service.invalidate_report_historical(redis, user_id)

        period_label = period_start.strftime("%B %Y")
        await notification_service.create(
            session,
            user_id=user_id,
            type_="report_ready",
            title=f"Tu reporte de {period_label} esta listo",
            action_url=f"/reports/{report.id}",
            related_entity_type="report",
            related_entity_id=report.id,
        )
        await notification_service.send_email_notification(
            session,
            user_id,
            f"Tu reporte de {period_label} esta listo",
            f"<p>Tu reporte de {period_label} ya esta disponible en "
            f"{settings.FRONTEND_URL}/reports/{report.id}</p>",
        )
    except Exception as exc:
        report.status = "error"
        report.error_message = str(exc)
        await session.flush()
        raise

    # Fuera del try/except de arriba a proposito: un fallo de IA generando
    # los puntos del periodo nunca debe convertir un reporte ya listo en
    # 'error' (ver docstring de report_insight_service.generate_for_report).
    # Solo para periodos realmente cerrados -- un rango 'custom' ad-hoc no
    # dispara la generacion de puntos de IA.
    if report.type != "custom":
        await report_insight_service.generate_for_report(session, user_id, report)
    # `report` ya es persistente (se flusheo arriba) -- su relacion
    # `.insights` no queda marcada como cargada solo por crear las filas
    # hijas (o por no crear ninguna), y leerla sin refrescar dispara un
    # lazy-load sync que revienta bajo asyncio (MissingGreenlet).
    await session.refresh(report, attribute_names=["insights"])

    return report


async def generate_monthly_for_user(
    session: AsyncSession, user_id: UUID, year: int, month: int, generated_by: str
) -> Report:
    start, end = _month_bounds(year, month)
    return await generate_report(session, user_id, start, end, generated_by)


def _merge_by_category(entries: list[dict]) -> list[dict]:
    """Suma por nombre de categoria a traves de varios meses (cada entrada
    mensual ya viene con las subcategorias sumadas a su padre, ver
    engine_service._category_breakdown) -- el desglose de subcategorias
    tambien se fusiona entre meses, no solo el total del padre."""
    totals: dict[str, Decimal] = {}
    subtotals: dict[str, dict[str, Decimal]] = {}
    for entry in entries:
        name = entry["category"]
        totals[name] = totals.get(name, Decimal("0")) + Decimal(str(entry["amount"]))
        for sub in entry.get("subcategories", []):
            bucket = subtotals.setdefault(name, {})
            sub_name = sub["category"]
            bucket[sub_name] = bucket.get(sub_name, Decimal("0")) + Decimal(str(sub["amount"]))

    merged = []
    for name, amount in totals.items():
        row = {"category": name, "amount": amount}
        if name in subtotals:
            row["subcategories"] = sorted(
                (
                    {"category": sub_name, "amount": sub_amount}
                    for sub_name, sub_amount in subtotals[name].items()
                ),
                key=lambda r: r["amount"],
                reverse=True,
            )
        merged.append(row)
    return merged


def _aggregate_yearly_summary(
    monthly_summaries: list[dict], previous_yearly_score: float | None
) -> dict:
    """Agrega los `summary` de los reportes mensuales ya generados de un año
    en la MISMA forma que devuelve `engine_service.compute_period_summary` --
    a proposito no vuelve a tocar las transacciones crudas (ver Contexto del
    plan): el trabajo pesado ya lo hizo cada reporte mensual."""
    income_total = sum(
        (Decimal(str(m["income"]["total"])) for m in monthly_summaries), Decimal("0")
    )
    expenses_total = sum(
        (Decimal(str(m["expenses"]["total"])) for m in monthly_summaries), Decimal("0")
    )
    debts_paid = sum(
        (Decimal(str(m["committed"]["debts_paid"])) for m in monthly_summaries), Decimal("0")
    )
    recurring_paid = sum(
        (Decimal(str(m["committed"]["recurring_paid"])) for m in monthly_summaries), Decimal("0")
    )
    # .get(...) con default: reportes mensuales generados antes de que este
    # campo existiera (JSON ya persistido en `reports.summary`) no se
    # regeneran solos -- generate_report retorna el existente 'ready' tal
    # cual si ya esta calculado para ese periodo exacto.
    adjustments_in = sum(
        (Decimal(str(m.get("adjustments", {}).get("total_in", 0))) for m in monthly_summaries),
        Decimal("0"),
    )
    adjustments_out = sum(
        (Decimal(str(m.get("adjustments", {}).get("total_out", 0))) for m in monthly_summaries),
        Decimal("0"),
    )
    adjustments_count = sum(m.get("adjustments", {}).get("count", 0) for m in monthly_summaries)

    income_by_category = _merge_by_category(
        [row for m in monthly_summaries for row in m["income"]["by_category"]]
    )
    expenses_by_category = _merge_by_category(
        [row for m in monthly_summaries for row in m["expenses"]["by_category"]]
    )

    first, last = monthly_summaries[0], monthly_summaries[-1]
    net_worth_start = Decimal(str(first["net_worth"]["start"]))
    net_worth_end = Decimal(str(last["net_worth"]["end"]))
    last_score = last["health_score"]["value"]
    if previous_yearly_score is None:
        trend = None
    elif last_score > previous_yearly_score:
        trend = "improved"
    elif last_score < previous_yearly_score:
        trend = "worsened"
    else:
        trend = "stable"

    savings_rate = (
        float((income_total - expenses_total) / income_total) if income_total > 0 else 0.0
    )
    dti = float((debts_paid + recurring_paid) / income_total) if income_total > 0 else 0.0

    return {
        "period": {"start": first["period"]["start"], "end": last["period"]["end"]},
        "income": {"total": income_total, "by_category": income_by_category},
        "expenses": {"total": expenses_total, "by_category": expenses_by_category},
        "committed": {"debts_paid": debts_paid, "recurring_paid": recurring_paid},
        "adjustments": {
            "total_in": adjustments_in,
            "total_out": adjustments_out,
            "net": adjustments_in - adjustments_out,
            "count": adjustments_count,
        },
        "net_worth": {
            "start": net_worth_start,
            "end": net_worth_end,
            "delta": net_worth_end - net_worth_start,
        },
        "health_score": {"value": last_score, "previous": previous_yearly_score, "trend": trend},
        "savings_rate": round(savings_rate, 4),
        "dti": round(dti, 4),
    }


async def generate_yearly_report(
    session: AsyncSession, user_id: UUID, year: int, generated_by: str, force: bool = False
) -> Report:
    """Agrega los reportes mensuales `ready` ya generados de `year` (no
    recalcula desde las transacciones crudas) y genera los puntos de IA del
    año a partir de ese agregado. Idempotente igual que `generate_report`.

    `force=True` recalcula aunque ya este 'ready', y ademas fuerza primero la
    regeneracion de los 12 meses de `year` (con `generate_report(...,
    force=True)`, que crea los que falten y recalcula los que ya existan) --
    esta funcion agrega reportes mensuales YA 'ready', asi que sin ese paso
    el año quedaria recalculado sobre datos mensuales viejos. De paso, esto
    resuelve de un solo llamado el backfill de todo un año."""
    period_start, period_end = _year_bounds(year)
    existing = await _get_existing_report(session, user_id, period_start, period_end)
    if existing is not None and existing.status == "ready" and not force:
        return existing

    if force:
        for month in range(1, 13):
            month_start, month_end = _month_bounds(year, month)
            await generate_report(
                session, user_id, month_start, month_end, generated_by, force=True
            )

    monthly_result = await session.execute(
        select(Report)
        .where(
            Report.user_id == user_id,
            Report.type.in_(("monthly_auto", "monthly_manual")),
            Report.status == "ready",
            Report.period_start >= period_start,
            Report.period_start <= period_end,
        )
        .order_by(Report.period_start)
    )
    monthly_reports = list(monthly_result.scalars().all())
    if not monthly_reports:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"No hay reportes mensuales de {year} para agregar"
        )

    previous_yearly = await _get_existing_report(session, user_id, *_year_bounds(year - 1))
    previous_yearly_score = (
        previous_yearly.summary.get("health_score", {}).get("value")
        if previous_yearly is not None and previous_yearly.summary
        else None
    )

    if existing is not None:
        await session.execute(delete(ReportInsight).where(ReportInsight.report_id == existing.id))
        report = existing
        report.status = "generating"
        report.error_message = None
    else:
        report = Report(
            user_id=user_id,
            type="yearly_auto" if generated_by == "auto" else "yearly_manual",
            period_start=period_start,
            period_end=period_end,
            status="generating",
            generated_by=generated_by,
        )
        session.add(report)
    await session.flush()

    try:
        summary = _aggregate_yearly_summary(
            [m.summary for m in monthly_reports], previous_yearly_score
        )
        report.summary = json_safe(summary)
        report.status = "ready"
        report.generated_at = datetime.now(UTC)
        await session.flush()

        redis = await get_redis()
        await cache_service.invalidate_report_historical(redis, user_id)

        await notification_service.create(
            session,
            user_id=user_id,
            type_="report_ready",
            title=f"Tu reporte anual de {year} esta listo",
            action_url=f"/reports/{report.id}",
            related_entity_type="report",
            related_entity_id=report.id,
        )
        await notification_service.send_email_notification(
            session,
            user_id,
            f"Tu reporte anual de {year} esta listo",
            f"<p>Tu reporte anual de {year} ya esta disponible en "
            f"{settings.FRONTEND_URL}/reports/{report.id}</p>",
        )
    except Exception as exc:
        report.status = "error"
        report.error_message = str(exc)
        await session.flush()
        raise

    await report_insight_service.generate_for_report(session, user_id, report)
    await session.refresh(report, attribute_names=["insights"])
    return report


async def list_reports(
    session: AsyncSession, user_id: UUID, page: int = 1, per_page: int = 20
) -> tuple[list[Report], int]:
    query = select(Report).where(Report.user_id == user_id)
    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    query = (
        query.options(selectinload(Report.insights))
        .order_by(Report.period_start.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await session.execute(query)
    return list(result.scalars().all()), total


async def get_report(session: AsyncSession, user_id: UUID, report_id: UUID) -> Report:
    result = await session.execute(
        select(Report)
        .options(selectinload(Report.insights))
        .where(Report.id == report_id, Report.user_id == user_id)
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")
    return report


async def get_historical(
    session: AsyncSession, redis: Redis, user_id: UUID, page: int = 1, per_page: int = 20
) -> tuple[list[dict], int]:
    cache_key = report_key(user_id, "historical", {"page": page, "per_page": per_page})

    async def _compute() -> dict:
        reports, total = await list_reports(session, user_id, page, per_page)
        items = [json.loads(ReportOut.model_validate(r).model_dump_json()) for r in reports]
        return {"items": items, "total": total}

    cached = await cache_service.get_or_compute(
        redis, cache_key, _compute, CACHE_TTL["report_historical_list"]
    )
    return cached["items"], cached["total"]


async def get_current_month_summary(session: AsyncSession, redis: Redis, user_id: UUID) -> dict:
    today = date.today()
    month_start = today.replace(day=1)
    cache_key = report_key(user_id, "current", {})

    async def _compute() -> dict:
        return json_safe(
            await engine_service.compute_period_summary(session, user_id, month_start, today)
        )

    return await cache_service.get_or_compute(
        redis, cache_key, _compute, CACHE_TTL["report_monthly_current"]
    )
