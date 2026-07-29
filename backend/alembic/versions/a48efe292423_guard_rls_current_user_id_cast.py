"""guard RLS current_setting cast to uuid with NULLIF

Bug #5 de la familia RLS (ver 293528f67338 y a3d7af2c6426): la policy nueva
de `devices` (`user_id = current_setting(...)::uuid OR refresh_token = ...`)
seguia reventando en POST /auth/refresh con el mismo
`invalid input syntax for type uuid: ""` de siempre, a pesar del OR.

Causa raiz real, mas profunda que "faltaba una condicion" -- Postgres NO
garantiza cortocircuito al evaluar un OR dentro de una policy de RLS: si el
primer lado (`current_setting('app.current_user_id', true)::uuid`) falla al
castear, la excepcion se dispara igual, sin importar que el segundo lado
sea el que deberia decidir el resultado.

Y `current_setting('app.current_user_id', true)` NO devuelve NULL cuando la
variable nunca se seteo EN ESTA SESION -- el segundo argumento (`true`,
"missing_ok") solo evita el error "unrecognized configuration parameter"
la primerisima vez que el nombre `app.current_user_id` se usa en el
servidor. Una vez que Postgres ya "conoce" ese nombre (porque CUALQUIER
sesion, de cualquier proyecto, ya hizo `SET LOCAL app.current_user_id` desde
que el servidor arranco), sesiones nuevas donde nunca se seteo devuelven
STRING VACIO `''`, no NULL. `''::uuid` siempre falla el cast.

Esto no es exclusivo de `devices`: LAS 20 POLICIES de este archivo (todas
las que tocan `current_setting('app.current_user_id', ...)`) tienen el
mismo patron sin guardia. No se han manifestado en las demas tablas solo
porque el codigo de la app hoy siempre pasa por `get_rls_db` (que si setea
la variable) antes de tocarlas -- pero es el mismo terreno fragil que ya
causo los bugs #1-#5, y cualquier caller futuro que se salte `get_rls_db`
vuelve a pisarlo. Se corrige de una vez en las 20, no solo en `devices`.

Fix: envolver el `current_setting(...)` con
`NULLIF(current_setting('app.current_user_id', true), '')` ANTES del cast.
NULLIF convierte el string vacio a NULL, `NULL::uuid` es un cast valido (da
NULL, no error), y `user_id = NULL` evalua a NULL/falso de forma segura --
el resto del OR (o el resultado final de la policy) se evalua con
normalidad en vez de abortar la query completa.

Revision ID: a48efe292423
Revises: a3d7af2c6426
Create Date: 2026-08-10 22:20:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a48efe292423"
down_revision: str | Sequence[str] | None = "a3d7af2c6426"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Guardia reutilizada en todas las policies: NULLIF(...) antes del cast.
_GUARD = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

# Tablas con el patron simple `user_id = current_setting(...)::uuid` --
# mismo fix mecanico en las 16, sin logica adicional.
_SIMPLE_TABLES = [
    "accounts",
    "budget_limits",
    "budget_periods",
    "chat_messages",
    "debt_payments",
    "debts",
    "insight_reviews",
    "insights",
    "journal_entries",
    "notifications",
    "recurring_items",
    "report_insights",
    "reports",
    "unplanned_debts",
    "user_preferences",
    "category_hides",
]


def upgrade() -> None:
    for table in _SIMPLE_TABLES:
        op.execute(f"DROP POLICY IF EXISTS rls_{table} ON {table}")
        op.execute(f"CREATE POLICY rls_{table} ON {table} USING (user_id = {_GUARD})")

    # categories: mismo patron + la excepcion de categorias de sistema
    # (user_id IS NULL), que no toca current_setting -- no necesita guardia.
    op.execute("DROP POLICY IF EXISTS rls_categories ON categories")
    op.execute(
        f"""
        CREATE POLICY rls_categories ON categories
            USING ((user_id IS NULL) OR (user_id = {_GUARD}))
        """
    )

    # journal_lines: el cast vive dentro del EXISTS contra journal_entries.
    op.execute("DROP POLICY IF EXISTS rls_journal_lines ON journal_lines")
    op.execute(
        f"""
        CREATE POLICY rls_journal_lines ON journal_lines
            USING (EXISTS (
                SELECT 1 FROM journal_entries je
                WHERE je.id = journal_lines.entry_id
                    AND je.user_id = {_GUARD}
            ))
        """
    )

    # feedback: dos casts -- el propio user_id y el EXISTS de bypass admin.
    op.execute("DROP POLICY IF EXISTS rls_feedback ON feedback")
    op.execute(
        f"""
        CREATE POLICY rls_feedback ON feedback
            USING (
                user_id = {_GUARD}
                OR EXISTS (
                    SELECT 1 FROM users
                    WHERE users.id = {_GUARD}
                        AND users.role = 'admin'
                )
            )
        """
    )

    # devices: el bug #5 original. Mismo guard en el primer lado del OR de
    # a3d7af2c6426; el segundo lado (refresh_token, varchar) no castea a
    # uuid y no necesita guardia.
    op.execute("DROP POLICY IF EXISTS rls_devices ON devices")
    op.execute(
        f"""
        CREATE POLICY rls_devices ON devices
            USING (
                user_id = {_GUARD}
                OR refresh_token = current_setting('app.lookup_refresh_token', true)
            )
        """
    )


def downgrade() -> None:
    _UNGUARDED = "current_setting('app.current_user_id', true)::uuid"

    for table in _SIMPLE_TABLES:
        op.execute(f"DROP POLICY IF EXISTS rls_{table} ON {table}")
        op.execute(f"CREATE POLICY rls_{table} ON {table} USING (user_id = {_UNGUARDED})")

    op.execute("DROP POLICY IF EXISTS rls_categories ON categories")
    op.execute(
        f"""
        CREATE POLICY rls_categories ON categories
            USING ((user_id IS NULL) OR (user_id = {_UNGUARDED}))
        """
    )

    op.execute("DROP POLICY IF EXISTS rls_journal_lines ON journal_lines")
    op.execute(
        f"""
        CREATE POLICY rls_journal_lines ON journal_lines
            USING (EXISTS (
                SELECT 1 FROM journal_entries je
                WHERE je.id = journal_lines.entry_id
                    AND je.user_id = {_UNGUARDED}
            ))
        """
    )

    op.execute("DROP POLICY IF EXISTS rls_feedback ON feedback")
    op.execute(
        f"""
        CREATE POLICY rls_feedback ON feedback
            USING (
                user_id = {_UNGUARDED}
                OR EXISTS (
                    SELECT 1 FROM users
                    WHERE users.id = {_UNGUARDED}
                        AND users.role = 'admin'
                )
            )
        """
    )

    # Revierte exactamente a la version de a3d7af2c6426 (down_revision de
    # esta migracion), no a la original de 293528f67338 -- esta migracion
    # no toco esa condicion de refresh_token, solo agrego la guardia.
    op.execute("DROP POLICY IF EXISTS rls_devices ON devices")
    op.execute(
        """
        CREATE POLICY rls_devices ON devices
            USING (
                user_id = current_setting('app.current_user_id', true)::uuid
                OR refresh_token = current_setting('app.lookup_refresh_token', true)
            )
        """
    )
