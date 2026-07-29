from pydantic import BaseModel


class BulkImportError(BaseModel):
    row: int
    block: str | None = None
    reason: str


class BulkImportResult(BaseModel):
    created: int
    errors: list[BulkImportError]
