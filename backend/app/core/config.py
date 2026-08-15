from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Base de datos
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

    # Google OAuth (M01 extendido) -- vacios hasta crear un proyecto real en
    # Google Cloud Console; sin GOOGLE_CLIENT_ID/SECRET, /auth/google/login
    # redirige a una URL de Google que rechaza la solicitud (no rompe el
    # resto de la app, solo ese flujo no funciona)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    # AI Provider
    AI_PROVIDER: str = "gemini"
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_AI_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    GEMINI_MODEL: str = "gemini-flash-latest"
    # 1024 se quedaba corto para el chat normal (ver STATEMENT_INSTRUCTIONS en
    # advisor.py): pedirle que enumere cada movimiento de un estado de cuenta
    # de varias paginas cortaba la respuesta a la mitad, sin tool-call de
    # confirmacion despues y sin ningun error -- el stream del proveedor
    # termina "bien" (no lanza excepcion), asi que antes de este cambio nadie
    # se enteraba. Ver tambien el chequeo de finish_reason/stop_reason en
    # gemini.py/claude.py, que ahora avisa en el chat si de verdad se corta.
    # 8192 (subido otra vez de 4096) para estados de cuenta largos -- ambos
    # modelos configurados (gemini-flash-latest, claude-sonnet-4-6) soportan
    # esto sin problema como limite de tokens de SALIDA.
    AI_MAX_TOKENS: int = 8192
    AI_RATE_LIMIT_PER_USER_DAY: int = 30

    # Email
    EMAIL_FROM: str = "noreply@finanzas.app"
    FRONTEND_URL: str = "http://localhost:5173"

    # Push notifications (M11) -- vacio hasta que exista un proyecto Firebase real
    FIREBASE_CREDENTIALS_JSON: str = ""

    # Aviso de privacidad (ver DISCLAIMER.md en la raiz del repo -- el texto
    # real que se muestra en la app vive en frontend/src/lib/disclaimer.ts,
    # una copia deliberada, no un archivo leido en runtime: el backend corre
    # en Docker con contexto de build "./backend", DISCLAIMER.md en la raiz
    # del repo ni siquiera entraria a esa imagen). Esta version es la unica
    # fuente de verdad de "cual es la version vigente hoy" -- subela (y la de
    # frontend/src/lib/disclaimer.ts, deben coincidir) cada vez que el
    # contenido legal cambie de forma material. No confundir con
    # AI_PROVIDER/etc: esto no es config de infra, es contenido versionado.
    DISCLAIMER_VERSION: str = "2026-08-15"

    # App
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "console"


settings = Settings()
