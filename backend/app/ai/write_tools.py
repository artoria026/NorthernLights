"""Tools de escritura reales (M10 -> M02/M05/M06): crean cuentas, deudas,
recurrentes y transacciones de verdad, siempre scopeadas al usuario
autenticado via RLS (mismo patron que la sesion RLS que abre advisor.py).

Separado de app/ai/tools.py a proposito (SRP): las tools de tools.py son de
solo lectura (salvo create_insight). Estas las usa tanto el chat normal
(`/ai/chat`, con confirmacion explicita del usuario antes de crear -- ver
SYSTEM_PROMPT en advisor.py) como el modo de importacion (`/ai/import`).
"""

from decimal import Decimal, InvalidOperation
from uuid import UUID

import structlog
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import ACCOUNT_SUBTYPES, ACCOUNT_TYPES
from app.models.debt import DEBT_TYPES, PAYMENT_FREQUENCIES
from app.models.recurring import FREQUENCIES, ITEM_TYPES
from app.schemas.account import AccountCreate
from app.schemas.debt import DebtCreate, InitialCharge, UnplannedDebtCreate
from app.schemas.recurring import RecurringItemCreate
from app.schemas.transaction import TransactionCreate
from app.services import (
    account_service,
    category_service,
    debt_service,
    recurring_service,
    transaction_service,
)

logger = structlog.get_logger(__name__)

WRITE_TOOLS = [
    {
        "name": "create_transaction",
        "description": (
            "Crea UN ingreso o gasto puntual, no recurrente -- para cuando el usuario "
            "dicta de memoria movimientos sueltos (ej. 'gaste 100 en comida el martes, "
            "y 500 en gasolina el jueves'). Llama a esta tool una vez por cada "
            "movimiento; puedes hacer varias llamadas en la misma respuesta si ya "
            "tienes todos los datos de cada uno."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "entry_type": {"type": "string", "enum": ["income", "expense"]},
                "amount": {"type": "number"},
                "description": {"type": "string"},
                "account_name": {
                    "type": "string",
                    "description": "Nombre de la cuenta ya creada de donde sale/entra el dinero",
                },
                "category_name": {
                    "type": "string",
                    "description": "Nombre exacto de una de las categorias del sistema",
                },
            },
            "required": [
                "date",
                "entry_type",
                "amount",
                "description",
                "account_name",
                "category_name",
            ],
        },
    },
    {
        "name": "list_existing_accounts_and_debts",
        "description": (
            "Lista las cuentas, deudas activas y deudas sin plan que el usuario "
            "ya tiene registradas. Usa esto ANTES de crear nada para no duplicar "
            "algo que ya existe."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_account",
        "description": (
            "Crea una cuenta real del usuario (banco, efectivo, ahorro o tarjeta de credito)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "type": {"type": "string", "enum": list(ACCOUNT_TYPES)},
                "subtype": {"type": "string", "enum": list(ACCOUNT_SUBTYPES)},
                "initial_balance": {
                    "type": "number",
                    "description": "Saldo actual (lo que tiene, o lo que debe hoy si es TDC)",
                },
                "currency": {"type": "string", "default": "MXN"},
                "credit_limit": {"type": "number"},
                "interest_rate": {
                    "type": "number",
                    "description": "Tasa anual como decimal, ej 0.475 = 47.5%",
                },
                "billing_cycle_day": {"type": "integer"},
                "payment_due_day": {"type": "integer"},
                "notes": {"type": "string"},
            },
            "required": ["name", "type"],
        },
    },
    {
        "name": "create_debt",
        "description": (
            "Crea una deuda CON plan de pago activo (tiene cuota, frecuencia y dia de pago)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "creditor": {"type": "string"},
                "type": {"type": "string", "enum": list(DEBT_TYPES)},
                "total_amount": {"type": "number"},
                "current_balance": {
                    "type": "number",
                    "description": "Si es distinto de total_amount (ya se pago parte)",
                },
                "original_amount": {
                    "type": "number",
                    "description": "Monto antes de una quita/descuento, si aplica",
                },
                "agreed_amount": {
                    "type": "number",
                    "description": "Monto acordado despues de una quita/descuento, si aplica",
                },
                "interest_rate": {"type": "number", "description": "Decimal anual, ej 0.475"},
                "payment_amount": {"type": "number"},
                "payment_frequency": {"type": "string", "enum": list(PAYMENT_FREQUENCIES)},
                "payment_day": {"type": "integer"},
                "total_installments": {"type": "integer"},
                "next_payment_date": {"type": "string", "description": "YYYY-MM-DD"},
                "linked_account_name": {
                    "type": "string",
                    "description": "Nombre de la cuenta desde la que se paga, si se menciono",
                },
                "notes": {"type": "string"},
                "initial_charge": {
                    "type": "object",
                    "description": (
                        "Solo para type='installment' (compra a meses/MSI): registra la "
                        "transaccion de la compra completa contra la TDC en el mismo paso "
                        "que crea la deuda -- total_amount es el monto TOTAL de la compra."
                    ),
                    "properties": {
                        "category_name": {
                            "type": "string",
                            "description": "Categoria de gasto exacta para la compra",
                        },
                        "paying_account_name": {
                            "type": "string",
                            "description": "Nombre de la TDC/cuenta que se carga",
                        },
                        "description": {"type": "string"},
                    },
                    "required": ["category_name", "paying_account_name", "description"],
                },
            },
            "required": ["name", "type", "total_amount"],
        },
    },
    {
        "name": "create_unplanned_debt",
        "description": (
            "Crea una deuda SIN plan de pago organizado todavia (solo recordatorio, "
            "no afecta presupuesto ni balances)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "creditor": {"type": "string"},
                "amount": {"type": "number"},
                "notes": {"type": "string"},
            },
            "required": ["name", "amount"],
        },
    },
    {
        "name": "create_recurring_item",
        "description": (
            "Crea un gasto recurrente, suscripcion, servicio o ingreso fijo. La cuenta y "
            "la categoria se dan por nombre, no por id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "item_type": {"type": "string", "enum": list(ITEM_TYPES)},
                "amount": {"type": "number"},
                "frequency": {"type": "string", "enum": list(FREQUENCIES)},
                "frequency_day": {"type": "integer"},
                "account_name": {
                    "type": "string",
                    "description": "Nombre de la cuenta ya creada desde/hacia la que se mueve",
                },
                "category_name": {
                    "type": "string",
                    "description": "Nombre exacto de una de las 19 categorias del sistema",
                },
                "next_date": {"type": "string", "description": "YYYY-MM-DD"},
                "notes": {"type": "string"},
                "url": {"type": "string"},
            },
            "required": [
                "name",
                "item_type",
                "amount",
                "frequency",
                "account_name",
                "category_name",
            ],
        },
    },
]


