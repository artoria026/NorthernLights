import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient

from app.core.security import create_state_token
from app.services import google_auth_service

pytestmark = pytest.mark.asyncio


def _google_profile(**overrides) -> dict:
    profile = {
        "sub": str(uuid.uuid4()),
        "email": f"{uuid.uuid4()}@gmail.com",
        "name": "Google User",
        "email_verified": True,
    }
    profile.update(overrides)
    return profile


async def test_google_login_redirects_to_google_with_state(client: AsyncClient):
    response = await client.get("/api/v1/auth/google/login")
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    query = parse_qs(urlparse(location).query)
    assert query["response_type"] == ["code"]
    assert "state" in query


async def test_google_callback_user_cancelled_redirects_with_error(client: AsyncClient):
    response = await client.get("/api/v1/auth/google/callback?error=access_denied")
    assert response.status_code == 302
    assert "error=google_cancelled" in response.headers["location"]


async def test_google_callback_invalid_state_redirects_with_error(client: AsyncClient):
    response = await client.get("/api/v1/auth/google/callback?code=whatever&state=not-a-real-token")
    assert response.status_code == 302
    assert "error=invalid_state" in response.headers["location"]


async def test_google_callback_creates_new_user(client: AsyncClient, monkeypatch):
    profile = _google_profile()
    monkeypatch.setattr(google_auth_service, "exchange_code", lambda code: _async_return(profile))
    state = create_state_token()

    response = await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("http://localhost:5173/auth/callback?")
    query = parse_qs(urlparse(location).query)
    assert "access_token" in query
    assert "refresh_token" in query
    # Newly created account -- AuthCallback.tsx uses this to mark the
    # changelog as seen and not show the "What's New" modal to someone
    # who never used the app.
    assert query["is_new"] == ["1"]

    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {query['access_token'][0]}"}
    )
    assert me.json()["data"]["email"] == profile["email"]


async def test_google_callback_links_existing_email_user(client: AsyncClient, monkeypatch):
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Ada", "password": "supersecret123", "accept_disclaimer": True},
    )

    profile = _google_profile(email=email)
    monkeypatch.setattr(google_auth_service, "exchange_code", lambda code: _async_return(profile))
    state = create_state_token()

    response = await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")
    assert response.status_code == 302
    query = parse_qs(urlparse(response.headers["location"]).query)
    # Already existing account (registered by email before) -- it's not "new".
    assert "is_new" not in query

    # The original user can still log in with their usual password.
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "supersecret123"}
    )
    assert login.status_code == 200

    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {query['access_token'][0]}"}
    )
    assert me.json()["data"]["email"] == email


async def test_google_callback_creates_new_user_with_avatar(client: AsyncClient, monkeypatch):
    profile = _google_profile(picture="https://lh3.googleusercontent.com/a/foto-real.jpg")
    monkeypatch.setattr(google_auth_service, "exchange_code", lambda code: _async_return(profile))
    state = create_state_token()

    response = await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")
    query = parse_qs(urlparse(response.headers["location"]).query)

    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {query['access_token'][0]}"}
    )
    assert me.json()["data"]["avatar_url"] == profile["picture"]


async def test_google_callback_does_not_overwrite_manually_set_avatar(
    client: AsyncClient, monkeypatch
):
    profile = _google_profile(picture="https://lh3.googleusercontent.com/a/original.jpg")
    monkeypatch.setattr(google_auth_service, "exchange_code", lambda code: _async_return(profile))
    state = create_state_token()

    first = await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")
    token = parse_qs(urlparse(first.headers["location"]).query)["access_token"][0]

    # The user uploads their own photo in Settings.
    await client.put(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Google User", "avatar_url": "data:image/png;base64,aGVsbG8="},
    )

    # Logs in again via Google with a different photo on their real profile --
    # must not override the one the user already picked by hand.
    profile["picture"] = "https://lh3.googleusercontent.com/a/foto-nueva-de-google.jpg"
    second = await client.get(f"/api/v1/auth/google/callback?code=abc&state={create_state_token()}")
    token = parse_qs(urlparse(second.headers["location"]).query)["access_token"][0]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["avatar_url"] == "data:image/png;base64,aGVsbG8="


async def test_google_callback_unverified_email_rejected(client: AsyncClient, monkeypatch):
    profile = _google_profile(email_verified=False)
    monkeypatch.setattr(google_auth_service, "exchange_code", lambda code: _async_return(profile))
    state = create_state_token()

    response = await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")
    assert response.status_code == 302
    assert "error=google_exchange_failed" in response.headers["location"]


async def _async_return(value):
    return value
