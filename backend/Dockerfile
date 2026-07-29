# Backend FastAPI — imagen unica reutilizada por 3 servicios en docker-compose.yml
# (backend, celery-worker, celery-beat), cada uno con su propio `command:`.
# Migraciones (alembic upgrade head) corren SOLO en el CMD del servicio
# `backend` para evitar que los 3 contenedores compitan por migrar a la vez.
FROM python:3.12-slim

WORKDIR /app

# libpq5: cliente nativo de Postgres que necesita asyncpg/psycopg en runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Instala dependencias en una capa separada del codigo — cache de Docker no
# se invalida por cambios en app/ mientras pyproject.toml/uv.lock no cambien.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"]
