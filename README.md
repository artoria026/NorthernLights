# NorthernLights — Personal Finance

Personal finance web app with double-entry accounting, debt tracking, monthly budget, recurring expenses/subscriptions, historical reports, and an AI financial advisor (Claude/Gemini) that can read and create transactions via chat.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), PostgreSQL 16, Redis 7, Celery, Alembic. Package manager: `uv`.
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui (Base UI), TanStack Query v5, Zustand, React Router v7.
- **AI:** swappable provider via `AI_PROVIDER` — Gemini (`gemini-flash-latest`, default) or Claude (`claude-sonnet-4-6`), function calling + streaming.
- **Auth:** custom JWT (access + refresh token with rotation) + optional Google OAuth.

## Repo structure

```
northern_lights/
├── backend/
│   ├── app/
│   │   ├── ai/            # providers (claude.py/gemini.py), prompts, advisor tools
│   │   ├── core/           # config, database (RLS), security (JWT), celery, redis
│   │   ├── models/         # SQLAlchemy ORM
│   │   ├── routers/        # FastAPI endpoints (one per module)
│   │   ├── schemas/        # Pydantic
│   │   ├── services/       # business logic (one file per module)
│   │   └── tasks/          # Celery jobs (alerts, reports, recurring items, etc.)
│   ├── alembic/versions/   # migrations (a single linear chain, no branches)
│   └── tests/               # pytest, real DB (finanzas_test) per transaction/savepoint
├── frontend-web/
│   └── src/
│       ├── pages/           # one page per main route
│       ├── components/nl/   # shared domain components (charts, help, etc.)
│       ├── components/ui/   # shadcn/ui
│       ├── hooks/            # one hook per resource (TanStack Query)
│       └── lib/              # utils, custom SVG charts, category icons
├── docs/
│   ├── legal/DISCLAIMER.md  # privacy notice (readable copy; the real text lives in frontend-web/src/lib/disclaimer.ts)
│   ├── DISCLAIMER_INPUTS.md # inventory of features/data used as input for the disclaimer
│   ├── CONVENTIONS.md       # branch and commit naming conventions
│   └── RELEASING.md         # checklist for releasing a version and writing the changelog
├── CLAUDE.md                # instructions for AI agents working in this repo
└── docker-compose.yml       # pgAdmin only (optional) — Postgres/Redis are native, not Docker
```

## Setup on a new machine

### Requirements

