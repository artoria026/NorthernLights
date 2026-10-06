# Production reset: wipe the database and deploy from scratch

One-time runbook, written for the agent (or person) that will **delete the production
database and rebuild it** from the single initial migration. Read all of it before running
anything. Every command that changes state sits behind a numbered step; the steps marked
**STOP** need an explicit human "go" first.

## What happens, and why it is safe to do this once

The old migration chain was folded into one migration, `293528f67338`
(`backend/alembic/versions/293528f67338_initial_schema.py`). On an **empty** database,
`alembic upgrade head` creates:

- all 23 tables (21 with `FORCE ROW LEVEL SECURITY`), indexes, triggers and policies;
- the 17 system categories, with Spanish name, English name and a stable `slug`;
- one admin user, from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`;
- the `SELECT` grants for the `finanzas_admin` reporting role, **if that role already exists**.

It can **not** be applied on top of the old production database: that one is stamped with
old revision ids (e.g. `a48efe292423`) that no longer exist in the code, so Alembic cannot
upgrade or downgrade it. The only path is: new empty database, then migrate.

All user data is lost (users, accounts, transactions, debts, budgets, chats). That is the
intent. Nothing is migrated.

## Hard rules

1. **Only touch this app's database.** Postgres and Redis on this host are native and
   **shared** with other projects (other databases exist on the same cluster). Never run a
   cluster-wide command, never `DROP DATABASE` before step 3 has proven which database you
   are connected to.
2. **Never run `pytest`, or start any new one-off container (`docker compose run`), with the
   production `.env` loaded.** The test suite migrates and un-migrates the database it points
   to; running it through a container that inherited the production `.env` already wiped the
   real database twice (see the lock at the top of `backend/tests/conftest.py`). Use
   `docker compose exec` against the running services instead.
3. **Do not flush Redis.** It is shared. Every cache key here carries a user id
   (`snapshot:<uuid>`, `report:<uuid>:*`, `ai_rate:<uuid>:*`) and old ids never come back, so
   stale keys are harmless and expire by TTL (max 7 days). Only purge this app's Celery queue
   (step 6).
4. **Do not print secrets.** Do not `cat` the `.env`; read single variables when needed and
   never paste `ADMIN_PASSWORD`, `SECRET_KEY` or database passwords into logs or messages.
5. Use `-f docker-compose.prod.yml` on every compose command. The default
   `docker-compose.yml` is the local pgAdmin one.

## 0. Before you start (human decisions)

- [ ] The change is merged to `master` and you are deploying from `master`.
- [ ] A maintenance window is agreed; users know their data will be erased. (Users can
      download accounts and categories as JSON from Settings, but transactions, debts and
      budgets are **not** included in those files.)
- [ ] The production `.env` has real values for: `DATABASE_URL`, `SECRET_KEY`,
      `APP_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (**8+ characters**; with
      `APP_ENV=production` the migration refuses a shorter one and the deploy fails),
      `ADMIN_NAME`, `ADMIN_DB_PASSWORD`, `REDIS_URL`, `CELERY_BROKER_URL`,
      `CELERY_RESULT_BACKEND`, `CORS_ORIGINS`, `FRONTEND_URL`, and the AI key(s).
- [ ] You have a Postgres role that can `DROP`/`CREATE DATABASE` and create roles (a
      superuser, or the owner plus `CREATEDB`). The app role `finanzas_user` deliberately
      cannot create roles.

## 1. Get the code and check it

```bash
cd <repo on the server>
git fetch origin && git checkout master && git pull --ff-only origin master
ls backend/alembic/versions/*.py          # must list exactly ONE file: 293528f67338_initial_schema.py
git log --oneline -3
```

Stop if there is more than one migration file: someone is deploying the wrong branch.

## 2. Read the real target from the production `.env`

Resolve these from `DATABASE_URL` (do not guess, do not copy the dev values):

- `<DB_NAME>`: database name; `<APP_ROLE>`: the user in the URL (expected `finanzas_user`);
  `<HOST>:<PORT>`: the shared native Postgres (the compose file reaches it at `172.17.0.1`).

## 3. Preflight: prove you are looking at the right database

