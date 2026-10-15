"""Files attached to a chat message: PDFs (bank statements) and images
(screenshots). Everything in memory -- nothing is written to disk, logged, or
stored; the bytes only travel on to the AI provider.

The kind of a file is decided by its CONTENT (magic bytes), never by the name or the
content-type the browser declared: a screenshot renamed `.pdf`, or a PDF that the
browser labelled `application/octet-stream`, is handled for what it really is.
"""

from dataclasses import dataclass

from fastapi import UploadFile

from app.ai.pdf_utils import PdfPasswordError, strip_pdf_password

MAX_CHAT_ATTACHMENTS = 5
MAX_PDF_BYTES = 15 * 1024 * 1024
# Claude's own per-image limit; the web app shrinks screenshots well below this.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# What the whole message may carry; the reverse proxy in front allows a bit more.
MAX_TOTAL_BYTES = 25 * 1024 * 1024

PDF = "application/pdf"
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")


class AttachmentError(Exception):
    """A problem with one attachment, with a stable `code` the web app reacts to
    (e.g. asking for that file's password) and the file it is about."""

    def __init__(self, code: str, message: str, filename: str, index: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.filename = filename
        self.index = index


@dataclass(frozen=True)
class ChatAttachment:
    filename: str
    media_type: str
    data: bytes

    @property
    def is_pdf(self) -> bool:
        return self.media_type == PDF

    @property
    def is_image(self) -> bool:
        return self.media_type in IMAGE_TYPES


def sniff_media_type(data: bytes) -> str | None:
    """PDF / PNG / JPEG / WebP by their first bytes; None for anything else."""
    if data.startswith(b"%PDF-"):
        return PDF
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _looks_like_heic(data: bytes) -> bool:
    return data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"mif1", b"msf1")


async def prepare_attachments(
    uploads: list[UploadFile],
    file_passwords: list[str | None] | None = None,
    default_password: str | None = None,
) -> list[ChatAttachment]:
    """Reads, classifies and validates every upload. Encrypted PDFs are opened with
    THEIR password (`file_passwords[i]`, falling back to `default_password`) and
    rewritten without it before going on; images and plain PDFs never need one.
    Raises AttachmentError for the first problem."""
    passwords = file_passwords or []
    prepared: list[ChatAttachment] = []
    total = 0
    for index, upload in enumerate(uploads):
        name = upload.filename or f"archivo-{index + 1}"
        data = await upload.read()
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise AttachmentError(
                "ATTACHMENTS_TOO_LARGE",
                f"Los archivos pesan mas de {MAX_TOTAL_BYTES // (1024 * 1024)}MB en total.",
                name,
                index,
            )

        media_type = sniff_media_type(data)
        if media_type is None:
            if _looks_like_heic(data):
                message = (
                    "Las fotos HEIC (iPhone) no se pueden leer. Manda una captura "
                    "(PNG/JPG) o exporta la foto como JPG."
                )
            else:
                message = "Solo se pueden adjuntar PDF o imagenes (PNG, JPG o WebP)."
            raise AttachmentError("UNSUPPORTED_ATTACHMENT", f"'{name}': {message}", name, index)

        if media_type == PDF:
            if len(data) > MAX_PDF_BYTES:
                raise AttachmentError(
                    "ATTACHMENT_TOO_LARGE",
                    f"'{name}' pesa mas de {MAX_PDF_BYTES // (1024 * 1024)}MB.",
                    name,
                    index,
                )
            password = passwords[index] if index < len(passwords) else None
            try:
                data = strip_pdf_password(data, password or default_password)
            except PdfPasswordError as e:
                code = (
                    "PDF_PASSWORD_REQUIRED"
                    if e.reason == "required"
                    else "PDF_PASSWORD_INVALID"
                    if e.reason == "invalid"
                    else "UNSUPPORTED_ATTACHMENT"
                )
                raise AttachmentError(code, f"'{name}': {e}", name, index) from e
        elif len(data) > MAX_IMAGE_BYTES:
            raise AttachmentError(
                "ATTACHMENT_TOO_LARGE",
                f"'{name}' pesa mas de {MAX_IMAGE_BYTES // (1024 * 1024)}MB.",
                name,
                index,
            )
        prepared.append(ChatAttachment(filename=name, media_type=media_type, data=data))
    return prepared
