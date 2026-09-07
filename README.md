# NorthernLights — Personal Finance

A personal finance web app with real double-entry accounting under the hood, debt tracking, budgeting, recurring expenses/subscriptions, historical reports, and an AI financial advisor (Claude/Gemini) that can read your real data and create transactions for you via chat. Bilingual UI (Spanish/English), switchable at any time.

Built solo, end to end: schema design, a real Postgres Row-Level Security model (not just a `WHERE user_id = ?`), the double-entry ledger, the AI tool-calling loop, and the frontend on top of it.

## Screenshots

| | |
|---|---|
| ![Login — bilingual](docs/screenshots/login.png) | ![Dashboard](docs/screenshots/dashboard.png) |
| ![Transactions](docs/screenshots/transactions.png) | ![Debts](docs/screenshots/debts.png) |

<p align="center"><img src="docs/screenshots/advisor.png" alt="AI Advisor" width="700"></p>

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), PostgreSQL 16, Redis 7, Celery, Alembic. Package manager: `uv`.
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui (Base UI), TanStack Query v5, Zustand, React Router v7, react-i18next.
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
│       ├── locales/          # i18next translation namespaces (es/en)
│       └── lib/              # utils, custom SVG charts, category icons
├── docs/
│   ├── SETUP.md             # step-by-step to run this locally
│   ├── legal/DISCLAIMER.md  # privacy notice (readable copy; the real text lives in frontend-web/src/lib/disclaimer.ts)
│   ├── DISCLAIMER_INPUTS.md # inventory of features/data used as input for the disclaimer
│   ├── CONVENTIONS.md       # branch and commit naming conventions
│   └── RELEASING.md         # checklist for releasing a version and writing the changelog
├── CLAUDE.md                # instructions for AI agents working in this repo
└── docker-compose.yml       # pgAdmin only (optional) — Postgres/Redis are native, not Docker
```

## Architecture — non-obvious decisions

- **Double-entry accounting:** every `JournalEntry` (the transaction the user sees) has 2+ `JournalLine`s (debit/credit) against an `Account`. For simple income/expense entries the user never sees or picks the internal ledger account on the other side (`account_service.get_or_create_category_ledger_account`) — that only surfaces for transfers, loans, and shared expenses.
- **Real RLS, not decorative:** every table holding user data has `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (part of the initial migration `293528f67338`). Without `FORCE`, Postgres exempts the table owner from its own policies — and the app role is the owner. Every authenticated request goes through `get_rls_db`, which runs `SET LOCAL app.current_user_id` before touching any user table. `current_setting(..., true)` doesn't return `NULL` when the variable was never set in the session (it returns `''`, which blows up the cast to `uuid`) — every policy wraps the cast with `NULLIF(..., '')` (migration `a48efe292423`).
- **`finanzas_admin` role:** the one deliberate RLS bypass, read-only (`SELECT` only, can't even write). `finanzas_user` is a member of it; `get_admin_db` runs `SET LOCAL ROLE finanzas_admin` on the same connection as always (there's no second pool/engine).
- **System categories:** rows in `categories` with `user_id IS NULL`, fixed for every user (9 expense + 3 income, seeded directly in the initial migration `293528f67338`). The AI advisor and the Excel bulk import resolve categories by exact name (case-insensitive) against whatever exists at that moment — if you rename them, also update the hardcoded list in `app/ai/advisor.py` (system prompt) and `frontend-web/src/pages/ImportarDatos.tsx` (help text).
- **Hashed refresh tokens + login rate-limiting:** `devices.refresh_token` stores `sha256(token)`, never the real value — a leak of that table doesn't hand out ready-to-use sessions. 5 failed login attempts (per email, via Redis) trigger a 15-minute lockout.
- **Amounts as strings:** the backend's `Decimal` fields are serialized as strings in JSON (`json_safe()`), never as `number` — the frontend always does `Number(value)` before `toLocaleString`/arithmetic, never assumes it's already numeric.
- **i18n, not a find-and-replace job:** locale files are split by namespace (`common`/`pages`/`tours`/`categories`), plural forms use i18next's real `_one`/`_other` keys instead of manual `${n===1?'':'s'}` ternaries, and content that's data rather than UI copy (system category names, the AI's own responses) intentionally stays out of the translation layer instead of being force-translated — see `frontend-web/src/lib/categoryIcons.ts` for how a translated label is kept separate from the stable id it's looked up by.

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
- Celery worker/beat don't start on their own — you have to run them separately if you want the periodic jobs.
- The AI advisor and generated insights/reports currently respond in Spanish regardless of the UI language; only the interface itself is fully bilingual so far.

## Running it locally

Want to actually run this? The full walkthrough (database setup, env vars, the one manual Postgres role, tests) is in **[docs/SETUP.md](docs/SETUP.md)**.