Run as the Postgres superuser (or the owner). Replace the placeholders.

```bash
psql "postgresql://<SUPERUSER>@<HOST>:<PORT>/postgres" -c "\l"        # other databases exist: leave them alone
psql "postgresql://<SUPERUSER>@<HOST>:<PORT>/<DB_NAME>" <<'SQL'
SELECT current_database(), current_user;
SELECT version_num FROM alembic_version;                              -- an OLD revision id is expected
SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1;
SELECT count(*) AS users FROM users;
SELECT datname, usename, application_name, state FROM pg_stat_activity WHERE datname = current_database();
SQL
```

Confirm all of: the table list matches this app (`journal_entries`, `journal_lines`, `debts`,
`category_hides`, `feedback`, ...), the name is the app's own database and not another
project's, and the user count is what the owner expects to lose.

**STOP.** Show this output to the human and wait for an explicit "go" before step 4.

## 4. Backup (do not skip, do not continue if it fails)

Dumps must be taken by a role that **bypasses row-level security** (superuser, or
`finanzas_admin`). As the app role, `pg_dump` aborts on the forced-RLS tables.

```bash
TS=$(date +%Y%m%d_%H%M%S)
BK=~/backups/northernlights_prod_pre_reset_$TS.sql.gz
pg_dump "postgresql://<SUPERUSER>@<HOST>:<PORT>/<DB_NAME>" --no-owner | gzip > "$BK"
ls -la "$BK"
gunzip -c "$BK" | grep -c '^COPY public\.'            # expect 23 (one per table)
gunzip -c "$BK" | grep -A3 '^COPY public.users ' | head -5
sha256sum "$BK"
```

The backup must be non-trivial in size and show 23 `COPY` blocks. If `pg_dump` printed any
error, stop. Keep the file and the checksum; the rollback depends on them.

## 5. Stop the web side and the scheduler

```bash
docker compose -f docker-compose.prod.yml stop celery-beat backend
docker compose -f docker-compose.prod.yml ps
```

Stop `frontend` too unless a maintenance page is in place. Beat goes first so nothing new is
scheduled while you clean up.

## 6. Purge this app's pending Celery work, then stop the worker

