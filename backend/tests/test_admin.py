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
    """Registra un usuario normal, lo promueve a admin escribiendo el rol
    directo en la misma transaccion que `client` (no hay endpoint de
    auto-promocion, a proposito), y vuelve a loguearse: el JWT emitido al
    registrarse ya trae `role=user` fijo, promoverlo no actualiza tokens
    emitidos antes del cambio."""
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