- PostgreSQL 16+ and Redis running (native or in Docker — this repo's `docker-compose.yml` only brings up pgAdmin, it assumes you already have both available).
- Python 3.12+ with [`uv`](https://docs.astral.sh/uv/) installed.
- Node.js 20+.

### 1. Database

```bash
createuser -h localhost -p 5432 finanzas_user -P    # prompts you for a password
createdb   -h localhost -p 5432 -O finanzas_user finanzas_dev
createdb   -h localhost -p 5432 -O finanzas_user finanzas_test   # for running pytest
```

If that port/user is already taken by another project on your machine, use any other — it just needs to match `DATABASE_URL` in the `.env` from step 3.

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` with the user/password/port from step 1.
- `SECRET_KEY` — any long random string (`python -c "import secrets; print(secrets.token_urlsafe(64))"`).
- `ANTHROPIC_API_KEY` and/or `GOOGLE_AI_API_KEY` — you need at least the one for the provider set in `AI_PROVIDER` (default `gemini`) for the Advisor to work; without either, the rest of the app still works.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` — if set, the initial migration creates that user with the admin role (idempotent, doesn't break if left empty).
- `ADMIN_DB_PASSWORD` — any new password, you'll use it in step 4.
- Google OAuth / Firebase / email remain optional — without configuring them, those specific flows won't work but the rest of the app will.

```bash
uv sync
uv run alembic upgrade head
```

### 3. The Admin reporting role (manual step, once per database)

The Admin panel needs to see **all** users' data (total counts), but every user table has Row-Level Security with `FORCE` enabled — not even the app's own role can bypass it without explicit permission. The one migration that can't run on its own is a `CREATE ROLE`, and Alembic can't do it alone because the app role (`finanzas_user`) deliberately **doesn't have** `CREATEROLE`. With any Postgres superuser:

```sql
CREATE ROLE finanzas_admin LOGIN PASSWORD '<what you set in ADMIN_DB_PASSWORD>'
    NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT finanzas_admin TO finanzas_user;
```

And then, so that role has the `SELECT` grants it needs:

```bash
uv run alembic upgrade head   # now it finds the role and grants the GRANTs
```

Without this step, the app works normally — only the Admin panel (`/admin`) fails when it requests `/admin/users` or `/admin/stats`.

```bash
uv run uvicorn app.main:app --reload --port 8000
# http://localhost:8000/docs
```

### 4. Frontend

```bash
cd frontend-web
cp .env.local.example .env.local
npm install
npm run dev
# http://localhost:5173
```

`VITE_ENABLE_DEV_LOGIN=true` in `.env.local` enables the "Use test account" button on `/login` (also requires Vite dev mode — it never shows up in `npm run build`). You need to register that account by hand once (`test@local.dev` / `test1234`, or change the hardcoded value in `Login.tsx` if you'd rather use something else).

### 5. (Optional) Celery — alerts, automatic reports, reminders

```bash
cd backend
uv run celery -A app.core.celery worker --loglevel=info
uv run celery -A app.core.celery beat --loglevel=info   # periodic task scheduler
```

The app works without this — you just won't get the periodic jobs (generating monthly reports, upcoming card-payment alerts, pending-payment reminders).

## Tests

```bash
cd backend && uv run pytest              # 220 tests, uses finanzas_test (migrates/unmigrates itself on each run)
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

## Architecture — non-obvious decisions

- **Double-entry accounting:** every `JournalEntry` (the transaction the user sees) has 2+ `JournalLine`s (debit/credit) against an `Account`. For simple income/expense entries the user never sees or picks the internal ledger account on the other side (`account_service.get_or_create_category_ledger_account`) — that only surfaces for transfers, loans, and shared expenses.
- **Real RLS, not decorative:** every table holding user data has `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (part of the initial migration `293528f67338`). Without `FORCE`, Postgres exempts the table owner from its own policies — and the app role is the owner. Every authenticated request goes through `get_rls_db`, which runs `SET LOCAL app.current_user_id` before touching any user table. `current_setting(..., true)` doesn't return `NULL` when the variable was never set in the session (it returns `''`, which blows up the cast to `uuid`) — every policy wraps the cast with `NULLIF(..., '')` (migration `a48efe292423`).
- **`finanzas_admin` role:** the one deliberate RLS bypass, read-only (`SELECT` only, can't even write). `finanzas_user` is a member of it; `get_admin_db` runs `SET LOCAL ROLE finanzas_admin` on the same connection as always (there's no second pool/engine). See step 3 of setup.
- **System categories:** rows in `categories` with `user_id IS NULL`, fixed for every user (9 expense + 3 income, seeded directly in the initial migration `293528f67338`). The AI advisor and the Excel bulk import resolve categories by exact name (case-insensitive) against whatever exists at that moment — if you rename them, also update the hardcoded list in `app/ai/advisor.py` (system prompt) and `frontend-web/src/pages/ImportarDatos.tsx` (help text).
- **Hashed refresh tokens + login rate-limiting:** `devices.refresh_token` stores `sha256(token)`, never the real value — a leak of that table doesn't hand out ready-to-use sessions. 5 failed login attempts (per email, via Redis) trigger a 15-minute lockout.
- **Test login button:** gated by TWO conditions (Vite's `import.meta.env.DEV` + `VITE_ENABLE_DEV_LOGIN=true`), never just one — this protects it both from a production build and from being accidentally left on in a shared `dev` environment.
- **Amounts as strings:** the backend's `Decimal` fields are serialized as strings in JSON (`json_safe()`), never as `number` — the frontend always does `Number(value)` before `toLocaleString`/arithmetic, never assumes it's already numeric.

## Feature map

| Module | Backend router | Service(s) | Frontend page |
|---|---|---|---|
| Auth / profile / devices | `auth.py` | `auth_service.py`, `google_auth_service.py` | `Login`, `Register`, `Settings`, `AuthCallback` |
| Accounts | `accounts.py` | `account_service.py` | `Accounts` |
| Categories | `categories.py` | `category_service.py` | `Categorias` |
| Transactions | `transactions.py` | `transaction_service.py` | `Transactions` |
| Debts | `debts.py` | `debt_service.py` | `Debts` |
| Recurring / subscriptions | `recurring.py` | `recurring_service.py` | `Recurring`, `Subscriptions` |
| Budget | `budget.py` | `budget_service.py` | `Budget` |
| Financial engine (snapshot, health) | `engine.py` | `engine_service.py` | `Dashboard` |
| Insights | `insights.py` | `insight_service.py` | `Insights` |
| Reports | `reports.py` | `report_service.py`, `report_insight_service.py` | `Reports` |
| AI advisor | `ai.py` | `chat_service.py`, `app/ai/*` | `Advisor` |
| Notifications | `notifications.py` | `notification_service.py`, `push_service.py` | `Notifications` |
| Bulk import (Excel) | `bulk_import.py` | `bulk_import_service.py` | `ImportarDatos` |
| Export/delete my data | `data.py` | `data_service.py` | `Settings` |
| Admin | `admin.py` | `admin_service.py` | `Admin` |
| Feedback (bug/feature request from the what's-new modal) | `feedback.py` | `feedback_service.py` | — (modal, no dedicated page) |

## Known gaps

- No real email provider connected — `app/tasks/email.py` only logs, the "forgot my password" flow works end-to-end on the backend but has no frontend screen.
- No push provider (Firebase) configured by default — `push_service.py` is a silent no-op without `FIREBASE_CREDENTIALS_JSON`.
- Google OAuth requires creating a real project in Google Cloud Console — without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, that button redirects to a URL Google rejects (doesn't break the rest of the app).
- Celery worker/beat don't start on their own — you have to run them separately if you want the periodic jobs (see step 5 of setup).
