"""Every failure path produces the same structured, non-leaky JSON error."""

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
)
from app.main import create_app


class _Payload(BaseModel):
    name: str = Field(min_length=2)
    password: str
    amount: int = Field(gt=0)


def _build_client() -> TestClient:
    router = APIRouter(prefix="/_test")

    @router.post("/validate")
    def validate(payload: _Payload) -> dict:
        return {"ok": True}

    @router.get("/unauthorized")
    def unauthorized():
        raise UnauthorizedError()

    @router.get("/forbidden")
    def forbidden():
        raise ForbiddenError()

    @router.get("/not-found")
    def not_found():
        raise NotFoundError("Policy POL-1 was not found.")

    @router.get("/conflict")
    def conflict():
        raise ConflictError("Policy is already active.")

    @router.get("/integrity")
    def integrity():
        raise IntegrityError(
            "INSERT INTO policies (number) VALUES (%s)",
            {"number": "POL-1"},
            Exception(1062, "Duplicate entry 'POL-1' for key 'uq_policies_number'"),
        )

    @router.get("/db-down")
    def db_down():
        raise OperationalError(
            "SELECT 1", {}, Exception(2003, "Can't connect to MySQL server on '10.0.0.5'")
        )

    @router.get("/db-check-violation")
    def db_check_violation():
        raise OperationalError("INSERT ...", {}, Exception(3819, "Check constraint violated"))

    @router.get("/db-bug")
    def db_bug():
        raise ProgrammingError("SELECT * FROM secret_table", {}, Exception(1146, "no table"))

    @router.get("/crash")
    def crash():
        raise RuntimeError(r"C:\internal\path\secret.py exploded with password=hunter2")

    app = create_app()
    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def client():
    return _build_client()


def _assert_error(response, status, code, detail=None):
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["code"] == code
    assert isinstance(body["detail"], str) and body["detail"]
    if detail:
        assert body["detail"] == detail
    return body


def test_validation_error_is_422_with_field_errors(client):
    response = client.post(
        "/_test/validate", json={"name": "x", "password": "hunter2", "amount": 0}
    )
    body = _assert_error(response, 422, "validation_error", "Request validation failed.")
    fields = {err["field"] for err in body["errors"]}
    assert fields == {"body.name", "body.amount"}
    for err in body["errors"]:
        assert set(err) == {"field", "message", "type"}
    assert "hunter2" not in response.text, "submitted input must not be echoed back"


def test_missing_body_is_validation_error(client):
    _assert_error(client.post("/_test/validate"), 422, "validation_error")


def test_unauthorized_is_401_with_challenge(client):
    response = client.get("/_test/unauthorized")
    _assert_error(response, 401, "unauthorized")
    assert response.headers["www-authenticate"] == "Bearer"


def test_forbidden_is_403(client):
    _assert_error(client.get("/_test/forbidden"), 403, "forbidden")


def test_not_found_is_404_with_custom_message(client):
    _assert_error(client.get("/_test/not-found"), 404, "not_found", "Policy POL-1 was not found.")


def test_unknown_route_is_structured_404(client):
    _assert_error(client.get("/api/v1/does-not-exist"), 404, "not_found")


def test_wrong_method_is_structured_405(client):
    _assert_error(client.delete("/api/v1/health"), 405, "method_not_allowed")


def test_conflict_is_409(client):
    _assert_error(client.get("/_test/conflict"), 409, "conflict", "Policy is already active.")


def test_database_integrity_error_is_409_without_sql(client):
    response = client.get("/_test/integrity")
    _assert_error(response, 409, "conflict")
    for leaked in ("INSERT", "uq_policies_number", "Duplicate", "POL-1"):
        assert leaked not in response.text


def test_database_connection_error_is_503_without_details(client):
    response = client.get("/_test/db-down")
    _assert_error(response, 503, "database_unavailable")
    assert "10.0.0.5" not in response.text


def test_non_connection_operational_error_is_500_not_503(client):
    _assert_error(client.get("/_test/db-check-violation"), 500, "internal_error")


def test_other_database_error_is_500_without_sql(client):
    response = client.get("/_test/db-bug")
    _assert_error(response, 500, "internal_error")
    assert "secret_table" not in response.text


def test_unexpected_exception_is_500_without_internals(client):
    response = client.get("/_test/crash")
    body = _assert_error(response, 500, "internal_error")
    assert body == {"detail": "An unexpected error occurred.", "code": "internal_error"}
    for leaked in ("hunter2", "secret.py", "Traceback", "RuntimeError"):
        assert leaked not in response.text


def test_unexpected_exception_is_logged_server_side(client, caplog):
    client.get("/_test/crash")
    record = next(r for r in caplog.records if r.getMessage() == "Unhandled exception")
    assert record.levelname == "ERROR"
    assert record.path == "/_test/crash"
    assert record.exc_info is not None
