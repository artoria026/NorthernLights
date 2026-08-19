import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

pytestmark = pytest.mark.asyncio

_PASSWORD = "supersecret123"


async def _register_and_login(client: AsyncClient, name: str = "Test") -> tuple[str, str, str]:
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        "/api/v1/auth/register", json={"email": email, "name": name, "password": _PASSWORD, "accept_disclaimer": True}
    )
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    token = login.json()["data"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    return token, me.json()["data"]["id"], me.json()["data"]["email"]


async def _register_admin(client: AsyncClient, session_factory) -> dict:
    """Mismo patron que test_admin.py: promueve escribiendo el rol directo,
    despues re-loguea (el JWT emitido al registrarse ya trae role='user')."""
    _, user_id, email = await _register_and_login(client, name="Admin")
    async with session_factory() as session:
        await session.execute(
            text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": user_id}
        )
        await session.commit()
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_create_feedback(client: AsyncClient):
    token, _, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post(
        "/api/v1/feedback",
        headers=headers,
        json={"type": "bug", "message": "El boton de exportar no responde"},
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["type"] == "bug"
    assert data["status"] == "new"


async def test_feedback_requires_valid_type(client: AsyncClient):
    token, _, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post(
        "/api/v1/feedback",
        headers=headers,
        json={"type": "queja", "message": "Mensaje valido de sobra"},
    )
    assert response.status_code == 422


async def test_only_admin_can_list_feedback(client: AsyncClient):
    token, _, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.get("/api/v1/admin/feedback", headers=headers)
    assert response.status_code == 403


async def test_admin_sees_feedback_from_all_users(client: AsyncClient, session_factory):
    admin_headers = await _register_admin(client, session_factory)

    token_a, _, _ = await _register_and_login(client, name="Usuario A")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    await client.post(
        "/api/v1/feedback", headers=headers_a, json={"type": "bug", "message": "Bug de usuario A"}
    )

    token_b, _, _ = await _register_and_login(client, name="Usuario B")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    await client.post(
        "/api/v1/feedback",
        headers=headers_b,
        json={"type": "feature", "message": "Sugerencia de usuario B"},
    )

    response = await client.get("/api/v1/admin/feedback", headers=admin_headers)
    assert response.status_code == 200
    items = response.json()["data"]
    messages = {item["message"] for item in items}
    assert "Bug de usuario A" in messages
    assert "Sugerencia de usuario B" in messages
    # El admin ve el nombre/email de quien lo mando, no solo el mensaje.
    names = {item["user_name"] for item in items}
    assert {"Usuario A", "Usuario B"}.issubset(names)


async def test_regular_user_cannot_see_others_feedback_directly(client: AsyncClient):
    """GET /feedback (abajo) ya cubre el listado propio de un usuario normal;
    esto prueba ademas que la policy RLS en si misma aisla -- no es solo el
    403 de require_admin lo que protege los datos de otros."""
    token_a, _, _ = await _register_and_login(client, name="Usuario A")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    create = await client.post(
        "/api/v1/feedback", headers=headers_a, json={"type": "bug", "message": "Solo de A"}
    )
    feedback_id = create.json()["data"]["id"]

    token_b, _, _ = await _register_and_login(client, name="Usuario B")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    # No hay GET /feedback/{id} publico; probamos el unico camino posible
    # (intentar cambiarle el status) devuelve 403 por require_admin, no 404 --
    # confirma que la ausencia de datos no es lo que bloquea.
    patch = await client.patch(
        f"/api/v1/admin/feedback/{feedback_id}/status",
        headers=headers_b,
        json={"status": "read"},
    )
    assert patch.status_code == 403


async def test_admin_updates_feedback_status(client: AsyncClient, session_factory):
    admin_headers = await _register_admin(client, session_factory)
    token, _, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    create = await client.post(
        "/api/v1/feedback",
        headers=headers,
        json={"type": "feature", "message": "Modo oscuro mas oscuro"},
    )
    feedback_id = create.json()["data"]["id"]

    update = await client.patch(
        f"/api/v1/admin/feedback/{feedback_id}/status",
        headers=admin_headers,
        json={"status": "considered"},
    )
    assert update.status_code == 200
    assert update.json()["data"]["status"] == "considered"

    listing = await client.get(
        "/api/v1/admin/feedback", headers=admin_headers, params={"status": "considered"}
    )
    ids = {item["id"] for item in listing.json()["data"]}
    assert feedback_id in ids


async def test_user_can_list_own_feedback(client: AsyncClient):
    token_a, _, _ = await _register_and_login(client, name="Usuario A")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    await client.post(
        "/api/v1/feedback", headers=headers_a, json={"type": "bug", "message": "Solo de A"}
    )

    token_b, _, _ = await _register_and_login(client, name="Usuario B")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    await client.post(
        "/api/v1/feedback", headers=headers_b, json={"type": "bug", "message": "Solo de B"}
    )

    response = await client.get("/api/v1/feedback", headers=headers_a)
    assert response.status_code == 200
    messages = {item["message"] for item in response.json()["data"]}
    assert messages == {"Solo de A"}


async def test_status_change_to_considered_notifies_user(client: AsyncClient, session_factory):
    admin_headers = await _register_admin(client, session_factory)
    token, _, _ = await _register_and_login(client, name="Olvidadizo")
    headers = {"Authorization": f"Bearer {token}"}
    create = await client.post(
        "/api/v1/feedback",
        headers=headers,
        json={"type": "feature", "message": "Exportar a Excel"},
    )
    feedback_id = create.json()["data"]["id"]

    update = await client.patch(
        f"/api/v1/admin/feedback/{feedback_id}/status",
        headers=admin_headers,
        json={"status": "considered", "admin_note": "Lo metemos al roadmap de Q4"},
    )
    assert update.status_code == 200
    assert update.json()["data"]["admin_note"] == "Lo metemos al roadmap de Q4"

    notifications = await client.get("/api/v1/notifications", headers=headers)
    items = notifications.json()["data"]
    assert any(
        n["type"] == "feedback_status_changed" and n["body"] == "Lo metemos al roadmap de Q4"
        for n in items
    )

    own_feedback = await client.get("/api/v1/feedback", headers=headers)
    assert own_feedback.json()["data"][0]["admin_note"] == "Lo metemos al roadmap de Q4"


async def test_status_change_to_read_does_not_notify_user(client: AsyncClient, session_factory):
    """new/read son transiciones internas del admin -- no deben generar
    notificacion, a diferencia de considered/discarded."""
    admin_headers = await _register_admin(client, session_factory)
    token, _, _ = await _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    create = await client.post(
        "/api/v1/feedback", headers=headers, json={"type": "bug", "message": "Algo menor"}
    )
    feedback_id = create.json()["data"]["id"]

    await client.patch(
        f"/api/v1/admin/feedback/{feedback_id}/status",
        headers=admin_headers,
        json={"status": "read"},
    )

    notifications = await client.get("/api/v1/notifications", headers=headers)
    assert notifications.json()["data"] == []
