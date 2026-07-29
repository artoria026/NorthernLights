"""Regresion para cuatro bugs de la misma familia, encontrados en cadena en el
primer deploy real:

1. auth_service.register() y 2. google_auth_service.resolve_user() (alta
nueva) hacian el insert en cascada de UserPreferences sin haber seteado
antes app.current_user_id -- con FORCE ROW LEVEL SECURITY esa policy
rechaza el insert (`user_id = NULL` nunca es TRUE) en cualquier rol que no
sea superuser/BYPASSRLS. Fix: generar el id a mano (uuid4()) antes del
insert -- el default=uuid.uuid4 de la columna solo se aplica al flushear,
no alcanza con solo reordenar el set_rls_user().

3. get_user_by_email() (login, forgot_password, la verificacion de email
duplicado en register(), y el lookup de cuenta existente en
resolve_user()) se llama SIEMPRE antes de saber quien es el usuario -- es
imposible haber seteado app.current_user_id todavia. User.preferences es
lazy="selectin" a nivel de modelo (carga sola en cualquier fetch de User),
asi que esa misma query dispara una sub-query contra user_preferences que
tambien pisa su policy de RLS, esta vez sin que mover un set_rls_user()
sirva de nada (el problema esta dentro de la funcion de lookup, antes de
que el caller pueda hacer algo). Fix: raiseload(User.preferences) en ese
query especifico -- ninguno de sus call sites necesita `.preferences`.

4. GET/PUT/DELETE /me, PUT /settings, POST /google/unlink y los endpoints
de /device usaban Depends(get_db) en vez de Depends(get_rls_db) -- la
dependencia que el proyecto ya documenta como obligatoria para tocar
tablas de usuario. A diferencia de #3, aca si hace falta el RLS seteado
(build_user_out necesita `.preferences` de verdad), asi que el fix es usar
la dependencia correcta. POST /auth/refresh es un caso aparte: no puede
usar get_rls_db (no hay access token valido, es el endpoint para cuando ya
vencio) -- su Device se busca por refresh_token antes de saber el user_id,
asi que la policy de `devices` necesito una clausula extra para ese
lookup puntual (ver migracion a3d7af2c6426).

El resto del suite corre contra `finanzas_user`, que en algunos entornos
(p.ej. un Postgres bootstrap dentro de un contenedor Docker) puede terminar
siendo SUPERUSER -- eso significa BYPASSRLS siempre gana sin importar FORCE,
y ningun test normal puede detectar una violacion de RLS real (se confirmo a
mano: el insert "roto" pasaba silenciosamente via finanzas_user, y solo
fallaba conectado como un rol sin privilegios especiales, exactamente como en
produccion). Este archivo se conecta con un rol de verdad (sin SUPERUSER,
sin BYPASSRLS, no owner de las tablas) para poder probar RLS como se
comporta en un Postgres real -- un rol FIJO (`finanzas_rls_test`), creado una
sola vez a mano por un superuser (ver fixture `low_priv_session_factory`),
no uno nuevo por test: `finanzas_user` no tiene CREATEROLE a proposito, asi
que nunca podria crearlo/borrarlo el mismo."""

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
    """A diferencia de la version anterior (CREATE ROLE por test, DROP al
    terminar), este rol es fijo y se crea UNA SOLA VEZ a mano con un
    superuser -- finanzas_user no tiene CREATEROLE a proposito (mismo
    principio que finanzas_admin, ver README "Setup en una maquina nueva"),
    asi que nunca puede crear/borrar roles el mismo. Lo que SI puede hacer
    como dueno de las tablas es GRANT sobre un rol que ya existe, que es
    idempotente y se repite en cada test -- no hace falta CREATEROLE para
    eso. Si el rol no existe todavia, se salta el test con instrucciones en
    vez de fallar feo."""
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

    # OJO: create_async_engine(str(url)) manda la password enmascarada
    # ("***") -- URL.__str__ la oculta a proposito para que no se filtre en
    # logs. Hay que pasar el objeto URL directo, no su version en texto.
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
            session, RegisterRequest(email=email, name="Ada", password="supersecret123")
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
    """No necesita el rol sin bypass -- esto prueba directamente que la
    sub-query de user_preferences ya no se dispara (no que RLS la bloquee).
    Confirmado a mano contra finanzas_dev con echo=True: antes de este fix
    salian dos SELECT (users + user_preferences) aca; ahora solo uno, y
    tocar `.preferences` sobre este user en particular explota adrede en vez
    de reintentar la query en el momento equivocado."""
    email = f"{uuid.uuid4()}@example.com"
    async with session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123")
        )
        await session.commit()

    async with session_factory() as session:
        user = await auth_service.get_user_by_email(session, email)
        assert user is not None
        with pytest.raises(InvalidRequestError):
            _ = user.preferences


