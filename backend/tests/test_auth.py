import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_token
from app.models.user import Device, User

pytestmark = pytest.mark.asyncio


async def test_register_creates_user(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada Lovelace", "password": "supersecret123", "accept_disclaimer": True},
    )
    assert response.status_code == 201
    body = response.json()["data"]
    assert body["email"] == email
    assert body["role"] == "user"


async def test_register_duplicate_email_conflicts(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    payload = {"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True}
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409


async def test_login_returns_token_pair(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    response = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["access_token"]
    assert body["refresh_token"]


async def test_login_wrong_password_unauthorized(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    response = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert response.status_code == 401


async def test_refresh_rotates_token(client: AsyncClient):
    """El refresh token es de un solo uso: cada /auth/refresh devuelve uno
    nuevo y el viejo deja de servir. Antes el backend rotaba el token en la
    DB pero nunca se lo devolvia al cliente -- el cliente seguia mandando el
    viejo (ya invalido) en el proximo refresh y la sesion moria sola sin
    aviso al segundo ciclo. Esto prueba el flujo completo, no solo que
    devuelva un access_token."""
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    first_refresh_token = login.json()["data"]["refresh_token"]

    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first_refresh_token}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["access_token"]
    second_refresh_token = data["refresh_token"]
    assert second_refresh_token
    assert second_refresh_token != first_refresh_token

    reused = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first_refresh_token}
    )
    assert reused.status_code == 401

    again = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": second_refresh_token}
    )
    assert again.status_code == 200


async def test_refresh_token_is_stored_hashed(client: AsyncClient, session_factory):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    plaintext_token = login.json()["data"]["refresh_token"]
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {login.json()['data']['access_token']}"},
    )
    user_id = uuid.UUID(me.json()["data"]["id"])

    async with session_factory() as session:
        result = await session.execute(select(Device).where(Device.user_id == user_id))
        device = result.scalar_one()
        assert device.refresh_token != plaintext_token
        assert device.refresh_token == hash_token(plaintext_token)


async def test_logout_revokes_refresh_token(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    tokens = login.json()["data"]

    logout = await client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert logout.status_code == 200

    refresh_after_logout = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refresh_after_logout.status_code == 401


async def test_login_locks_after_too_many_failed_attempts(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )

    for _ in range(5):
        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
        )
        assert response.status_code == 401

    locked = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert locked.status_code == 429

    # Ni siquiera con la contraseña correcta entra mientras esta bloqueado --
    # si no, un atacante podria usar esto para confirmar la contraseña real
    # una vez agotados los intentos, sin resetear el contador.
    still_locked = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert still_locked.status_code == 429


async def test_successful_login_clears_failed_attempts(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )

    for _ in range(3):
        await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"})

    ok = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert ok.status_code == 200

    # El contador se reinicio -- 3 fallos mas todavia no deberian bloquear
    # (el limite es 5).
    for _ in range(3):
        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong"}
        )
        assert response.status_code == 401


async def test_protected_route_without_token_is_401(client: AsyncClient):
    response = await client.get("/api/v1/accounts")
    assert response.status_code == 401


