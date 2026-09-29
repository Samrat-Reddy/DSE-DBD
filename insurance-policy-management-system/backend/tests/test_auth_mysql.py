"""Authentication and RBAC against real MySQL (TEST_DATABASE_URL, migrated to head)."""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.exceptions import ConflictError
from app.core.security import verify_password
from app.models import Base, Role, RoleName, User
from app.scripts.seed_dev_users import DEV_PASSWORD, DEV_USERS, seed_dev_users
from app.services import users as user_service

pytestmark = pytest.mark.mysql

PASSWORD = "Test-Password-123"


@pytest.fixture
def make_user(mysql_api, mysql_sessions: sessionmaker[Session]):
    """Create users through the real service (and its transaction)."""

    def _make(email: str, role: RoleName, *, is_active: bool = True) -> User:
        with mysql_sessions() as session:
            return user_service.create_user(
                session,
                email=email,
                password=PASSWORD,
                first_name="Test",
                last_name=role.value.title(),
                role=role,
                is_active=is_active,
            )

    return _make


def _login(api, email: str, password: str = PASSWORD):
    return api.post("/api/v1/auth/login", json={"email": email, "password": password})


def _token_headers(api, email: str) -> dict[str, str]:
    response = _login(api, email)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# --- schema -----------------------------------------------------------------


def test_roles_are_seeded_by_migration(mysql_sessions):
    with mysql_sessions() as session:
        names = set(session.scalars(select(Role.name)))
    assert names == {"administrator", "agent", "policyholder"}
    assert names == {role.value for role in RoleName}


def test_users_table_constraints_and_indexes(mysql_engine: Engine):
    inspector = inspect(mysql_engine)
    assert inspector.get_pk_constraint("users")["constrained_columns"] == ["id"]
    assert [
        (fk["name"], fk["constrained_columns"], fk["referred_table"], fk["options"].get("ondelete"))
        for fk in inspector.get_foreign_keys("users")
    ] == [("fk_users_role_id_roles", ["role_id"], "roles", "RESTRICT")]
    assert {u["name"] for u in inspector.get_unique_constraints("users")} == {"uq_users_email"}
    # Exactly one index backs the FK (no duplicate auto-created by MySQL).
    indexes = {ix["name"]: ix["column_names"] for ix in inspector.get_indexes("users")}
    assert indexes == {"ix_users_role_id": ["role_id"], "uq_users_email": ["email"]}
    assert {c["name"] for c in inspector.get_check_constraints("users")} == {
        "ck_users_is_active_boolean",
        "ck_users_email_format",
    }
    nullable = {c["name"]: c["nullable"] for c in inspector.get_columns("users")}
    assert not any(nullable.values()), "every users column is NOT NULL"


def test_models_match_migrated_schema(mysql_engine: Engine):
    with mysql_engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []


# --- database constraints ---------------------------------------------------


def _insert_user(session: Session, **overrides) -> None:
    values = {
        "role_id": session.scalar(select(Role.id).where(Role.name == "agent")),
        "email": "raw@example.com",
        "password_hash": "x",
        "first_name": "Raw",
        "last_name": "Insert",
        "is_active": 1,
    }
    values.update(overrides)
    session.execute(
        text(
            "INSERT INTO users (role_id, email, password_hash, first_name, last_name, is_active)"
            " VALUES (:role_id, :email, :password_hash, :first_name, :last_name, :is_active)"
        ),
        values,
    )
    session.commit()


def test_database_enforces_unique_email_case_insensitively(mysql_api, mysql_sessions):
    with mysql_sessions() as session:
        _insert_user(session, email="dup@example.com")
        with pytest.raises(IntegrityError) as excinfo:
            _insert_user(session, email="DUP@example.com")
        assert excinfo.value.orig.args[0] == 1062


def test_database_enforces_role_foreign_key(mysql_api, mysql_sessions):
    with mysql_sessions() as session, pytest.raises(IntegrityError) as excinfo:
        _insert_user(session, role_id=999_999)
    assert excinfo.value.orig.args[0] == 1452


