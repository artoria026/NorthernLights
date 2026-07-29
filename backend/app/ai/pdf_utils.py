"""Quitar la contraseña de un PDF antes de mandarlo al modelo de IA -- ni
Gemini ni Claude pueden abrir un PDF encriptado por su cuenta (ver
app/ai/advisor.py, bloques `document`). Todo en memoria: nunca se persiste
el PDF a disco ni la contraseña a ningun lado (ni logs)."""

import io

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError


class PdfPasswordError(Exception):
    """Contraseña incorrecta o faltante para un PDF que si esta encriptado."""


def strip_pdf_password(data: bytes, password: str | None) -> bytes:
    """Si el PDF no esta encriptado, regresa `data` tal cual. Si lo esta,
    intenta abrirlo con `password` y regresa una copia sin encriptacion (las
    paginas se re-escriben en un PdfWriter nuevo) -- asi el proveedor de IA
    recibe bytes de un PDF plano, sin tener que saber nada de la contrasena."""
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
