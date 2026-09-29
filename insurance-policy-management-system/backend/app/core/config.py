"""Application settings, loaded once from environment variables / `.env`.

Everything configurable lives on the single `Settings` object returned by
`get_settings()`. Nothing else in the backend should read `os.environ`.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

# backend/.env, independent of the directory the process was started from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Never echo raw values (e.g. a malformed DATABASE_URL with its password)
        # in validation error messages.
        hide_input_in_errors=True,
    )

    app_name: str = "Insurance Policy Management System API"
    app_version: str = "0.1.0"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    # Kept as SecretStr so the password never appears in reprs or logs.
    database_url: SecretStr
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_pool_recycle_seconds: int = Field(default=1800, ge=1)
    db_connect_timeout_seconds: int = Field(default=5, ge=1)
    db_echo: bool = False

    # Comma-separated in the environment, e.g. "http://localhost:5173,http://127.0.0.1:5173".
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # JWT access tokens. The secret signs every token: generate it with
    # `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
    jwt_secret_key: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = "ipms-api"
    access_token_expire_minutes: int = Field(default=30, ge=1, le=1440)

    @field_validator("database_url")
    @classmethod
    def _require_mysql(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except (ArgumentError, ValueError):
            raise ValueError(
                "DATABASE_URL is not a valid URL; expected "
                "mysql+pymysql://user:password@host:3306/database"
            ) from None
        if url.get_backend_name() != "mysql":
            raise ValueError(
                "DATABASE_URL must point to MySQL, e.g. mysql+pymysql://user:pass@host:3306/db"
            )
        if not url.database:
            raise ValueError("DATABASE_URL must include a database (schema) name")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("api_prefix")
    @classmethod
    def _normalise_prefix(cls, value: str) -> str:
        return "/" + value.strip("/") if value.strip("/") else ""

    @property
    def database_url_safe(self) -> str:
        """DATABASE_URL with the password masked, safe for logging."""
        return make_url(self.database_url.get_secret_value()).render_as_string(hide_password=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
