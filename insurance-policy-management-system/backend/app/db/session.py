"""MySQL engine, session factory and the per-request session dependency."""

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings


def create_db_engine(settings: Settings) -> Engine:
    url = make_url(settings.database_url.get_secret_value())
    if "charset" not in url.query:
        url = url.update_query_dict({"charset": "utf8mb4"})

    return create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        # MySQL drops idle connections after wait_timeout (8h by default);
        # recycle earlier and ping before use so requests never get a dead one.
        pool_recycle=settings.db_pool_recycle_seconds,
        pool_pre_ping=True,
        echo=settings.db_echo,
        connect_args={
            "connect_timeout": settings.db_connect_timeout_seconds,
            # Store and compare all DATETIME values in UTC regardless of server zone.
            "init_command": "SET time_zone = '+00:00'",
        },
    )


engine = create_db_engine(get_settings())

# expire_on_commit=False lets services return ORM objects after committing
# without triggering a lazy reload during response serialisation.
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed afterwards.

    Services own transaction boundaries and call `commit()` explicitly; anything
    left uncommitted (including after an exception) is rolled back on close.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def ping_database(session: Session) -> None:
    """Round-trip to MySQL. Raises SQLAlchemyError if it is unreachable."""
    session.execute(text("SELECT 1"))
