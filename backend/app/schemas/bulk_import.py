from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class BulkImportError(BaseModel):
    row: int
    block: str | None = None
    reason: str


class BulkImportResult(BaseModel):
    created: int
    errors: list[BulkImportError]


class PreviewTotal(BaseModel):
    count: int
    total: Decimal


class PreviewAccount(BaseModel):
    name: str
    count: int
    income: Decimal
    expense: Decimal


class PreviewCategory(BaseModel):
    name: str
    type: str
    count: int
    total: Decimal


class PreviewTag(BaseModel):
    name: str
    count: int
    total: Decimal


class PreviewDuplicate(BaseModel):
    row: int
    date: date
    amount: Decimal
    description: str


class PreviewDuplicates(BaseModel):
    count: int
    examples: list[PreviewDuplicate]


class BulkImportPreview(BaseModel):
    """What loading the file would do (nothing has been saved)."""

    valid_rows: int
    error_rows: int
    income: PreviewTotal
    expense: PreviewTotal
    # Payments to credit cards (transfers): neither income nor expense.
    card_payment: PreviewTotal = PreviewTotal(count=0, total=Decimal(0))
    date_from: date | None
    date_to: date | None
    by_account: list[PreviewAccount]
    by_category: list[PreviewCategory]
    by_tag: list[PreviewTag]
    possible_duplicates: PreviewDuplicates
    errors: list[BulkImportError]
