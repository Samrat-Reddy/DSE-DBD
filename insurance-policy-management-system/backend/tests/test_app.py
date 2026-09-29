"""Application startup, health probes, OpenAPI docs and CORS."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import create_db_engine, get_db
from app.main import app, create_app


def test_app_starts_and_stops_cleanly():
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/health/live").status_code == 200


def test_health_does_not_need_database(client):
    # The unit-test DATABASE_URL points at a closed port, so this passing
    # proves liveness is independent of MySQL.
    for path in ("/api/v1/health", "/api/v1/health/live"):
        response = client.get(path)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["environment"] == "test"
        assert body["version"]


def test_readiness_reports_503_when_mysql_unreachable(client):
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}


def test_readiness_reports_ok_when_database_answers(client):
    class _HealthySession:
        def execute(self, statement):
            assert str(statement) == "SELECT 1"

    app.dependency_overrides[get_db] = lambda: _HealthySession()
    try:
        response = client.get("/api/v1/health/ready")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok"}


def test_readiness_unavailable_response_leaks_no_connection_details(client):
    text = client.get("/api/v1/health/ready").text
    for secret in ("unit:unit", "127.0.0.1", "pymysql", "OperationalError"):
        assert secret not in text


def test_openapi_docs_and_redoc_are_served(client):
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200

    schema = client.get("/openapi.json").json()
    for path in ("/api/v1/health", "/api/v1/health/live", "/api/v1/health/ready"):
        assert path in schema["paths"]


def test_cors_allows_configured_origin_only(client):
    headers = {"Access-Control-Request-Method": "GET"}
    allowed = client.options(
        "/api/v1/health", headers={**headers, "Origin": "http://localhost:5173"}
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"

    denied = client.options("/api/v1/health", headers={**headers, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_engine_uses_mysql_utf8mb4_and_pool_settings():
    engine = create_db_engine(get_settings())
    try:
        assert engine.dialect.name == "mysql"
        assert engine.url.query["charset"] == "utf8mb4"
        assert engine.pool.size() == get_settings().db_pool_size
        assert engine.pool._pre_ping is True
    finally:
        engine.dispose()


def test_get_db_yields_a_session_and_always_closes_it(monkeypatch):
    import app.db.session as session_module

    opened: list[Session] = []

    class _TrackingSession(Session):
        closed = False

        def close(self):
            self.closed = True
            super().close()

    def factory():
        opened.append(_TrackingSession())
        return opened[-1]

    monkeypatch.setattr(session_module, "SessionLocal", factory)

    dependency = get_db()
    session = next(dependency)
    assert isinstance(session, Session)
    dependency.close()
    assert session.closed

    # Also closed when the request handler raises.
    dependency = get_db()
    next(dependency)
    try:
        dependency.throw(RuntimeError("boom"))
    except RuntimeError:
        pass
    assert opened[-1].closed
    assert opened[0] is not opened[1], "each request must get its own session"