# No escribe nada -- ver advisor.py, SYSTEM_PROMPT y execute() dentro de
# chat(). El asesor la llama en vez de solo preguntar "¿confirmas?" en el
# texto de su respuesta: el frontend la detecta en tool_calls y le muestra al
# usuario una tarjeta con los datos y botones de Confirmar/Cancelar (Advisor.tsx,
# ActionCard) en vez de depender de que escriba "si" en texto libre.
PROPOSE_ACTION_NAME = "propose_action"

PROPOSE_ACTION_TOOL = {
    "name": PROPOSE_ACTION_NAME,
    "description": (
        "Antes de ejecutar create_transaction, create_account, create_debt, "
        "create_unplanned_debt o create_recurring_item, llama primero a esta "
        "tool (salvo que el usuario ya te haya pedido explicitamente que "
        "registres ya con todos los datos). No crea nada -- le muestra al "
        "usuario una tarjeta con los datos y botones de Confirmar/Cancelar en "
        "vez de que tengas que preguntarlo en tu texto. En tu siguiente turno: "
        "si confirma, ejecuta la tool de escritura de 'action' con esos "
        "mismos datos; si cancela, no ejecutes nada."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "Nombre exacto de la tool de escritura que se ejecutaria si se confirma",
                "enum": [
                    "create_transaction",
                    "create_account",
                    "create_debt",
                    "create_unplanned_debt",
                    "create_recurring_item",
                ],
            },
            "summary": {
                "type": "string",
                "description": "Una frase corta describiendo la accion, ej. 'Registrar gasto de comida'",
            },
            "fields": {
                "type": "array",
                "description": "Los datos a mostrar en la tarjeta, en el orden en que deben verse",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                    },
                    "required": ["label", "value"],
                },
            },
        },
        "required": ["action", "summary", "fields"],
    },
}