async def test_me_returns_current_user(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    access_token = login.json()["data"]["access_token"]

    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert response.status_code == 200
    assert response.json()["data"]["email"] == email


async def _register_and_login(client: AsyncClient) -> str:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    return login.json()["data"]["access_token"]


async def test_new_user_gets_default_preferences(client: AsyncClient):
    token = await _register_and_login(client)
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    data = me.json()["data"]
    assert data["theme"] == "dark"
    assert data["pay_cycle"] == "monthly"
    assert data["email_notifications"] is True
    assert data["push_notifications"] is True
    assert data["avatar_url"] is None
    # Apagado por defecto -- ver seccion "deuda sin plan" en /debts.
    assert data["debt_trouble_mode"] is False


async def test_update_settings_changes_theme_and_pay_cycle(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/settings",
        headers=headers,
        json={"theme": "light", "pay_cycle": "biweekly"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["theme"] == "light"
    assert data["pay_cycle"] == "biweekly"
    # Lo que no se manda no cambia.
    assert data["email_notifications"] is True


async def test_update_settings_toggles_debt_trouble_mode(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/settings",
        headers=headers,
        json={"debt_trouble_mode": True},
    )
    assert response.status_code == 200
    assert response.json()["data"]["debt_trouble_mode"] is True


async def test_new_account_has_no_seen_changelog_version(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["data"]["last_seen_changelog_version"] is None


async def test_update_settings_marks_changelog_version_as_seen(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/settings",
        headers=headers,
        json={"last_seen_changelog_version": "2026.08.0"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["last_seen_changelog_version"] == "2026.08.0"

    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["data"]["last_seen_changelog_version"] == "2026.08.0"


async def test_register_without_accepting_disclaimer_rejected(client: AsyncClient):
    """DisclaimerGate (frontend) exige esto antes de crear la cuenta -- el
    checkbox del formulario no alcanza por si solo, el backend lo valida de
    nuevo (accept_disclaimer en RegisterRequest, ver auth_service.register)."""
    email = f"{uuid.uuid4()}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123"},
    )
    assert response.status_code == 400
    assert "aviso de privacidad" in response.json()["error"]

    explicit_false = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "name": "Ada",
            "password": "supersecret123",
            "accept_disclaimer": False,
        },
    )
    assert explicit_false.status_code == 400


async def test_register_stamps_current_disclaimer_version(client: AsyncClient):
    token = await _register_and_login(client)
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    data = me.json()["data"]
    assert data["accepted_disclaimer_version"] == settings.DISCLAIMER_VERSION
    assert data["current_disclaimer_version"] == settings.DISCLAIMER_VERSION


async def test_accept_disclaimer_updates_existing_user(client: AsyncClient, session_factory):
    """Simula una cuenta creada ANTES de que existiera esta feature
    (accepted_disclaimer_version=NULL) escribiendolo directo por DB -- asi es
    como se ve de verdad una cuenta ya existente hoy. DisclaimerGate la
    bloquearia hasta que llame a este endpoint."""
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    user_id = uuid.UUID(me.json()["data"]["id"])

    async with session_factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one()
        user.preferences.accepted_disclaimer_version = None
        await session.commit()

    stale = await client.get("/api/v1/auth/me", headers=headers)
    assert stale.json()["data"]["accepted_disclaimer_version"] is None

    accepted = await client.post("/api/v1/auth/accept-disclaimer", headers=headers)
    assert accepted.status_code == 200
    assert accepted.json()["data"]["accepted_disclaimer_version"] == settings.DISCLAIMER_VERSION

    refreshed = await client.get("/api/v1/auth/me", headers=headers)
    assert refreshed.json()["data"]["accepted_disclaimer_version"] == settings.DISCLAIMER_VERSION


async def test_update_profile_sets_avatar(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/me",
        headers=headers,
        json={"name": "Ada", "avatar_url": "data:image/png;base64,aGVsbG8="},
    )
    assert response.status_code == 200
    assert response.json()["data"]["avatar_url"] == "data:image/png;base64,aGVsbG8="


async def test_delete_account_requires_correct_password(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    token = login.json()["data"]["access_token"]
    refresh_token = login.json()["data"]["refresh_token"]
    headers = {"Authorization": f"Bearer {token}"}

    wrong = await client.request(
        "DELETE", "/api/v1/auth/me", headers=headers, json={"password": "not-it"}
    )
    assert wrong.status_code == 401

    right = await client.request(
        "DELETE", "/api/v1/auth/me", headers=headers, json={"password": "supersecret123"}
    )
    assert right.status_code == 200

    # La cuenta queda desactivada y la sesion revocada: ni login ni refresh
    # vuelven a funcionar.
    login_again = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert login_again.status_code == 403

    refresh_again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh_again.status_code == 401


async def test_unlink_google_requires_existing_password(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    # Esta cuenta nunca se vinculo a Google.
    response = await client.post("/api/v1/auth/google/unlink", headers=headers)
    assert response.status_code == 400