def test_role_in_use_cannot_be_deleted(make_user, mysql_sessions):
    make_user("holder@example.com", RoleName.AGENT)
    with mysql_sessions() as session, pytest.raises(IntegrityError) as excinfo:
        session.execute(text("DELETE FROM roles WHERE name = 'agent'"))
        session.commit()
    assert excinfo.value.orig.args[0] == 1451


def test_database_enforces_active_flag_values(mysql_api, mysql_sessions):
    with mysql_sessions() as session, pytest.raises(OperationalError) as excinfo:
        _insert_user(session, is_active=2)
    assert excinfo.value.orig.args[0] == 3819  # check constraint violated


def test_password_is_stored_only_as_argon2_hash(make_user, mysql_sessions):
    user = make_user("hash@example.com", RoleName.POLICYHOLDER)
    with mysql_sessions() as session:
        stored = session.scalar(
            text("SELECT password_hash FROM users WHERE id = :id"), {"id": user.id}
        )
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored
    assert verify_password(PASSWORD, stored)


def test_service_normalises_email_and_maps_duplicate_to_conflict(make_user, mysql_sessions):
    user = make_user("  Mixed.Case@Example.COM ", RoleName.AGENT)
    assert user.email == "mixed.case@example.com"
    with pytest.raises(ConflictError):
        make_user("mixed.case@example.com", RoleName.POLICYHOLDER)
    with mysql_sessions() as session:
        assert session.scalar(text("SELECT COUNT(*) FROM users")) == 1, "no partial insert"


# --- login and current user -------------------------------------------------


