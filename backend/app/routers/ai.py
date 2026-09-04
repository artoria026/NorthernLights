from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import advisor
from app.ai.pdf_utils import PdfPasswordError, strip_pdf_password
from app.core.config import settings
from app.core.database import get_rls_db
from app.core.redis import get_redis
from app.core.security import CurrentUser, get_current_user
from app.schemas.chat import AiUsageOut, ChatMessageOut
from app.schemas.common import Meta, SuccessResponse
from app.services import cache_service, chat_service

router = APIRouter()

# PDF bank statements attached to /ai/chat: explicit limits to avoid
# sending a giant batch to the model (cost/abuse) -- enough for several
# months of a credit card, not for "my whole banking history at once".
MAX_CHAT_ATTACHMENTS = 5
MAX_CHAT_ATTACHMENT_BYTES = 15 * 1024 * 1024


@router.get("/usage")
async def usage(
    current_user: CurrentUser = Depends(get_current_user),
) -> SuccessResponse:
    limit = settings.AI_RATE_LIMIT_PER_USER_DAY
    if current_user.role == "admin":
        return SuccessResponse(
            data=AiUsageOut(used_today=0, remaining_today=limit, limit_per_day=limit, unlimited=True)
        )
    redis = await get_redis()
    used, remaining = await cache_service.get_ai_rate_limit_status(redis, current_user.id, limit)
    return SuccessResponse(
        data=AiUsageOut(used_today=used, remaining_today=remaining, limit_per_day=limit)
    )


@router.post("/chat")
async def chat(
    message: str = Form(..., min_length=1, max_length=4000),
    pdf_password: str | None = Form(default=None),
    attachments: list[UploadFile] = File(default=[]),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    """multipart/form-data instead of JSON: allows attaching (optional) PDF
    bank statements from the same day-to-day chat -- see
    STATEMENT_INSTRUCTIONS in advisor.py. Without attachments, it behaves
    exactly the same as before, just that the body is no longer JSON."""
    if len(attachments) > MAX_CHAT_ATTACHMENTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Maximo {MAX_CHAT_ATTACHMENTS} archivos por mensaje"
        )

    # Decrypted here (not in advisor.chat) so we can return a clear 400 about
    # the password/size before opening the RLS session and spending a
    # daily rate-limit query on a file that couldn't even be read.
    # The PDF and password are never persisted to disk/logs.
    pdf_attachments: list[bytes] = []
    for upload in attachments:
        content = await upload.read()
        if len(content) > MAX_CHAT_ATTACHMENT_BYTES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"'{upload.filename}' pesa mas de "
                f"{MAX_CHAT_ATTACHMENT_BYTES // (1024 * 1024)}MB",
            )
        try:
            pdf_attachments.append(strip_pdf_password(content, pdf_password))
        except PdfPasswordError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{upload.filename}': {e}") from e

    redis = await get_redis()
    return StreamingResponse(
        advisor.chat(redis, current_user.id, message, current_user.role, pdf_attachments),
        media_type="text/event-stream",
    )


@router.get("/history")
async def get_history(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    messages, total = await chat_service.list_history(session, current_user.id, page, per_page)
    return SuccessResponse(
        data=[ChatMessageOut.model_validate(m) for m in messages],
        meta=Meta(total=total, page=page, per_page=per_page),
    )


@router.delete("/history")
async def delete_history(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await chat_service.clear_history(session, current_user.id)
    return SuccessResponse(data={"cleared": True})
