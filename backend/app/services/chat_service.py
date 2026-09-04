from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_message import ChatMessage


async def get_recent_messages(
    session: AsyncSession, user_id: UUID, limit_pairs: int = 10
) -> list[ChatMessage]:
    """Last `limit_pairs` user/assistant pairs, in chronological order, to
    build the context sent to the model (M10 rule #3)."""
    result = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit_pairs * 2)
    )
    messages = list(result.scalars().all())
    messages.reverse()
    return messages


async def list_history(
    session: AsyncSession, user_id: UUID, page: int = 1, per_page: int = 20
) -> tuple[list[ChatMessage], int]:
    query = select(ChatMessage).where(ChatMessage.user_id == user_id)
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar_one()
    query = (
        query.order_by(ChatMessage.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    result = await session.execute(query)
    return list(result.scalars().all()), total


async def save_message(
    session: AsyncSession,
    user_id: UUID,
    role: str,
    content: str,
    *,
    tool_calls: list[dict] | None = None,
    tokens_used: int | None = None,
    ai_provider: str | None = None,
) -> ChatMessage:
    message = ChatMessage(
        user_id=user_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        tokens_used=tokens_used,
        ai_provider=ai_provider,
    )
    session.add(message)
    await session.flush()
    return message


async def clear_history(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(ChatMessage).where(ChatMessage.user_id == user_id))
    await session.flush()
