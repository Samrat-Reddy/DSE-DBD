"""Shared test setup.

Unit tests must never touch a developer's real database, so before the app is
imported DATABASE_URL is pointed at a closed local port (environment variables
take precedence over backend/.env). MySQL integration tests connect to
TEST_DATABASE_URL instead and are skipped when it is not configured.
"""

import os

os.environ.update(
    {
        "APP_ENV": "test",
        "DEBUG": "false",
        "API_PREFIX": "/api/v1",
        "DATABASE_URL": "mysql+pymysql://unit:unit@127.0.0.1:1/ipms_unit_tests",
        "DB_CONNECT_TIMEOUT_SECONDS": "1",
        "CORS_ORIGINS": "http://localhost:5173",
        # Test-only signing key; never used outside pytest.
        "JWT_SECRET_KEY": "pytest-only-signing-key-0123456789abcdef",
        "JWT_ALGORITHM": "HS256",
        "JWT_ISSUER": "ipms-api",
        "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
    }
)

from collections.abc import Callable, Iterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import SecretStr  # noqa: E402
from pydantic_settings import BaseSettings, SettingsConfigDict  # noqa: E402
from sqlalchemy import Connection, Engine, text  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.core.config import ENV_FILE, get_settings  # noqa: E402
from app.db.session import create_db_engine, get_db  # noqa: E402
from app.main import app as application  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Tables emptied after each MySQL API test, in foreign-key order.
DATA_TABLES = (
    "claim_events",
    "claim_settlements",
    "claim_assessments",
    "claim_verifications",
    "claim_documents",
    "claims",
    "claim_type_documents",
    "claim_types",
    "payments",
    "installments",
    "premium_schedules",
    "policies",
    "customers",
    "agents",
    "product_features",
    "product_term_options",
    "product_premium_frequencies",
    "products",
    "id_sequences",
    "users",
)


class _IntegrationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    test_database_url: str | None = None


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def mysql_engine() -> Iterator[Engine]:
    url = _IntegrationSettings().test_database_url
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; skipping MySQL integration tests")

    settings = get_settings().model_copy(update={"database_url": SecretStr(url)})
    engine = create_db_engine(settings)
    with engine.begin() as connection:
        run_alembic(connection, command.upgrade, "head")
    yield engine
    engine.dispose()


def run_alembic(connection: Connection, action: Callable, revision: str) -> None:
    """Run an Alembic command (upgrade/downgrade) on an existing connection."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.attributes["connection"] = connection
    # Fail fast instead of hanging if an open transaction holds a metadata lock.
    connection.execute(text("SET SESSION lock_wait_timeout = 15"))
    action(config, revision)


@pytest.fixture
def mysql_sessions(mysql_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=mysql_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def mysql_api(client: TestClient, mysql_sessions: sessionmaker[Session]) -> Iterator[TestClient]:
    """The API client, with every request using its own session on the test schema.

    Data rows are deleted afterwards (children first); roles are migration
    reference data and stay.
    """

    def _get_test_db() -> Iterator[Session]:
        session = mysql_sessions()
        try:
            yield session
        finally:
            session.close()

    application.dependency_overrides[get_db] = _get_test_db
    try:
        yield client
    finally:
        application.dependency_overrides.pop(get_db, None)
        with mysql_sessions() as session:
            for table in DATA_TABLES:
                session.execute(text(f"DELETE FROM {table}"))  # noqa: S608 (constant names)
            session.commit()
