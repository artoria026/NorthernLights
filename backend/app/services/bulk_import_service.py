import re
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from uuid import UUID

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.tag import Tag
from app.models.transaction import JournalEntry
from app.schemas.transaction import JournalLineIn, TransactionCreate
from app.services import account_service, category_service, transaction_service

# Layout: two blocks side by side on a single sheet, like a typical
# homemade spreadsheet (see the example the user brought) -- Income in A-E,
# empty column F as a separator, Expenses in G-K. Same 5 columns in both:
# Amount, Description, Date, Account, Category (the last two are the ones
# we added to their original format -- the app needs them to know where
# each transaction goes).
SHEET_NAME = "Transacciones"
LISTS_SHEET = "Listas"
TEMPLATE_ROWS = 200
HEADER_ROW = 2
FIRST_DATA_ROW = 3

BLOCK_HEADERS = ["Monto", "Descripción", "Fecha", "Cuenta", "Categoría"]
INCOME_START_COL = 1  # A
EXPENSE_START_COL = 7  # G

# Optional third block (P-T): payments to a credit card, a transfer from one of the user's
# own accounts to the card. It has no category -- the last column is the card instead.
CARD_PAYMENT_START_COL = 16  # P
CARD_PAYMENT_HEADERS = ["Monto", "Descripción", "Fecha", "Cuenta origen", "Tarjeta"]
CARD_PAYMENT_DEFAULT_DESCRIPTION = "Pago de tarjeta"
CARD_PAYMENT_FILL = PatternFill("solid", fgColor="D8E4BC")

# Optional column after the Expenses block (L): the tags of each expense, separated by
# commas. Files made before it existed simply don't have it -- they keep working.
TAGS_COL = 12  # L
TAGS_HEADER = "Etiquetas"

# Two more optional columns after the tags: a free-text note per transaction, one for
# the Expenses block (M, next to its tags) and one for the Income block (N), because a
# single row can hold an income and an expense at once. Old files don't have them.
EXPENSE_NOTES_COL = 13  # M
INCOME_NOTES_COL = 14  # N
NOTES_HEADER = "Notas"
INCOME_NOTES_HEADER = "Notas (ingresos)"

# Optional column after the card payments block (U): months without interest for an expense
# paid with a credit card ("MSI"). Empty = a normal purchase; 2 or more = an installment plan.
INSTALLMENTS_COL = 21  # U
INSTALLMENTS_HEADER = "Meses sin intereses"
MIN_INSTALLMENTS = 2
TAG_SEPARATORS = re.compile(r"[,;]")

INCOME_FILL = PatternFill("solid", fgColor="B8CCE4")
EXPENSE_FILL = PatternFill("solid", fgColor="E6B8B7")

COLUMN_WIDTHS = {
    1: 12,
    2: 30,
    3: 14,
    4: 20,
    5: 24,
    6: 3,
    7: 12,
    8: 30,
    9: 14,
    10: 20,
    11: 24,
    12: 28,
    13: 40,
    14: 40,
    15: 3,
    16: 12,
    17: 30,
    18: 14,
    19: 20,
    20: 24,
    21: 18,
}


def _write_block(
    ws, start_col: int, title: str, fill: PatternFill, headers: list[str] = BLOCK_HEADERS
) -> None:
    title_cell = ws.cell(row=1, column=start_col, value=title)
    title_cell.font = Font(bold=True)
    for offset in range(5):
        ws.cell(row=1, column=start_col + offset).fill = fill
        header_cell = ws.cell(row=HEADER_ROW, column=start_col + offset, value=headers[offset])
        header_cell.font = Font(bold=True)
        header_cell.fill = fill


def _is_asset(account: Account) -> bool:
    return account.type == "asset"


def _is_credit_card(account: Account) -> bool:
    return account.type == "liability" and account.subtype == "credit_card"


