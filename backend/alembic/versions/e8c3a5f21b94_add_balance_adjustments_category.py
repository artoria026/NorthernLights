"""add the native, immutable «Ajustes de saldo» category and put every adjustment under it

A balance adjustment (reconciling an account against what is really there) is how the app records
money that left or arrived without a known reason. It now lives under its own system category, slug
`balance_adjustment`, of a new type `adjustment` that never shows up in the income / expense pickers.
The category is assigned by the app, never chosen; existing adjustments, which had no category, are
moved under it here.

Revision ID: e8c3a5f21b94
Revises: d6b1f3a8e204
Create Date: 2026-10-22 18:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8c3a5f21b94"
down_revision: str | Sequence[str] | None = "d6b1f3a8e204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE categories DROP CONSTRAINT ck_categories_type")
    op.execute(
        "ALTER TABLE categories ADD CONSTRAINT ck_categories_type "
        "CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'adjustment'::text]))"
    )
    op.execute(
        """
        INSERT INTO categories (user_id, name, name_en, slug, type, icon, color, is_system, sort_order)
        VALUES (NULL, 'Ajustes de saldo', 'Balance Adjustments', 'balance_adjustment', 'adjustment',
                'scale', '#f5a623', TRUE, 990)
        """
    )
    # journal_entries has FORCE RLS and no user is set during a migration: lift FORCE only for
    # the conversion of the adjustments that already exist.
    op.execute("ALTER TABLE ONLY journal_entries NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        UPDATE journal_entries
        SET category_id = (SELECT id FROM categories WHERE slug = 'balance_adjustment')
        WHERE entry_type IN ('adjustment_in', 'adjustment_out') AND category_id IS NULL
        """
    )
    op.execute("ALTER TABLE ONLY journal_entries FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE ONLY journal_entries NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        UPDATE journal_entries SET category_id = NULL
        WHERE category_id = (SELECT id FROM categories WHERE slug = 'balance_adjustment')
        """
    )
    op.execute("ALTER TABLE ONLY journal_entries FORCE ROW LEVEL SECURITY")
    op.execute("DELETE FROM categories WHERE slug = 'balance_adjustment'")
    op.execute("ALTER TABLE categories DROP CONSTRAINT ck_categories_type")
    op.execute(
        "ALTER TABLE categories ADD CONSTRAINT ck_categories_type "
        "CHECK (type = ANY (ARRAY['income'::text, 'expense'::text]))"
    )