def _decimal(value: float | int | str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


async def _resolve_account_id(session: AsyncSession, user_id: UUID, name: str) -> UUID | dict:
    accounts = await account_service.list_accounts(session, user_id)
    match = next((a for a in accounts if a.name.strip().lower() == name.strip().lower()), None)
    if match is None:
        existing = ", ".join(a.name for a in accounts) or "(ninguna)"
        return {
            "error": (
                f"No encontre una cuenta llamada '{name}'. Cuentas existentes: {existing}. "
                "Pregunta al usuario si falta crearla o si el nombre es distinto."
            )
        }
    return match.id


async def _resolve_category_id(
    session: AsyncSession, user_id: UUID, name: str, expected_type: str
) -> UUID | dict:
    categories = await category_service.list_categories(session, user_id, expected_type)
    match = next((c for c in categories if c.name.strip().lower() == name.strip().lower()), None)
    if match is None:
        existing = ", ".join(c.name for c in categories) or "(ninguna)"
        return {
            "error": (
                f"No encontre una categoria de tipo '{expected_type}' llamada '{name}'. "
                f"Categorias disponibles: {existing}. Pregunta al usuario cual usar."
            )
        }
    return match.id


def _format_validation_error(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        field = ".".join(str(loc) for loc in err["loc"]) or "valor"
        parts.append(f"{field}: {err['msg']}")
    return "Datos invalidos: " + "; ".join(parts)


async def execute_write_tool(
    session: AsyncSession, user_id: UUID, tool_name: str, tool_input: dict, role: str = "user"
) -> dict:
    """Nunca deja escapar una excepcion: cualquier fallo se devuelve como
    {"error": ...} para que el modelo lo lea y se lo explique al usuario en
    espanol, en vez de tumbar el stream completo con un error generico (ver
    SYSTEM_PROMPT/IMPORT_SYSTEM_PROMPT en advisor.py)."""
    try:
        return await _dispatch_write_tool(session, user_id, tool_name, tool_input, role)
    except KeyError as e:
        return {
            "error": (
                f"Falta el campo requerido {e} para usar la tool '{tool_name}'. "
                "Pidele ese dato al usuario antes de reintentar."
            )
        }
    except ValidationError as e:
        return {"error": _format_validation_error(e)}
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception:
        logger.exception("import_tool_failed", tool=tool_name, user_id=str(user_id))
        return {
            "error": (
                f"No pude completar '{tool_name}' por un error inesperado del servidor. "
                "Avisa al usuario y sugiere intentarlo de nuevo o hacerlo manualmente."
            )
        }


async def _dispatch_write_tool(
    session: AsyncSession, user_id: UUID, tool_name: str, tool_input: dict, role: str = "user"
) -> dict:
    match tool_name:
        case "create_transaction":
            account_id = await _resolve_account_id(session, user_id, tool_input["account_name"])
            if isinstance(account_id, dict):
                return account_id
            category_id = await _resolve_category_id(
                session, user_id, tool_input["category_name"], tool_input["entry_type"]
            )
            if isinstance(category_id, dict):
                return category_id
            entry = await transaction_service.create_transaction(
                session,
                user_id,
                TransactionCreate(
                    date=tool_input["date"],
                    description=tool_input["description"],
                    entry_type=tool_input["entry_type"],
                    category_id=category_id,
                    account_id=account_id,
                    amount=_decimal(tool_input["amount"]),
                ),
            )
            return {"id": str(entry.id), "description": entry.description, "created": True}
        case "list_existing_accounts_and_debts":
            accounts = await account_service.list_accounts(session, user_id)
            debts = await debt_service.list_debts(session, user_id)
            unplanned = await debt_service.list_unplanned_debts(session, user_id)
            return {
                "accounts": [
                    {
                        "name": a.name,
                        "type": a.type,
                        "subtype": a.subtype,
                        "balance": str(a.balance),
                    }
                    for a in accounts
                ],
                "debts_with_plan": [
                    {
                        "name": d.name,
                        "creditor": d.creditor,
                        "current_balance": str(d.current_balance),
                    }
                    for d in debts
                ],
                "debts_without_plan": [
                    {"name": d.name, "creditor": d.creditor, "amount": str(d.amount)}
                    for d in unplanned
                    if d.status == "pending"
                ],
            }
        case "create_account":
            account = await account_service.create_account(
                session,
                user_id,
                AccountCreate(
                    name=tool_input["name"],
                    type=tool_input["type"],
                    subtype=tool_input.get("subtype"),
                    initial_balance=_decimal(tool_input.get("initial_balance")) or Decimal(0),
                    currency=tool_input.get("currency", "MXN"),
                    credit_limit=_decimal(tool_input.get("credit_limit")),
                    interest_rate=_decimal(tool_input.get("interest_rate")),
                    billing_cycle_day=tool_input.get("billing_cycle_day"),
                    payment_due_day=tool_input.get("payment_due_day"),
                    notes=tool_input.get("notes"),
                ),
            )
            return {"id": str(account.id), "name": account.name, "created": True}
        case "create_debt":
            linked_account_id = None
            if tool_input.get("linked_account_name"):
                resolved = await _resolve_account_id(
                    session, user_id, tool_input["linked_account_name"]
                )
                if isinstance(resolved, dict):
                    return resolved
                linked_account_id = resolved

            initial_charge = None
            charge_input = tool_input.get("initial_charge")
            if charge_input:
                charge_category_id = await _resolve_category_id(
                    session, user_id, charge_input["category_name"], "expense"
                )
                if isinstance(charge_category_id, dict):
                    return charge_category_id
                charge_account_id = await _resolve_account_id(
                    session, user_id, charge_input["paying_account_name"]
                )
                if isinstance(charge_account_id, dict):
                    return charge_account_id
                initial_charge = InitialCharge(
                    category_id=charge_category_id,
                    paying_account_id=charge_account_id,
                    description=charge_input["description"],
                )

            debt = await debt_service.create_debt(
                session,
                user_id,
                DebtCreate(
                    name=tool_input["name"],
                    creditor=tool_input.get("creditor"),
                    type=tool_input["type"],
                    total_amount=_decimal(tool_input["total_amount"]),
                    current_balance=_decimal(tool_input.get("current_balance")),
                    original_amount=_decimal(tool_input.get("original_amount")),
                    agreed_amount=_decimal(tool_input.get("agreed_amount")),
                    interest_rate=_decimal(tool_input.get("interest_rate")) or Decimal(0),
                    payment_amount=_decimal(tool_input.get("payment_amount")),
                    payment_frequency=tool_input.get("payment_frequency"),
                    payment_day=tool_input.get("payment_day"),
                    total_installments=tool_input.get("total_installments"),
                    next_payment_date=tool_input.get("next_payment_date"),
                    linked_account_id=linked_account_id,
                    notes=tool_input.get("notes"),
                    initial_charge=initial_charge,
                ),
                current_user_role=role,
            )
            return {"id": str(debt.id), "name": debt.name, "created": True}
        case "create_unplanned_debt":
            unplanned = await debt_service.create_unplanned_debt(
                session,
                user_id,
                UnplannedDebtCreate(
                    name=tool_input["name"],
                    creditor=tool_input.get("creditor"),
                    amount=_decimal(tool_input["amount"]),
                    notes=tool_input.get("notes"),
                ),
            )
            return {"id": str(unplanned.id), "name": unplanned.name, "created": True}
        case "create_recurring_item":
            account_id = await _resolve_account_id(session, user_id, tool_input["account_name"])
            if isinstance(account_id, dict):
                return account_id
            expected_type = "income" if tool_input["item_type"] == "income" else "expense"
            category_id = await _resolve_category_id(
                session, user_id, tool_input["category_name"], expected_type
            )
            if isinstance(category_id, dict):
                return category_id
            item = await recurring_service.create_recurring_item(
                session,
                user_id,
                RecurringItemCreate(
                    name=tool_input["name"],
                    item_type=tool_input["item_type"],
                    amount=_decimal(tool_input["amount"]),
                    frequency=tool_input["frequency"],
                    frequency_day=tool_input.get("frequency_day"),
                    account_id=account_id,
                    category_id=category_id,
                    next_date=tool_input["next_date"],
                    notes=tool_input.get("notes"),
                    url=tool_input.get("url"),
                ),
            )
            return {"id": str(item.id), "name": item.name, "created": True}
        case _:
            return {"error": f"Tool desconocido: {tool_name}"}
