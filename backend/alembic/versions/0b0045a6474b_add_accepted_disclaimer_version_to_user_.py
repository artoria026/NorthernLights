"""add accepted disclaimer version to user preferences

Revision ID: 0b0045a6474b
Revises: a48efe292423
Create Date: 2026-08-15 02:29:45.164448

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b0045a6474b'
down_revision: Union[str, Sequence[str], None] = 'a48efe292423'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences", sa.Column("accepted_disclaimer_version", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "accepted_disclaimer_version")