def build_template_workbook(
    accounts: list[Account],
    income_categories: list[Category],
    expense_categories: list[Category],
    tag_names: list[str] | None = None,
) -> BytesIO:
    """Downloadable template: two tables (Income/Expenses) with Account and
    Category as dropdown lists (referencing a hidden 'Listas' sheet
    -- Excel doesn't support long inline lists beyond ~255 characters). The
    Expenses block has an extra optional 'Etiquetas' column (several tags separated
    by commas; the dropdown suggests the user's tags but doesn't force a single one)."""
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_NAME

    _write_block(ws, INCOME_START_COL, "Ingresos", INCOME_FILL)
    _write_block(ws, EXPENSE_START_COL, "Gastos", EXPENSE_FILL)
    _write_block(
        ws, CARD_PAYMENT_START_COL, "Pagos de tarjeta", CARD_PAYMENT_FILL, CARD_PAYMENT_HEADERS
    )
    tags_header = ws.cell(row=HEADER_ROW, column=TAGS_COL, value=TAGS_HEADER)
    tags_header.font = Font(bold=True)
    tags_header.fill = EXPENSE_FILL
    ws.cell(row=1, column=TAGS_COL).fill = EXPENSE_FILL
    for col, header, fill in (
        (EXPENSE_NOTES_COL, NOTES_HEADER, EXPENSE_FILL),
        (INCOME_NOTES_COL, INCOME_NOTES_HEADER, INCOME_FILL),
        (INSTALLMENTS_COL, INSTALLMENTS_HEADER, EXPENSE_FILL),
    ):
        notes_header = ws.cell(row=HEADER_ROW, column=col, value=header)
        notes_header.font = Font(bold=True)
        notes_header.fill = fill
        ws.cell(row=1, column=col).fill = fill

    for col, width in COLUMN_WIDTHS.items():
        ws.column_dimensions[chr(64 + col)].width = width
    ws.freeze_panes = "A3"

    lists_ws = wb.create_sheet(LISTS_SHEET)
    lists_ws.sheet_state = "hidden"
    account_names = [a.name for a in accounts] or ["(crea una cuenta primero)"]
    income_names = [c.display_name for c in income_categories] or ["(sin categorias)"]
    expense_names = [c.display_name for c in expense_categories] or ["(sin categorias)"]
    for i, name in enumerate(account_names, start=1):
        lists_ws.cell(row=i, column=1, value=name)
    for i, name in enumerate(income_names, start=1):
        lists_ws.cell(row=i, column=2, value=name)
    for i, name in enumerate(expense_names, start=1):
        lists_ws.cell(row=i, column=3, value=name)
    tag_names = list(tag_names or [])
    for i, name in enumerate(tag_names, start=1):
        lists_ws.cell(row=i, column=4, value=name)
    # For the card payments block: where the money comes from (assets) and the cards.
    source_names = [a.name for a in accounts if _is_asset(a)] or ["(crea una cuenta primero)"]
    card_names = [a.name for a in accounts if _is_credit_card(a)] or ["(sin tarjetas)"]
    for i, name in enumerate(source_names, start=1):
        lists_ws.cell(row=i, column=5, value=name)
    for i, name in enumerate(card_names, start=1):
        lists_ws.cell(row=i, column=6, value=name)

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
    dv_source = DataValidation(
        type="list", formula1=_range("E", len(source_names)), allow_blank=True
    )
    dv_card = DataValidation(type="list", formula1=_range("F", len(card_names)), allow_blank=True)
    for dv in (
        dv_account_income,
        dv_cat_income,
        dv_account_expense,
        dv_cat_expense,
        dv_source,
        dv_card,
    ):
        ws.add_data_validation(dv)
    if tag_names:
        # Suggests the existing tags, but typing several separated by commas must not be rejected.
        dv_tags = DataValidation(
            type="list",
            formula1=_range("D", len(tag_names)),
            allow_blank=True,
            showErrorMessage=False,
        )
        ws.add_data_validation(dv_tags)
        dv_tags.add(f"L{FIRST_DATA_ROW}:L{last_row}")
    dv_account_income.add(f"D{FIRST_DATA_ROW}:D{last_row}")
    dv_cat_income.add(f"E{FIRST_DATA_ROW}:E{last_row}")
    dv_account_expense.add(f"J{FIRST_DATA_ROW}:J{last_row}")
    dv_cat_expense.add(f"K{FIRST_DATA_ROW}:K{last_row}")
    dv_source.add(f"S{FIRST_DATA_ROW}:S{last_row}")
    dv_card.add(f"T{FIRST_DATA_ROW}:T{last_row}")

    for row in range(FIRST_DATA_ROW, last_row + 1):
        ws.cell(row=row, column=3).number_format = "yyyy-mm-dd"
        ws.cell(row=row, column=9).number_format = "yyyy-mm-dd"
        ws.cell(row=row, column=CARD_PAYMENT_START_COL + 2).number_format = "yyyy-mm-dd"

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
    tags: list[str] = field(default_factory=list)
    notes: str | None = None
    # Only for entry_type 'card_payment': the card that receives the payment (account_name
    # is where the money comes from, category_name stays empty).
    card_name: str = ""
    # Only for an expense paid with a credit card: number of months without interest.
    installments: int | None = None


