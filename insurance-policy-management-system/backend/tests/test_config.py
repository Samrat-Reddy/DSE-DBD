import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings

MYSQL_URL = "mysql+pymysql://ipms_app:s3cret-pass@127.0.0.1:3306/ipms"


def make_settings(**overrides) -> Settings:
    # _env_file=None: these tests must not depend on a developer's backend/.env.
    return Settings(_env_file=None, **{"database_url": MYSQL_URL, **overrides})


def test_settings_load_from_environment():
    settings = get_settings()
    assert settings.app_env == "test"
    assert settings.api_prefix == "/api/v1"
    assert settings.cors_origins == ["http://localhost:5173"]


def test_get_settings_returns_single_cached_instance():
    assert get_settings() is get_settings()


def test_environment_variables_override_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", MYSQL_URL)
    monkeypatch.setenv("DB_POOL_SIZE", "3")
    monkeypatch.setenv("APP_ENV", "production")
    settings = Settings(_env_file=None)
    assert settings.db_pool_size == 3
    assert settings.app_env == "production"


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///./app.db",
        "postgresql://user:pass@localhost/ipms",
        "mysql+pymysql://user:pass@localhost:3306",
        "not a url",
    ],
)
def test_non_mysql_or_incomplete_database_urls_are_rejected(url):
    with pytest.raises(ValidationError):
        make_settings(database_url=url)


def test_cors_origins_parsed_from_comma_separated_string():
    settings = make_settings(cors_origins="http://localhost:5173/, http://127.0.0.1:5173 ,")
    assert settings.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_database_password_never_rendered():
    settings = make_settings()
    assert "s3cret-pass" not in repr(settings)
    assert "s3cret-pass" not in str(settings.model_dump())
    assert "s3cret-pass" not in settings.database_url_safe
    assert settings.database_url_safe.startswith("mysql+pymysql://ipms_app:***@127.0.0.1")


def test_api_prefix_normalised():
    assert make_settings(api_prefix="api/v1/").api_prefix == "/api/v1"


def test_malformed_database_url_error_does_not_echo_password():
    # Missing "@" between password and host makes the port unparseable.
    with pytest.raises(ValidationError) as excinfo:
        make_settings(database_url="mysql+pymysql://ipms_app:s3cret-pass127.0.0.1:3306/ipms")
    assert "s3cret-pass" not in str(excinfo.value)
    assert "DATABASE_URL is not a valid URL" in str(excinfo.value)
