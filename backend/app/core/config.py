from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Auth JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Google OAuth (M01 extended) -- empty until a real project is created in
    # Google Cloud Console; without GOOGLE_CLIENT_ID/SECRET, /auth/google/login
    # redirects to a Google URL that rejects the request (doesn't break the
    # rest of the app, only that flow doesn't work)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    # AI Provider
    AI_PROVIDER: str = "gemini"
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_AI_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    GEMINI_MODEL: str = "gemini-flash-latest"
    # 1024 was too short for normal chat (see STATEMENT_INSTRUCTIONS in
    # advisor.py): asking it to list every transaction from a multi-page
    # bank statement cut the response in half, with no confirmation
    # tool-call after it and no error at all -- the provider's stream
    # ends "cleanly" (no exception raised), so before this change nobody
    # found out. Also see the finish_reason/stop_reason check in
    # gemini.py/claude.py, which now warns in the chat if it really gets cut off.
    # 16384 (raised again from 8192) for long bank statements: each
    # create_transaction/create_debt proposed in the same turn (see
    # STATEMENT_INSTRUCTIONS in advisor.py) spends ~150-250 tokens of
    # response, so a statement with 30+ transactions can easily eat up the
    # previous limit. Also see THINKING_BUDGET_TOKENS in gemini.py:
    # gemini-flash-latest's internal "thinking" comes out of this SAME
    # limit if it isn't capped separately, and without that a heavy turn could
    # exhaust it entirely without writing anything visible (silent truncation).
    AI_MAX_TOKENS: int = 16384
    AI_RATE_LIMIT_PER_USER_DAY: int = 30

    # Email
    EMAIL_FROM: str = "noreply@finanzas.app"
    FRONTEND_URL: str = "http://localhost:5173"

    # Push notifications (M11) -- empty until a real Firebase project exists
    FIREBASE_CREDENTIALS_JSON: str = ""

    # Privacy disclaimer (see docs/legal/DISCLAIMER.md at the repo root --
    # the actual text shown in the app lives in frontend/src/lib/disclaimer.ts,
    # a deliberate copy, not a file read at runtime: the backend runs
    # in Docker with build context "./backend", docs/legal/DISCLAIMER.md
    # wouldn't even make it into that image). This version is the sole
    # source of truth for "what is the current version today" -- bump it (and
    # frontend/src/lib/disclaimer.ts's, they must match) every time the
    # legal content changes materially. Don't confuse this with
    # AI_PROVIDER/etc: this isn't infra config, it's versioned content.
    DISCLAIMER_VERSION: str = "2026-08-15"

    # App
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "console"


settings = Settings()
