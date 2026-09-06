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
    # Not sent -> falls back to the column default, not None/empty.
    assert body["locale"] == "es"


async def test_register_with_locale_seeds_preference(client: AsyncClient):
    email = f"{uuid.uuid4()}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "name": "Ada Lovelace",
            "password": "supersecret123",
            "accept_disclaimer": True,
            "locale": "en",
        },
    )
    assert response.status_code == 201
    assert response.json()["data"]["locale"] == "en"


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
    """The refresh token is single-use: every /auth/refresh returns a new
    one and the old one stops working. Previously the backend rotated the token in the
    DB but never returned it to the client -- the client kept sending the
    old (now invalid) one on the next refresh and the session would silently die
    without warning on the second cycle. This tests the full flow, not just that
    it returns an access_token."""
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

    # Not even the correct password gets in while it's locked --
    # otherwise an attacker could use this to confirm the real password
    # once the attempts are exhausted, without resetting the counter.
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

    # The counter was reset -- 3 more failures still shouldn't lock
    # (the limit is 5).
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
    assert data["locale"] == "es"
    assert data["pay_cycle"] == "monthly"
    assert data["email_notifications"] is True
    assert data["push_notifications"] is True
    assert data["avatar_url"] is None
    # Off by default -- see the "debt without a plan" section in /debts.
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
    # What isn't sent doesn't change.
    assert data["email_notifications"] is True
    assert data["locale"] == "es"


async def test_update_settings_changes_locale(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/settings",
        headers=headers,
        json={"locale": "en"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["locale"] == "en"
    # What isn't sent doesn't change.
    assert data["theme"] == "dark"


async def test_update_settings_rejects_invalid_locale(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.put(
        "/api/v1/auth/settings",
        headers=headers,
        json={"locale": "fr"},
    )
    assert response.status_code == 422


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
    """DisclaimerGate (frontend) requires this before creating the account -- the
    form checkbox alone isn't enough, the backend validates it
    again (accept_disclaimer in RegisterRequest, see auth_service.register)."""
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
    """Simulates an account created BEFORE this feature existed
    (accepted_disclaimer_version=NULL) by writing it directly via DB -- this is
    truly what an already-existing account looks like today. DisclaimerGate would
    block it until it calls this endpoint."""
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

    # The account ends up deactivated and the session revoked: neither login nor refresh
    # work again.
    login_again = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert login_again.status_code == 403

    refresh_again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh_again.status_code == 401


async def test_unlink_google_requires_existing_password(client: AsyncClient):
    token = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    # This account was never linked to Google.
    response = await client.post("/api/v1/auth/google/unlink", headers=headers)
    assert response.status_code == 400
