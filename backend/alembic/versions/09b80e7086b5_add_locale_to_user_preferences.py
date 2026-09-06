"""add locale to user preferences

Revision ID: 09b80e7086b5
Revises: 562e5a0a2776
Create Date: 2026-09-06 00:03:38.144751

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09b80e7086b5'
down_revision: Union[str, Sequence[str], None] = '562e5a0a2776'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column("locale", sa.String(), nullable=False, server_default="es"),
    )
    op.create_check_constraint(
        "ck_user_preferences_locale",
        "user_preferences",
        "locale IN ('es', 'en')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_user_preferences_locale", "user_preferences", type_="check")
    op.drop_column("user_preferences", "locale")
