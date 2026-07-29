import json
from datetime import date
from typing import Any
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.insight import INSIGHT_CATEGORIES, INSIGHT_PRIORITIES
from app.schemas.engine import SimulationRequest
from app.schemas.insight import InsightCreateFromChat
from app.services import budget_service, debt_service, engine_service, insight_service

TOOLS = [
    {
        "name": "get_financial_summary",
        "description": (
            "Snapshot completo: saldo, ingresos, gastos del mes, deudas, "
            "presupuesto y health score."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_available_spending",
        "description": "Dinero libre disponible para gastar en un periodo.",
        "input_schema": {
            "type": "object",
            "properties": {"period": {"type": "string", "enum": ["today", "week", "month"]}},
            "required": ["period"],
        },
    },
    {
        "name": "simulate_new_commitment",
        "description": "Impacto en presupuesto de adquirir una nueva deuda o gasto recurrente.",
        "input_schema": {
            "type": "object",
            "properties": {
                "monthly_amount": {"type": "number"},
                "duration_months": {"type": "integer", "description": "0 = indefinido"},
                "description": {"type": "string"},
            },
            "required": ["monthly_amount"],
        },
    },
    {
        "name": "get_debt_schedule",
        "description": "Proximos pagos de deudas y recurrentes en N dias.",
        "input_schema": {
            "type": "object",
            "properties": {"days_ahead": {"type": "integer", "default": 30}},
        },
    },
    {
        "name": "get_problem_debts",
        "description": (
            "Deudas que el usuario marco como con problemas de pago: sin plan "
            "de pago definido (owed_by_me) o en negociacion. Usa esto cuando "
            "el usuario pida ayuda para salir de una deuda o analizar como "
            "pagarla -- estas deudas no aparecen en get_debt_schedule porque "
            "no tienen un calendario de pagos."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_spending_by_category",
        "description": "Gastos del mes por categoria con comparacion vs limite de presupuesto.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "string", "description": "YYYY-MM, default mes actual"}
            },
        },
    },
    {
        "name": "create_insight",
        "description": (
            "Persiste un plan o recomendacion que el usuario quiere guardar y "
            "hacerle seguimiento activo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "category": {"type": "string", "enum": list(INSIGHT_CATEGORIES)},
                "priority": {"type": "string", "enum": list(INSIGHT_PRIORITIES)},
            },
            "required": ["title", "description", "category"],
        },
    },
]


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _parse_month(month: str | None) -> tuple[int, int]:
    if not month:
        today = date.today()
        return today.year, today.month
    year_str, month_str = month.split("-")
    return int(year_str), int(month_str)


async def execute_tool(
    session: AsyncSession,
    redis: Redis,
    user_id: UUID,
    tool_name: str,
    tool_input: dict,
    snapshot: dict,
) -> dict:
    match tool_name:
        case "get_financial_summary":
            return snapshot
        case "get_available_spending":
            result = await engine_service.available_spending(session, user_id, tool_input["period"])
            return _json_safe(result)
        case "simulate_new_commitment":
            scenario = SimulationRequest(
                type="new_debt", monthly_amount=tool_input["monthly_amount"]
            )
            result = await engine_service.simulate_scenario(session, user_id, scenario)
            return _json_safe(result)
        case "get_debt_schedule":
            days_ahead = tool_input.get("days_ahead", 30)
            debts = await debt_service.get_upcoming(session, user_id, days_ahead)
            return _json_safe(
                {
                    "debts": [
                        {
                            "id": str(d.id),
                            "name": d.name,
                            "next_payment_date": d.next_payment_date,
                            "payment_amount": d.payment_amount,
                        }
                        for d in debts
                    ]
                }
            )
        case "get_problem_debts":
            unplanned = await debt_service.list_unplanned_debts(session, user_id)
            negotiating = await debt_service.list_debts(session, user_id, status_="negotiating")
            return _json_safe(
                {
                    "without_payment_plan": [
                        {
                            "id": str(u.id),
                            "name": u.name,
                            "creditor": u.creditor,
                            "amount": u.amount,
                            "notes": u.notes,
                        }
                        for u in unplanned
                        if u.status == "pending" and u.direction == "owed_by_me"
                    ],
                    "in_negotiation": [
                        {
                            "id": str(d.id),
                            "name": d.name,
                            "current_balance": d.current_balance,
                            "interest_rate": d.interest_rate,
                        }
                        for d in negotiating
                    ],
                }
            )
        case "get_spending_by_category":
            year, month = _parse_month(tool_input.get("month"))
            result = await budget_service.get_current_budget(session, user_id, year, month)
            return _json_safe(result)
        case "create_insight":
            payload = InsightCreateFromChat(
                title=tool_input["title"],
                description=tool_input["description"],
                category=tool_input["category"],
                priority=tool_input.get("priority", "medium"),
            )
            return await insight_service.create_from_chat(session, user_id, payload, snapshot)
        case _:
            return {"error": f"Tool desconocido: {tool_name}"}
