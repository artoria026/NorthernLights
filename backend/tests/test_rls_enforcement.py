"""Regression test for four bugs of the same family, found in a chain during the
first real deploy:

1. auth_service.register() and 2. google_auth_service.resolve_user() (new
signup) did the cascading UserPreferences insert without having set
app.current_user_id beforehand -- with FORCE ROW LEVEL SECURITY that policy
rejects the insert (`user_id = NULL` is never TRUE) under any role that isn't
superuser/BYPASSRLS. Fix: generate the id by hand (uuid4()) before the
insert -- the column's default=uuid.uuid4 only applies on flush,
just reordering set_rls_user() isn't enough.

3. get_user_by_email() (login, forgot_password, the duplicate-email check
in register(), and the existing-account lookup in
resolve_user()) is ALWAYS called before knowing who the user is -- it's
impossible to have set app.current_user_id yet. User.preferences is
lazy="selectin" at the model level (loads on its own on any User fetch),
so that same query triggers a sub-query against user_preferences that
also runs into its RLS policy, this time with moving a set_rls_user()
doing nothing (the problem is inside the lookup function, before
the caller can do anything). Fix: raiseload(User.preferences) on that
specific query -- none of its call sites need `.preferences`.

4. GET/PUT/DELETE /me, PUT /settings, POST /google/unlink and the /device
endpoints used Depends(get_db) instead of Depends(get_rls_db) -- the
dependency the project already documents as mandatory for touching
user tables. Unlike #3, here RLS being set IS needed
(build_user_out really needs `.preferences`), so the fix is to use
the correct dependency. POST /auth/refresh is a separate case: it can't
use get_rls_db (there's no valid access token, it's the endpoint for when it already
expired) -- its Device is looked up by refresh_token before knowing the user_id,
so the `devices` policy needed an extra clause for that
specific lookup (see migration a3d7af2c6426).

The rest of the suite runs against `finanzas_user`, which in some environments
(e.g. a Postgres bootstrap inside a Docker container) can end up
being SUPERUSER -- which means BYPASSRLS always wins regardless of FORCE,
and no normal test can detect a real RLS violation (confirmed by
hand: the "broken" insert went through silently via finanzas_user, and only
failed when connected as a role without special privileges, exactly like in
production). This file connects with a real role (no SUPERUSER,
no BYPASSRLS, not an owner of the tables) to be able to test RLS as it
behaves on a real Postgres -- a FIXED role (`finanzas_rls_test`), created
once by hand by a superuser (see fixture `low_priv_session_factory`),
not a new one per test: `finanzas_user` doesn't have CREATEROLE on purpose, so
it could never create/drop it itself."""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.user import User
from app.schemas.auth import DeviceInfo, RegisterRequest
from app.services import auth_service, google_auth_service

pytestmark = pytest.mark.asyncio


ROLE = "finanzas_rls_test"
PASSWORD = "regression-test-only"


@pytest_asyncio.fixture
async def low_priv_session_factory():
    """Unlike the previous version (CREATE ROLE per test, DROP at the
    end), this role is fixed and created ONCE by hand with a
    superuser -- finanzas_user doesn't have CREATEROLE on purpose (same
    principle as finanzas_admin, see README "Setup en una maquina nueva"),
    so it can never create/drop roles itself. What it CAN do
    as owner of the tables is GRANT on a role that already exists, which is
    idempotent and repeats on every test -- CREATEROLE isn't needed for
    that. If the role doesn't exist yet, the test is skipped with instructions
    instead of failing ugly."""
    admin_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    async with admin_engine.begin() as conn:
        role_exists = (
            await conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :name"), {"name": ROLE})
        ).scalar()
        if not role_exists:
            await admin_engine.dispose()
            pytest.skip(
                f"Falta el rol de prueba '{ROLE}' -- crealo una vez con un superuser: "
                f"CREATE ROLE {ROLE} LOGIN PASSWORD '{PASSWORD}' NOSUPERUSER NOBYPASSRLS; "
                "(ver README.md, seccion de tests)."
            )
        await conn.execute(text(f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {ROLE}"))

    # HEADS UP: create_async_engine(str(url)) sends the masked password
    # ("***") -- URL.__str__ hides it on purpose so it doesn't leak into
    # logs. Must pass the URL object directly, not its text version.
    low_priv_url = make_url(settings.DATABASE_URL).set(username=ROLE, password=PASSWORD)
    low_priv_engine = create_async_engine(low_priv_url, poolclass=NullPool)
    session_maker = async_sessionmaker(low_priv_engine, expire_on_commit=False)

    yield session_maker

    await low_priv_engine.dispose()
    await admin_engine.dispose()


async def test_register_works_under_real_row_level_security(low_priv_session_factory):
    async with low_priv_session_factory() as session:
        email = f"{uuid.uuid4()}@example.com"
        user = await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123", accept_disclaimer=True)
        )
        await session.commit()
        assert user.email == email
        assert user.preferences.theme == "dark"


async def test_google_new_signup_works_under_real_row_level_security(low_priv_session_factory):
    async with low_priv_session_factory() as session:
        google_profile = {
            "sub": str(uuid.uuid4()),
            "email": f"{uuid.uuid4()}@gmail.com",
            "name": "Google User",
            "email_verified": True,
        }
        user, is_new = await google_auth_service.resolve_user(session, google_profile)
        await session.commit()
        assert is_new is True
        assert user.email == google_profile["email"]
        assert user.preferences.theme == "dark"


async def test_get_user_by_email_does_not_trigger_preferences_query(session_factory):
    """Doesn't need the no-bypass role -- this tests directly that the
    user_preferences sub-query no longer fires (not that RLS blocks it).
    Confirmed by hand against finanzas_dev with echo=True: before this fix
    two SELECTs (users + user_preferences) came out here; now just one, and
    touching `.preferences` on this particular user blows up on purpose instead
    of retrying the query at the wrong moment."""
    email = f"{uuid.uuid4()}@example.com"
    async with session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123", accept_disclaimer=True)
        )
        await session.commit()

    async with session_factory() as session:
        user = await auth_service.get_user_by_email(session, email)
        assert user is not None
        with pytest.raises(InvalidRequestError):
            _ = user.preferences


