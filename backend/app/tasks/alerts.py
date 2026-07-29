import asyncio
from datetime import date, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery import celery_app
from app.core.database import rls_session
from app.core.redis import get_redis
from app.models.account import Account
from app.models.debt import Debt
from app.services import account_service, cache_service, notification_service, push_service
from app.tasks._common import active_user_ids

logger = structlog.get_logger(__name__)

TDC_LOOKAHEAD_DAYS = 5
TDC_EMAIL_THRESHOLD_DAYS = 3


async def _process_debt_alerts_for_user(session: AsyncSession, user_id, today: date) -> int:
    redis = await get_redis()
    count = 0

    debts_due = await session.execute(
        select(Debt).where(
            Debt.user_id == user_id,
            Debt.status == "active",
            Debt.next_payment_date.is_not(None),
            Debt.next_payment_date >= today,
            Debt.next_payment_date <= today + timedelta(days=3),
            Debt.deleted_at.is_(None),
        )
    )
    for debt in debts_due.scalars():
        if await cache_service.debt_alert_already_sent(redis, user_id, debt.id, "due_soon"):
            continue
        days_left = (debt.next_payment_date - today).days
        await notification_service.create(
            session,
            user_id=user_id,
            type_="debt_alert",
            title=f"Pago próximo: {debt.name}",
            body=f"Vence en {days_left} día(s). Monto: ${debt.payment_amount or 0:,.0f}",
            related_entity_type="debt",
            related_entity_id=debt.id,
        )
        await push_service.send_push_if_enabled(
            session, user_id, f"Pago próximo: {debt.name}", f"Vence en {days_left} día(s)"
        )
        await cache_service.mark_debt_alert_sent(redis, user_id, debt.id, "due_soon")
        count += 1

    return count


async def _process_tdc_alerts_for_user(session: AsyncSession, user_id, today: date) -> int:
    redis = await get_redis()
    count = 0

    tdc_accounts = await session.execute(
        select(Account).where(
            Account.user_id == user_id,
            Account.type == "liability",
            Account.subtype == "credit_card",
            Account.billing_cycle_day.is_not(None),
            Account.payment_due_day.is_not(None),
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
    )
    for account in tdc_accounts.scalars():
        cycle = await account_service.get_tdc_cycle(session, account, today)
        days_until_due = cycle["days_until_due"]
        if days_until_due is None or days_until_due > TDC_LOOKAHEAD_DAYS:
            continue
        if await cache_service.debt_alert_already_sent(redis, user_id, account.id, "tdc_due"):
            continue

        await notification_service.create(
            session,
            user_id=user_id,
            type_="tdc_due",
            title=f"TDC {account.name}: pago en {days_until_due} día(s)",
            body=f"Saldo a pagar: ${cycle['statement_balance']:,.0f}",
            related_entity_type="account",
            related_entity_id=account.id,
        )
        await push_service.send_push_if_enabled(
            session,
            user_id,
            f"TDC {account.name}: pago en {days_until_due} día(s)",
            f"Saldo a pagar: ${cycle['statement_balance']:,.0f}",
        )
        if days_until_due <= TDC_EMAIL_THRESHOLD_DAYS:
            await notification_service.send_email_notification(
                session,
                user_id,
                subject=f"Urgente: TDC {account.name} vence pronto",
                body_html=(
                    f"<p>Tu tarjeta {account.name} vence en {days_until_due} día(s).</p>"
                    f"<p>Saldo a pagar: ${cycle['statement_balance']:,.0f}</p>"
                ),
            )
        await cache_service.mark_debt_alert_sent(redis, user_id, account.id, "tdc_due")
        count += 1

    return count


async def _process_overdue_loans_for_user(session: AsyncSession, user_id, today: date) -> int:
    redis = await get_redis()
    count = 0

    overdue = await session.execute(
        select(Debt).where(
            Debt.user_id == user_id,
            Debt.type.in_(("loan_received", "informal")),
            Debt.status == "active",
            Debt.due_date.is_not(None),
            Debt.due_date < today,
            Debt.deleted_at.is_(None),
        )
    )
    for debt in overdue.scalars():
        if await cache_service.debt_alert_already_sent(redis, user_id, debt.id, "overdue"):
            continue
        days_overdue = (today - debt.due_date).days
        await notification_service.create(
            session,
            user_id=user_id,
            type_="loan_overdue",
            title=f"Préstamo vencido: {debt.name}",
            body=f"Venció hace {days_overdue} día(s). Saldo: ${debt.current_balance:,.0f}",
            related_entity_type="debt",
            related_entity_id=debt.id,
        )
        await cache_service.mark_debt_alert_sent(redis, user_id, debt.id, "overdue")
        count += 1

    return count


async def _process_debt_and_tdc_for_all_users() -> int:
    today = date.today()
    total = 0
    for user_id in await active_user_ids():
        async with rls_session(user_id) as session:
            total += await _process_debt_alerts_for_user(session, user_id, today)
            total += await _process_tdc_alerts_for_user(session, user_id, today)
    return total


async def _process_overdue_loans_for_all_users() -> int:
    today = date.today()
    total = 0
    for user_id in await active_user_ids():
        async with rls_session(user_id) as session:
            total += await _process_overdue_loans_for_user(session, user_id, today)
    return total


@celery_app.task(name="alerts.process_debt_and_tdc")
def process_debt_and_tdc() -> int:
    count = asyncio.run(_process_debt_and_tdc_for_all_users())
    logger.info("alerts_process_debt_and_tdc_completed", generated=count)
    return count


@celery_app.task(name="alerts.process_overdue_loans")
def process_overdue_loans() -> int:
    count = asyncio.run(_process_overdue_loans_for_all_users())
    logger.info("alerts_process_overdue_loans_completed", generated=count)
    return count
