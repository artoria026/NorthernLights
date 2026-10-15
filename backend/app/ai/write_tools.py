"""Real write tools (M10 -> M02/M05/M06): actually create accounts, debts,
recurring items, and transactions, always scoped to the authenticated
user via RLS (same pattern as the RLS session that advisor.py opens).

Separate from app/ai/tools.py on purpose (SRP): tools.py's tools are
read-only (except create_insight).

The advisor model does NOT get these tools: it can only call `propose_actions`
(see below), which validates the items and stores them as an AiProposal. These
functions are what the server runs, from proposal_service, when the user
confirms: what the user saw is exactly what gets executed.
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
from app.schemas.debt import DebtCreate, UnplannedDebtCreate
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
                    "description": (
                        "Nombre de la cuenta desde la que se paga, si se menciono. Si el "
                        "usuario no la tiene creada todavia, usa create_account primero "
                        "(o preguntale los datos)."
                    ),
                },
                "notes": {"type": "string"},
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


# The model never writes. These are the actions a proposal can contain; the server
# executes them only after the user confirms (proposal_service.confirm_proposal).
WRITE_ACTION_NAMES = (
    "create_transaction",
    "create_account",
    "create_debt",
    "create_unplanned_debt",
    "create_recurring_item",
)
WRITE_ACTION_TOOLS = [t for t in WRITE_TOOLS if t["name"] in WRITE_ACTION_NAMES]
# Read-only lookups that live in this list (the advisor may call them freely).
LOOKUP_TOOLS = [t for t in WRITE_TOOLS if t["name"] not in WRITE_ACTION_NAMES]

MAX_PROPOSAL_ITEMS = 60


def _argument_reference() -> str:
    """One line per action with its fields (* = required), generated from the very
    schemas execution validates against, so the tool description can't drift."""
    lines = []
    for tool in WRITE_ACTION_TOOLS:
        schema = tool["input_schema"]
        required = set(schema.get("required", []))
        parts = []
        for name, spec in schema["properties"].items():
            kind = "|".join(spec["enum"]) if spec.get("enum") else spec.get("type", "string")
            parts.append(f"{name}{'*' if name in required else ''}: {kind}")
        lines.append(f"- {tool['name']}: {', '.join(parts)}")
    return "\n".join(lines)


def _merged_argument_properties() -> dict:
    """Union of every action's fields, for the `arguments` object of an item. A
    name shared by actions with different meaning (e.g. `type`) loses its enum and
    description: the reference in the tool description says what each one accepts."""
    merged: dict[str, dict] = {}
    for tool in WRITE_ACTION_TOOLS:
        for name, spec in tool["input_schema"]["properties"].items():
            if name not in merged:
                merged[name] = dict(spec)
            elif merged[name] != spec:
                merged[name] = {"type": merged[name].get("type", "string")}
    return merged


# Writes nothing -- see advisor.py and proposal_service.py. This is the ONLY way
# the advisor can get something registered: it proposes, the frontend shows the user
# a card with every item and Confirm/Cancel buttons (Advisor.tsx), and only when the
# user confirms does the server execute the stored items.
PROPOSE_ACTIONS_NAME = "propose_actions"