def test_login_returns_bearer_token(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    response = _login(mysql_api, "admin@example.com")
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 30 * 60
    assert body["access_token"].count(".") == 2


def test_login_email_is_case_insensitive(make_user, mysql_api):
    make_user("case@example.com", RoleName.AGENT)
    assert _login(mysql_api, "CASE@Example.com").status_code == 200


@pytest.mark.parametrize(
    ("email", "password"),
    [("user@example.com", "Wrong-Password-1"), ("nobody@example.com", PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
def test_login_failures_are_401_and_indistinguishable(make_user, mysql_api, email, password):
    make_user("user@example.com", RoleName.AGENT)
    response = _login(mysql_api, email, password)
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password.", "code": "unauthorized"}


def test_inactive_user_cannot_login(make_user, mysql_api):
    make_user("off@example.com", RoleName.AGENT, is_active=False)
    response = _login(mysql_api, "off@example.com")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_me_returns_current_user_from_mysql(make_user, mysql_api):
    user = make_user("me@example.com", RoleName.POLICYHOLDER)
    response = mysql_api.get("/api/v1/auth/me", headers=_token_headers(mysql_api, "me@example.com"))
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "id": user.id,
        "email": "me@example.com",
        "first_name": "Test",
        "last_name": "Policyholder",
        "is_active": True,
        "role": {"id": body["role"]["id"], "name": "policyholder"},
    }
    assert "password" not in response.text and "argon2" not in response.text


def test_token_for_deleted_user_is_401(make_user, mysql_api, mysql_sessions):
    make_user("gone@example.com", RoleName.AGENT)
    headers = _token_headers(mysql_api, "gone@example.com")
    with mysql_sessions() as session:
        session.execute(text("DELETE FROM users"))
        session.commit()
    assert mysql_api.get("/api/v1/auth/me", headers=headers).status_code == 401


# --- RBAC -------------------------------------------------------------------


def test_rbac_admin_and_agent_endpoints(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    make_user("agent@example.com", RoleName.AGENT)
    make_user("holder@example.com", RoleName.POLICYHOLDER)
    admin = _token_headers(mysql_api, "admin@example.com")
    agent = _token_headers(mysql_api, "agent@example.com")
    holder = _token_headers(mysql_api, "holder@example.com")

    assert mysql_api.get("/api/v1/auth/test/admin", headers=admin).status_code == 200
    assert mysql_api.get("/api/v1/auth/test/admin", headers=agent).status_code == 403
    assert mysql_api.get("/api/v1/auth/test/agent", headers=agent).status_code == 200
    assert mysql_api.get("/api/v1/auth/test/agent", headers=admin).status_code == 403
    assert mysql_api.get("/api/v1/auth/test/agent", headers=holder).status_code == 403
    assert mysql_api.get("/api/v1/auth/test/admin").status_code == 401


def test_deactivation_revokes_existing_token_immediately(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    agent_user = make_user("agent@example.com", RoleName.AGENT)
    admin = _token_headers(mysql_api, "admin@example.com")
    agent = _token_headers(mysql_api, "agent@example.com")
    assert mysql_api.get("/api/v1/auth/test/agent", headers=agent).status_code == 200

    response = mysql_api.patch(
        f"/api/v1/users/{agent_user.id}/status", json={"is_active": False}, headers=admin
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    # The still-unexpired token is rejected, and a new login fails.
    assert mysql_api.get("/api/v1/auth/test/agent", headers=agent).status_code == 401
    assert mysql_api.get("/api/v1/auth/me", headers=agent).status_code == 401
    assert _login(mysql_api, "agent@example.com").status_code == 401

    mysql_api.patch(
        f"/api/v1/users/{agent_user.id}/status", json={"is_active": True}, headers=admin
    )
    assert mysql_api.get("/api/v1/auth/me", headers=agent).status_code == 200


def test_administrator_cannot_deactivate_self(make_user, mysql_api):
    admin_user = make_user("admin@example.com", RoleName.ADMINISTRATOR)
    headers = _token_headers(mysql_api, "admin@example.com")
    response = mysql_api.patch(
        f"/api/v1/users/{admin_user.id}/status", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 409


def test_status_update_for_unknown_user_is_404(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    response = mysql_api.patch(
        "/api/v1/users/999999/status",
        json={"is_active": False},
        headers=_token_headers(mysql_api, "admin@example.com"),
    )
    assert response.status_code == 404


# --- user administration API ------------------------------------------------


def _new_user_payload(email: str = "new@example.com") -> dict:
    return {
        "email": email,
        "password": "New-User-Password-1",
        "first_name": "New",
        "last_name": "User",
        "role": "agent",
    }


def test_administrator_creates_user_who_can_then_login(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    admin = _token_headers(mysql_api, "admin@example.com")

    response = mysql_api.post("/api/v1/users", json=_new_user_payload(), headers=admin)
    assert response.status_code == 201
    assert response.json()["role"]["name"] == "agent"
    assert "New-User-Password-1" not in response.text

    login = _login(mysql_api, "new@example.com", "New-User-Password-1")
    assert login.status_code == 200


def test_duplicate_email_via_api_is_409(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    admin = _token_headers(mysql_api, "admin@example.com")
    assert (
        mysql_api.post("/api/v1/users", json=_new_user_payload(), headers=admin).status_code == 201
    )

    response = mysql_api.post(
        "/api/v1/users", json=_new_user_payload("NEW@example.com"), headers=admin
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": "A user with this email already exists.",
        "code": "conflict",
    }


def test_only_administrators_create_users(make_user, mysql_api):
    make_user("agent@example.com", RoleName.AGENT)
    agent = _token_headers(mysql_api, "agent@example.com")
    assert (
        mysql_api.post("/api/v1/users", json=_new_user_payload(), headers=agent).status_code == 403
    )
    assert mysql_api.post("/api/v1/users", json=_new_user_payload()).status_code == 401


def test_create_user_validates_role_and_password(make_user, mysql_api):
    make_user("admin@example.com", RoleName.ADMINISTRATOR)
    admin = _token_headers(mysql_api, "admin@example.com")
    bad_role = {**_new_user_payload(), "role": "claims_officer"}
    short_password = {**_new_user_payload(), "password": "short"}
    for payload in (bad_role, short_password):
        response = mysql_api.post("/api/v1/users", json=payload, headers=admin)
        assert response.status_code == 422


# --- development seed -------------------------------------------------------


def test_seed_creates_one_user_per_role_and_is_idempotent(mysql_api, mysql_sessions):
    with mysql_sessions() as session:
        assert len(seed_dev_users(session)) == len(DEV_USERS)
    with mysql_sessions() as session:
        assert seed_dev_users(session) == []
        roles = dict(session.execute(select(User.email, Role.name).join(User.role)).all())
    assert roles == {email: role.value for email, *_, role in DEV_USERS}
    assert _login(mysql_api, "admin@example.com", DEV_PASSWORD).status_code == 200
