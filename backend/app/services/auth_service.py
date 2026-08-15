import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import raiseload

from app.core.config import settings
from app.core.redis import get_redis
from app.core.security import (
    create_access_token,
    generate_secure_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.user import Device, User, UserPreferences
from app.schemas.auth import (
    DeviceInfo,
    RegisterRequest,
    TokenPair,
    UpdateProfileRequest,
    UpdateSettingsRequest,
    UserOut,
)
from app.services import cache_service

REFRESH_TOKEN_EXPIRE_DAYS = 7
PASSWORD_RESET_TTL_SECONDS = 900


async def set_rls_user(session: AsyncSession, user_id: UUID) -> None:
    """Habilita RLS para el resto de esta transaccion una vez que ya sabemos
    quien es el usuario (p.ej. tras verificar password o token de reset)."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"), {"uid": str(user_id)}
    )


def build_user_out(user: User) -> UserOut:
    """UserOut mezcla identidad (`users`) y preferencias (`user_preferences`,
    tabla separada -- ver migracion f2a8c4e1d6b7). `user.preferences` viene
    precargada por el lazy="selectin" del modelo, no hace falta otra query."""
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        role=user.role,
        auth_provider=user.auth_provider,
        theme=user.preferences.theme,
        email_notifications=user.preferences.email_notifications,
        push_notifications=user.preferences.push_notifications,
        pay_cycle=user.preferences.pay_cycle,
        debt_trouble_mode=user.preferences.debt_trouble_mode,
        last_seen_changelog_version=user.preferences.last_seen_changelog_version,
        accepted_disclaimer_version=user.preferences.accepted_disclaimer_version,
        current_disclaimer_version=settings.DISCLAIMER_VERSION,
        created_at=user.created_at,
    )


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Usado solo en contextos PRE-autenticacion (register/login/forgot_password
    aca y el lookup de google_auth_service) -- en ese momento no se conoce
    ningun user_id todavia, asi que es imposible haber llamado set_rls_user().
    User.preferences es lazy="selectin" a nivel de modelo (carga sola en
    cualquier fetch de User), pero esa query en cascada SI choca contra la
    policy de RLS de user_preferences sin app.current_user_id seteado -- a
    diferencia del bug de insert en register()/resolve_user(), aca no hay
    forma de "setear el RLS mas temprano" porque el problema esta dentro de
    esta misma funcion, antes de que el caller pueda hacer nada. Ninguno de
    los call sites de este helper necesita `.preferences` (todos son checks
    de identidad/password), asi que se apaga ese loader puntual con
    raiseload en vez de dejar que la sub-query se dispare sola."""
    result = await session.execute(
        select(User).options(raiseload(User.preferences)).where(User.email == email)
    )
    return result.scalar_one_or_none()


async def register(session: AsyncSession, data: RegisterRequest) -> User:
    if await get_user_by_email(session, data.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "El email ya esta registrado")
    if not data.accept_disclaimer:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Debes aceptar el aviso de privacidad para crear una cuenta",
        )

    # id generado a mano (no confiar en el default=uuid.uuid4 de la columna):
    # ese default lo aplica el ORM recien al flushear el INSERT, asi que
    # user.id sigue siendo None hasta entonces -- si se le pasa None a
    # set_rls_user() abajo, `app.current_user_id` queda seteado como el
    # string "None" y la policy de user_preferences revienta con
    # "invalid input syntax for type uuid" en vez de dejar pasar el insert.
    # Mismo patron que budget_service (id=uuid4() explicito cuando hace
    # falta saber el id antes del flush).
    user = User(
        id=uuid4(),
        email=data.email,
        name=data.name,
        password_hash=hash_password(data.password),
        role="user",
        auth_provider="email",
        preferences=UserPreferences(accepted_disclaimer_version=settings.DISCLAIMER_VERSION),
    )
    # El insert en cascada de UserPreferences (FORCE ROW LEVEL SECURITY, ver
    # migracion 293528f67338) necesita app.current_user_id seteado para
    # pasar su policy -- sin esto el registro rompia con "new row violates
    # row-level security policy for table user_preferences" en cualquier rol
    # que no sea superuser/BYPASSRLS (no se veia en local porque el rol de
    # la app ahi es superuser, pero si en un Postgres de verdad -- bug
    # reportado en el primer deploy real).
    await set_rls_user(session, user.id)
    session.add(user)
    await session.flush()
    return user


