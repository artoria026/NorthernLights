"""The tags migration turns the old free-text `journal_entries.tags` into real tags.

Runs the migration's own downgrade/upgrade inside the test's rolled-back
transaction (Postgres DDL is transactional), so nothing outside it changes."""

import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tests.conftest import BACKEND_ROOT

pytestmark = pytest.mark.asyncio


def _load_migration():
    path = next((BACKEND_ROOT / "alembic" / "versions").glob("*_add_tags.py"))
    spec = importlib.util.spec_from_file_location("add_tags_migration", Path(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_old_free_text_tags_become_real_tags(db_connection):
    migration = _load_migration()

    def run(sync_conn, step):
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(migration, step)()

    user_id = uuid.uuid4()
    other_id = uuid.uuid4()
    entry_ids = [uuid.uuid4() for _ in range(3)]

    await db_connection.run_sync(run, "downgrade")  # back to the free-text column
    for uid, email in ((user_id, "a@example.com"), (other_id, "b@example.com")):
        await db_connection.execute(
            text("INSERT INTO users (id, email, name, role) VALUES (:id, :email, 'T', 'user')"),
            {"id": uid, "email": f"{uid}-{email}"},
        )
    # RLS (FORCE) is on for the owner too: act as the user that owns the rows
    for uid, entries in ((user_id, entry_ids[:2]), (other_id, entry_ids[2:])):
        await db_connection.execute(
            text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(uid)}
        )
        for entry_id in entries:
            tags = {
                entry_ids[0]: ["Viaje Mty", "  con pareja "],
                entry_ids[1]: ["viaje mty", ""],
            }.get(entry_id, ["Viaje Mty"])
            await db_connection.execute(
                text(
                    "INSERT INTO journal_entries "
                    "(id, user_id, date, description, entry_type, status, tags) "
                    "VALUES (:id, :uid, '2026-10-10', 'x', 'expense', 'confirmed', "
                    "CAST(:tags AS text[]))"
                ),
                {"id": entry_id, "uid": uid, "tags": tags},
            )
    await db_connection.execute(text("SELECT set_config('app.current_user_id', '', true)"))

    await db_connection.run_sync(run, "upgrade")

    await db_connection.execute(
        text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(user_id)}
    )
    names = (
        (await db_connection.execute(text("SELECT name FROM tags ORDER BY lower(name)")))
        .scalars()
        .all()
    )
    # one tag per distinct name ignoring case, trimmed, blanks dropped;
    # the other user's tags are not visible
    assert [n.lower() for n in names] == ["con pareja", "viaje mty"]
    linked = (
        await db_connection.execute(
            text(
                "SELECT je.id, lower(t.name) FROM journal_entry_tags jt "
                "JOIN journal_entries je ON je.id = jt.entry_id JOIN tags t ON t.id = jt.tag_id"
            )
        )
    ).all()
    assert sorted((str(i), n) for i, n in linked) == sorted(
        [
            (str(entry_ids[0]), "viaje mty"),
            (str(entry_ids[0]), "con pareja"),
            (str(entry_ids[1]), "viaje mty"),
        ]
    )
