"""Current-user resolution and role dependencies, with the user lookup stubbed.

Real-MySQL coverage of the same flows lives in test_auth_mysql.py.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import require_any_role, require_role
from app.core.config import get_settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import create_access_token
from app.models import RoleName
from app.services import auth as auth_service


def _user(user_id=1, role=RoleName.AGENT, active=True):
    return SimpleNamespace(id=user_id, is_active=active, role=SimpleNamespace(name=role))


@pytest.fixture
def users(monkeypatch):
    """In-memory stand-in for the user repository lookup."""
    table: dict[int, SimpleNamespace] = {}
    monkeypatch.setattr(
        auth_service.user_repo, "get_user_by_id", lambda db, user_id: table.get(user_id)
    )
    return table


def _token(user_id: int) -> str:
    return create_access_token(user_id, get_settings())


def _auth(user_id: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user_id)}"}


# --- resolve_user_from_token ------------------------------------------------


def test_valid_token_resolves_active_user(users):
    users[5] = _user(5)
    assert auth_service.resolve_user_from_token(None, _token(5), get_settings()) is users[5]


def test_token_for_unknown_user_is_unauthorized(users):
    with pytest.raises(UnauthorizedError):
        auth_service.resolve_user_from_token(None, _token(404), get_settings())


def test_token_for_inactive_user_is_unauthorized(users):
    users[6] = _user(6, active=False)
    with pytest.raises(UnauthorizedError):
        auth_service.resolve_user_from_token(None, _token(6), get_settings())


def test_invalid_token_is_unauthorized(users):
    with pytest.raises(UnauthorizedError):
        auth_service.resolve_user_from_token(None, "garbage", get_settings())


# --- role dependencies ------------------------------------------------------


def test_require_role_admits_matching_role():
    agent = _user(role=RoleName.AGENT)
    assert require_role(RoleName.AGENT)(agent) is agent


def test_require_role_forbids_other_roles():
    with pytest.raises(ForbiddenError):
        require_role(RoleName.ADMINISTRATOR)(_user(role=RoleName.AGENT))


def test_require_any_role_admits_each_listed_role():
    check = require_any_role(RoleName.AGENT, RoleName.ADMINISTRATOR)
    for role in (RoleName.AGENT, RoleName.ADMINISTRATOR):
        user = _user(role=role)
        assert check(user) is user
    with pytest.raises(ForbiddenError):
        check(_user(role=RoleName.POLICYHOLDER))


def test_require_any_role_needs_at_least_one_role():
    with pytest.raises(ValueError):
        require_any_role()


# --- HTTP layer -------------------------------------------------------------


def _assert_401(response):
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_without_authorization_header_is_401(client):
    response = client.get("/api/v1/auth/me")
    _assert_401(response)
    assert response.json()["detail"] == "Not authenticated."


@pytest.mark.parametrize(
    "header",
    ["Basic dXNlcjpwYXNz", "Bearer", "Bearer ", "Token abc", "bearerabc"],
)
def test_malformed_authorization_header_is_401(client, header):
    _assert_401(client.get("/api/v1/auth/me", headers={"Authorization": header}))


def test_invalid_jwt_is_401(client):
    _assert_401(client.get("/api/v1/auth/me", headers={"Authorization": "Bearer abc.def.ghi"}))


def test_expired_jwt_is_401(client):
    from datetime import UTC, datetime, timedelta

    old = datetime.now(UTC) - timedelta(days=1)
    token = create_access_token(1, get_settings(), now=old)
    _assert_401(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}))


def test_me_returns_safe_profile(client, users):
    users[3] = SimpleNamespace(
        id=3,
        email="agent@example.com",
        first_name="Dev",
        last_name="Agent",
        is_active=True,
        password_hash="$argon2id$should-never-leak",
        role=SimpleNamespace(id=2, name=RoleName.AGENT),
    )
    response = client.get("/api/v1/auth/me", headers=_auth(3))
    assert response.status_code == 200
    assert response.json() == {
        "id": 3,
        "email": "agent@example.com",
        "first_name": "Dev",
        "last_name": "Agent",
        "is_active": True,
        "role": {"id": 2, "name": "agent"},
    }
    assert "argon2" not in response.text


def test_role_protected_endpoint_is_403_for_wrong_role(client, users):
    users[3] = _user(3, role=RoleName.AGENT)
    response = client.get("/api/v1/auth/test/admin", headers=_auth(3))
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_role_protected_endpoint_is_200_for_right_role(client, users):
    users[1] = _user(1, role=RoleName.ADMINISTRATOR)
    response = client.get("/api/v1/auth/test/admin", headers=_auth(1))
    assert response.status_code == 200
    assert response.json()["role"] == "administrator"


def test_login_rejects_invalid_payload_without_echoing_password(client):
    response = client.post(
        "/api/v1/auth/login", json={"email": "not-an-email", "password": "hunter2-secret"}
    )
    assert response.status_code == 422
    assert "hunter2-secret" not in response.text


def test_openapi_describes_bearer_auth_and_auth_routes(client):
    schema = client.get("/openapi.json").json()
    schemes = schema["components"]["securitySchemes"]
    assert schemes["HTTPBearer"] == {
        "type": "http",
        "scheme": "bearer",
        "description": "JWT from POST /auth/login",
    }
    for path in (
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/auth/test/admin",
        "/api/v1/auth/test/agent",
        "/api/v1/users",
        "/api/v1/users/{user_id}/status",
    ):
        assert path in schema["paths"]
    assert schema["paths"]["/api/v1/auth/me"]["get"]["security"] == [{"HTTPBearer": []}]
    assert "security" not in schema["paths"]["/api/v1/auth/login"]["post"]


def test_rbac_check_endpoints_not_mounted_in_production():
    from app.main import create_app

    prod = create_app(get_settings().model_copy(update={"app_env": "production"}))
    paths = prod.openapi()["paths"]
    assert "/api/v1/auth/test/admin" not in paths
    assert "/api/v1/auth/me" in paths
    with TestClient(prod) as prod_client:
        assert prod_client.get("/api/v1/auth/test/admin").status_code == 404
