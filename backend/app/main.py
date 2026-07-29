import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

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

app = FastAPI(title="App Finanzas Personales API", version="0.1.0")


class CatchAllExceptionMiddleware(BaseHTTPMiddleware):
    """Una excepcion no capturada por ningun handler de FastAPI la procesa
    Starlette en ServerErrorMiddleware, que queda FUERA de CORSMiddleware --
    el navegador entonces reporta un falso error de CORS en vez del 500 real.
    Atajarla aqui (una capa de middleware normal, dentro de CORSMiddleware
    porque se registra antes) hace que la respuesta de error si pase por
    CORSMiddleware en su camino de vuelta."""

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("unhandled_exception", path=request.url.path)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Ocurrio un error inesperado",
                    "code": "INTERNAL_ERROR",
                    "details": {},
                },
            )


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
