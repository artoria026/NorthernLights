"""add recurring_items.icon: the icon the user picked for a subscription or recurring item

Optional, a short key (a brand like "spotify" or a generic one like "server"). Null means the app
suggests one from the item's name, so nothing existing needs to be filled in.

Revision ID: a3c5e7b9d102
Revises: f1a7c9d3b520
Create Date: 2026-10-24 13:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c5e7b9d102"
down_revision: str | Sequence[str] | None = "f1a7c9d3b520"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE recurring_items ADD COLUMN icon varchar(64)")


def downgrade() -> None:
    op.execute("ALTER TABLE recurring_items DROP COLUMN IF EXISTS icon")
