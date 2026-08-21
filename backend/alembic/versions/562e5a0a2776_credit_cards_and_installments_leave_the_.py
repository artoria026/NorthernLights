"""credit cards and installments leave the debts model

Las tarjetas de credito ya viven completas como `Account`
(saldo/limite/tasa/corte) sin depender de nada mas -- el tipo `credit_card`
en `debts` era un overlay 100% opcional que en produccion ya estaba
desincronizado del saldo real de la cuenta (deuda "Plata card inicial":
current_balance=15764.67 vs Account.balance=21736.08). Se borra esa unica
fila real y se retira `credit_card` de los tipos permitidos; pagar una TDC
ahora siempre es una transferencia real entre cuentas (ver
transaction_service/PayCreditCardForm), nunca una fila de `debts`.

`installment` (MSI) nunca estuvo realmente conectado a nada: ni
`create_debt` ni `register_debt_payment` pasaban `debt_id` al crear el
`journal_entry` del cargo/pago, y ningun JSX del frontend leia
`total_installments`/`paid_installments`. 0 filas reales en produccion, asi
que no hay nada que migrar -- se retira el tipo y se reemplaza por
`installment_plans`, metadata 1:1 de la transaccion real de la compra
(`journal_entry_id` unico), sin su propia contabilidad paralela.
`monthly_amount` y en que cuota va se calculan al vuelo desde esa
transaccion (ver transaction_service), nunca se guardan.

Revision ID: 562e5a0a2776
Revises: fab8d0a6fafd
Create Date: 2026-08-21 07:56:36.338473

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "562e5a0a2776"
down_revision: str | Sequence[str] | None = "fab8d0a6fafd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GUARD = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

_OLD_DEBT_TYPES = (
    "credit_card",
    "personal_loan",
    "payroll_loan",
    "installment",
    "informal",
    "civic",
    "loan_received",
)
_NEW_DEBT_TYPES = (
    "personal_loan",
    "payroll_loan",
    "informal",
    "civic",
    "loan_received",
)


def _check_sql(types: tuple[str, ...]) -> str:
    array = ", ".join(f"'{t}'::text" for t in types)
    return f"type = ANY (ARRAY[{array}])"


def upgrade() -> None:
    # `debts` tiene FORCE ROW LEVEL SECURITY -- se aplica incluso al owner de
    # la tabla (finanzas_user, el rol con el que corre esta migracion), asi
    # que sin desactivarla aqui este DELETE afecta 0 filas en silencio (la
    # policy exige app.current_user_id, que una migracion nunca setea) y el
    # ALTER TABLE ... ADD CONSTRAINT de mas abajo revienta contra la fila que
    # en realidad seguia ahi. Alcance minimo: se reactiva (ENABLE + FORCE)
    # antes de seguir con el resto de la migracion.
    op.execute("ALTER TABLE debts DISABLE ROW LEVEL SECURITY")

    # La unica fila real de tipo credit_card (ver docstring) -- sin plan de
    # pago activo (payment_amount=0), desincronizada de la cuenta real desde
    # siempre. `installment` no necesita DELETE: 0 filas en produccion.
    op.execute("DELETE FROM debts WHERE type = 'credit_card'")

    op.execute("ALTER TABLE debts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ONLY debts FORCE ROW LEVEL SECURITY")

    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_type_check")
    op.execute(f"ALTER TABLE debts ADD CONSTRAINT debts_type_check CHECK ({_check_sql(_NEW_DEBT_TYPES)})")

    op.execute(
        """
        CREATE TABLE installment_plans (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            journal_entry_id uuid NOT NULL,
            total_installments integer NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT installment_plans_pkey PRIMARY KEY (id),
            CONSTRAINT installment_plans_journal_entry_id_key UNIQUE (journal_entry_id),
            CONSTRAINT installment_plans_journal_entry_id_fkey FOREIGN KEY (journal_entry_id)
                REFERENCES journal_entries(id) ON DELETE CASCADE,
            CONSTRAINT installment_plans_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )

    op.execute("ALTER TABLE ONLY installment_plans FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY")

    op.execute("CREATE INDEX idx_installment_plans_user ON installment_plans USING btree (user_id)")

    op.execute(
        "CREATE TRIGGER trg_updated_at_installment_plans BEFORE UPDATE ON installment_plans "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )

    op.execute(f"CREATE POLICY rls_installment_plans ON installment_plans USING (user_id = {_GUARD})")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS installment_plans CASCADE")

    op.execute("ALTER TABLE debts DROP CONSTRAINT debts_type_check")
    op.execute(f"ALTER TABLE debts ADD CONSTRAINT debts_type_check CHECK ({_check_sql(_OLD_DEBT_TYPES)})")
