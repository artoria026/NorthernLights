from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.user import User


async def active_user_ids() -> list:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User.id).where(User.is_active.is_(True)))
        return [row[0] for row in result.all()]
