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
    """An exception not caught by any FastAPI handler is processed by
    Starlette in ServerErrorMiddleware, which is OUTSIDE CORSMiddleware --
    the browser then reports a false CORS error instead of the real 500.
    Catching it here (a normal middleware layer, inside CORSMiddleware
    because it's registered before it) makes the error response actually
    pass through CORSMiddleware on its way back.

    Deliberately pure ASGI, NOT `BaseHTTPMiddleware` (like it was before):
    that subclass runs the rest of the stack in a separate Task (via
    TaskGroup/memory stream) so it can hand `dispatch` a `call_next()`
    shaped like a normal function. With a long-lived StreamingResponse
    (e.g. /ai/chat, see ai/advisor.py) that extra Task boundary is exactly
    where a client disconnect (or an AI provider error that cuts the
    generator off midway) can trigger a `CancelledError` that hits cleanup
    code (closing the DB session) at the wrong place -- it leaves the
    asyncpg connection half-finished instead of cleanly closed, and that
    poisoned connection goes back to the pool for whichever request gets
    it next (real bug, seen in prod: a transient 503 from Gemini in
    /ai/chat made an unrelated /api/v1/categories fail with "connection is
    closed" seconds later). Pure ASGI runs everything in the same Task as
    the request -- without that boundary, a cancellation follows asyncio's
    normal rules (resolved in the same `finally`/`async with` that was
    already awaiting it) instead of crossing Tasks."""

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
                # Something has already been sent to the client (e.g.
                # headers of an SSE that managed to start) -- it can't be
                # replaced by a new JSONResponse, the headers are already
                # gone. All that's left is logging it (above) and letting
                # the connection end.
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