PROPOSE_ACTIONS_TOOL = {
    "name": PROPOSE_ACTIONS_NAME,
    "description": (
        "Es tu UNICA forma de registrar algo: no tienes herramientas que escriban. "
        "Propon aqui, en UNA sola llamada, todo lo que quieres registrar (cuentas, "
        "deudas, gastos recurrentes, transacciones). No crea nada: guarda la "
        "propuesta exactamente como la mandas y le muestra al usuario una tarjeta con "
        "cada elemento y botones de Confirmar/Cancelar. Si confirma, el sistema "
        "registra esos mismos datos tal cual (tu no vuelves a hacer nada); si cancela, "
        "no se registra nada. No pidas confirmacion en tu texto. Valida todo antes de "
        "guardar: si algun elemento tiene un error se devuelve y tienes que corregirlo "
        f"y llamar de nuevo. Maximo {MAX_PROPOSAL_ITEMS} elementos por propuesta; si hay mas, "
        "haz varias propuestas (por ejemplo, una por mes).\n"
        "Campos de `arguments` segun `action` (* = requerido):\n" + _argument_reference()
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Una frase corta que describe toda la propuesta, ej. "
                "'Registrar 12 gastos del estado de cuenta de septiembre'",
            },
            "items": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_PROPOSAL_ITEMS,
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": list(WRITE_ACTION_NAMES)},
                        "arguments": {
                            "type": "object",
                            "description": "Los campos de la accion elegida",
                            "properties": _merged_argument_properties(),
                        },
                    },
                    "required": ["action", "arguments"],
                },
            },
        },
        "required": ["summary", "items"],
    },
}
PROPOSE_ACTIONS_TOOL["input_schema"]["properties"]["replaces"] = {
    "type": "string",
    "description": (
        "Id (o sus primeros 8 caracteres) de una propuesta PENDIENTE que esta nueva "
        "corrige: si el usuario pide quitar, agregar o cambiar algo de una propuesta "
        "pendiente, manda aqui la propuesta COMPLETA ya corregida y el id de la "
        "anterior; la anterior queda reemplazada y ya no se podra confirmar. "
        "Omitelo si es una propuesta independiente."
    ),
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
    wanted = name.strip().lower()
    # A system category answers to its name in either language.
    match = next(
        (
            c
            for c in categories
            if wanted in {c.name.strip().lower(), (c.name_en or "").strip().lower()}
        ),
        None,
    )
    if match is None:
        existing = ", ".join(c.display_name for c in categories) or "(ninguna)"
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



# -- display of an item in the proposal card: raw values under stable keys; the
# frontend localizes the labels and formats money/dates (so the card follows the UI
# language) --


def _present(**values: object) -> list[dict]:
    return [{"key": k, "value": str(v)} for k, v in values.items() if v not in (None, "")]


def _transaction_model(tool_input: dict, account_id: UUID, category_id: UUID) -> TransactionCreate:
    return TransactionCreate(
        date=tool_input["date"],
        description=tool_input["description"],
        entry_type=tool_input["entry_type"],
        category_id=category_id,
        account_id=account_id,
        amount=_decimal(tool_input["amount"]),
    )


def _account_model(tool_input: dict) -> AccountCreate:
    return AccountCreate(
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
    )


def _debt_model(tool_input: dict, linked_account_id: UUID | None) -> DebtCreate:
    return DebtCreate(
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
    )


def _unplanned_debt_model(tool_input: dict) -> UnplannedDebtCreate:
    return UnplannedDebtCreate(
        name=tool_input["name"],
        creditor=tool_input.get("creditor"),
        amount=_decimal(tool_input["amount"]),
        notes=tool_input.get("notes"),
    )


def _recurring_model(tool_input: dict, account_id: UUID, category_id: UUID) -> RecurringItemCreate:
    return RecurringItemCreate(
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
    )


def _check_against_schema(tool_name: str, tool_input: dict) -> str | None:
    """Required fields and enum values, from the same schema the model was shown.
    Returns a readable message, or None if it is fine."""
    tool = next(t for t in WRITE_ACTION_TOOLS if t["name"] == tool_name)
    schema = tool["input_schema"]
    for field in schema.get("required", []):
        if tool_input.get(field) in (None, ""):
            return (
                f"Falta el campo requerido '{field}' de '{tool_name}'. "
                "Pidele ese dato al usuario antes de proponerlo."
            )
    for field, spec in schema["properties"].items():
        value = tool_input.get(field)
        if value is not None and spec.get("enum") and value not in spec["enum"]:
            allowed = ", ".join(spec["enum"])
            return f"'{field}' de '{tool_name}' debe ser uno de: {allowed} (recibi '{value}')."
    return None


async def prepare_write_tool(
    session: AsyncSession, user_id: UUID, tool_name: str, tool_input: dict
) -> dict:
    """Dry run used when the advisor PROPOSES an item: checks everything the real
    execution will check (required fields, enum values, that the account/category
    exist, the same pydantic models) without writing, and returns the fields to show
    in the card -- or {"error": ...} for the advisor to fix. Never raises."""
    if tool_name not in WRITE_ACTION_NAMES:
        return {"error": f"'{tool_name}' no es una accion que se pueda proponer."}
    if not isinstance(tool_input, dict):
        return {"error": f"Los 'arguments' de '{tool_name}' deben ser un objeto."}
    try:
        problem = _check_against_schema(tool_name, tool_input)
        if problem:
            return {"error": problem}
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
                _transaction_model(tool_input, account_id, category_id)
                return {
                    "fields": _present(
                        date=tool_input["date"],
                        entry_type=tool_input["entry_type"],
                        amount=tool_input["amount"],
                        description=tool_input["description"],
                        account=tool_input["account_name"],
                        category=tool_input["category_name"],
                    )
                }
            case "create_account":
                _account_model(tool_input)
                return {
                    "fields": _present(
                        name=tool_input["name"],
                        type=tool_input["type"],
                        subtype=tool_input.get("subtype"),
                        initial_balance=tool_input.get("initial_balance"),
                        currency=tool_input.get("currency"),
                        credit_limit=tool_input.get("credit_limit"),
                        interest_rate=tool_input.get("interest_rate"),
                        billing_cycle_day=tool_input.get("billing_cycle_day"),
                        payment_due_day=tool_input.get("payment_due_day"),
                    )
                }
            case "create_debt":
                linked_account_id = None
                if tool_input.get("linked_account_name"):
                    resolved = await _resolve_account_id(
                        session, user_id, tool_input["linked_account_name"]
                    )
                    if isinstance(resolved, dict):
                        return resolved
                    linked_account_id = resolved
                _debt_model(tool_input, linked_account_id)
                return {
                    "fields": _present(
                        name=tool_input["name"],
                        creditor=tool_input.get("creditor"),
                        type=tool_input["type"],
                        total_amount=tool_input["total_amount"],
                        current_balance=tool_input.get("current_balance"),
                        payment_amount=tool_input.get("payment_amount"),
                        payment_frequency=tool_input.get("payment_frequency"),
                        payment_day=tool_input.get("payment_day"),
                        next_payment_date=tool_input.get("next_payment_date"),
                        interest_rate=tool_input.get("interest_rate"),
                        linked_account=tool_input.get("linked_account_name"),
                    )
                }
            case "create_unplanned_debt":
                _unplanned_debt_model(tool_input)
                return {
                    "fields": _present(
                        name=tool_input["name"],
                        creditor=tool_input.get("creditor"),
                        amount=tool_input["amount"],
                    )
                }
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
                _recurring_model(tool_input, account_id, category_id)
                return {
                    "fields": _present(
                        name=tool_input["name"],
                        item_type=tool_input["item_type"],
                        amount=tool_input["amount"],
                        frequency=tool_input["frequency"],
                        frequency_day=tool_input.get("frequency_day"),
                        account=tool_input["account_name"],
                        category=tool_input["category_name"],
                        next_date=tool_input["next_date"],
                    )
                }
    except ValidationError as e:
        return {"error": _format_validation_error(e)}
    except KeyError as e:
        return {"error": f"Falta el campo requerido {e} para '{tool_name}'."}
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception:
        logger.exception("prepare_write_tool_failed", tool=tool_name, user_id=str(user_id))
        return {"error": f"No pude validar '{tool_name}' por un error inesperado del servidor."}
    return {"error": f"Tool desconocido: {tool_name}"}


async def execute_write_tool(
    session: AsyncSession, user_id: UUID, tool_name: str, tool_input: dict, role: str = "user"
) -> dict:
    """Never lets an exception escape: any failure is returned as
    {"error": ...} so the model can read it and explain it to the user in
    Spanish, instead of taking down the whole stream with a generic error (see
    SYSTEM_PROMPT/IMPORT_SYSTEM_PROMPT in advisor.py)."""
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
                _transaction_model(tool_input, account_id, category_id),
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
                _account_model(tool_input),
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

            debt = await debt_service.create_debt(
                session,
                user_id,
                _debt_model(tool_input, linked_account_id),
                current_user_role=role,
            )
            return {"id": str(debt.id), "name": debt.name, "created": True}
        case "create_unplanned_debt":
            unplanned = await debt_service.create_unplanned_debt(
                session,
                user_id,
                _unplanned_debt_model(tool_input),
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
                _recurring_model(tool_input, account_id, category_id),
            )
            return {"id": str(item.id), "name": item.name, "created": True}
        case _:
            return {"error": f"Tool desconocido: {tool_name}"}
