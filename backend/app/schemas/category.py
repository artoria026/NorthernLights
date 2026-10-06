from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(pattern="^(income|expense)$")
    icon: str | None = None
    color: str = "#6366F1"
    parent_id: UUID | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    color: str | None = None


class CategoryOut(BaseModel):
    id: UUID
    user_id: UUID | None
    name: str
    type: str
    icon: str | None
    color: str
    is_system: bool
    is_active: bool
    sort_order: int
    parent_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CategorySummaryItem(BaseModel):
    category_id: UUID
    total: Decimal


CATEGORY_EXPORT_FORMAT = "northernlights.categories"
CATEGORY_EXPORT_VERSION = 1
CATEGORY_IMPORT_MAX = 1000


class CategoryExportItem(BaseModel):
    """One category as written to the JSON export. No ids: system categories
    are identified by (type, name) and a subcategory points at its parent by
    name -- ids don't survive a database reset. `hidden` only means something
    for system categories (the per-user deactivation); `parent_is_system`
    says whether `parent_name` is a system or one of the user's own."""

    name: str
    type: str
    icon: str | None
    color: str
    sort_order: int
    is_system: bool
    is_active: bool
    hidden: bool
    parent_name: str | None
    parent_is_system: bool | None
    created_at: datetime


class CategoryExport(BaseModel):
    format: str
    version: int
    exported_at: datetime
    categories: list[CategoryExportItem]


class CategoryImportItem(BaseModel):
    """Same validation as creating a category by hand; the export-only
    fields (created_at) are ignored."""

    name: str = Field(min_length=1)
    type: str = Field(pattern="^(income|expense)$")
    icon: str | None = None
    color: str = "#6366F1"
    sort_order: int = 0
    is_system: bool = False
    is_active: bool = True
    hidden: bool = False
    parent_name: str | None = None
    parent_is_system: bool | None = None


class CategoryImportRequest(BaseModel):
    format: str
    version: int
    categories: list[CategoryImportItem] = Field(max_length=CATEGORY_IMPORT_MAX)

    @field_validator("format")
    @classmethod
    def known_format(cls, value: str) -> str:
        if value != CATEGORY_EXPORT_FORMAT:
            raise ValueError("El archivo no es una exportacion de categorias de NorthernLights")
        return value

    @field_validator("version")
    @classmethod
    def supported_version(cls, value: int) -> int:
        if not 1 <= value <= CATEGORY_EXPORT_VERSION:
            raise ValueError(f"Version de archivo no soportada: {value}")
        return value


class CategoryImportResult(BaseModel):
    created: int
    hidden: int
    skipped: list[str]
    unmatched: list[str]
