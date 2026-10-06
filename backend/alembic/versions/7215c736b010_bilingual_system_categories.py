"""bilingual system categories: stable slug + english name

Las categorias de sistema solo existian en espaniol y se identificaban por
nombre (import de Excel, herramientas de la IA, import de categorias), asi que
un nombre ingles o un cambio de acento las rompia. Se agregan dos columnas
solo para filas de sistema (user_id IS NULL):

- `slug`: identificador estable, unico entre las de sistema.
- `name_en`: el nombre en ingles. `name` sigue siendo el espaniol y el valor
  canonico; el idioma se resuelve al leer (ver Category.display_name).

De paso se corrige "Educacion y Desarrollo" -> "Educación y Desarrollo" y el
"Otro" de ingresos pasa a "Otro Ingreso" (era ambiguo con "Otro Gasto").

Revision ID: 7215c736b010
Revises: 09b80e7086b5
Create Date: 2026-10-06 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7215c736b010"
down_revision: str | Sequence[str] | None = "09b80e7086b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (slug, type, nombre anterior en la base, nombre nuevo, name_en)
_SEED = [
    ("food_drinks", "expense", "Comida y Bebidas", "Comida y Bebidas", "Food & Drinks"),
    ("transport_mobility", "expense", "Transporte y Movilidad", "Transporte y Movilidad", "Transport & Mobility"),
    ("housing_home", "expense", "Vivienda y Hogar", "Vivienda y Hogar", "Housing & Home"),
    ("health_wellness", "expense", "Salud y Bienestar", "Salud y Bienestar", "Health & Wellness"),
    ("clothing_personal_care", "expense", "Ropa y Cuidado Personal", "Ropa y Cuidado Personal", "Clothing & Personal Care"),
    ("leisure_entertainment", "expense", "Ocio y Entretenimiento", "Ocio y Entretenimiento", "Leisure & Entertainment"),
    ("education_development", "expense", "Educacion y Desarrollo", "Educación y Desarrollo", "Education & Development"),
    ("pets", "expense", "Mascotas", "Mascotas", "Pets"),
    ("other_expense", "expense", "Otro Gasto", "Otro Gasto", "Other Expense"),
    ("main_job", "income", "Empleo principal", "Empleo principal", "Main Job"),
    ("freelance", "income", "Freelance", "Freelance", "Freelance"),
    ("other_income", "income", "Otro", "Otro Ingreso", "Other Income"),
]


def upgrade() -> None:
    op.add_column("categories", sa.Column("slug", sa.Text(), nullable=True))
    op.add_column("categories", sa.Column("name_en", sa.Text(), nullable=True))
    op.execute(
        "ALTER TABLE categories ADD CONSTRAINT ck_categories_i18n_system_only "
        "CHECK (user_id IS NULL OR (slug IS NULL AND name_en IS NULL))"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_categories_system_slug ON categories (slug) WHERE slug IS NOT NULL"
    )

    for slug, type_, old_name, new_name, name_en in _SEED:
        op.execute(
            sa.text(
                "UPDATE categories SET slug = :slug, name = :new_name, name_en = :name_en "
                "WHERE user_id IS NULL AND type = :type AND name = :old_name"
            ).bindparams(
                slug=slug, new_name=new_name, name_en=name_en, type=type_, old_name=old_name
            )
        )


def downgrade() -> None:
    for _slug, type_, old_name, new_name, _name_en in _SEED:
        op.execute(
            sa.text(
                "UPDATE categories SET name = :old_name "
                "WHERE user_id IS NULL AND type = :type AND name = :new_name"
            ).bindparams(old_name=old_name, type=type_, new_name=new_name)
        )
    op.execute("DROP INDEX uq_categories_system_slug")
    op.execute("ALTER TABLE categories DROP CONSTRAINT ck_categories_i18n_system_only")
    op.drop_column("categories", "name_en")
    op.drop_column("categories", "slug")
