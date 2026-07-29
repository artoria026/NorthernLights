from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ReportGenerateRequest(BaseModel):
    period_start: date | None = None
    period_end: date | None = None
    year: int | None = None
    """Si se especifica, genera el reporte anual de ese año (ignora period_start/period_end)."""


class ReportInsightOut(BaseModel):
    id: UUID
    report_id: UUID
    flow_type: str
    title: str
    description: str
    category_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportOut(BaseModel):
    id: UUID
    type: str
    period_start: date
    period_end: date
    status: str
    summary: dict[str, Any] | None
    generated_by: str
    generated_at: datetime | None
    error_message: str | None
    created_at: datetime
    insights: list[ReportInsightOut] = []

    model_config = {"from_attributes": True}
