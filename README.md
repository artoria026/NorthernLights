# NorthernLights — Finanzas Personales

App web de finanzas personales con contabilidad de doble entrada, seguimiento de deudas, presupuesto mensual, gastos recurrentes/suscripciones, reportes históricos, y un asesor financiero con IA (Claude/Gemini) que puede leer y crear movimientos por chat.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), PostgreSQL 16, Redis 7, Celery, Alembic. Gestor de paquetes: `uv`.
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui (Base UI), TanStack Query v5, Zustand, React Router v7.
- **IA:** proveedor intercambiable vía `AI_PROVIDER` — Gemini (`gemini-flash-latest`, default) o Claude (`claude-sonnet-4-6`), function calling + streaming.
- **Auth:** JWT propio (access + refresh token con rotación) + Google OAuth opcional.

## Estructura del repo

```
northern_lights/
├── backend/
│   ├── app/
│   │   ├── ai/            # providers (claude.py/gemini.py), prompts, tools del asesor
│   │   ├── core/           # config, database (RLS), security (JWT), celery, redis
│   │   ├── models/         # SQLAlchemy ORM
│   │   ├── routers/        # endpoints FastAPI (uno por módulo)
│   │   ├── schemas/        # Pydantic
│   │   ├── services/       # lógica de negocio (un archivo por módulo)
│   │   └── tasks/          # jobs de Celery (alertas, reportes, recurrentes, etc.)
│   ├── alembic/versions/   # migraciones (una cadena lineal, sin branches)
│   └── tests/               # pytest, DB real (finanzas_test) por transacción/savepoint
├── frontend-web/
│   └── src/
│       ├── pages/           # una página por ruta principal
│       ├── components/nl/   # componentes compartidos del dominio (charts, help, etc.)
│       ├── components/ui/   # shadcn/ui
│       ├── hooks/            # un hook por recurso (TanStack Query)
│       └── lib/              # utils, charts SVG propios, category icons
└── docker-compose.yml       # solo pgAdmin (opcional) — Postgres/Redis son nativos, no Docker
```

## Setup en una máquina nueva

### Requisitos

