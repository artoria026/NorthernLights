"""add debt_movements: the history of why a debt grew or shrank

Until now a debt only kept its current balance and, for repayments, a DebtPayment row; a
second loan to the same person had nowhere to go and nothing recorded why the balance
changed. Each row here is one step of the debt: the opening balance, a loan (the debt
grows), a payment (it shrinks) or a manual correction, with the concept, the real account
the money moved through, the journal entry behind it and the moment it was registered.

The existing debts are backfilled so their history is not empty: one opening row with the
registered total, one payment row per DebtPayment, and a correction row when the current
balance does not match opening minus payments.

Igual que el resto de tablas con datos de usuario: RLS forzado y policy por user_id con la
guardia NULLIF.

Revision ID: b81f3c5d7e92
Revises: 7c1d9e4b2a60
Create Date: 2026-10-20 23:30:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b81f3c5d7e92"
down_revision: str | Sequence[str] | None = "7c1d9e4b2a60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GUARD = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE debt_movements (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            debt_id uuid NOT NULL,
            kind text NOT NULL,
            delta numeric(15,2) NOT NULL,
            date date NOT NULL,
            concept text,
            account_id uuid,
            journal_entry_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT debt_movements_pkey PRIMARY KEY (id),
            CONSTRAINT ck_debt_movements_kind CHECK (
                kind = ANY (ARRAY['opening'::text, 'loan'::text, 'payment'::text, 'adjustment'::text])
            ),
            CONSTRAINT ck_debt_movements_delta CHECK (delta <> 0),
            CONSTRAINT debt_movements_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT debt_movements_debt_id_fkey FOREIGN KEY (debt_id)
                REFERENCES debts(id) ON DELETE CASCADE,
            CONSTRAINT debt_movements_account_id_fkey FOREIGN KEY (account_id)
                REFERENCES accounts(id) ON DELETE SET NULL,
            CONSTRAINT debt_movements_journal_entry_id_fkey FOREIGN KEY (journal_entry_id)
                REFERENCES journal_entries(id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_debt_movements_debt ON debt_movements "
        "USING btree (debt_id, date, created_at)"
    )
    op.execute("CREATE INDEX idx_debt_movements_user ON debt_movements USING btree (user_id)")

    # Backfill. debts and debt_payments have FORCE RLS and no user is set during a
    # migration, so the owner would see no rows: lift FORCE only for the conversion.
    for table in ("debts", "debt_payments", "debt_movements"):
        op.execute(f"ALTER TABLE ONLY {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        INSERT INTO debt_movements (user_id, debt_id, kind, delta, date, concept, created_at)
        SELECT d.user_id, d.id, 'opening', d.total_amount,
               COALESCE(d.start_date, d.created_at::date), 'Saldo inicial', d.created_at
        FROM debts d
        WHERE d.total_amount <> 0
        """
    )
    op.execute(
        """
        INSERT INTO debt_movements
            (user_id, debt_id, kind, delta, date, concept, journal_entry_id, created_at)
        SELECT p.user_id, p.debt_id, 'payment', -p.amount, p.date, p.notes,
               p.journal_entry_id, p.created_at
        FROM debt_payments p
        """
    )
    op.execute(
        """
        INSERT INTO debt_movements (user_id, debt_id, kind, delta, date, concept, created_at)
        SELECT d.user_id, d.id, 'adjustment',
               d.current_balance - (
                   d.total_amount - COALESCE((SELECT sum(p.amount) FROM debt_payments p
                                              WHERE p.debt_id = d.id), 0)
               ),
               d.updated_at::date, 'Corrección de saldo', d.updated_at
        FROM debts d
        WHERE d.current_balance <> d.total_amount - COALESCE(
            (SELECT sum(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0
        )
        """
    )
    for table in ("debts", "debt_payments"):
        op.execute(f"ALTER TABLE ONLY {table} FORCE ROW LEVEL SECURITY")

    op.execute("ALTER TABLE debt_movements ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ONLY debt_movements FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY rls_debt_movements ON debt_movements USING (user_id = {_GUARD})")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS debt_movements")
