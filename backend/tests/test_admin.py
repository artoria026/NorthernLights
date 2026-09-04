import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

pytestmark = pytest.mark.asyncio

_PASSWORD = "supersecret123"


async def _register_and_login(client: AsyncClient, name: str = "Test") -> tuple[str, str]:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register", json={"email": email, "name": name, "password": _PASSWORD, "accept_disclaimer": True}
    )
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    token = login.json()["data"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    return token, me.json()["data"]["id"], me.json()["data"]["email"]


async def _register_admin(client: AsyncClient, session_factory) -> tuple[dict, str]:
    """Registers a normal user, promotes them to admin by writing the role
    directly in the same transaction as `client` (there is no
    self-promotion endpoint, on purpose), and logs in again: the JWT issued at
    registration already carries `role=user` fixed, promoting the user doesn't update
    tokens issued before the change."""
    _, user_id, email = await _register_and_login(client, name="Admin")
    async with session_factory() as session:
        await session.execute(
            text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": user_id}
        )
        await session.commit()

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}, user_id


async def test_only_admin_can_list_users(client: AsyncClient):
    token, _, _ = await _register_and_login(client)
    response = await client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


async def test_admin_lists_users_with_counts(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)

    other_token, _, _ = await _register_and_login(client, name="Otro")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    await client.post(
        "/api/v1/accounts",
        headers=other_headers,
        json={"name": "Cuenta", "type": "asset", "subtype": "checking", "initial_balance": "100"},
    )

    response = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] >= 2
    assert any(u["accounts_count"] == 1 for u in body["data"])


async def test_admin_cannot_deactivate_self(client: AsyncClient, session_factory):
    admin_headers, admin_id = await _register_admin(client, session_factory)
    response = await client.patch(
        f"/api/v1/admin/users/{admin_id}/active", headers=admin_headers, json={"is_active": False}
    )
    assert response.status_code == 400


async def test_admin_can_deactivate_other_user(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)
    _, other_id, _ = await _register_and_login(client, name="Otro")

    response = await client.patch(
        f"/api/v1/admin/users/{other_id}/active", headers=admin_headers, json={"is_active": False}
    )
    assert response.status_code == 200
    assert response.json()["data"]["is_active"] is False


async def test_admin_cannot_remove_own_admin_role(client: AsyncClient, session_factory):
    admin_headers, admin_id = await _register_admin(client, session_factory)
    response = await client.patch(
        f"/api/v1/admin/users/{admin_id}/role", headers=admin_headers, json={"role": "user"}
    )
    assert response.status_code == 400


async def test_admin_can_promote_another_user(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)
    _, other_id, _ = await _register_and_login(client, name="Otro")

    response = await client.patch(
        f"/api/v1/admin/users/{other_id}/role", headers=admin_headers, json={"role": "admin"}
    )
    assert response.status_code == 200
    assert response.json()["data"]["role"] == "admin"


async def test_admin_stats_reflects_real_counts(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)
    response = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert response.status_code == 200
    stats = response.json()["data"]
    assert stats["total_users"] >= 1
    assert stats["admin_users"] >= 1


async def test_admin_lists_last_active_from_login(client: AsyncClient, session_factory):
    """The login in _register_and_login already creates/updates a Device -- that's
    enough to confirm that last_active_at doesn't stay null after logging in,
    without having to insert a Device by hand."""
    admin_headers, _ = await _register_admin(client, session_factory)
    _, other_id, _ = await _register_and_login(client, name="Otro")

    response = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert response.status_code == 200
    users = {u["id"]: u for u in response.json()["data"]}
    assert users[other_id]["last_active_at"] is not None


async def test_admin_lists_health_score_without_leaking_components(
    client: AsyncClient, session_factory
):
    """The composite score (0-100) does go in the response -- its components
    (DTI, savings rate, etc., which do describe the user's real
    financial situation) must never appear in AdminUserOut."""
    admin_headers, _ = await _register_admin(client, session_factory)
    _, other_id, _ = await _register_and_login(client, name="Otro")

    response = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert response.status_code == 200
    users = {u["id"]: u for u in response.json()["data"]}
    other = users[other_id]
    assert 0 <= other["health_score"] <= 100
    assert "components" not in other
    assert "dti" not in other


