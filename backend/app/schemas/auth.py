from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.user import LOCALES, PAY_CYCLES, THEMES
from app.schemas.common import IMAGE_DATA_URL_MAX_LENGTH, IMAGE_DATA_URL_PATTERN


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)
    # Must come in as True -- auth_service.register validates it explicitly
    # (it's not enough for the frontend to disable the button: the actual
    # checkbox is the legal gate, this field is what enforces it server-side).
    accept_disclaimer: bool = False
    # Whatever language the frontend was showing when the user picked
    # "Sign up" (see LanguageSwitcher on AuthLayout) -- seeds the account's
    # saved preference instead of everyone starting at the 'es' column
    # default and having to change it by hand right after registering.
    locale: str | None = Field(default=None, pattern=f"^({'|'.join(LOCALES)})$")


class DeviceInfo(BaseModel):
    device_name: str | None = None
    device_type: str = "web"
    push_token: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device: DeviceInfo = DeviceInfo()


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1)
    avatar_url: str | None = Field(
        default=None, max_length=IMAGE_DATA_URL_MAX_LENGTH, pattern=IMAGE_DATA_URL_PATTERN
    )


class UpdateSettingsRequest(BaseModel):
    theme: str | None = Field(default=None, pattern=f"^({'|'.join(THEMES)})$")
    locale: str | None = Field(default=None, pattern=f"^({'|'.join(LOCALES)})$")
    email_notifications: bool | None = None
    push_notifications: bool | None = None
    pay_cycle: str | None = Field(default=None, pattern=f"^({'|'.join(PAY_CYCLES)})$")
    debt_trouble_mode: bool | None = None
    last_seen_changelog_version: str | None = None


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    avatar_url: str | None
    role: str
    auth_provider: str
    theme: str
    locale: str
    email_notifications: bool
    push_notifications: bool
    pay_cycle: str
    debt_trouble_mode: bool
    last_seen_changelog_version: str | None
    accepted_disclaimer_version: str | None
    # Always = settings.DISCLAIMER_VERSION -- sent together with the field
    # above so the frontend only has to compare the two strings on this
    # same object (DisclaimerGate) instead of keeping its own copy of
    # "which version is current" manually synced with the backend.
    current_disclaimer_version: str
    created_at: datetime


class DeleteAccountRequest(BaseModel):
    password: str | None = None


class DeviceOut(BaseModel):
    id: UUID
    device_name: str | None
    device_type: str
    last_used_at: datetime | None
    is_active: bool

    model_config = {"from_attributes": True}
