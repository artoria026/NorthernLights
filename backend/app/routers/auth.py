from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, get_rls_db
from app.core.security import CurrentUser, create_state_token, get_current_user, verify_state_token
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    DeviceInfo,
    DeviceOut,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UpdateProfileRequest,
    UpdateSettingsRequest,
)
from app.schemas.common import SuccessResponse
from app.services import auth_service, google_auth_service

router = APIRouter()


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterRequest, session: AsyncSession = Depends(get_db)
) -> SuccessResponse:
    user = await auth_service.register(session, data)
    return SuccessResponse(data=auth_service.build_user_out(user))


@router.post("/login")
async def login(data: LoginRequest, session: AsyncSession = Depends(get_db)) -> SuccessResponse:
    tokens = await auth_service.login(session, data.email, data.password, data.device)
    return SuccessResponse(data=tokens)


@router.post("/refresh")
async def refresh(data: RefreshRequest, session: AsyncSession = Depends(get_db)) -> SuccessResponse:
    tokens = await auth_service.refresh(session, data.refresh_token)
    return SuccessResponse(data=tokens)


@router.post("/logout")
async def logout(
    data: RefreshRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await auth_service.logout(session, current_user.id, data.refresh_token)
    return SuccessResponse(data={"success": True})


@router.post("/logout-all")
async def logout_all(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await auth_service.logout_all(session, current_user.id)
    return SuccessResponse(data={"success": True})


@router.get("/me")
async def me(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    result = await session.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return SuccessResponse(data=auth_service.build_user_out(user))


@router.put("/me")
async def update_profile(
    data: UpdateProfileRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    user = await auth_service.update_profile(session, current_user.id, data)
    return SuccessResponse(data=auth_service.build_user_out(user))


@router.delete("/me")
async def delete_account(
    data: DeleteAccountRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await auth_service.delete_account(session, current_user.id, data.password)
    return SuccessResponse(data={"success": True})


@router.put("/settings")
async def update_settings(
    data: UpdateSettingsRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    user = await auth_service.update_settings(session, current_user.id, data)
    return SuccessResponse(data=auth_service.build_user_out(user))


@router.post("/google/unlink")
async def unlink_google(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    user = await auth_service.unlink_google(session, current_user.id)
    return SuccessResponse(data=auth_service.build_user_out(user))


@router.put("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await auth_service.change_password(
        session, current_user.id, data.current_password, data.new_password
    )
    return SuccessResponse(data={"success": True})


@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPasswordRequest, session: AsyncSession = Depends(get_db)
) -> SuccessResponse:
    await auth_service.forgot_password(session, data.email)
    return SuccessResponse(data={"success": True})


@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest, session: AsyncSession = Depends(get_db)
) -> SuccessResponse:
    await auth_service.reset_password(session, data.token, data.new_password)
    return SuccessResponse(data={"success": True})


@router.post("/device")
async def register_device(
    data: DeviceInfo,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    device = await auth_service.register_device(session, current_user.id, data)
    return SuccessResponse(data=DeviceOut.model_validate(device))


@router.get("/devices")
async def list_devices(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    devices = await auth_service.list_devices(session, current_user.id)
    return SuccessResponse(data=[DeviceOut.model_validate(d) for d in devices])


@router.delete("/devices/{device_id}")
async def revoke_device(
    device_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_rls_db),
) -> SuccessResponse:
    await auth_service.revoke_device(session, current_user.id, device_id)
    return SuccessResponse(data={"success": True})


@router.get("/google/login")
async def google_login() -> RedirectResponse:
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": create_state_token(),
        "access_type": "online",
        "prompt": "select_account",
    }
    google_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return RedirectResponse(url=google_url, status_code=status.HTTP_302_FOUND)


@router.get("/google/callback")
async def google_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    def _redirect_error(code_: str) -> RedirectResponse:
        return RedirectResponse(f"{settings.FRONTEND_URL}/login?error={code_}", status_code=302)

    if error:
        return _redirect_error("google_cancelled")
    if not state or not verify_state_token(state):
        return _redirect_error("invalid_state")
    if not code:
        return _redirect_error("google_exchange_failed")

    try:
        google_user = await google_auth_service.exchange_code(code)
        user, is_new = await google_auth_service.resolve_user(session, google_user)
        if not user.is_active:
            return _redirect_error("account_disabled")
        tokens = await auth_service.issue_tokens_for_device(
            session, user, DeviceInfo(device_type="web", device_name="Google OAuth")
        )
    except HTTPException:
        return _redirect_error("google_exchange_failed")

    query_params = {"access_token": tokens.access_token, "refresh_token": tokens.refresh_token}
    if is_new:
        query_params["is_new"] = "1"
    query = urlencode(query_params)
    return RedirectResponse(f"{settings.FRONTEND_URL}/auth/callback?{query}", status_code=302)
