"""Files attached to the AI chat: PDFs (bank statements) and images (screenshots).

What a file is comes from its content, not its name; only an encrypted PDF ever
needs a password, and each one has its own."""

import base64
import io
import json
import uuid

import pytest
from httpx import AsyncClient
from pypdf import PdfWriter

from app.ai import advisor
from app.ai.attachments import (
    MAX_IMAGE_BYTES,
    MAX_PDF_BYTES,
    sniff_media_type,
)
from app.ai.gemini import _build_contents
from tests.test_ai import FakeAIProvider, _register_and_login, _use_test_session

pytestmark = pytest.mark.asyncio

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-png-body" * 4
JPEG = b"\xff\xd8\xff\xe0" + b"fake-jpeg-body" * 4
WEBP = b"RIFF" + b"\x24\x00\x00\x00" + b"WEBP" + b"VP8 " + b"fake-webp-body" * 2
GIF = b"GIF89a" + b"fake-gif-body" * 4
HEIC = b"\x00\x00\x00\x18" + b"ftypheic" + b"\x00" * 16


def _pdf(password: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    if password:
        writer.encrypt(password)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


async def _login(client: AsyncClient, session_factory, monkeypatch, turns=None, **capture):
    token, user_id = await _register_and_login(client)
    _use_test_session(monkeypatch, session_factory, uuid.UUID(user_id))
    monkeypatch.setattr(
        advisor,
        "get_ai_provider",
        lambda: FakeAIProvider(
            turns=turns or [[{"type": "text", "text": "Vi tus archivos."}]], **capture
        ),
    )
    return {"Authorization": f"Bearer {token}"}


async def _send(client, headers, files, message="mira esto", **data):
    return await client.post(
        "/api/v1/ai/chat",
        headers=headers,
        data={"message": message, **data},
        files=[("attachments", f) for f in files],
    )


# -- what a file is -----------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (_pdf(), "application/pdf"),
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (WEBP, "image/webp"),
        (GIF, None),
        (HEIC, None),
        (b"", None),
        (b"just some text", None),
    ],
)
async def test_the_kind_of_a_file_comes_from_its_bytes(data, expected):
    assert sniff_media_type(data) == expected