async def test_login_works_under_real_row_level_security(low_priv_session_factory):
    """Bug #3 of the same family, reported after the first two:
    User.preferences is lazy="selectin" (models/user.py) so any
    User fetch brings it along on its own -- but that means
    get_user_by_email(), called by login() BEFORE any known
    user_id exists (app.current_user_id can't be set without knowing
    who), fires a second automatic query against user_preferences
    that does run into its RLS policy. Unlike bugs #1/#2, moving
    a set_rls_user() earlier in login() isn't enough: the problem is
    INSIDE get_user_by_email(), before login() gets a chance to
    do anything."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123", accept_disclaimer=True)
        )
        await session.commit()

    async with low_priv_session_factory() as session:
        tokens = await auth_service.login(session, email, "supersecret123", DeviceInfo())
        await session.commit()
        assert tokens.access_token
        assert tokens.refresh_token


async def test_me_endpoint_query_works_under_real_row_level_security(low_priv_session_factory):
    """Bug #4: GET /me, PUT /me, DELETE /me, PUT /settings and POST
    /google/unlink used Depends(get_db) (session without RLS) instead of
    Depends(get_rls_db) -- the dependency the project already documents as
    mandatory for reading/writing user tables (core/database.py).
    Unlike get_user_by_email(), build_user_out() DOES need
    `.preferences`, so raiseload isn't the solution here -- the session
    needs to have RLS set from the start. This test simulates
    exactly what get_rls_db does (set_rls_user before the query),
    since a FastAPI dependency can't be invoked outside a
    request."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        user = await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123", accept_disclaimer=True)
        )
        user_id = user.id
        await session.commit()

    async with low_priv_session_factory() as session:
        await auth_service.set_rls_user(session, user_id)
        result = await session.execute(select(User).where(User.id == user_id))
        fetched = result.scalar_one()
        out = auth_service.build_user_out(fetched)
        assert out.email == email
        assert out.theme == "dark"


async def test_refresh_works_under_real_row_level_security(low_priv_session_factory):
    """Bug #4, second half: POST /auth/refresh is the ONLY endpoint where
    not even get_rls_db helps -- it's literally the flow for when the
    access token has already expired, there's no current_user to resolve. auth_service.
    refresh() looked up its Device by refresh_token BEFORE knowing the
    user_id, and the original `devices` policy (only "is my own device")
    wouldn't let that row be seen under real RLS -- /auth/refresh returned 401 with
    ANY token, valid or not. Fix: rls_devices has an extra clause
    (see migration a3d7af2c6426) that allows the lookup by the exact hash
    being searched for."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123", accept_disclaimer=True)
        )
        await session.commit()

    async with low_priv_session_factory() as session:
        tokens = await auth_service.login(session, email, "supersecret123", DeviceInfo())
        await session.commit()

    async with low_priv_session_factory() as session:
        # Fresh session, WITHOUT set_rls_user -- exactly the real state of
        # POST /auth/refresh (get_db(), with no known current_user).
        new_tokens = await auth_service.refresh(session, tokens.refresh_token)
        await session.commit()
        assert new_tokens.access_token
        assert new_tokens.refresh_token
        assert new_tokens.refresh_token != tokens.refresh_token