async def issue_tokens_for_device(
    session: AsyncSession, user: User, device: DeviceInfo
) -> TokenPair:
    """Compartido por `login()` (email/password) y el callback de Google
    OAuth (M01 extendido) -- ambos terminan en el mismo par de tokens +
    registro/actualizacion del `Device`, la unica diferencia entre ellos es
    COMO se resolvio el `user` antes de llegar aqui."""
    await set_rls_user(session, user.id)

    refresh_token = generate_secure_token()
    expires_at = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    existing = await session.execute(
        select(Device).where(
            Device.user_id == user.id,
            Device.device_type == device.device_type,
            Device.device_name == device.device_name,
        )
    )
    device_row = existing.scalar_one_or_none()
    if device_row:
        device_row.refresh_token = hash_token(refresh_token)
        device_row.refresh_token_expires_at = expires_at
        device_row.push_token = device.push_token or device_row.push_token
        device_row.last_used_at = datetime.now(UTC)
        device_row.is_active = True
    else:
        session.add(
            Device(
                user_id=user.id,
                device_name=device.device_name,
                device_type=device.device_type,
                push_token=device.push_token,
                refresh_token=hash_token(refresh_token),
                refresh_token_expires_at=expires_at,
                last_used_at=datetime.now(UTC),
                is_active=True,
            )
        )

    access_token = create_access_token(user.id, user.role)
    return TokenPair(access_token=access_token, refresh_token=refresh_token)


async def login(session: AsyncSession, email: str, password: str, device: DeviceInfo) -> TokenPair:
    redis = await get_redis()
    if await cache_service.is_login_locked(redis, email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.",
        )

    user = await get_user_by_email(session, email)
    if user is None or user.password_hash is None:
        await cache_service.register_failed_login(redis, email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    if not verify_password(password, user.password_hash):
        await cache_service.register_failed_login(redis, email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cuenta desactivada")

    await cache_service.clear_failed_logins(redis, email)
    return await issue_tokens_for_device(session, user, device)


async def refresh(session: AsyncSession, refresh_token: str) -> TokenPair:
    """Rota el refresh token en cada uso (single-use): la fila en `devices`
    solo guarda su hash (ver hash_token), asi que la comparacion tambien es
    por hash. Devuelve el nuevo refresh token en texto plano al cliente --
    antes esta funcion lo rotaba en la DB pero solo devolvia el access_token
    nuevo, asi que el cliente seguia mandando el refresh token viejo (ya
    invalido) en el siguiente refresh y terminaba deslogueado sin aviso cada
    ~2x ACCESS_TOKEN_EXPIRE_MINUTES; ver api.ts en el frontend.

    Bug #4 de la familia RLS: este es el UNICO lookup de Device que no puede
    conocer el user_id de antemano (es literalmente el endpoint que se usa
    cuando el access token ya vencio) -- rls_devices (ver migracion
    a3d7af2c6426) tiene una clausula aparte para esto, habilitada seteando
    app.lookup_refresh_token con el hash que se esta buscando antes de la
    query. logout()/logout_all() no necesitan esto: ya conocen el user_id
    de un access token valido antes de tocar `devices`."""
    hashed = hash_token(refresh_token)
    await session.execute(
        text("SELECT set_config('app.lookup_refresh_token', :t, true)"), {"t": hashed}
    )
    result = await session.execute(select(Device).where(Device.refresh_token == hashed))
    device = result.scalar_one_or_none()
    if device is None or not device.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesion invalida")
    if device.refresh_token_expires_at and device.refresh_token_expires_at < datetime.now(UTC):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesion expirada")

    user_result = await session.execute(select(User).where(User.id == device.user_id))
    user = user_result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesion invalida")

    await set_rls_user(session, user.id)
    new_refresh_token = generate_secure_token()
    device.refresh_token = hash_token(new_refresh_token)
    device.refresh_token_expires_at = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    device.last_used_at = datetime.now(UTC)

    access_token = create_access_token(user.id, user.role)
    return TokenPair(access_token=access_token, refresh_token=new_refresh_token)


async def logout(session: AsyncSession, user_id: UUID, refresh_token: str) -> None:
    await set_rls_user(session, user_id)
    result = await session.execute(
        select(Device).where(
            Device.refresh_token == hash_token(refresh_token), Device.user_id == user_id
        )
    )
    device = result.scalar_one_or_none()
    if device:
        device.is_active = False
        device.refresh_token = None


async def logout_all(session: AsyncSession, user_id: UUID) -> None:
    await set_rls_user(session, user_id)
    result = await session.execute(select(Device).where(Device.user_id == user_id))
    for device in result.scalars():
        device.is_active = False
        device.refresh_token = None


async def change_password(
    session: AsyncSession, user_id: UUID, current_password: str, new_password: str
) -> None:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    if user.password_hash is None or not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password actual incorrecto")
    user.password_hash = hash_password(new_password)


async def forgot_password(session: AsyncSession, email: str) -> None:
    user = await get_user_by_email(session, email)
    if user is None or user.password_hash is None:
        return  # No revelar si el email existe o es cuenta OAuth

    token = secrets.token_urlsafe(32)
    redis = await get_redis()
    await redis.set(f"pwd_reset:{token}", str(user.id), ex=PASSWORD_RESET_TTL_SECONDS)
    # Fase 4 (pendiente, ver Notion): sin proveedor de email real conectado
    # (app.tasks.email.send_email es un stub que solo loguea), el token nunca
    # le llega al usuario -- y el frontend tampoco expone todavia una pantalla
    # de "olvide mi password" que llame a este endpoint. El backend queda listo
    # (token + /auth/reset-password funcionan de punta a punta) para cuando se
    # conecte un proveedor real; falta ese proveedor y la pantalla en el front.


async def reset_password(session: AsyncSession, token: str, new_password: str) -> None:
    redis = await get_redis()
    redis_key = f"pwd_reset:{token}"
    user_id_raw = await redis.get(redis_key)
    if not user_id_raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Token invalido o expirado")

    user_id = UUID(user_id_raw)
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Token invalido o expirado")

    user.password_hash = hash_password(new_password)
    await redis.delete(redis_key)
    await logout_all(session, user.id)


async def update_profile(session: AsyncSession, user_id: UUID, data: UpdateProfileRequest) -> User:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await session.flush()
    return user


async def update_settings(
    session: AsyncSession, user_id: UUID, data: UpdateSettingsRequest
) -> User:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user.preferences, field, value)
    await session.flush()
    return user


async def accept_disclaimer(session: AsyncSession, user_id: UUID) -> User:
    """A diferencia de update_settings, este NO acepta el valor desde el
    cliente -- lo estampa el propio servidor con settings.DISCLAIMER_VERSION.
    Es un campo de cumplimiento (DisclaimerGate bloquea la app entera hasta
    que coincida), no una preferencia de UI como last_seen_changelog_version."""
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    user.preferences.accepted_disclaimer_version = settings.DISCLAIMER_VERSION
    await session.flush()
    return user


async def unlink_google(session: AsyncSession, user_id: UUID) -> User:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    if user.google_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta cuenta no esta vinculada a Google")
    if user.password_hash is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No puedes desvincular Google: es tu unica forma de entrar a la cuenta",
        )
    user.google_id = None
    user.auth_provider = "email"
    await session.flush()
    return user


