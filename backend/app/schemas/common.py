from typing import Any

from pydantic import BaseModel

# Compartido por cualquier campo que guarde una imagen subida por el usuario
# como data-url (logo de cuenta, foto de perfil): el frontend siempre la
# normaliza a un PNG/JPG/WebP pequeno en un <canvas> antes de mandarla, asi
# que este limite es generoso para eso sin permitir fotos completas.
IMAGE_DATA_URL_PATTERN = r"^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+=*$"
IMAGE_DATA_URL_MAX_LENGTH = 400_000


class Meta(BaseModel):
    total: int
    page: int
    per_page: int


class SuccessResponse(BaseModel):
    data: Any
    meta: Meta | None = None


class ErrorResponse(BaseModel):
    error: str
    code: str
    details: dict = {}
