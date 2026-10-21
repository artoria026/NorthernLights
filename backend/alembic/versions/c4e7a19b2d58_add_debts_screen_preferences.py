"""add the Deudas screen preferences: which view and which tab the user left selected

The Deudas screen has two views (cards / list) and two tabs (what I owe / what I am owed). The
choice is a preference of the user, so it lives with the others in user_preferences and follows
the account to any browser instead of staying in one browser's storage.

Revision ID: c4e7a19b2d58
Revises: b81f3c5d7e92
Create Date: 2026-10-21 02:10:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e7a19b2d58"
down_revision: str | Sequence[str] | None = "b81f3c5d7e92"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE user_preferences "
        "ADD COLUMN debts_view character varying DEFAULT 'cards' NOT NULL, "
        "ADD COLUMN debts_direction character varying DEFAULT 'owed_by_me' NOT NULL, "
        "ADD CONSTRAINT ck_user_preferences_debts_view CHECK (debts_view IN ('cards', 'list')), "
        "ADD CONSTRAINT ck_user_preferences_debts_direction "
        "CHECK (debts_direction IN ('owed_by_me', 'owed_to_me'))"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE user_preferences "
        "DROP CONSTRAINT IF EXISTS ck_user_preferences_debts_view, "
        "DROP CONSTRAINT IF EXISTS ck_user_preferences_debts_direction, "
        "DROP COLUMN IF EXISTS debts_view, "
        "DROP COLUMN IF EXISTS debts_direction"
    )
