import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import advisor
from app.ai.attachments import MAX_CHAT_ATTACHMENTS, AttachmentError, prepare_attachments
from app.core.config import settings
from app.core.database import get_rls_db
from app.core.redis import get_redis
from app.core.security import CurrentUser, get_current_user
from app.schemas.chat import AiUsageOut, ChatMessageOut, ProposalOut
from app.schemas.common import Meta, SuccessResponse
from app.services import cache_service, chat_service, proposal_service

router = APIRouter()



def _parse_file_passwords(raw: str | None, count: int) -> list[str | None]:
    """`file_passwords` is a JSON array aligned with `attachments`: the password of
    each file, or null for the ones that don't have one."""
    if not raw:
        return []
    try:
        passwords = json.loads(raw)
    except ValueError:
        passwords = None
    if (
        not isinstance(passwords, list)
        or len(passwords) != count
        or not all(p is None or isinstance(p, str) for p in passwords)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "file_passwords debe ser una lista JSON con una contraseña (o null) por archivo",
        )
    return passwords


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
    file_passwords: str | None = Form(default=None),
    attachments: list[UploadFile] = File(default=[]),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    """multipart/form-data instead of JSON: lets the day-to-day chat carry
    attachments -- PDF bank statements and screenshots (see attachments.py) --
    optional. Without attachments it behaves exactly like a plain message.

    Each encrypted PDF is opened with ITS password (`file_passwords`, aligned with
    `attachments`; `pdf_password` stays as a fallback for all of them). Images and
    plain PDFs never need one."""
    if len(attachments) > MAX_CHAT_ATTACHMENTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Maximo {MAX_CHAT_ATTACHMENTS} archivos por mensaje"
        )
    passwords = _parse_file_passwords(file_passwords, len(attachments))

    # Read and checked here (not in advisor.chat) so a clear 400 about the file or
    # its password comes back before opening the RLS session and spending a daily
    # rate-limit query on something that couldn't even be read. The files and the
    # passwords are never persisted to disk or logs.
    try:
        prepared = await prepare_attachments(attachments, passwords, pdf_password)
    except AttachmentError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={
                "error": e.message,
                "code": e.code,
                "details": {"filename": e.filename, "index": e.index},
            },
        ) from e

    redis = await get_redis()
    return StreamingResponse(
        advisor.chat(redis, current_user.id, message, current_user.role, prepared),
        media_type="text/event-stream",
    )


@router.post("/proposals/{proposal_id}/confirm")
async def confirm_proposal(
    proposal_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    """The user confirmed what the advisor proposed: the server runs the stored items,
    all or nothing. Answers 200 with the proposal and its `status` (confirmed, or
    failed/cancelled/expired when it could not be confirmed) -- a status problem is
    not an HTTP error, so the state we recorded is kept."""
    proposal = await proposal_service.confirm_proposal(
        session, current_user.id, proposal_id, current_user.role
    )
    return SuccessResponse(data=_proposal_out(proposal))


@router.post("/proposals/{proposal_id}/cancel")
async def cancel_proposal(
    proposal_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    proposal = await proposal_service.cancel_proposal(session, current_user.id, proposal_id)
    return SuccessResponse(data=_proposal_out(proposal))


def _proposal_out(proposal) -> ProposalOut:
    return ProposalOut(
        id=proposal.id,
        status=proposal_service.effective_status(proposal),
        summary=proposal.summary,
        items=[{"action": i["action"], "fields": i["fields"]} for i in proposal.items],
        error=proposal.error,
        created_at=proposal.created_at,
        resolved_at=proposal.resolved_at,
    )


@router.get("/history")
async def get_history(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    messages, total = await chat_service.list_history(session, current_user.id, page, per_page)
    # A proposal's stored result only knows it was pending when it was made: show each
    # one with its status now (confirmed, cancelled...).
    proposals = await proposal_service.load_proposals(
        session, current_user.id, proposal_service.proposal_ids_in(messages)
    )
    data = []
    for m in messages:
        item = ChatMessageOut.model_validate(m)
        item.tool_calls = proposal_service.annotate_tool_calls(m.tool_calls, proposals)
        data.append(item)
    return SuccessResponse(data=data, meta=Meta(total=total, page=page, per_page=per_page))


@router.delete("/history")
async def delete_history(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await chat_service.clear_history(session, current_user.id)
    return SuccessResponse(data={"cleared": True})