async def delete_account(session: AsyncSession, user_id: UUID, password: str | None) -> None:
    """Baja logica (deleted_at), no borra la fila -- mismo patron que
    accounts/categories/debts. Revoca todas las sesiones activas. Pide la
    contrasena actual como confirmacion solo si el usuario tiene una (las
    cuentas solo-Google no tienen nada que verificar aqui)."""
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    if user.password_hash is not None:
        if not password or not verify_password(password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Contraseña incorrecta")

    await logout_all(session, user.id)
    user.is_active = False
    user.deleted_at = datetime.now(UTC)


async def register_device(session: AsyncSession, user_id: UUID, device: DeviceInfo) -> Device:
    await set_rls_user(session, user_id)
    existing = await session.execute(
        select(Device).where(
            Device.user_id == user_id,
            Device.device_type == device.device_type,
            Device.device_name == device.device_name,
        )
    )
    device_row = existing.scalar_one_or_none()
    if device_row:
        device_row.push_token = device.push_token
        device_row.last_used_at = datetime.now(UTC)
        return device_row

    device_row = Device(
        user_id=user_id,
        device_name=device.device_name,
        device_type=device.device_type,
        push_token=device.push_token,
        last_used_at=datetime.now(UTC),
    )
    session.add(device_row)
    await session.flush()
    return device_row


async def list_devices(session: AsyncSession, user_id: UUID) -> list[Device]:
    await set_rls_user(session, user_id)
    result = await session.execute(
        select(Device).where(Device.user_id == user_id, Device.is_active.is_(True))
    )
    return list(result.scalars().all())


async def revoke_device(session: AsyncSession, user_id: UUID, device_id: UUID) -> None:
    await set_rls_user(session, user_id)
    result = await session.execute(
        select(Device).where(Device.id == device_id, Device.user_id == user_id)
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dispositivo no encontrado")
    device.is_active = False
    device.refresh_token = None
