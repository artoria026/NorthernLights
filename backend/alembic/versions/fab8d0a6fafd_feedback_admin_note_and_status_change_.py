"""feedback admin note and status change notification

Cierra el ciclo de feedback en las dos direcciones: hoy un admin cambia el
status de un feedback (new/read/considered/discarded) y el usuario que lo
mando nunca se entera. Dos cambios de esquema para esto:

1. `feedback.admin_note`: nota opcional que el admin deja al cambiar el
   status (ej. por que se descarto), visible para el usuario dueno del
   feedback -- sin esto "Descartado" no dice nada del porque.
2. `notifications_type_check`: se agrega 'feedback_status_changed' a la
   lista de tipos permitidos, para poder notificar al usuario in-app via
   notification_service.create() (unico punto de escritura de esa tabla,
   ver notification_service.py) cuando su feedback pasa a considered o
   discarded.

El nombre real de la constraint en la base es `notifications_type_check`
(asi quedo en 293528f67338_initial_schema, un dump directo de la base ya
existente) -- NO coincide con el nombre `ck_notifications_type` declarado
en el modelo SQLAlchemy (Notification.__table_args__); es un desfase previo
a esta migracion, no algo que se corrija aqui.

Revision ID: fab8d0a6fafd
Revises: 0b0045a6474b
Create Date: 2026-08-19 02:48:05.257668

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fab8d0a6fafd"
down_revision: str | Sequence[str] | None = "0b0045a6474b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_NOTIFICATION_TYPES = (
    "report_ready",
    "insight_generated",
    "insight_reviewed",
    "debt_alert",
    "budget_alert",
    "tdc_due",
    "pending_payment",
    "pending_payment_reminder",
    "subscription_alert",
    "loan_overdue",
)
_NEW_NOTIFICATION_TYPES = (*_OLD_NOTIFICATION_TYPES, "feedback_status_changed")


def _check_sql(types: tuple[str, ...]) -> str:
    array = ", ".join(f"'{t}'::text" for t in types)
    return f"type = ANY (ARRAY[{array}])"


def upgrade() -> None:
    op.add_column("feedback", sa.Column("admin_note", sa.Text(), nullable=True))

    op.execute("ALTER TABLE notifications DROP CONSTRAINT notifications_type_check")
    op.execute(
        f"ALTER TABLE notifications ADD CONSTRAINT notifications_type_check "
        f"CHECK ({_check_sql(_NEW_NOTIFICATION_TYPES)})"
    )


def downgrade() -> None:
    # Cualquier fila 'feedback_status_changed' ya escrita rompe el CHECK
    # viejo al reaplicarlo -- se borran primero (mismo criterio que un
    # downgrade de columna: el dato que dependia de la migracion no
    # sobrevive el rollback).
    op.execute("DELETE FROM notifications WHERE type = 'feedback_status_changed'")
    op.execute("ALTER TABLE notifications DROP CONSTRAINT notifications_type_check")
    op.execute(
        f"ALTER TABLE notifications ADD CONSTRAINT notifications_type_check "
        f"CHECK ({_check_sql(_OLD_NOTIFICATION_TYPES)})"
    )

    op.drop_column("feedback", "admin_note")
