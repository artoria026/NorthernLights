import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


class CurrentUser(BaseModel):
    id: UUID
    role: str


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def generate_secure_token() -> str:
    return secrets.token_urlsafe(64)


def hash_token(token: str) -> str:
    """SHA-256 alcanza para un secreto ya random de 64 bytes -- a diferencia
    de una contraseña (baja entropia, necesita bcrypt para resistir fuerza
    bruta), un refresh token de generate_secure_token() es imposible de
    adivinar sin importar que tan rapido sea el hash. Usado para no guardar
    devices.refresh_token en texto plano: una fuga de esa tabla ya no
    entrega sesiones activas listas para usar."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: UUID, role: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> CurrentUser:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido o expirado"
        ) from exc

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

    sub = payload.get("sub")
    role = payload.get("role")
    if sub is None or role is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

    return CurrentUser(id=UUID(sub), role=role)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    return decode_access_token(credentials.credentials)


async def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def create_state_token() -> str:
    """JWT de corta duracion (10 min) con un nonce aleatorio -- reemplaza la
    sesion de servidor de anti-CSRF clasica del flujo OAuth (la app es
    stateless). Se manda como `state` a Google y se valida al volver en
    /auth/google/callback."""
    payload = {
        "nonce": secrets.token_urlsafe(32),
        "exp": datetime.now(UTC) + timedelta(minutes=10),
        "purpose": "oauth_state",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_state_token(state: str) -> bool:
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload.get("purpose") == "oauth_state"
    except JWTError:
        return False
