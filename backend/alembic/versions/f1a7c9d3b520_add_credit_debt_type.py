"""add the «credit» debt type (credit lines, cards in collections, store credit)

A credit (Mercado Crédito, a card gone to collections, Coppel, Didi) is not a loan: what is owed
comes from using a line, not from money handed over once. It gets its own debt type next to
personal_loan, payroll_loan, informal, civic and loan_received.

Revision ID: f1a7c9d3b520
Revises: e8c3a5f21b94
Create Date: 2026-10-22 21:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a7c9d3b520"
down_revision: str | Sequence[str] | None = "e8c3a5f21b94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = "'personal_loan'::text, 'payroll_loan'::text, 'informal'::text, 'civic'::text, 'loan_received'::text"


def upgrade() -> None:
    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_type_check")
    op.execute(
        f"ALTER TABLE debts ADD CONSTRAINT debts_type_check "
        f"CHECK (type = ANY (ARRAY[{_OLD}, 'credit'::text]))"
    )


def downgrade() -> None:
    # debts has FORCE RLS and no user is set during a migration: lift FORCE only to turn the
    # credits back into personal loans, the closest type the old constraint accepts.
    op.execute("ALTER TABLE ONLY debts NO FORCE ROW LEVEL SECURITY")
    op.execute("UPDATE debts SET type = 'personal_loan' WHERE type = 'credit'")
    op.execute("ALTER TABLE ONLY debts FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_type_check")
    op.execute(
        f"ALTER TABLE debts ADD CONSTRAINT debts_type_check CHECK (type = ANY (ARRAY[{_OLD}]))"
    )
