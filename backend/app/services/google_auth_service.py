from uuid import uuid4

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User, UserPreferences
from app.services import auth_service

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


async def exchange_code(code: str) -> dict:
    """Intercambia el `code` de un solo uso por el perfil del usuario en
    Google. Dos llamadas HTTP directas via httpx -- no hace falta authlib
    para esto, el flujo real son dos POST/GET planos."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if token_response.status_code != 200:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "No se pudo validar el codigo de Google"
            )
        google_access_token = token_response.json()["access_token"]

        userinfo_response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )
        if userinfo_response.status_code != 200:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "No se pudo obtener el perfil de Google"
            )
        return userinfo_response.json()


async def resolve_user(session: AsyncSession, google_user: dict) -> tuple[User, bool]:
    """Tres casos: ya vinculado (login directo), email existente sin vincular
    (se vincula sin avisar -- puede entrar con cualquiera de los dos metodos
    desde ahora), o usuario nuevo (sin password, solo puede entrar por
    Google). Rechaza email no verificado por Google en cualquier caso.

    El segundo elemento de la tupla es `is_new` -- el router lo manda como
    query param al frontend (`&is_new=1`) para que AuthCallback marque el
    changelog como visto en cuentas recien creadas (ver ChangelogButton.tsx);
    sin esto una cuenta de Google recien creada veria el modal de "Novedades"
    en su primer login, igual que se corrigio para el registro por email."""
    if not google_user.get("email_verified", False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El email de Google no esta verificado")

    sub = google_user["sub"]
    email = google_user["email"]
    name = google_user.get("name") or email.split("@")[0]
    picture = google_user.get("picture")

    result = await session.execute(select(User).where(User.google_id == sub))
    user = result.scalar_one_or_none()
    if user is not None:
        # Solo autocompleta si el usuario nunca puso una foto propia -- no le
        # pisamos una que haya subido a mano en Configuracion.
        if user.avatar_url is None and picture:
            user.avatar_url = picture
            await session.flush()
        return user, False

    user = await auth_service.get_user_by_email(session, email)
    if user is not None:
        user.google_id = sub
        if user.avatar_url is None and picture:
            user.avatar_url = picture
        await session.flush()
        return user, False

    # id generado a mano -- ver el comentario largo en auth_service.register:
    # el default=uuid.uuid4 de la columna solo se aplica al flushear, asi que
    # user.id seguiria siendo None si se lo pasaramos a set_rls_user antes
    # del insert sin generarlo nosotros primero.
    user = User(
        id=uuid4(),
        email=email,
        name=name,
        avatar_url=picture,
        password_hash=None,
        role="user",
        auth_provider="google",
        google_id=sub,
        is_active=True,
        preferences=UserPreferences(),
    )
    # Mismo fix que auth_service.register(): el insert en cascada de
    # UserPreferences necesita app.current_user_id seteado para pasar su
    # policy de RLS (FORCE ROW LEVEL SECURITY).
    await auth_service.set_rls_user(session, user.id)
    session.add(user)
    await session.flush()
    return user, True
