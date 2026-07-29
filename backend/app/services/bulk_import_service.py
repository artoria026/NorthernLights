from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from uuid import UUID

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.schemas.transaction import TransactionCreate
from app.services import account_service, category_service, transaction_service

# Layout: dos bloques lado a lado en una sola hoja, como una hoja de calculo
# casera tipica (ver el ejemplo que trajo el usuario) -- Ingresos en A-E,
# columna F vacia de separador, Gastos en G-K. Mismas 5 columnas en ambos:
# Monto, Descripcion, Fecha, Cuenta, Categoria (las ultimas dos son las que
# le agregamos a su formato original -- la app las necesita para saber a
# donde va cada movimiento).
SHEET_NAME = "Transacciones"
LISTS_SHEET = "Listas"
TEMPLATE_ROWS = 200
HEADER_ROW = 2
FIRST_DATA_ROW = 3

BLOCK_HEADERS = ["Monto", "Descripción", "Fecha", "Cuenta", "Categoría"]
INCOME_START_COL = 1  # A
EXPENSE_START_COL = 7  # G

INCOME_FILL = PatternFill("solid", fgColor="B8CCE4")
EXPENSE_FILL = PatternFill("solid", fgColor="E6B8B7")

COLUMN_WIDTHS = {1: 12, 2: 30, 3: 14, 4: 20, 5: 24, 6: 3, 7: 12, 8: 30, 9: 14, 10: 20, 11: 24}


def _write_block(ws, start_col: int, title: str, fill: PatternFill) -> None:
    title_cell = ws.cell(row=1, column=start_col, value=title)
    title_cell.font = Font(bold=True)
    for offset in range(5):
        ws.cell(row=1, column=start_col + offset).fill = fill
        header_cell = ws.cell(
            row=HEADER_ROW, column=start_col + offset, value=BLOCK_HEADERS[offset]
        )
        header_cell.font = Font(bold=True)
        header_cell.fill = fill


def build_template_workbook(
    accounts: list[Account],
    income_categories: list[Category],
    expense_categories: list[Category],
) -> BytesIO:
    """Plantilla descargable: dos tablas (Ingresos/Gastos) con Cuenta y
    Categoria como listas desplegables (referencian una hoja oculta 'Listas'
    -- Excel no soporta listas largas inline mas alla de ~255 caracteres)."""
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_NAME

    _write_block(ws, INCOME_START_COL, "Ingresos", INCOME_FILL)
    _write_block(ws, EXPENSE_START_COL, "Gastos", EXPENSE_FILL)

    for col, width in COLUMN_WIDTHS.items():
        ws.column_dimensions[chr(64 + col)].width = width
    ws.freeze_panes = "A3"

    lists_ws = wb.create_sheet(LISTS_SHEET)
    lists_ws.sheet_state = "hidden"
    account_names = [a.name for a in accounts] or ["(crea una cuenta primero)"]
    income_names = [c.name for c in income_categories] or ["(sin categorias)"]
    expense_names = [c.name for c in expense_categories] or ["(sin categorias)"]
    for i, name in enumerate(account_names, start=1):
        lists_ws.cell(row=i, column=1, value=name)
    for i, name in enumerate(income_names, start=1):
        lists_ws.cell(row=i, column=2, value=name)
    for i, name in enumerate(expense_names, start=1):
        lists_ws.cell(row=i, column=3, value=name)

    def _range(col: str, count: int) -> str:
        return f"={LISTS_SHEET}!${col}$1:${col}${count}"

    last_row = FIRST_DATA_ROW + TEMPLATE_ROWS - 1

    dv_account_income = DataValidation(
        type="list", formula1=_range("A", len(account_names)), allow_blank=True
    )
    dv_cat_income = DataValidation(
        type="list", formula1=_range("B", len(income_names)), allow_blank=True
    )
    dv_account_expense = DataValidation(
        type="list", formula1=_range("A", len(account_names)), allow_blank=True
    )
    dv_cat_expense = DataValidation(
        type="list", formula1=_range("C", len(expense_names)), allow_blank=True
    )
    for dv in (dv_account_income, dv_cat_income, dv_account_expense, dv_cat_expense):
        ws.add_data_validation(dv)
    dv_account_income.add(f"D{FIRST_DATA_ROW}:D{last_row}")
    dv_cat_income.add(f"E{FIRST_DATA_ROW}:E{last_row}")
    dv_account_expense.add(f"J{FIRST_DATA_ROW}:J{last_row}")
    dv_cat_expense.add(f"K{FIRST_DATA_ROW}:K{last_row}")

    for row in range(FIRST_DATA_ROW, last_row + 1):
        ws.cell(row=row, column=3).number_format = "yyyy-mm-dd"
        ws.cell(row=row, column=9).number_format = "yyyy-mm-dd"

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


