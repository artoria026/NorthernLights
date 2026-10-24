"""add the «paused» debt status (a debt the user has put on hold)

A paused debt is still owed -- its balance keeps counting in what the user owes -- but it asks for
nothing: it leaves the upcoming payments, the monthly commitment and the reminders until it is
resumed. Payments can still be registered on it.

Revision ID: b4d6f8a0c213
Revises: a3c5e7b9d102
Create Date: 2026-10-24 15:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d6f8a0c213"
down_revision: str | Sequence[str] | None = "a3c5e7b9d102"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = "'active'::text, 'completed'::text, 'negotiating'::text"


def upgrade() -> None:
    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_status_check")
    op.execute(
        f"ALTER TABLE debts ADD CONSTRAINT debts_status_check "
        f"CHECK (status = ANY (ARRAY[{_OLD}, 'paused'::text]))"
    )


def downgrade() -> None:
    # debts has FORCE RLS and no user is set during a migration: lift FORCE only to turn the
    # paused debts back into active ones, the closest status the old constraint accepts.
    op.execute("ALTER TABLE ONLY debts NO FORCE ROW LEVEL SECURITY")
    op.execute("UPDATE debts SET status = 'active' WHERE status = 'paused'")
    op.execute("ALTER TABLE ONLY debts FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_status_check")
    op.execute(
        f"ALTER TABLE debts ADD CONSTRAINT debts_status_check CHECK (status = ANY (ARRAY[{_OLD}]))"
    )
