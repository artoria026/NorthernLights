from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AdminUserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    auth_provider: str
    is_active: bool
    created_at: datetime
    accounts_count: int
    transactions_count: int
    last_active_at: datetime | None = None
    health_score: float


class AdminUserActiveUpdate(BaseModel):
    is_active: bool


class AdminUserRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|user)$")


class AdminPasswordResetOut(BaseModel):
    temporary_password: str


class SignupDay(BaseModel):
    date: str
    count: int


class AdminStats(BaseModel):
    total_users: int
    active_users: int
    admin_users: int
    new_users_last_7_days: int
    total_accounts: int
    total_transactions: int
    total_debts: int
    google_users: int
    users_with_accounts: int
    users_with_debts: int
    users_with_recurring: int
    inactive_users_30d: int
    ai_queries_today: int
    feedback_new_count: int
    signups_last_14_days: list[SignupDay]