def _parse_notes(row_cells: tuple, entry_type: str) -> str | None:
    """The note of the row's block, or None when the cell is empty or the file is older
    than the notes columns."""
    col = EXPENSE_NOTES_COL if entry_type == "expense" else INCOME_NOTES_COL
    if len(row_cells) < col:
        return None
    value = row_cells[col - 1].value
    text = str(value).strip() if value is not None else ""
    return text or None


def _parse_installments(row_cells: tuple, entry_type: str) -> tuple[int | None, bool]:
    """(months, is_valid). Only expenses can have months; an empty cell (or an old file
    without the column) means a normal purchase."""
    if entry_type != "expense" or len(row_cells) < INSTALLMENTS_COL:
        return None, True
    value = row_cells[INSTALLMENTS_COL - 1].value
    if value is None or str(value).strip() == "":
        return None, True
    try:
        months = int(str(value).strip())
    except ValueError:
        return None, False
    if months < MIN_INSTALLMENTS:
        return None, False
    return months, True


def _parse_tags(value: object) -> list[str]:
    """'Viaje Mty, Choque' -> ['Viaje Mty', 'Choque'] (no blanks, no repeats, order kept)."""
    if value is None:
        return []
    names = [part.strip() for part in TAG_SEPARATORS.split(str(value))]
    return list(dict.fromkeys(name for name in names if name))


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
                return datetime.strptime(value.strip(), fmt).date()  # noqa: DTZ007 (business date, no time)
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


BLOCK_LABELS = {"income": "Ingreso", "expense": "Gasto", "card_payment": "Pago de tarjeta"}


