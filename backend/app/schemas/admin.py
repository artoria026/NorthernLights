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


class AdminUserActiveUpdate(BaseModel):
    is_active: bool


class AdminUserRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|user)$")


class AdminStats(BaseModel):
    total_users: int
    active_users: int
    admin_users: int
    new_users_last_7_days: int
    total_accounts: int
    total_transactions: int
    total_debts: int