Tasks queued by the old deployment refer to users that will no longer exist. Purge through
the running worker (this only empties this app's queue):

```bash
docker compose -f docker-compose.prod.yml exec celery-worker uv run celery -A app.core.celery purge -f
docker compose -f docker-compose.prod.yml stop celery-worker
```

Do **not** use `redis-cli FLUSHDB`/`FLUSHALL` (rule 3). Re-check `pg_stat_activity` (step 3):
no connection from the app may remain before step 8.

## 7. Make sure the `finanzas_admin` role exists, **before** migrating

Roles live at cluster level and survive a database drop. Check, and create only if missing
(`<ADMIN_DB_PASSWORD>` is the `ADMIN_DB_PASSWORD` value from `.env`):

```sql
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('finanzas_admin', '<APP_ROLE>');

-- only if finanzas_admin is missing:
CREATE ROLE finanzas_admin LOGIN PASSWORD '<ADMIN_DB_PASSWORD>'
    NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
-- membership, needed for SET LOCAL ROLE (idempotent):
GRANT finanzas_admin TO <APP_ROLE>;
```

This order matters: the migration grants `SELECT` to this role only if it exists at that
moment. There is a single migration, so running `alembic upgrade head` again later will **not**
add the grants (see "If the admin panel fails" below).

## 8. Replace the database

Preferred, as a role with the privileges from step 0. Use the exact `<DB_NAME>` and
`<APP_ROLE>` proven in step 3.

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '<DB_NAME>' AND pid <> pg_backend_pid();
DROP DATABASE "<DB_NAME>";
CREATE DATABASE "<DB_NAME>" OWNER <APP_ROLE>;
```

Fallback if `DROP DATABASE` is not allowed but you own the schema: connect to `<DB_NAME>` and run

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION <APP_ROLE>;
GRANT USAGE ON SCHEMA public TO PUBLIC;
```

(Dropping the schema also removes the `pgcrypto` extension; the migration recreates it.)

Confirm it is empty: `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';` must return `0`.

## 9. Deploy and migrate

The `backend` container runs `alembic upgrade head` and then starts uvicorn
(`backend/Dockerfile`). Only `backend` migrates; the Celery containers must not.

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml logs -f backend
```

Expected in the logs, in order:

```
Running upgrade  -> 293528f67338, initial schema ...
[293528f67338] usuario admin creado: <ADMIN_EMAIL>
Uvicorn running on http://0.0.0.0:8000
```

Failure modes:

- `RuntimeError: ... ADMIN_PASSWORD tiene menos de 8 caracteres y APP_ENV=production`: fix
  the password in `.env`. The DDL is transactional, nothing was left half-applied; the
  container will restart-loop until fixed. Re-run from step 8 only if the database is not
  empty anymore.
- `[293528f67338] ADMIN_EMAIL/ADMIN_PASSWORD no definidos`: the app came up with **no admin**.
  Set both and recreate the database (step 8) rather than patching by hand.
- `[293528f67338] el rol finanzas_admin no existe todavia`: you skipped step 7. Create the
  role and apply the manual grants below.

Then start the rest:

```bash
docker compose -f docker-compose.prod.yml up -d celery-worker celery-beat frontend
docker compose -f docker-compose.prod.yml ps
```

## 10. Verify (all must pass)

Run as the superuser, or as `finanzas_admin` (the app role cannot see rows under RLS).

```sql
SELECT version_num FROM alembic_version;                                    -- 293528f67338
SELECT count(*) FROM information_schema.tables WHERE table_schema='public'; -- 23
SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
   AND relkind='r' AND relforcerowsecurity;                                 -- 21
SELECT count(*) FROM categories
 WHERE user_id IS NULL AND slug IS NOT NULL AND name_en IS NOT NULL;        -- 17
SELECT email, role FROM users;                                              -- exactly one row: the admin
SELECT count(*) FROM user_preferences;                                      -- 1
SELECT bool_and(has_table_privilege('finanzas_admin', c.oid, 'SELECT'))
  FROM pg_class c WHERE relnamespace='public'::regnamespace AND relkind='r'; -- t
```

Application checks:

- `GET /health` returns 200 (also what the container healthcheck uses).
- Sign in as the admin in the web app (an agent should not type the password into logs).
  The privacy notice appears on first login; accept it.
- Categories list shows 17 entries; switching the language to English renames them
  ("Food & Drinks", "Groceries", ...).
- Admin panel loads `/admin/users` and `/admin/stats` (a permission error here means the
  reporting grants are missing; see below).
- `docker compose -f docker-compose.prod.yml logs --since 10m` shows no tracebacks from
  backend, celery-worker or celery-beat.

Finally, **tell the human to change the admin password** from Settings.

## If the admin panel fails (permission error on `/admin/*`)

The `finanzas_admin` role did not exist when the migration ran. As the database owner or a
superuser, once (replace `<DB_NAME>`):

```sql
GRANT CONNECT ON DATABASE "<DB_NAME>" TO finanzas_admin;
GRANT USAGE ON SCHEMA public TO finanzas_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO finanzas_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO finanzas_admin;
```

## Rollback

Only if the new deployment cannot be made to work. This brings back the old database **and**
requires the old code, because the restored database is stamped with the old revision ids.

1. `docker compose -f docker-compose.prod.yml stop celery-beat celery-worker backend frontend`
2. Check out the commit that was running before the reset (note it in step 1 before pulling:
   `git rev-parse HEAD`) and rebuild its images.
3. Recreate the empty database (step 8).
4. Restore **as a superuser / BYPASSRLS role**. Restoring as the app role fails: `COPY` is not
   supported into tables under row-level security.
   ```bash
   gunzip -c "$BK" | psql "postgresql://<SUPERUSER>@<HOST>:<PORT>/<DB_NAME>" --single-transaction -v ON_ERROR_STOP=1
   ```
5. Start the old backend (`up -d backend`); its migration step is a no-op because the restored
   database is already at the old head. Verify login with a real user.

## Record

When finished, write down in the handoff: the git commit deployed, the backup path and its
`sha256sum`, the output of the step 10 queries, and anything that deviated from this plan.