@dataclass
class ParsedRow:
    entry_type: str
    amount: Decimal
    description: str
    date: date_type
    account_name: str
    category_name: str
    row_number: int


@dataclass
class ParseResult:
    rows: list[ParsedRow] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


def _parse_date(value: object) -> date_type | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date_type):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(value.strip(), fmt).date()  # noqa: DTZ007 (fecha de negocio, sin hora)
            except ValueError:
                continue
    return None


def _parse_amount(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        cleaned = str(value).replace("$", "").replace(",", "").strip()
        amount = Decimal(cleaned)
    except InvalidOperation:
        return None
    return amount if amount > 0 else None


def _parse_block(row_cells: tuple, row_idx: int, entry_type: str, start_col: int) -> tuple:
    """start_col es 0-indexado dentro de `row_cells` (0 para Ingresos/A,
    6 para Gastos/G). Retorna (ParsedRow | None, error dict | None)."""
    block_label = "Ingreso" if entry_type == "income" else "Gasto"
    amount_cell = row_cells[start_col].value
    if amount_cell in (None, ""):
        return None, None

    amount = _parse_amount(amount_cell)
    description = row_cells[start_col + 1].value
    date_value = _parse_date(row_cells[start_col + 2].value)
    account_name = row_cells[start_col + 3].value
    category_name = row_cells[start_col + 4].value
    account_name = str(account_name).strip() if account_name else ""
    category_name = str(category_name).strip() if category_name else ""

    if amount is None:
        return None, {"row": row_idx, "block": block_label, "reason": "Monto inválido"}
    if date_value is None:
        return None, {"row": row_idx, "block": block_label, "reason": "Fecha inválida o vacía"}
    if not account_name:
        return None, {"row": row_idx, "block": block_label, "reason": "Falta la cuenta"}
    if not category_name:
        return None, {"row": row_idx, "block": block_label, "reason": "Falta la categoría"}

    return (
        ParsedRow(
            entry_type=entry_type,
            amount=amount,
            description=str(description).strip() if description else block_label,
            date=date_value,
            account_name=account_name,
            category_name=category_name,
            row_number=row_idx,
        ),
        None,
    )


def parse_upload(content: bytes) -> ParseResult:
    wb = load_workbook(BytesIO(content), data_only=True)
    if SHEET_NAME not in wb.sheetnames:
        return ParseResult(
            errors=[
                {
                    "row": 0,
                    "block": None,
                    "reason": (
                        f"No encontré la hoja '{SHEET_NAME}'. Usa la plantilla descargada sin "
                        "renombrar la hoja."
                    ),
                }
            ]
        )
    ws = wb[SHEET_NAME]
    result = ParseResult()

    for row_idx, row_cells in enumerate(ws.iter_rows(min_row=FIRST_DATA_ROW), start=FIRST_DATA_ROW):
        for entry_type, start_col in (("income", 0), ("expense", 6)):
            if len(row_cells) < start_col + 5:
                continue
            parsed, error = _parse_block(row_cells, row_idx, entry_type, start_col)
            if parsed:
                result.rows.append(parsed)
            if error:
                result.errors.append(error)

    return result


async def commit_parsed_rows(session: AsyncSession, user_id: UUID, parsed: ParseResult) -> dict:
    accounts = await account_service.list_accounts(session, user_id)
    income_categories = await category_service.list_categories(session, user_id, "income")
    expense_categories = await category_service.list_categories(session, user_id, "expense")

    account_by_name = {a.name.strip().lower(): a.id for a in accounts}
    income_by_name = {c.name.strip().lower(): c.id for c in income_categories}
    expense_by_name = {c.name.strip().lower(): c.id for c in expense_categories}

    created = 0
    errors = list(parsed.errors)

    for row in parsed.rows:
        block_label = "Ingreso" if row.entry_type == "income" else "Gasto"
        account_id = account_by_name.get(row.account_name.strip().lower())
        if account_id is None:
            errors.append(
                {
                    "row": row.row_number,
                    "block": block_label,
                    "reason": f"La cuenta '{row.account_name}' no existe",
                }
            )
            continue

        cat_map = income_by_name if row.entry_type == "income" else expense_by_name
        category_id = cat_map.get(row.category_name.strip().lower())
        if category_id is None:
            errors.append(
                {
                    "row": row.row_number,
                    "block": block_label,
                    "reason": f"La categoría '{row.category_name}' no existe",
                }
            )
            continue

        await transaction_service.create_transaction(
            session,
            user_id,
            TransactionCreate(
                date=row.date,
                description=row.description,
                entry_type=row.entry_type,
                category_id=category_id,
                account_id=account_id,
                amount=row.amount,
            ),
        )
        created += 1

    return {"created": created, "errors": errors}
