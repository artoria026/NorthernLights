"""devices refresh token lookup policy

Bug #4 de la familia RLS (ver 293528f67338 y su historial de comentarios):
POST /auth/refresh necesita encontrar su propio `Device` por
refresh_token (hasheado) ANTES de saber quien es el usuario -- es
literalmente el endpoint que se usa cuando el access token ya vencio, no
hay ningun current_user resuelto con el que setear app.current_user_id.
La policy original de `devices` (`user_id = current_setting(...)`) no deja
ver la fila en ese momento bajo RLS real, asi que auth_service.refresh()
devolvia 401 "Sesion invalida" con CUALQUIER token, incluso uno valido.

Fix: agregar una segunda condicion a la policy que permite ver la fila si
su refresh_token coincide con uno que el caller esta buscando
explicitamente (via `app.lookup_refresh_token`, seteado por refresh() antes
de la query). Es seguro: el hash es de un secreto de 64 bytes generado con
`secrets.token_urlsafe`, asi que la unica forma de "acertarle" es poseer el
token original -- la autorizacion sigue siendo "quien tiene el token, puede
usarlo", solo que ahora expresada como policy en vez de necesitar
bypassear RLS. logout()/logout_all()/register_device()/list_devices()/
revoke_device() no cambian: ya conocen el user_id de antemano (via un
access token valido) y siguen entrando por la primera condicion.

Revision ID: a3d7af2c6426
Revises: 293528f67338
Create Date: 2026-08-10 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3d7af2c6426"
down_revision: str | Sequence[str] | None = "293528f67338"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS rls_devices ON devices")
    op.execute(
        "CREATE POLICY rls_devices ON devices "
        "USING (user_id = current_setting('app.current_user_id', true)::uuid)"
    )
