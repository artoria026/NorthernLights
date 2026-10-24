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

from datetime import date as date_type
from decimal import Decimal, InvalidOperation
from uuid import UUID

import structlog
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import ACCOUNT_SUBTYPES, ACCOUNT_TYPES
from app.models.debt import DEBT_DIRECTIONS, DEBT_TYPES, PAYMENT_FREQUENCIES
from app.models.recurring import FREQUENCIES, ITEM_TYPES
from app.schemas.account import AccountCreate
from app.schemas.debt import DebtCreate, DebtIncreaseCreate, DebtPaymentCreate, UnplannedDebtCreate
from app.schemas.recurring import RecurringItemCreate
from app.schemas.transaction import JournalLineIn, SplitExpenseCreate, TransactionCreate
from app.services import (
    account_service,
    category_service,
    debt_service,
    recurring_service,
    tag_service,
    transaction_service,
)

logger = structlog.get_logger(__name__)

WRITE_TOOLS = [
    {
        "name": "create_transaction",
        "description": (
            "Crea UN ingreso o gasto puntual, no recurrente -- para cuando el usuario "
            "dicta de memoria movimientos sueltos (ej. 'gaste 100 en comida el martes, "
            "y 500 en gasolina el jueves') o a partir de un ticket o estado de cuenta. "
            "Un movimiento por elemento; un ticket puede partirse en varios elementos "
            "(uno por categoria) si el usuario lo pide."
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
                "notes": {
                    "type": "string",
                    "description": "Detalle libre (ej. los articulos de un ticket). Opcional",
                },
                "tag_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Etiquetas que el usuario YA tiene (ver list_categories_and_tags); "
                        "solo para gastos"
                    ),
                },
                "installment_total": {
                    "type": "integer",
                    "description": (
                        "Solo gasto pagado con TDC: numero de mensualidades si fue a meses "
                        "sin intereses (monto = total de la compra)"
                    ),
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
            "Crea una deuda: con plan de pago (cuota, frecuencia y dia de pago) o un prestamo "
            "informal a/de una persona (type=informal). direction=owed_to_me si el usuario "
            "PRESTO dinero (le deben); con funding_account_name el dinero sale de (o entra "
            "a) esa cuenta en ese momento. Si ya existe una deuda informal activa con esa "
            "persona usa increase_debt, no esta."
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
                "direction": {
                    "type": "string",
                    "enum": list(DEBT_DIRECTIONS),
                    "description": "owed_by_me (debo, por defecto) u owed_to_me (me deben)",
                },
                "funding_account_name": {
                    "type": "string",
                    "description": (
                        "Cuenta por donde SE MOVIO el dinero del prestamo (de donde salio si "
                        "presto, donde entro si le prestaron). Omitelo si la deuda ya existia "
                        "antes y solo se esta registrando su saldo"
                    ),
                },
                "start_date": {"type": "string", "description": "YYYY-MM-DD del prestamo"},
                "concept": {"type": "string", "description": "Concepto del movimiento inicial"},
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
                "auto_generate": {
                    "type": "boolean",
                    "description": (
                        "true (por defecto): la app genera el cargo cada ciclo. false: solo "
                        "recordatorio/seguimiento; usalo si el usuario paga a mano o ya "
                        "registro los cargos"
                    ),
                },
                "notes": {"type": "string"},
                "url": {"type": "string"},
                "icon": {
                    "type": "string",
                    "description": (
                        "Clave de icono (ej. spotify, netflix, server). Omitelo: la app sugiere "
                        "uno segun el nombre"
                    ),
                },
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
    {
        "name": "create_transfer",
        "description": (
            "Mueve dinero entre dos cuentas del usuario SIN que sea gasto ni ingreso "
            "(retiro a efectivo, pasar de nomina a ahorro, PAGO A UNA TARJETA DE CREDITO "
            "desde el banco: la TDC va en to_account_name). No uses create_transaction "
            "para esto: inflaria gastos e ingresos."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "amount": {"type": "number"},
                "from_account_name": {"type": "string", "description": "De donde sale"},
                "to_account_name": {"type": "string", "description": "A donde llega"},
                "description": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["date", "amount", "from_account_name", "to_account_name"],
        },
    },
    {
        "name": "register_debt_payment",
        "description": (
            "Registra un pago a una deuda activa (o un cobro, si la deuda es de alguien que "
            "le debe al usuario): baja su saldo y mueve el dinero de la cuenta. Es la forma "
            "correcta de pagar una deuda; NO la registres como gasto."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "debt_name": {"type": "string", "description": "Nombre de la deuda activa"},
                "account_name": {
                    "type": "string",
                    "description": "Cuenta de donde sale (o a donde entra, si es un cobro)",
                },
                "amount": {"type": "number"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "notes": {"type": "string"},
            },
            "required": ["debt_name", "account_name", "amount", "date"],
        },
    },
    {
        "name": "increase_debt",
        "description": (
            "Otro prestamo sobre una deuda que YA existe (le prestas mas a la misma persona, "
            "o te prestan mas): el saldo y el total crecen y el dinero se mueve por la "
            "cuenta."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "debt_name": {"type": "string"},
                "account_name": {
                    "type": "string",
                    "description": "Cuenta de donde sale el dinero (presto) o donde entra",
                },
                "amount": {"type": "number"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "concept": {"type": "string"},
            },
            "required": ["debt_name", "account_name", "amount", "date"],
        },
    },
    {
        "name": "create_split_expense",
        "description": (
            "Un gasto que el usuario pago completo pero que comparte con otras personas: "
            "solo `my_share` cuenta como gasto suyo y lo demas queda como deuda de cada "
            "persona hacia el (se suma a la deuda informal que ya tenga con ella). Total "
            "cargado a la cuenta = my_share + suma de debtors."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "description": {"type": "string"},
                "notes": {"type": "string"},
                "category_name": {"type": "string"},
                "paying_account_name": {
                    "type": "string",
                    "description": "Cuenta que absorbe el cargo completo",
                },
                "my_share": {"type": "number", "description": "Lo que le toca al usuario"},
                "debtors": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "person_name": {"type": "string"},
                            "amount": {"type": "number"},
                        },
                        "required": ["person_name", "amount"],
                    },
                },
            },
            "required": [
                "date",
                "description",
                "category_name",
                "paying_account_name",
                "my_share",
                "debtors",
            ],
        },
    },
    {
        "name": "reconcile_account",
        "description": (
            "Ajusta el saldo de una cuenta liquida (efectivo, debito, ahorro) al saldo REAL "
            "que el usuario tiene: la diferencia se registra como ajuste de saldo (no como "
            "gasto ni ingreso). Usalo solo cuando el usuario dice cuanto tiene de verdad."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "account_name": {"type": "string"},
                "real_balance": {"type": "number", "description": "Saldo real hoy"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "notes": {"type": "string"},
            },
            "required": ["account_name", "real_balance", "date"],
        },
    },
    {
        "name": "list_categories_and_tags",
        "description": (
            "Categorias de gasto e ingreso disponibles (nombre exacto) y las etiquetas que "
            "el usuario ya creo. Llamala antes de proponer movimientos si no estas seguro "
            "del nombre exacto de la categoria."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_recurring_items",
        "description": (
            "Gastos recurrentes, suscripciones y servicios ya registrados (monto, "
            "frecuencia, dia, cuenta, estado). Usala antes de crear uno para no duplicarlo."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_transactions",
        "description": (
            "Busca transacciones ya registradas (maximo 50, las mas recientes primero). "
            "Usala ANTES de proponer movimientos que podrian estar ya registrados (estado "
            "de cuenta, ticket, captura de banco) para no duplicar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Parte de la descripcion"},
                "date_from": {"type": "string", "description": "YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD"},
                "amount_min": {"type": "number"},
                "amount_max": {"type": "number"},
                "account_name": {"type": "string"},
                "limit": {"type": "integer", "description": "Por defecto 20"},
            },
        },
    },
    {
        "name": "get_debt_movements",
        "description": (
            "Historial de una deuda (prestamos, pagos, ajustes) con el saldo que dejo cada "
            "paso: para saber que ya se pago o se presto antes de registrar algo mas."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"debt_name": {"type": "string"}},
            "required": ["debt_name"],
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
    "create_transfer",
    "register_debt_payment",
    "increase_debt",
    "create_split_expense",
    "reconcile_account",
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
            if spec.get("type") == "array" and spec.get("items", {}).get("type") == "object":
                item_required = set(spec["items"].get("required", []))
                keys = ", ".join(
                    f"{k}{'*' if k in item_required else ''}" for k in spec["items"]["properties"]
                )
                kind = f"array de {{{keys}}}"
            elif spec.get("type") == "array":
                kind = "array de texto"
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


def _transaction_model(
    tool_input: dict, account_id: UUID, category_id: UUID, tag_ids: list[UUID] | None = None
) -> TransactionCreate:
    return TransactionCreate(
        date=tool_input["date"],
        description=tool_input["description"],
        notes=tool_input.get("notes"),
        tag_ids=tag_ids or [],
        entry_type=tool_input["entry_type"],
        category_id=category_id,
        account_id=account_id,
        amount=_decimal(tool_input["amount"]),
        installment_total=tool_input.get("installment_total"),
    )


async def _resolve_tag_ids(
    session: AsyncSession, user_id: UUID, names: list[str] | None
) -> list[UUID] | dict:
    if not names:
        return []
    tags = await tag_service.list_tags(session, user_id)
    by_name = {t.name.strip().lower(): t.id for t in tags}
    missing = [n for n in names if n.strip().lower() not in by_name]
    if missing:
        existing = ", ".join(t.name for t in tags) or "(ninguna)"
        return {
            "error": (
                f"No existe la etiqueta {', '.join(repr(n) for n in missing)}. Etiquetas del "
                f"usuario: {existing}. Pregunta si la omites o la crea el desde la app."
            )
        }
    return [by_name[n.strip().lower()] for n in names]


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


def _debt_model(
    tool_input: dict, linked_account_id: UUID | None, funding_account_id: UUID | None = None
) -> DebtCreate:
    return DebtCreate(
        name=tool_input["name"],
        creditor=tool_input.get("creditor"),
        type=tool_input["type"],
        direction=tool_input.get("direction") or "owed_by_me",
        funding_account_id=funding_account_id,
        start_date=tool_input.get("start_date"),
        concept=tool_input.get("concept"),
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
        auto_generate=tool_input.get("auto_generate", True),
        notes=tool_input.get("notes"),
        url=tool_input.get("url"),
        icon=tool_input.get("icon"),
    )


# -- actions that resolve several names (accounts, debts) before running ----------------
# Each _plan_* does ALL the checking and returns {"fields": [...], "run": async fn} or
# {"error": ...}. Proposing calls it and shows `fields` without running; confirming calls it
# again and awaits `run`, so what is checked is exactly what is executed.


async def _resolve_debt(
    session: AsyncSession, user_id: UUID, name: str, *, only_active: bool = True
) -> "object | dict":
    debts = await debt_service.list_debts(session, user_id)
    wanted = name.strip().lower()
    matches = [
        d
        for d in debts
        if d.name.strip().lower() == wanted and (not only_active or d.status == "active")
    ]
    if not matches:
        existing = ", ".join(d.name for d in debts if d.status == "active") or "(ninguna)"
        return {
            "error": (
                f"No encontre una deuda activa llamada '{name}'. Deudas activas: {existing}. "
                "Pregunta al usuario cual es, o si hay que crearla primero."
            )
        }
    if len(matches) > 1:
        return {
            "error": (
                f"Hay {len(matches)} deudas activas llamadas '{name}': pregunta al usuario "
                "cual es (debo o me deben)."
            )
        }
    return matches[0]


async def _plan_transfer(session: AsyncSession, user_id: UUID, a: dict) -> dict:
    origin = await _resolve_account_id(session, user_id, a["from_account_name"])
    if isinstance(origin, dict):
        return origin
    destination = await _resolve_account_id(session, user_id, a["to_account_name"])
    if isinstance(destination, dict):
        return destination
    if origin == destination:
        return {"error": "La cuenta de origen y la de destino son la misma."}
    amount = _decimal(a["amount"])
    data = TransactionCreate(
        date=a["date"],
        description=a.get("description") or "Transferencia",
        notes=a.get("notes"),
        entry_type="transfer",
        lines=[
            JournalLineIn(account_id=destination, amount=amount, type="debit"),
            JournalLineIn(account_id=origin, amount=amount, type="credit"),
        ],
    )

    async def run() -> dict:
        entry = await transaction_service.create_transaction(session, user_id, data)
        return {"id": str(entry.id), "description": entry.description, "created": True}

    return {
        "fields": _present(
            date=a["date"],
            amount=a["amount"],
            from_account=a["from_account_name"],
            to_account=a["to_account_name"],
            description=data.description,
        ),
        "run": run,
    }


async def _plan_debt_payment(session: AsyncSession, user_id: UUID, a: dict) -> dict:
    debt = await _resolve_debt(session, user_id, a["debt_name"])
    if isinstance(debt, dict):
        return debt
    account_id = await _resolve_account_id(session, user_id, a["account_name"])
    if isinstance(account_id, dict):
        return account_id
    data = DebtPaymentCreate(
        account_id=account_id, amount=_decimal(a["amount"]), date=a["date"], notes=a.get("notes")
    )

    async def run() -> dict:
        payment = await debt_service.register_debt_payment(session, user_id, debt.id, data)
        return {"id": str(payment.id), "debt": debt.name, "created": True}

    return {
        "fields": _present(
            debt=debt.name,
            amount=a["amount"],
            account=a["account_name"],
            date=a["date"],
            current_balance=debt.current_balance,
            notes=a.get("notes"),
        ),
        "run": run,
    }


async def _plan_debt_increase(session: AsyncSession, user_id: UUID, a: dict) -> dict:
    debt = await _resolve_debt(session, user_id, a["debt_name"], only_active=False)
    if isinstance(debt, dict):
        return debt
    account_id = await _resolve_account_id(session, user_id, a["account_name"])
    if isinstance(account_id, dict):
        return account_id
    data = DebtIncreaseCreate(
        account_id=account_id,
        amount=_decimal(a["amount"]),
        date=a["date"],
        concept=a.get("concept"),
    )

    async def run() -> dict:
        movement = await debt_service.increase_debt(session, user_id, debt.id, data)
        return {"id": str(movement.id), "debt": debt.name, "created": True}

    return {
        "fields": _present(
            debt=debt.name,
            amount=a["amount"],
            account=a["account_name"],
            date=a["date"],
            current_balance=debt.current_balance,
            concept=a.get("concept"),
        ),
        "run": run,
    }


async def _plan_split_expense(session: AsyncSession, user_id: UUID, a: dict) -> dict:
    account_id = await _resolve_account_id(session, user_id, a["paying_account_name"])
    if isinstance(account_id, dict):
        return account_id
    category_id = await _resolve_category_id(session, user_id, a["category_name"], "expense")
    if isinstance(category_id, dict):
        return category_id
    debtors = a["debtors"]
    if not isinstance(debtors, list) or not debtors:
        return {"error": "'debtors' debe ser una lista con al menos una persona."}
    data = SplitExpenseCreate(
        date=a["date"],
        description=a["description"],
        notes=a.get("notes"),
        category_id=category_id,
        paying_account_id=account_id,
        my_share=_decimal(a["my_share"]),
        debtors=[
            {"person_name": d.get("person_name"), "amount": _decimal(d.get("amount"))}
            for d in debtors
            if isinstance(d, dict)
        ],
    )
    total = data.my_share + sum(d.amount for d in data.debtors)

    async def run() -> dict:
        entry = await transaction_service.split_expense(session, user_id, data)
        return {"id": str(entry.id), "description": entry.description, "created": True}

    return {
        "fields": _present(
            date=a["date"],
            description=a["description"],
            category=a["category_name"],
            account=a["paying_account_name"],
            amount=total,
            my_share=a["my_share"],
            debtors=", ".join(f"{d.person_name} {d.amount}" for d in data.debtors),
        ),
        "run": run,
    }


async def _plan_reconcile(session: AsyncSession, user_id: UUID, a: dict) -> dict:
    account_id = await _resolve_account_id(session, user_id, a["account_name"])
    if isinstance(account_id, dict):
        return account_id
    account = await account_service.get_account(session, user_id, account_id)
    if account.type != "asset" or account.subtype not in account_service.LIQUID_SUBTYPES:
        return {
            "error": (
                f"'{a['account_name']}' no es una cuenta liquida (efectivo, debito o ahorro): "
                "solo esas se concilian."
            )
        }
    real_balance = _decimal(a["real_balance"])
    if real_balance is None or real_balance < 0:
        return {"error": "real_balance debe ser un numero mayor o igual a 0."}
    entry_date = date_type.fromisoformat(a["date"])

    async def run() -> dict:
        result = await transaction_service.reconcile_account(
            session, user_id, account_id, real_balance, entry_date, a.get("notes")
        )
        return {
            "adjusted": result["adjusted"],
            "previous_balance": str(result["previous_balance"]),
            "new_balance": str(result["new_balance"]),
        }

    return {
        "fields": _present(
            account=a["account_name"],
            current_balance=account.balance,
            real_balance=real_balance,
            delta=real_balance - account.balance,
            date=a["date"],
            notes=a.get("notes"),
        ),
        "run": run,
    }


_LOOKUP_NAMES = (
    "list_categories_and_tags",
    "list_recurring_items",
    "search_transactions",
    "get_debt_movements",
)

_PLANNERS = {
    "create_transfer": _plan_transfer,
    "register_debt_payment": _plan_debt_payment,
    "increase_debt": _plan_debt_increase,
    "create_split_expense": _plan_split_expense,
    "reconcile_account": _plan_reconcile,
}


# -- read-only lookups (the advisor calls them freely) ----------------------------------


async def _lookup(session: AsyncSession, user_id: UUID, name: str, a: dict) -> dict:
    match name:
        case "list_categories_and_tags":
            expense = await category_service.list_categories(session, user_id, "expense")
            income = await category_service.list_categories(session, user_id, "income")
            tags = await tag_service.list_tags(session, user_id)
            return {
                "expense_categories": [c.display_name for c in expense],
                "income_categories": [c.display_name for c in income],
                "tags": [t.name for t in tags],
            }
        case "list_recurring_items":
            items = await recurring_service.list_recurring_items(session, user_id)
            accounts = {x.id: x.name for x in await account_service.list_accounts(session, user_id)}
            return {
                "recurring_items": [
                    {
                        "name": i.name,
                        "item_type": i.item_type,
                        "amount": str(i.amount),
                        "frequency": i.frequency,
                        "frequency_day": i.frequency_day,
                        "account": accounts.get(i.account_id),
                        "status": i.status,
                        "auto_generate": i.auto_generate,
                        "next_date": str(i.next_date),
                    }
                    for i in items
                ]
            }
        case "search_transactions":
            account_id = None
            if a.get("account_name"):
                account_id = await _resolve_account_id(session, user_id, a["account_name"])
                if isinstance(account_id, dict):
                    return account_id
            limit = min(max(int(a.get("limit") or 20), 1), 50)
            entries, total = await transaction_service.list_transactions(
                session,
                user_id,
                per_page=limit,
                account_id=account_id,
                date_from=date_type.fromisoformat(a["date_from"]) if a.get("date_from") else None,
                date_to=date_type.fromisoformat(a["date_to"]) if a.get("date_to") else None,
                amount_min=_decimal(a.get("amount_min")),
                amount_max=_decimal(a.get("amount_max")),
                q=a.get("text"),
            )
            categories = await transaction_service.get_category_name_map(session, entries)
            return {
                "total_matches": total,
                "transactions": [
                    {
                        "date": str(e.date),
                        "description": e.description,
                        "amount": str(e.amount),
                        "entry_type": e.entry_type,
                        "status": e.status,
                        "category": categories.get(e.category_id),
                    }
                    for e in entries
                ],
            }
        case "get_debt_movements":
            debt = await _resolve_debt(session, user_id, a["debt_name"], only_active=False)
            if isinstance(debt, dict):
                return debt
            movements = await debt_service.list_debt_movements(session, user_id, debt.id)
            return {
                "debt": debt.name,
                "direction": debt.direction,
                "status": debt.status,
                "current_balance": str(debt.current_balance),
                "movements": [
                    {
                        "date": str(m["date"]),
                        "kind": m["kind"],
                        "delta": str(m["delta"]),
                        "concept": m["concept"],
                        "account": m["account_name"],
                        "balance_after": str(m["balance_after"]),
                    }
                    for m in movements
                ],
            }
    return {"error": f"Tool desconocido: {name}"}


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
        if tool_name in _PLANNERS:
            plan = await _PLANNERS[tool_name](session, user_id, tool_input)
            return {"error": plan["error"]} if "error" in plan else {"fields": plan["fields"]}
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
                tag_ids = await _resolve_tag_ids(session, user_id, tool_input.get("tag_names"))
                if isinstance(tag_ids, dict):
                    return tag_ids
                tx = _transaction_model(tool_input, account_id, category_id, tag_ids)
                await transaction_service.resolve_tags(session, user_id, tx.entry_type, tag_ids)
                return {
                    "fields": _present(
                        date=tool_input["date"],
                        entry_type=tool_input["entry_type"],
                        amount=tool_input["amount"],
                        description=tool_input["description"],
                        account=tool_input["account_name"],
                        category=tool_input["category_name"],
                        tags=", ".join(tool_input.get("tag_names") or []),
                        installment_total=tool_input.get("installment_total"),
                        notes=tool_input.get("notes"),
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
                funding_account_id = None
                if tool_input.get("funding_account_name"):
                    resolved = await _resolve_account_id(
                        session, user_id, tool_input["funding_account_name"]
                    )
                    if isinstance(resolved, dict):
                        return resolved
                    funding_account_id = resolved
                _debt_model(tool_input, linked_account_id, funding_account_id)
                return {
                    "fields": _present(
                        name=tool_input["name"],
                        creditor=tool_input.get("creditor"),
                        type=tool_input["type"],
                        direction=tool_input.get("direction"),
                        funding_account=tool_input.get("funding_account_name"),
                        start_date=tool_input.get("start_date"),
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
                        auto_generate=(
                            "false" if tool_input.get("auto_generate") is False else None
                        ),
                    )
                }
    except ValidationError as e:
        return {"error": _format_validation_error(e)}
    except KeyError as e:
        return {"error": f"Falta el campo requerido {e} para '{tool_name}'."}
    except ValueError as e:
        return {"error": f"Dato invalido en '{tool_name}': {e}"}
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
    except ValueError as e:
        return {"error": f"Dato invalido en '{tool_name}': {e}"}
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
    if tool_name in _PLANNERS:
        plan = await _PLANNERS[tool_name](session, user_id, tool_input)
        return {"error": plan["error"]} if "error" in plan else await plan["run"]()
    match tool_name:
        case name if name in _LOOKUP_NAMES:
            return await _lookup(session, user_id, tool_name, tool_input)
        case "create_transaction":
            account_id = await _resolve_account_id(session, user_id, tool_input["account_name"])
            if isinstance(account_id, dict):
                return account_id
            category_id = await _resolve_category_id(
                session, user_id, tool_input["category_name"], tool_input["entry_type"]
            )
            if isinstance(category_id, dict):
                return category_id
            tag_ids = await _resolve_tag_ids(session, user_id, tool_input.get("tag_names"))
            if isinstance(tag_ids, dict):
                return tag_ids
            entry = await transaction_service.create_transaction(
                session,
                user_id,
                _transaction_model(tool_input, account_id, category_id, tag_ids),
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
                        "type": d.type,
                        "direction": d.direction,
                        "status": d.status,
                        "current_balance": str(d.current_balance),
                    }
                    for d in debts
                    if d.status != "completed"
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
            funding_account_id = None
            if tool_input.get("funding_account_name"):
                resolved = await _resolve_account_id(
                    session, user_id, tool_input["funding_account_name"]
                )
                if isinstance(resolved, dict):
                    return resolved
                funding_account_id = resolved

            debt = await debt_service.create_debt(
                session,
                user_id,
                _debt_model(tool_input, linked_account_id, funding_account_id),
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
