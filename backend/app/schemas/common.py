from typing import Any

from pydantic import BaseModel

# Shared by any field that stores an image uploaded by the user as a
# data-url (account logo, profile photo): the frontend always normalizes it
# to a small PNG/JPG/WebP in a <canvas> before sending it, so this limit is
# generous for that without allowing full-size photos.
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
