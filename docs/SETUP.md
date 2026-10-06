# Running it locally

This is the step-by-step for anyone who wants to actually run NorthernLights on their own machine (clone it, poke at the code, extend it). If you're just browsing the repo, the [README](../README.md) is the better starting point.

## Requirements

- PostgreSQL 16+ and Redis running (native or in Docker — this repo's `docker-compose.yml` only brings up pgAdmin, it assumes you already have both available).
- Python 3.12+ with [`uv`](https://docs.astral.sh/uv/) installed.
- Node.js 20+.

## 1. Database

```bash
createuser -h localhost -p 5432 finanzas_user -P    # prompts you for a password
createdb   -h localhost -p 5432 -O finanzas_user finanzas_dev
createdb   -h localhost -p 5432 -O finanzas_user finanzas_test   # for running pytest
```

If that port/user is already taken by another project on your machine, use any other — it just needs to match `DATABASE_URL` in the `.env` from step 2.

## 2. Backend configuration

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` with the user/password/port from step 1.
- `SECRET_KEY` — any long random string (`python -c "import secrets; print(secrets.token_urlsafe(64))"`).
- `ANTHROPIC_API_KEY` and/or `GOOGLE_AI_API_KEY` — you need at least the one for the provider set in `AI_PROVIDER` (default `gemini`) for the Advisor to work; without either, the rest of the app still works.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` — the migration creates that user with the admin role on a new database (idempotent: it never touches an existing user). Leave them empty to skip it. The admin accepts the privacy notice on first login like anyone else, and promotes other admins from the Admin panel. With `APP_ENV=production` the migration refuses a password shorter than 8 characters.
- `ADMIN_DB_PASSWORD` — any new password, you'll use it in step 3.
- Google OAuth / Firebase / email remain optional — without configuring them, those specific flows won't work but the rest of the app will.

## 3. The Admin reporting role (manual step, once per database — BEFORE migrating)

The Admin panel needs to see **all** users' data (total counts), but every user table has Row-Level Security with `FORCE` enabled — not even the app's own role can bypass it without explicit permission. `CREATE ROLE` can't be done by Alembic because the app role (`finanzas_user`) deliberately **doesn't have** `CREATEROLE`. With any Postgres superuser:

```sql
CREATE ROLE finanzas_admin LOGIN PASSWORD '<what you set in ADMIN_DB_PASSWORD>'
    NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT finanzas_admin TO finanzas_user;
```

Do this **before** the first `alembic upgrade head`: the migration finds the role and grants it `SELECT` on every table. There is a single migration, so running it again later does **not** re-apply those grants. If you created the role after migrating (the Admin panel's `/admin/users` and `/admin/stats` fail with a permission error), give the grants by hand, as the database owner, once (replace `<db>`):

```sql
GRANT CONNECT ON DATABASE "<db>" TO finanzas_admin;
GRANT USAGE ON SCHEMA public TO finanzas_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO finanzas_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO finanzas_admin;
```

## 4. Migrate and run the backend

```bash
cd backend
uv sync
uv run alembic upgrade head   # all tables, the 17 system categories and the admin user
uv run uvicorn app.main:app --reload --port 8000
# http://localhost:8000/docs
```

## 5. Frontend

```bash
cd frontend-web
cp .env.local.example .env.local
npm install
npm run dev
# http://localhost:5173
```

`VITE_ENABLE_DEV_LOGIN=true` in `.env.local` enables the "Use test account" button on `/login` (also requires Vite dev mode — it never shows up in `npm run build`). You need to register that account by hand once (`test@local.dev` / `test1234`, or change the hardcoded value in `Login.tsx` if you'd rather use something else).

## 6. (Optional) Celery — alerts, automatic reports, reminders

```bash
cd backend
uv run celery -A app.core.celery worker --loglevel=info
uv run celery -A app.core.celery beat --loglevel=info   # periodic task scheduler
```

The app works without this — you just won't get the periodic jobs (generating monthly reports, upcoming card-payment alerts, pending-payment reminders).

## Tests

```bash
cd backend && uv run pytest              # ~275 tests, uses finanzas_test (migrates/unmigrates itself on each run)
cd backend && uv run ruff check .

cd frontend-web && npm run test -- --run
cd frontend-web && npx tsc -b
cd frontend-web && npm run lint
```

`tests/test_rls_enforcement.py` tests RLS against a real role (without superuser/bypassrls) to catch actual violations, not just reasoned-about ones. That role (`finanzas_rls_test`) is fixed and created by hand once, for the same reason as `finanzas_admin` (`finanzas_user` doesn't have `CREATEROLE`):

```sql
CREATE ROLE finanzas_rls_test LOGIN PASSWORD 'regression-test-only' NOSUPERUSER NOBYPASSRLS;
```

Without that role, those 5 tests skip themselves (`skip`, not a failure) with the instructions above shown in the message.

## Production: fresh database

The production container runs `alembic upgrade head` on start (see `backend/Dockerfile`), so a brand-new empty database comes up complete. The order that matters:

1. Create the database and the `finanzas_user` owner role (step 1), then the `finanzas_admin` role (step 3).
2. Put the production values in `.env`, including `ADMIN_EMAIL`, a real `ADMIN_PASSWORD` (8+ characters, required when `APP_ENV=production`), `ADMIN_DB_PASSWORD` and `SECRET_KEY`.
3. Deploy. The migration creates every table, seeds the 17 system categories (Spanish + English names) and creates the admin user.
4. Log in as the admin, accept the privacy notice, change the password, and check that the Admin panel loads the user list.