def _parse_block(row_cells: tuple, row_idx: int, entry_type: str, start_col: int) -> tuple:
    """start_col is 0-indexed within `row_cells` (0 for Income/A, 6 for Expenses/G, 15 for
    Card payments/P). Returns (ParsedRow | None, error dict | None)."""
    block_label = BLOCK_LABELS[entry_type]
    is_card_payment = entry_type == "card_payment"
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
        reason = "Falta la cuenta de origen" if is_card_payment else "Falta la cuenta"
        return None, {"row": row_idx, "block": block_label, "reason": reason}
    if not category_name:
        reason = "Falta la tarjeta" if is_card_payment else "Falta la categoría"
        return None, {"row": row_idx, "block": block_label, "reason": reason}

    installments, installments_ok = _parse_installments(row_cells, entry_type)
    if not installments_ok:
        return None, {
            "row": row_idx,
            "block": block_label,
            "reason": (
                f"Los meses sin intereses deben ser un número entero de {MIN_INSTALLMENTS} o más"
            ),
        }

    default_description = CARD_PAYMENT_DEFAULT_DESCRIPTION if is_card_payment else block_label
    return (
        ParsedRow(
            entry_type=entry_type,
            amount=amount,
            description=str(description).strip() if description else default_description,
            date=date_value,
            account_name=account_name,
            # In a card payment the last column is the card, not a category.
            category_name="" if is_card_payment else category_name,
            card_name=category_name if is_card_payment else "",
            row_number=row_idx,
            # Only expenses carry tags (the rest of the app enforces it too); the column
            # may not exist in files made before it was added.
            tags=(
                _parse_tags(row_cells[TAGS_COL - 1].value)
                if entry_type == "expense" and len(row_cells) >= TAGS_COL
                else []
            ),
            notes=None if is_card_payment else _parse_notes(row_cells, entry_type),
            installments=installments,
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
        for entry_type, start_col in (
            ("income", INCOME_START_COL - 1),
            ("expense", EXPENSE_START_COL - 1),
            ("card_payment", CARD_PAYMENT_START_COL - 1),
        ):
            if len(row_cells) < start_col + 5:
                continue
            parsed, error = _parse_block(row_cells, row_idx, entry_type, start_col)
            if parsed:
                result.rows.append(parsed)
            if error:
                result.errors.append(error)

    return result


def _category_names(category: Category) -> list[str]:
    """Lowercased names a category answers to. A system category answers to its name
    in either language, whatever the language of the template the file came from."""
    return [n.strip().lower() for n in (category.name, category.name_en) if n]


def _category_lookup(categories: list[Category]) -> dict[str, UUID]:
    """Lowercased name -> id (a system category answers to either language)."""
    return {name: c.id for c in categories for name in _category_names(c)}


@dataclass
class ResolvedRow:
    """A parsed row whose account, category and tags exist for this user."""

    row: ParsedRow
    account_id: UUID
    account_name: str
    category_id: UUID | None
    category_name: str
    tag_ids: list[UUID]
    tag_names: list[str]
    # Only for a card payment: the card that receives it (account_* is the source).
    card_account_id: UUID | None = None
    card_account_name: str = ""


async def resolve_rows(
    session: AsyncSession, user_id: UUID, parsed: ParseResult
) -> tuple[list[ResolvedRow], list[dict]]:
    """Matches every parsed row against the user's accounts, categories and tags
    WITHOUT writing anything. Rows that don't match go to the error list (with the
    reason); the others come back ready to be created. Both the preview and the real
    load go through here, so what the preview shows is what the load will do."""
    accounts = await account_service.list_accounts(session, user_id)
    income_categories = await category_service.list_categories(session, user_id, "income")
    expense_categories = await category_service.list_categories(session, user_id, "expense")

    account_by_name = {a.name.strip().lower(): a for a in accounts}
    tags = (await session.execute(select(Tag).where(Tag.user_id == user_id))).scalars().all()
    tag_by_name = {t.name.strip().lower(): t for t in tags}
    category_by_type = {
        "income": {n: c for c in income_categories for n in _category_names(c)},
        "expense": {n: c for c in expense_categories for n in _category_names(c)},
    }

    resolved: list[ResolvedRow] = []
    errors = list(parsed.errors)
    for row in parsed.rows:
        block_label = BLOCK_LABELS[row.entry_type]

        def fail(reason: str, row=row, block_label=block_label) -> None:
            errors.append({"row": row.row_number, "block": block_label, "reason": reason})

        account = account_by_name.get(row.account_name.strip().lower())
        if account is None:
            fail(f"La cuenta '{row.account_name}' no existe")
            continue
        if row.entry_type == "card_payment":
            card = account_by_name.get(row.card_name.strip().lower())
            if card is None or not _is_credit_card(card):
                fail(f"La tarjeta '{row.card_name}' no existe o no es una tarjeta de crédito")
                continue
            if not _is_asset(account):
                fail(f"La cuenta de origen '{row.account_name}' debe ser una cuenta de dinero")
                continue
            resolved.append(
                ResolvedRow(
                    row=row,
                    account_id=account.id,
                    account_name=account.name,
                    category_id=None,
                    category_name="",
                    tag_ids=[],
                    tag_names=[],
                    card_account_id=card.id,
                    card_account_name=card.name,
                )
            )
            continue
        if row.installments and not _is_credit_card(account):
            fail("Los meses sin intereses solo aplican si pagas con una tarjeta de crédito")
            continue
        category = category_by_type[row.entry_type].get(row.category_name.strip().lower())
        if category is None:
            fail(f"La categoría '{row.category_name}' no existe")
            continue
        unknown_tags = [name for name in row.tags if name.lower() not in tag_by_name]
        if unknown_tags:
            fail(
                f"La etiqueta '{unknown_tags[0]}' no existe: créala en Etiquetas "
                "o corrige el nombre"
            )
            continue
        row_tags = [tag_by_name[name.lower()] for name in row.tags]
        resolved.append(
            ResolvedRow(
                row=row,
                account_id=account.id,
                account_name=account.name,
                category_id=category.id,
                category_name=category.display_name,
                tag_ids=[t.id for t in row_tags],
                tag_names=[t.name for t in row_tags],
            )
        )
    return resolved, errors


async def commit_parsed_rows(session: AsyncSession, user_id: UUID, parsed: ParseResult) -> dict:
    resolved, errors = await resolve_rows(session, user_id, parsed)
    for item in resolved:
        row = item.row
        if row.entry_type == "card_payment":
            # Paying a card is a transfer: it lowers what the card owes (debit on the
            # card) and takes the money out of the source account (credit).
            await transaction_service.create_transaction(
                session,
                user_id,
                TransactionCreate(
                    date=row.date,
                    description=row.description,
                    entry_type="transfer",
                    lines=[
                        JournalLineIn(
                            account_id=item.card_account_id, amount=row.amount, type="debit"
                        ),
                        JournalLineIn(account_id=item.account_id, amount=row.amount, type="credit"),
                    ],
                ),
            )
            continue
        await transaction_service.create_transaction(
            session,
            user_id,
            TransactionCreate(
                date=row.date,
                description=row.description,
                entry_type=row.entry_type,
                category_id=item.category_id,
                account_id=item.account_id,
                amount=row.amount,
                tag_ids=item.tag_ids,
                notes=row.notes,
                installment_total=row.installments,
            ),
        )
    return {"created": len(resolved), "errors": errors}


async def _existing_keys(
    session: AsyncSession, user_id: UUID, resolved: list[ResolvedRow]
) -> set[tuple[date_type, Decimal, str, str]]:
    """(date, amount, description, entry_type) of what the user already has in the
    date range of the file, to warn about rows that look already loaded."""
    if not resolved:
        return set()
    start = min(item.row.date for item in resolved)
    end = max(item.row.date for item in resolved)
    entries = (
        (
            await session.execute(
                select(JournalEntry).where(
                    JournalEntry.user_id == user_id,
                    JournalEntry.deleted_at.is_(None),
                    JournalEntry.date >= start,
                    JournalEntry.date <= end,
                    JournalEntry.entry_type.in_(("income", "expense", "transfer")),
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        (e.date, Decimal(e.amount or 0), (e.description or "").strip().lower(), e.entry_type)
        for e in entries
    }


async def build_preview(session: AsyncSession, user_id: UUID, parsed: ParseResult) -> dict:
    """What loading this file would do, without doing it: totals, breakdowns, the rows
    that would be rejected (with the reason) and the ones that look already loaded."""
    resolved, errors = await resolve_rows(session, user_id, parsed)
    existing = await _existing_keys(session, user_id, resolved)

    by_type = {
        "income": [0, Decimal(0)],
        "expense": [0, Decimal(0)],
        "card_payment": [0, Decimal(0)],
    }
    by_account: dict[str, dict] = {}
    by_category: dict[tuple[str, str], list] = {}
    by_tag: dict[str, list] = {}
    duplicates: list[dict] = []
    for item in resolved:
        row = item.row
        by_type[row.entry_type][0] += 1
        by_type[row.entry_type][1] += row.amount
        # A card payment is a transfer between the user's accounts: it isn't income,
        # expense or part of a category, so it only shows in its own total.
        entry_key = "transfer" if row.entry_type == "card_payment" else row.entry_type
        key = (row.date, row.amount, row.description.strip().lower(), entry_key)
        if key in existing:
            duplicates.append(
                {
                    "row": row.row_number,
                    "date": row.date,
                    "amount": row.amount,
                    "description": row.description,
                }
            )
        if row.entry_type == "card_payment":
            continue
        acct = by_account.setdefault(
            item.account_name,
            {"name": item.account_name, "count": 0, "income": Decimal(0), "expense": Decimal(0)},
        )
        acct["count"] += 1
        acct[row.entry_type] += row.amount
        cat = by_category.setdefault((row.entry_type, item.category_name), [0, Decimal(0)])
        cat[0] += 1
        cat[1] += row.amount
        for name in item.tag_names:
            tag = by_tag.setdefault(name, [0, Decimal(0)])
            tag[0] += 1
            tag[1] += row.amount

    dates = [item.row.date for item in resolved]
    return {
        "valid_rows": len(resolved),
        "error_rows": len(errors),
        "income": {"count": by_type["income"][0], "total": by_type["income"][1]},
        "expense": {"count": by_type["expense"][0], "total": by_type["expense"][1]},
        "card_payment": {"count": by_type["card_payment"][0], "total": by_type["card_payment"][1]},
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
        "by_account": sorted(by_account.values(), key=lambda a: -a["count"]),
        "by_category": [
            {"name": name, "type": type_, "count": v[0], "total": v[1]}
            for (type_, name), v in sorted(by_category.items(), key=lambda kv: -kv[1][1])
        ],
        "by_tag": [
            {"name": name, "count": v[0], "total": v[1]}
            for name, v in sorted(by_tag.items(), key=lambda kv: -kv[1][1])
        ],
        "possible_duplicates": {"count": len(duplicates), "examples": duplicates[:5]},
        "errors": errors,
    }
