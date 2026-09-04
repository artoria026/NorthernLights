from pydantic import BaseModel, Field, field_validator

# 'accounts' also forces 'transactions' and 'recurring' in the service (an
# account can't be deleted while something still references it) -- see
# data_service.erase_user_data.
DATA_CATEGORIES = (
    "transactions",
    "debts",
    "recurring",
    "budgets",
    "insights",
    "reports",
    "notifications",
    "chat",
    "categories",
    "accounts",
)


class DataEraseRequest(BaseModel):
    categories: list[str] = Field(min_length=1)
    password: str | None = None

    @field_validator("categories")
    @classmethod
    def validate_categories(cls, value: list[str]) -> list[str]:
        invalid = sorted(set(value) - set(DATA_CATEGORIES))
        if invalid:
            raise ValueError(f"Categorias invalidas: {', '.join(invalid)}")
        return value


class DataEraseResponse(BaseModel):
    erased: list[str]
