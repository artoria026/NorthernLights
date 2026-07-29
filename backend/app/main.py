import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.core.config import settings
from app.core.logging import configure_logging
from app.routers import (
    accounts,
    admin,
    ai,
    auth,
    budget,
    bulk_import,
    categories,
    data,
    debts,
    engine,
    feedback,
    insights,
    notifications,
    recurring,
    reports,
    transactions,
)

configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
logger = structlog.get_logger(__name__)

app = FastAPI(title="App Finanzas Personales API", version="1.0.0")


class CatchAllExceptionMiddleware:
    """Una excepcion no capturada por ningun handler de FastAPI la procesa
    Starlette en ServerErrorMiddleware, que queda FUERA de CORSMiddleware --
    el navegador entonces reporta un falso error de CORS en vez del 500 real.
    Atajarla aqui (una capa de middleware normal, dentro de CORSMiddleware
    porque se registra antes) hace que la respuesta de error si pase por
    CORSMiddleware en su camino de vuelta.

    ASGI puro a proposito, NO `BaseHTTPMiddleware` (como era antes): ese subclase
    corre el resto del stack en un Task separado (via TaskGroup/memory stream)
    para poder darle a `dispatch` un `call_next()` con forma de funcion normal.
    Con un StreamingResponse de larga duracion (ej. /ai/chat, ver ai/advisor.py)
    esa frontera extra de Task es justo donde una desconexion del cliente (o
    un error del proveedor de IA que corta el generador a medio camino) puede
    disparar un `CancelledError` que golpea codigo de limpieza (cierre de la
    sesion de DB) fuera de lugar -- deja la conexion de asyncpg terminada a
    medias en vez de cerrada limpia, y esa conexion envenenada vuelve al pool
    para el siguiente request que le toque (bug real, visto en prod: un 503
    transitorio de Gemini en /ai/chat hizo que un /api/v1/categories sin
    relacion alguna fallara con "connection is closed" segundos despues).
    ASGI puro corre todo en el mismo Task que la request -- sin esa frontera,
    una cancelacion sigue las reglas normales de asyncio (se resuelve en el
    mismo `finally`/`async with` que ya la esperaba) en vez de cruzar Tasks."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("unhandled_exception", path=scope.get("path", ""))
            if response_started:
                # Ya se le mando algo al cliente (ej. headers de un SSE que
                # alcanzo a empezar) -- no se puede reemplazar por un
                # JSONResponse nuevo, los headers ya se fueron. Solo queda
                # loguearlo (arriba) y dejar la conexion terminar.
                return
            response = JSONResponse(
                status_code=500,
                content={
                    "error": "Ocurrio un error inesperado",
                    "code": "INTERNAL_ERROR",
                    "details": {},
                },
            )
            await response(scope, receive, send)


app.add_middleware(CatchAllExceptionMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATUS_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    500: "INTERNAL_ERROR",
}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            "code": _STATUS_CODES.get(exc.status_code, "ERROR"),
            "details": {},
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            {
                "error": "Error de validacion",
                "code": "VALIDATION_ERROR",
                "details": {"errors": exc.errors()},
            }
        ),
    )


@app.get("/health")
async def health() -> dict:
    return {"data": {"status": "ok"}}


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/api/v1/accounts", tags=["accounts"])
app.include_router(categories.router, prefix="/api/v1/categories", tags=["categories"])
app.include_router(transactions.router, prefix="/api/v1/transactions", tags=["transactions"])
app.include_router(debts.router, prefix="/api/v1/debts", tags=["debts"])
app.include_router(recurring.router, prefix="/api/v1/recurring-items", tags=["recurring"])
app.include_router(budget.router, prefix="/api/v1/budget", tags=["budget"])
app.include_router(engine.router, prefix="/api/v1/engine", tags=["engine"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["notifications"])
app.include_router(insights.router, prefix="/api/v1/insights", tags=["insights"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["ai"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["reports"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(data.router, prefix="/api/v1/data", tags=["data"])
app.include_router(bulk_import.router, prefix="/api/v1/bulk-import", tags=["bulk-import"])
app.include_router(feedback.router, prefix="/api/v1/feedback", tags=["feedback"])
