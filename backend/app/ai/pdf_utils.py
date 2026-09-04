"""Strip a PDF's password before sending it to the AI model -- neither
Gemini nor Claude can open an encrypted PDF on its own (see
app/ai/advisor.py, `document` blocks). Everything in memory: the PDF is never
persisted to disk, nor the password anywhere (not even logs)."""

import io

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError


class PdfPasswordError(Exception):
    """Incorrect or missing password for a PDF that is in fact encrypted."""


def strip_pdf_password(data: bytes, password: str | None) -> bytes:
    """If the PDF isn't encrypted, returns `data` as-is. If it is,
    tries to open it with `password` and returns a copy without encryption (the
    pages are rewritten into a new PdfWriter) -- so the AI provider
    receives the bytes of a plain PDF, without needing to know anything about the password."""
    try:
        reader = PdfReader(io.BytesIO(data))
    except PdfReadError as e:
        raise PdfPasswordError(f"No pude leer el archivo, ¿es un PDF valido? ({e})") from e

    if not reader.is_encrypted:
        return data

    if not password:
        raise PdfPasswordError("Este PDF tiene contraseña, pero no se mando ninguna.")

    try:
        result = reader.decrypt(password)
    except PdfReadError:
        result = None
    if not result:
        raise PdfPasswordError("La contraseña no coincide con este PDF.")

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
