# ruff: noqa: E501 -- the table below reads best one category per line
"""The system categories, in one place.

`name` is the Spanish name and the canonical stored value; `name_en` is its
English counterpart. `slug` is the stable identifier -- names can change (they
did, to fix an accent and add "Otro Ingreso"), the slug can't. The seed lives
in the Alembic migration (migrations never import app code), and
tests/test_categories.py checks that the database matches this list, so the
two can't drift apart silently.
"""

from typing import NamedTuple


class SystemCategory(NamedTuple):
    slug: str
    type: str
    name: str
    name_en: str
    icon: str
    color: str
    sort_order: int


SYSTEM_CATEGORIES: tuple[SystemCategory, ...] = (
    SystemCategory("food_drinks", "expense", "Comida y Bebidas", "Food & Drinks", "utensils", "#f5a623", 10),
    SystemCategory("transport_mobility", "expense", "Transporte y Movilidad", "Transport & Mobility", "car", "#e85d9c", 20),
    SystemCategory("housing_home", "expense", "Vivienda y Hogar", "Housing & Home", "home", "#4e8ef0", 30),
    SystemCategory("health_wellness", "expense", "Salud y Bienestar", "Health & Wellness", "heart", "#8b7cf6", 40),
    SystemCategory("clothing_personal_care", "expense", "Ropa y Cuidado Personal", "Clothing & Personal Care", "shirt", "#00c9a7", 50),
    SystemCategory("leisure_entertainment", "expense", "Ocio y Entretenimiento", "Leisure & Entertainment", "gamepad-2", "#f04e4e", 60),
    SystemCategory("education_development", "expense", "Educación y Desarrollo", "Education & Development", "graduation-cap", "#f5a623", 70),
    SystemCategory("pets", "expense", "Mascotas", "Pets", "paw-print", "#e85d9c", 80),
    SystemCategory("other_expense", "expense", "Otro Gasto", "Other Expense", "more-horizontal", "#6f6f76", 999),
    SystemCategory("main_job", "income", "Empleo principal", "Main Job", "briefcase", "#00c9a7", 10),
    SystemCategory("freelance", "income", "Freelance", "Freelance", "laptop", "#4e8ef0", 20),
    SystemCategory("other_income", "income", "Otro Ingreso", "Other Income", "plus-circle", "#6f6f76", 999),
)


def system_category_names(type_: str) -> str:
    """'Spanish / English' pairs of one type, for prompts that tell the AI which
    names exist."""
    return ", ".join(f"{c.name} / {c.name_en}" for c in SYSTEM_CATEGORIES if c.type == type_)
