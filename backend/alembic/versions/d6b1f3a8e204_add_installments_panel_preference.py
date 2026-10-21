"""add the installments panel preference: whether the user left it collapsed

The credit card detail in Cuentas has a panel with the active installment purchases that can be
collapsed. Whether the user left it collapsed is a preference of the account, saved with the
others in user_preferences so it follows them to any browser.

Revision ID: d6b1f3a8e204
Revises: c4e7a19b2d58
Create Date: 2026-10-21 03:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d6b1f3a8e204"
down_revision: str | Sequence[str] | None = "c4e7a19b2d58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE user_preferences "
        "ADD COLUMN installments_collapsed boolean DEFAULT false NOT NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE user_preferences DROP COLUMN IF EXISTS installments_collapsed")
