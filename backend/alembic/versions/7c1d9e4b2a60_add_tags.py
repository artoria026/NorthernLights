"""add tags: labels to group expenses (a trip, an event) on top of categories

Una etiqueta la crea el usuario ("Viaje Mty Concierto X"), un gasto puede llevar
varias, y sirve para ver cuanto costo algo que cruza categorias. Reemplaza la
columna de texto libre journal_entries.tags (nunca tuvo pantalla): sus valores
se convierten en etiquetas reales antes de quitarla.

Igual que el resto de tablas: RLS forzado. journal_entry_tags no tiene user_id,
su policy sale de la etiqueta (como journal_lines sale de su asiento).

Revision ID: 7c1d9e4b2a60
Revises: 3238897fd341
Create Date: 2026-10-16 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c1d9e4b2a60"
down_revision: str | Sequence[str] | None = "3238897fd341"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GUARD = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE tags (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            name text NOT NULL,
            color text DEFAULT '#6366F1'::text NOT NULL,
            created_at timestamp with time zone DEFAULT now(),
            updated_at timestamp with time zone DEFAULT now(),
            CONSTRAINT tags_pkey PRIMARY KEY (id),
            CONSTRAINT tags_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX uq_tags_user_name ON tags USING btree (user_id, lower(name))")
    op.execute(
        "CREATE TRIGGER trg_updated_at_tags BEFORE UPDATE ON tags "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )
    op.execute(
        """
        CREATE TABLE journal_entry_tags (
            entry_id uuid NOT NULL,
            tag_id uuid NOT NULL,
            CONSTRAINT journal_entry_tags_pkey PRIMARY KEY (entry_id, tag_id),
            CONSTRAINT journal_entry_tags_entry_id_fkey FOREIGN KEY (entry_id)
                REFERENCES journal_entries(id) ON DELETE CASCADE,
            CONSTRAINT journal_entry_tags_tag_id_fkey FOREIGN KEY (tag_id)
                REFERENCES tags(id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE INDEX idx_journal_entry_tags_tag ON journal_entry_tags USING btree (tag_id)")

    # The old free-text values become real tags (one per distinct name, ignoring case).
    # journal_entries has FORCE RLS and no user is set during a migration, so the owner
    # would see no rows: lift FORCE only for the length of the conversion.
    op.execute("ALTER TABLE ONLY journal_entries NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        INSERT INTO tags (user_id, name)
        SELECT DISTINCT ON (je.user_id, lower(btrim(t))) je.user_id, btrim(t)
        FROM journal_entries je
        CROSS JOIN LATERAL unnest(je.tags) AS t
        WHERE btrim(t) <> ''
        """
    )
    op.execute(
        """
        INSERT INTO journal_entry_tags (entry_id, tag_id)
        SELECT DISTINCT je.id, tg.id
        FROM journal_entries je
        CROSS JOIN LATERAL unnest(je.tags) AS t
        JOIN tags tg ON tg.user_id = je.user_id AND lower(tg.name) = lower(btrim(t))
        WHERE btrim(t) <> ''
        """
    )
    op.execute("ALTER TABLE ONLY journal_entries FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE journal_entries DROP COLUMN tags")

    op.execute("ALTER TABLE tags ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ONLY tags FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY rls_tags ON tags USING (user_id = {_GUARD})")
    op.execute("ALTER TABLE journal_entry_tags ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ONLY journal_entry_tags FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY rls_journal_entry_tags ON journal_entry_tags USING (EXISTS (
            SELECT 1 FROM tags t
            WHERE t.id = journal_entry_tags.tag_id AND t.user_id = {_GUARD}
        ))
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE journal_entries ADD COLUMN tags text[] DEFAULT '{}'::text[]")
    # Same reason as in upgrade: no user is set during a migration, so lift FORCE
    # on the three tables while copying.
    for table in ("journal_entries", "journal_entry_tags", "tags"):
        op.execute(f"ALTER TABLE ONLY {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        UPDATE journal_entries je SET tags = sub.names
        FROM (
            SELECT jt.entry_id, array_agg(t.name ORDER BY t.name) AS names
            FROM journal_entry_tags jt JOIN tags t ON t.id = jt.tag_id
            GROUP BY jt.entry_id
        ) sub
        WHERE sub.entry_id = je.id
        """
    )
    op.execute("DROP TABLE IF EXISTS journal_entry_tags")
    op.execute("DROP TABLE IF EXISTS tags")
