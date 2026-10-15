"""add ai_proposals: what the AI advisor proposes, kept until the user confirms

El asesor de IA ya no escribe nada por su cuenta: guarda aqui la propuesta
completa (los elementos exactos que se ejecutarian) y solo el servidor los
ejecuta cuando el usuario confirma. Asi lo que se le mostro es lo que se
registra, y el contexto de la propuesta no depende de que el modelo lo recuerde.

Igual que el resto de tablas con datos de usuario: RLS forzado y policy por
user_id con la guardia NULLIF.

Revision ID: 3238897fd341
Revises: 293528f67338
Create Date: 2026-10-15 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3238897fd341"
down_revision: str | Sequence[str] | None = "293528f67338"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GUARD = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai_proposals (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            status text DEFAULT 'pending'::text NOT NULL,
            summary text NOT NULL,
            items jsonb NOT NULL,
            results jsonb,
            error text,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            resolved_at timestamp with time zone,
            CONSTRAINT ai_proposals_pkey PRIMARY KEY (id),
            CONSTRAINT ck_ai_proposals_status CHECK (
                status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'failed'::text, 'expired'::text, 'superseded'::text])
            ),
            CONSTRAINT ai_proposals_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE INDEX idx_ai_proposals_user_created ON ai_proposals USING btree (user_id, created_at)")
    op.execute(
        "CREATE TRIGGER trg_updated_at_ai_proposals BEFORE UPDATE ON ai_proposals "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )
    op.execute("ALTER TABLE ai_proposals ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ONLY ai_proposals FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY rls_ai_proposals ON ai_proposals USING (user_id = {_GUARD})")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai_proposals CASCADE")