- PostgreSQL 16+ y Redis corriendo (nativos o en Docker — el `docker-compose.yml` de este repo solo trae pgAdmin, asume que ya tienes ambos disponibles).
- Python 3.12+ con [`uv`](https://docs.astral.sh/uv/) instalado.
- Node.js 20+.

### 1. Base de datos

```bash
createuser -h localhost -p 5432 finanzas_user -P    # te pide poner un password
createdb   -h localhost -p 5432 -O finanzas_user finanzas_dev
createdb   -h localhost -p 5432 -O finanzas_user finanzas_test   # para correr pytest
```

Si ese puerto/usuario ya está ocupado por otro proyecto en tu máquina, usa cualquier otro — solo tiene que coincidir con `DATABASE_URL` en el `.env` del paso 3.

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Completa en `.env`:
- `DATABASE_URL` con el usuario/password/puerto del paso 1.
- `SECRET_KEY` — cualquier string aleatorio largo (`python -c "import secrets; print(secrets.token_urlsafe(64))"`).
- `ANTHROPIC_API_KEY` y/o `GOOGLE_AI_API_KEY` — necesitas al menos la del proveedor que dejes en `AI_PROVIDER` (default `gemini`) para que el Asesor funcione; sin ninguna, el resto de la app funciona igual.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` — si los dejas, la migración inicial crea ese usuario con rol admin (idempotente, no rompe si los dejas vacíos).
- `ADMIN_DB_PASSWORD` — cualquier password nuevo, lo vas a usar en el paso 4.
- Google OAuth / Firebase / email quedan opcionales — sin configurarlos, esos flujos específicos no funcionan pero el resto de la app sí.

```bash
uv sync
uv run alembic upgrade head
```

### 3. El rol de reportes de Admin (paso manual, una sola vez por base de datos)

El panel de Admin necesita ver datos de **todos** los usuarios (conteos totales), pero cada tabla de usuario tiene Row-Level Security con `FORCE` activo — ni el propio rol de la app puede saltarla sin permiso explícito. La única migración que falta correr es un `CREATE ROLE`, y Alembic no puede hacerlo solo porque el rol de la app (`finanzas_user`) **no tiene** `CREATEROLE` a propósito. Con cualquier superusuario de tu Postgres:

```sql
CREATE ROLE finanzas_admin LOGIN PASSWORD '<lo que pusiste en ADMIN_DB_PASSWORD>'
    NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT finanzas_admin TO finanzas_user;
```

Y luego, para que ese rol tenga los `SELECT` que necesita:

```bash
uv run alembic upgrade head   # ahora sí encuentra el rol y otorga los GRANTs
```

Sin este paso, la app funciona normal — solo el panel de Admin (`/admin`) falla al pedir `/admin/users` o `/admin/stats`.

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

`VITE_ENABLE_DEV_LOGIN=true` en `.env.local` habilita el botón "Usar cuenta de prueba" en `/login` (además requiere modo dev de Vite — nunca aparece en `npm run build`). Necesitas registrar esa cuenta a mano una vez (`test@local.dev` / `test1234`, o cambia el hardcode en `Login.tsx` si prefieres otra).

### 5. (Opcional) Celery — alertas, reportes automáticos, recordatorios

```bash
cd backend
uv run celery -A app.core.celery worker --loglevel=info
uv run celery -A app.core.celery beat --loglevel=info   # scheduler de tareas periódicas
```

La app funciona sin esto — solo no correrán los jobs periódicos (generar reportes mensuales, avisos de tarjeta por vencer, recordatorios de pagos pendientes).

## Tests

```bash
cd backend && uv run pytest              # 220 tests, usa finanzas_test (se migra/desmigra sola en cada corrida)
cd backend && uv run ruff check .

cd frontend-web && npm run test -- --run
cd frontend-web && npx tsc -b
cd frontend-web && npm run lint
```

`tests/test_rls_enforcement.py` prueba RLS contra un rol de verdad (sin superuser/bypassrls) para detectar violaciones reales, no solo razonadas. Ese rol (`finanzas_rls_test`) es fijo y se crea una sola vez a mano, mismo motivo que `finanzas_admin` (`finanzas_user` no tiene `CREATEROLE`):

```sql
CREATE ROLE finanzas_rls_test LOGIN PASSWORD 'regression-test-only' NOSUPERUSER NOBYPASSRLS;
```

Sin ese rol, esos 5 tests se saltan solos (`skip`, no fallan) con la instrucción de arriba en el mensaje.

## Arquitectura — decisiones no obvias

- **Doble entrada contable:** cada `JournalEntry` (transacción visible al usuario) tiene 2+ `JournalLine` (debe/haber) contra `Account`. Para income/expense simples el usuario nunca ve ni elige la cuenta contable interna del otro lado (`account_service.get_or_create_category_ledger_account`) — solo aplica en transfers, préstamos y gastos compartidos.
- **RLS de verdad, no decorativo:** todas las tablas con datos de usuario tienen `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (parte de la migración inicial `293528f67338`). Sin `FORCE`, Postgres exime al dueño de la tabla de sus propias policies — y el rol de la app es el dueño. Cada request autenticado pasa por `get_rls_db`, que hace `SET LOCAL app.current_user_id` antes de tocar cualquier tabla de usuario. `current_setting(..., true)` no da `NULL` cuando la variable nunca se seteó en la sesión (da `''`, que revienta el cast a `uuid`) — todas las policies envuelven el cast con `NULLIF(..., '')` (migración `a48efe292423`).
- **Rol `finanzas_admin`:** único bypass deliberado de RLS, de solo lectura (`SELECT` nada más, ni siquiera puede escribir). `finanzas_user` es miembro suyo; `get_admin_db` hace `SET LOCAL ROLE finanzas_admin` sobre la misma conexión de siempre (no hay una segunda pool/engine). Ver paso 3 del setup.
- **Categorías del sistema:** filas de `categories` con `user_id IS NULL`, fijas para todos los usuarios (9 de gasto + 3 de ingreso, sembradas directo en la migración inicial `293528f67338`). El asesor de IA y la importación por Excel resuelven categoría por nombre exacto (case-insensitive) contra las que existan en ese momento — si cambias los nombres, actualiza también la lista hardcodeada en `app/ai/advisor.py` (system prompt) y `frontend-web/src/pages/ImportarDatos.tsx` (texto de ayuda).
- **Refresh tokens hasheados + rate-limit de login:** `devices.refresh_token` guarda `sha256(token)`, nunca el valor real — una fuga de esa tabla no entrega sesiones listas para usar. 5 intentos fallidos de login (por email, vía Redis) bloquean 15 minutos.
- **Botón de login de prueba:** gateado por DOS condiciones (`import.meta.env.DEV` de Vite + `VITE_ENABLE_DEV_LOGIN=true`), nunca por una sola — así queda protegido tanto de un build de producción como de quedar prendido sin querer en un `dev` compartido.
- **Montos como string:** los campos `Decimal` del backend se serializan como string en JSON (`json_safe()`), nunca como `number` — el frontend siempre hace `Number(valor)` antes de `toLocaleString`/aritmética, nunca asume que ya es numérico.

## Mapa de funcionalidades

| Módulo | Router backend | Service(s) | Página frontend |
|---|---|---|---|
| Auth / perfil / dispositivos | `auth.py` | `auth_service.py`, `google_auth_service.py` | `Login`, `Register`, `Settings`, `AuthCallback` |
| Cuentas | `accounts.py` | `account_service.py` | `Accounts` |
| Categorías | `categories.py` | `category_service.py` | `Categorias` |
| Transacciones | `transactions.py` | `transaction_service.py` | `Transactions` |
| Deudas | `debts.py` | `debt_service.py` | `Debts` |
| Recurrentes / suscripciones | `recurring.py` | `recurring_service.py` | `Recurring`, `Subscriptions` |
| Presupuesto | `budget.py` | `budget_service.py` | `Budget` |
| Motor financiero (snapshot, salud) | `engine.py` | `engine_service.py` | `Dashboard` |
| Insights | `insights.py` | `insight_service.py` | `Insights` |
| Reportes | `reports.py` | `report_service.py`, `report_insight_service.py` | `Reports` |
| Asesor IA | `ai.py` | `chat_service.py`, `app/ai/*` | `Advisor` |
| Notificaciones | `notifications.py` | `notification_service.py`, `push_service.py` | `Notifications` |
| Importación masiva (Excel) | `bulk_import.py` | `bulk_import_service.py` | `ImportarDatos` |
| Exportar/borrar mis datos | `data.py` | `data_service.py` | `Settings` |
| Admin | `admin.py` | `admin_service.py` | `Admin` |
| Feedback (bug/feature desde el modal de novedades) | `feedback.py` | `feedback_service.py` | — (modal, no página propia) |

## Pendientes conocidos

- Sin proveedor de email real conectado — `app/tasks/email.py` solo loguea, el flujo de "olvidé mi password" funciona de punta a punta en backend pero no tiene pantalla en el frontend.
- Sin proveedor de push (Firebase) configurado por default — `push_service.py` es no-op silencioso sin `FIREBASE_CREDENTIALS_JSON`.
- Google OAuth requiere crear un proyecto real en Google Cloud Console — sin `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, ese botón redirige a una URL que Google rechaza (no rompe el resto de la app).
- Celery worker/beat no arrancan solos — hay que levantarlos aparte si quieres los jobs periódicos (ver paso 5 del setup).