async def test_admin_users_search_filters_by_name_or_email(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)
    unique = uuid.uuid4().hex[:10]
    name = f"Buscable-{unique}"
    _, target_id, email = await _register_and_login(client, name=name)

    by_name = await client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"search": unique}
    )
    assert by_name.status_code == 200
    assert by_name.json()["meta"]["total"] == 1
    assert by_name.json()["data"][0]["id"] == target_id

    by_email = await client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"search": email}
    )
    assert by_email.status_code == 200
    assert by_email.json()["meta"]["total"] == 1
    assert by_email.json()["data"][0]["id"] == target_id

    no_match = await client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"search": "no-existe-nadie-asi"}
    )
    assert no_match.json()["meta"]["total"] == 0
    assert no_match.json()["data"] == []


async def test_admin_reset_password_allows_login_with_temporary_password(
    client: AsyncClient, session_factory
):
    admin_headers, _ = await _register_admin(client, session_factory)
    _, other_id, other_email = await _register_and_login(client, name="Olvidadizo")

    response = await client.post(
        f"/api/v1/admin/users/{other_id}/reset-password", headers=admin_headers
    )
    assert response.status_code == 200
    temp_password = response.json()["data"]["temporary_password"]
    assert len(temp_password) >= 12

    # The old password no longer works.
    old_login = await client.post(
        "/api/v1/auth/login", json={"email": other_email, "password": _PASSWORD}
    )
    assert old_login.status_code == 401

    # The temporary one does work -- confirms that the stored hash is real and
    # usable, not just that the endpoint responded 200.
    new_login = await client.post(
        "/api/v1/auth/login", json={"email": other_email, "password": temp_password}
    )
    assert new_login.status_code == 200


async def test_admin_excludes_soft_deleted_users(client: AsyncClient, session_factory):
    """A deleted account (DELETE /auth/me, soft-delete via deleted_at) must not
    keep counting in total_users or appear in the list -- without this
    filter, "Total users" could only ever grow forever."""
    admin_headers, _ = await _register_admin(client, session_factory)

    before = await client.get("/api/v1/admin/stats", headers=admin_headers)
    total_before = before.json()["data"]["total_users"]

    token, target_id, _ = await _register_and_login(client, name="Se borra")
    target_headers = {"Authorization": f"Bearer {token}"}
    delete_resp = await client.request(
        "DELETE", "/api/v1/auth/me", headers=target_headers, json={"password": _PASSWORD}
    )
    assert delete_resp.status_code == 200

    after = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert after.json()["data"]["total_users"] == total_before

    users = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert target_id not in [u["id"] for u in users.json()["data"]]


async def test_admin_stats_counts_distinct_users_with_accounts(
    client: AsyncClient, session_factory
):
    """Two accounts belonging to the same user must count as 1 in
    users_with_accounts, not 2 -- confirms that the query uses
    count(distinct(...)) and not plain count()."""
    admin_headers, _ = await _register_admin(client, session_factory)
    other_token, _, _ = await _register_and_login(client, name="Otro")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    for name in ("Cuenta 1", "Cuenta 2"):
        await client.post(
            "/api/v1/accounts",
            headers=other_headers,
            json={"name": name, "type": "asset", "subtype": "checking", "initial_balance": "0"},
        )

    response = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert response.status_code == 200
    stats = response.json()["data"]
    assert stats["users_with_accounts"] == 1
    assert stats["total_accounts"] >= 2


async def test_admin_stats_feedback_new_count(client: AsyncClient, session_factory):
    admin_headers, _ = await _register_admin(client, session_factory)
    other_token, _, _ = await _register_and_login(client, name="Otro")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    await client.post(
        "/api/v1/feedback",
        headers=other_headers,
        json={"type": "bug", "message": "Algo no funciona"},
    )

    response = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["data"]["feedback_new_count"] >= 1


async def test_admin_stats_signups_last_14_days_includes_today(
    client: AsyncClient, session_factory
):
    admin_headers, _ = await _register_admin(client, session_factory)
    response = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert response.status_code == 200
    signups = response.json()["data"]["signups_last_14_days"]
    assert len(signups) == 14
    # The just-registered admin (and any other user created in this
    # test run) must fall on today, the last item in the list.
    assert signups[-1]["count"] >= 1
