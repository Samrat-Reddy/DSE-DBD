"""Alembic environment.

The database URL comes from the application settings (DATABASE_URL / .env),
never from alembic.ini, so credentials live in exactly one place. It is also
never written into the Alembic config object, because configparser would treat
`%` in URL-encoded passwords as interpolation syntax.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

import app.models  # noqa: F401  (registers every model on Base.metadata)
from app.core.config import get_settings
from app.db.base import Base

config = context.config

# Programmatic callers (the test suite) pass a connection and keep their own
# logging configuration.
if config.config_file_name is not None and "connection" not in config.attributes:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url():
    url = make_url(get_settings().database_url.get_secret_value())
    if "charset" not in url.query:
        url = url.update_query_dict({"charset": "utf8mb4"})
    return url


def run_migrations_offline() -> None:
    """Emit SQL to stdout (`alembic upgrade head --sql`) without connecting."""
    context.configure(
        url=_database_url().render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Tests may hand over an existing connection (see tests/test_mysql_integration.py).
    connection = config.attributes.get("connection")
    if connection is not None:
        _run_with_connection(connection)
        return

    engine = create_engine(_database_url(), pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            _run_with_connection(connection)
    finally:
        engine.dispose()


def _run_with_connection(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
