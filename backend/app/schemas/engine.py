from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

SIMULATION_TYPES = ("new_debt", "cancel_subscription", "extra_payment")


class NetWorth(BaseModel):
    total_assets: Decimal
    total_liabilities: Decimal
    net_worth: Decimal


class IncomeEstimate(BaseModel):
    recurring_base: Decimal
    historical_avg_3m: Decimal
    estimated_monthly: Decimal
    data_quality: str


class HealthScoreComponent(BaseModel):
    value: float
    score: float


class HealthScoreComponents(BaseModel):
    dti: HealthScoreComponent
    savings_rate: HealthScoreComponent
    emergency_coverage_months: HealthScoreComponent
    credit_utilization: HealthScoreComponent


class HealthScore(BaseModel):
    score: float
    components: HealthScoreComponents


class AvailableSpending(BaseModel):
    liquid_balance: Decimal
    committed_in_period: Decimal
    available: Decimal
    period: str


class Runway(BaseModel):
    days: int
    months: float
    label: str


class CashFlowEvent(BaseModel):
    name: str
    amount: Decimal
    type: str


class CashFlowDay(BaseModel):
    date: str
    balance: Decimal
    events: list[CashFlowEvent]


class UpcomingPayment(BaseModel):
    date: str
    name: str
    amount: Decimal
    type: str


class FinancialSnapshot(BaseModel):
    as_of: str
    net_worth: NetWorth
    income: IncomeEstimate
    committed_monthly: Decimal
    spent_this_month: Decimal
    health_score: HealthScore
    available_this_week: AvailableSpending
    upcoming_7_days: list[UpcomingPayment]
    runway: Runway


class SimulationRequest(BaseModel):
    type: str = Field(pattern=f"^({'|'.join(SIMULATION_TYPES)})$")
    monthly_amount: Decimal | None = None  # new_debt
    recurring_id: UUID | None = None  # cancel_subscription
    debt_id: UUID | None = None  # extra_payment
    amount: Decimal | None = None  # extra_payment


class SimulationSnapshot(BaseModel):
    monthly_committed: Decimal
    dti: Decimal
    net_worth: Decimal


class SimulationDelta(BaseModel):
    monthly_committed: Decimal
    dti: Decimal
    net_worth: Decimal


class SimulationResponse(BaseModel):
    before: SimulationSnapshot
    after: SimulationSnapshot
    delta: SimulationDelta