async def test_a_screenshot_named_pdf_is_treated_as_the_image_it_is(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(client, headers, [("captura.pdf", PNG, "application/pdf")])
    assert response.status_code == 200
    block = captured[0][-1]["content"][0]
    assert block["type"] == "image" and block["source"]["media_type"] == "image/png"


async def test_a_pdf_sent_as_octet_stream_is_still_a_pdf(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(client, headers, [("estado", _pdf(), "application/octet-stream")])
    assert response.status_code == 200
    assert captured[0][-1]["content"][0]["type"] == "document"


# -- images reach the provider -----------------------------------------------


async def test_screenshots_reach_the_provider_as_image_blocks_before_the_text(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(
        client,
        headers,
        [
            ("a.png", PNG, "image/png"),
            ("b.jpg", JPEG, "image/jpeg"),
            ("c.webp", WEBP, "image/webp"),
        ],
        message="son los gastos del viaje",
    )
    assert response.status_code == 200
    assert "Vi tus archivos." in response.text

    content = captured[0][-1]["content"]
    assert [b["type"] for b in content] == ["image", "image", "image", "text"]
    assert [b["source"]["media_type"] for b in content[:3]] == [
        "image/png",
        "image/jpeg",
        "image/webp",
    ]
    assert base64.b64decode(content[0]["source"]["data"]) == PNG
    assert content[3]["text"] == "son los gastos del viaje"


async def test_images_never_ask_for_a_password_and_ignore_one_that_is_sent(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(
        client, headers, [("a.png", PNG, "image/png")], pdf_password="no-importa"
    )
    assert response.status_code == 200


async def test_a_pdf_without_encryption_needs_no_password(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(client, headers, [("estado.pdf", _pdf(), "application/pdf")])
    assert response.status_code == 200
    assert captured[0][-1]["content"][0]["type"] == "document"


async def test_pdfs_and_images_can_travel_together(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(
        client,
        headers,
        [("estado.pdf", _pdf(), "application/pdf"), ("captura.png", PNG, "image/png")],
    )
    assert response.status_code == 200
    assert [b["type"] for b in captured[0][-1]["content"]] == ["document", "image", "text"]


# -- passwords: per file, only for encrypted PDFs ------------------------------


async def test_an_encrypted_pdf_without_a_password_asks_for_that_file(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(
        client,
        headers,
        [("captura.png", PNG, "image/png"), ("estado.pdf", _pdf("clave123"), "application/pdf")],
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "PDF_PASSWORD_REQUIRED"
    assert body["details"] == {"filename": "estado.pdf", "index": 1}


async def test_a_wrong_password_is_told_apart_from_a_missing_one(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(
        client,
        headers,
        [("estado.pdf", _pdf("correcta"), "application/pdf")],
        file_passwords=json.dumps(["incorrecta"]),
    )
    assert response.status_code == 400
    assert response.json()["code"] == "PDF_PASSWORD_INVALID"
    assert response.json()["details"]["index"] == 0


async def test_each_pdf_is_opened_with_its_own_password(
    client: AsyncClient, session_factory, monkeypatch
):
    captured: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_messages=captured)
    response = await _send(
        client,
        headers,
        [
            ("bbva.pdf", _pdf("clave-bbva"), "application/pdf"),
            ("captura.png", PNG, "image/png"),
            ("stori.pdf", _pdf("clave-stori"), "application/pdf"),
        ],
        file_passwords=json.dumps(["clave-bbva", None, "clave-stori"]),
    )
    assert response.status_code == 200, response.text
    assert [b["type"] for b in captured[0][-1]["content"]] == [
        "document",
        "image",
        "document",
        "text",
    ]


async def test_the_error_points_at_the_file_whose_password_is_wrong(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(
        client,
        headers,
        [
            ("bbva.pdf", _pdf("clave-bbva"), "application/pdf"),
            ("stori.pdf", _pdf("clave-stori"), "application/pdf"),
        ],
        file_passwords=json.dumps(["clave-bbva", "mal"]),
    )
    assert response.json()["code"] == "PDF_PASSWORD_INVALID"
    assert response.json()["details"] == {"filename": "stori.pdf", "index": 1}


async def test_the_single_password_field_still_works_as_a_fallback_for_every_pdf(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(
        client,
        headers,
        [("a.pdf", _pdf("misma"), "application/pdf"), ("b.pdf", _pdf("misma"), "application/pdf")],
        pdf_password="misma",
    )
    assert response.status_code == 200


@pytest.mark.parametrize("raw", ["not json", '{"a": 1}', '["uno", "dos"]', "[1]"])
async def test_a_malformed_file_passwords_field_is_rejected(
    client: AsyncClient, session_factory, monkeypatch, raw
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(client, headers, [("a.png", PNG, "image/png")], file_passwords=raw)
    assert response.status_code == 400


# -- what is refused -----------------------------------------------------------


async def test_something_that_is_not_a_pdf_or_a_supported_image_is_refused(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    for name, data in (("foto.gif", GIF), ("notas.txt", b"hola"), ("vacio.png", b"")):
        response = await _send(client, headers, [(name, data, "application/octet-stream")])
        assert response.status_code == 400, name
        assert response.json()["code"] == "UNSUPPORTED_ATTACHMENT"


async def test_an_iphone_heic_photo_gets_a_specific_message(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    response = await _send(client, headers, [("IMG_0001.HEIC", HEIC, "image/heic")])
    assert response.status_code == 400
    assert "HEIC" in response.json()["error"]


async def test_an_oversized_image_is_refused(client: AsyncClient, session_factory, monkeypatch):
    headers = await _login(client, session_factory, monkeypatch)
    big = PNG + b"0" * MAX_IMAGE_BYTES
    response = await _send(client, headers, [("grande.png", big, "image/png")])
    assert response.status_code == 400
    assert response.json()["code"] == "ATTACHMENT_TOO_LARGE"
    assert response.json()["details"]["filename"] == "grande.png"


async def test_an_oversized_pdf_is_refused(client: AsyncClient, session_factory, monkeypatch):
    headers = await _login(client, session_factory, monkeypatch)
    big = b"%PDF-1.4\n" + b"0" * MAX_PDF_BYTES
    response = await _send(client, headers, [("enorme.pdf", big, "application/pdf")])
    assert response.status_code == 400
    assert response.json()["code"] == "ATTACHMENT_TOO_LARGE"


async def test_the_total_weight_of_a_message_is_capped(
    client: AsyncClient, session_factory, monkeypatch
):
    # With 5 files and 5MB per image, only PDFs can reach the real 25MB cap, so the
    # test lowers it instead of building 25MB of valid PDF.
    monkeypatch.setattr("app.ai.attachments.MAX_TOTAL_BYTES", 1024 * 1024)
    headers = await _login(client, session_factory, monkeypatch)
    files = [(f"{i}.png", PNG + b"0" * (600 * 1024), "image/png") for i in range(2)]
    response = await _send(client, headers, files)
    assert response.status_code == 400
    assert response.json()["code"] == "ATTACHMENTS_TOO_LARGE"


async def test_at_most_five_files_per_message(client: AsyncClient, session_factory, monkeypatch):
    headers = await _login(client, session_factory, monkeypatch)
    five = await _send(client, headers, [(f"{i}.png", PNG, "image/png") for i in range(5)])
    assert five.status_code == 200
    six = await _send(client, headers, [(f"{i}.png", PNG, "image/png") for i in range(6)])
    assert six.status_code == 400


async def test_a_refused_file_does_not_spend_a_daily_query(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    before = (await client.get("/api/v1/ai/usage", headers=headers)).json()["data"]["used_today"]
    await _send(client, headers, [("notas.txt", b"hola", "text/plain")])
    after = (await client.get("/api/v1/ai/usage", headers=headers)).json()["data"]["used_today"]
    assert after == before


# -- how the model is instructed -----------------------------------------------


@pytest.mark.parametrize(
    ("files", "statement", "screenshot"),
    [
        ([], False, False),
        ([("e.pdf", _pdf(), "application/pdf")], True, False),
        ([("c.png", PNG, "image/png")], False, True),
        ([("e.pdf", _pdf(), "application/pdf"), ("c.png", PNG, "image/png")], True, True),
    ],
)
async def test_each_kind_of_file_adds_only_its_own_instructions(
    client: AsyncClient, session_factory, monkeypatch, files, statement, screenshot
):
    systems: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_systems=systems)
    response = await _send(client, headers, files)
    assert response.status_code == 200
    assert ("El usuario adjunto uno o mas PDFs" in systems[0]) is statement
    assert ("El usuario adjunto una o mas capturas de pantalla" in systems[0]) is screenshot


async def test_nothing_can_be_registered_without_confirmation_whatever_is_attached(
    client: AsyncClient, session_factory, monkeypatch
):
    systems: list = []
    headers = await _login(client, session_factory, monkeypatch, captured_systems=systems)
    await _send(
        client,
        headers,
        [("e.pdf", _pdf(), "application/pdf"), ("c.png", PNG, "image/png")],
    )
    prompt = systems[0]
    assert "NUNCA registras nada directamente" in prompt
    assert "propose_actions" in prompt
    # the old shortcuts that skipped confirmation are gone
    assert "SIN pasar por propose_action" not in prompt
    assert "ejecuta la tool de escritura directo" not in prompt
    assert "adjuntar el estado NO es confirmar" in prompt


# -- privacy: only the text is kept ---------------------------------------------


async def test_the_files_are_never_stored_only_the_text_of_the_message(
    client: AsyncClient, session_factory, monkeypatch
):
    headers = await _login(client, session_factory, monkeypatch)
    await _send(client, headers, [("a.png", PNG, "image/png")], message="gastos del viaje")

    history = (await client.get("/api/v1/ai/history", headers=headers)).json()["data"]
    user_message = next(m for m in history if m["role"] == "user")
    assert user_message["content"] == "gastos del viaje"
    assert base64.b64encode(PNG).decode() not in json.dumps(history)


# -- the Gemini translation -----------------------------------------------------


async def test_gemini_turns_an_image_block_into_an_inline_part():
    contents = _build_contents(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.b64encode(PNG).decode(),
                        },
                    },
                    {"type": "text", "text": "mira"},
                ],
            }
        ]
    )
    parts = contents[0].parts
    assert len(parts) == 2
    assert parts[0].inline_data.mime_type == "image/png"
    assert parts[0].inline_data.data == PNG
    assert parts[1].text == "mira"
