from datetime import date as date_type
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class BudgetLimitIn(BaseModel):
    category_id: UUID
    monthly_limit: Decimal = Field(ge=0)


class BudgetLimitsUpdate(BaseModel):
    limits: list[BudgetLimitIn] = Field(min_length=1)


class BudgetLimitOut(BaseModel):
    category_id: UUID
    category_name: str
    monthly_limit: Decimal


class BudgetLimitSuggestion(BaseModel):
    category_id: UUID
    category_name: str
    color: str
    current_limit: Decimal | None
    average_last_3_months: Decimal


class BudgetCategoryBreakdown(BaseModel):
    category_id: UUID
    category_name: str
    monthly_limit: Decimal
    spent: Decimal
    remaining: Decimal
    percentage: float
    alert: bool
    average_last_3_months: Decimal


class BudgetPeriodInfo(BaseModel):
    year: int
    month: int


class BudgetCurrent(BaseModel):
    period: BudgetPeriodInfo
    committed_fixed: Decimal
    variable_categories: list[BudgetCategoryBreakdown]
    variable_total_budgeted: Decimal
    variable_total_spent: Decimal
    income_estimated: Decimal
    available: Decimal


class BudgetSummary(BaseModel):
    committed_fixed: Decimal
    variable_total_budgeted: Decimal
    variable_total_spent: Decimal
    income_estimated: Decimal
    available: Decimal


class WeekBreakdown(BaseModel):
    week: int
    date_from: date_type
    date_to: date_type
    spent_by_category: dict[str, Decimal]
    weekly_limit_reference: dict[str, Decimal]


class WeeklyBudget(BaseModel):
    weeks: list[WeekBreakdown]


class BudgetTrendMonth(BaseModel):
    year: int
    month: int
    budgeted: Decimal
    spent: Decimal
    percentage: float