async def test_login_works_under_real_row_level_security(low_priv_session_factory):
    """Bug #3 de la misma familia, reportado despues de los dos primeros:
    User.preferences es lazy="selectin" (models/user.py) para que cualquier
    fetch de User la traiga sola -- pero eso significa que
    get_user_by_email(), llamado por login() ANTES de que exista ningun
    user_id conocido (no se puede setear app.current_user_id sin saber a
    quien), dispara una segunda query automatica contra user_preferences
    que si choca con su policy de RLS. A diferencia de los bugs #1/#2, mover
    un set_rls_user() mas temprano en login() no alcanza: el problema esta
    DENTRO de get_user_by_email(), antes de que login() tenga chance de
    hacer nada."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123")
        )
        await session.commit()

    async with low_priv_session_factory() as session:
        tokens = await auth_service.login(session, email, "supersecret123", DeviceInfo())
        await session.commit()
        assert tokens.access_token
        assert tokens.refresh_token


async def test_me_endpoint_query_works_under_real_row_level_security(low_priv_session_factory):
    """Bug #4: GET /me, PUT /me, DELETE /me, PUT /settings y POST
    /google/unlink usaban Depends(get_db) (sesion sin RLS) en vez de
    Depends(get_rls_db) -- la dependencia que el proyecto ya documenta como
    obligatoria para leer/escribir tablas de usuario (core/database.py).
    A diferencia de get_user_by_email(), build_user_out() SI necesita
    `.preferences`, asi que raiseload no es la solucion aca -- hace falta
    que la sesion tenga RLS seteado desde el vamos. Este test simula
    exactamente lo que get_rls_db hace (set_rls_user antes de la query),
    ya que no se puede invocar una dependencia de FastAPI fuera de un
    request."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        user = await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123")
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
    """Bug #4, segunda mitad: POST /auth/refresh es el UNICO endpoint donde
    ni siquiera get_rls_db sirve -- es literalmente el flujo para cuando el
    access token ya vencio, no hay current_user que resolver. auth_service.
    refresh() buscaba su Device por refresh_token ANTES de conocer el
    user_id, y la policy original de `devices` (solo "es mi propio device")
    no dejaba ver esa fila bajo RLS real -- /auth/refresh devolvia 401 con
    CUALQUIER token, valido o no. Fix: rls_devices tiene una clausula extra
    (ver migracion a3d7af2c6426) que permite el lookup por el hash exacto
    que se esta buscando."""
    email = f"{uuid.uuid4()}@example.com"
    async with low_priv_session_factory() as session:
        await auth_service.register(
            session, RegisterRequest(email=email, name="Ada", password="supersecret123")
        )
        await session.commit()

    async with low_priv_session_factory() as session:
        tokens = await auth_service.login(session, email, "supersecret123", DeviceInfo())
        await session.commit()

    async with low_priv_session_factory() as session:
        # Sesion fresca, SIN set_rls_user -- exactamente el estado real de
        # POST /auth/refresh (get_db(), sin current_user conocido).
        new_tokens = await auth_service.refresh(session, tokens.refresh_token)
        await session.commit()
        assert new_tokens.access_token
        assert new_tokens.refresh_token
        assert new_tokens.refresh_token != tokens.refresh_token
