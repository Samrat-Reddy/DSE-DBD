"""Integration tests against a real MySQL server.

Configure TEST_DATABASE_URL (environment or backend/.env) to point at a
disposable schema, e.g. `ipms_test` from sql/create_database.sql. These tests
create and drop their own tables there. Without it they are skipped.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import Engine, MetaData, String, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.db.base import NAMING_CONVENTION, IntPK, Money, TimestampMixin
from app.db.session import get_db
from app.main import app
from tests.conftest import run_alembic

pytestmark = pytest.mark.mysql

HEAD = "0005_claim_workflow"


class _ProbeBase(DeclarativeBase):
    """Separate metadata so the probe table never reaches Alembic autogenerate."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class _Probe(TimestampMixin, _ProbeBase):
    __tablename__ = "zz_foundation_probes"

    id: Mapped[IntPK]
    code: Mapped[str] = mapped_column(String(20), unique=True)
    amount: Mapped[Money]


@pytest.fixture
def probe_table(mysql_engine: Engine):
    _ProbeBase.metadata.drop_all(mysql_engine)
    _ProbeBase.metadata.create_all(mysql_engine)
    yield
    _ProbeBase.metadata.drop_all(mysql_engine)


def _open_session(engine: Engine) -> Session:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


@pytest.fixture
def mysql_session(mysql_engine: Engine):
    session = _open_session(mysql_engine)
    yield session
    session.close()


@pytest.fixture
def probe_session(mysql_engine: Engine, probe_table):
    # Depends on probe_table so it is closed *before* the table is dropped: an
    # open transaction holds a metadata lock and DROP TABLE would wait forever.
    session = _open_session(mysql_engine)
    yield session
    session.close()


def test_connects_to_mysql_8(mysql_engine: Engine):
    with mysql_engine.connect() as connection:
        version = connection.execute(text("SELECT VERSION()")).scalar_one()
        charset = connection.execute(text("SELECT @@character_set_client")).scalar_one()
        time_zone = connection.execute(text("SELECT @@session.time_zone")).scalar_one()
    assert int(version.split(".")[0]) >= 8
    assert charset == "utf8mb4"
    assert time_zone == "+00:00"


def test_readiness_is_ready_against_real_mysql(client, mysql_session: Session):
    app.dependency_overrides[get_db] = lambda: mysql_session
    try:
        response = client.get("/api/v1/health/ready")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok"}


def test_conventions_produce_expected_mysql_schema(mysql_engine: Engine, probe_table):
    inspector = inspect(mysql_engine)
    columns = {c["name"]: c for c in inspector.get_columns("zz_foundation_probes")}

    assert str(columns["id"]["type"]).startswith("BIGINT")
    assert columns["id"]["autoincrement"] is True
    assert str(columns["amount"]["type"]) == "DECIMAL(14, 2)"
    assert {u["name"] for u in inspector.get_unique_constraints("zz_foundation_probes")} == {
        "uq_zz_foundation_probes_code"
    }


def test_timestamps_are_set_by_mysql(probe_session: Session):
    mysql_session = probe_session
    probe = _Probe(code="A-1", amount=Decimal("1250.50"))
    mysql_session.add(probe)
    mysql_session.commit()
    mysql_session.refresh(probe)

    now = mysql_session.execute(text("SELECT UTC_TIMESTAMP()")).scalar_one()
    assert abs(now - probe.created_at) < timedelta(minutes=1)
    assert probe.updated_at == probe.created_at
    assert probe.amount == Decimal("1250.50")

    # Push created/updated into the past, then check ON UPDATE bumps updated_at.
    mysql_session.execute(
        text("UPDATE zz_foundation_probes SET created_at = :t, updated_at = :t WHERE id = :id"),
        {"t": datetime(2020, 1, 1), "id": probe.id},
    )
    mysql_session.execute(
        text("UPDATE zz_foundation_probes SET amount = 1 WHERE id = :id"), {"id": probe.id}
    )
    mysql_session.commit()
    created, updated = mysql_session.execute(
        select(_Probe.created_at, _Probe.updated_at).where(_Probe.id == probe.id)
    ).one()
    assert created == datetime(2020, 1, 1)
    assert updated > created


def test_unique_violation_raises_integrity_error_and_rolls_back(probe_session: Session):
    mysql_session = probe_session
    mysql_session.add(_Probe(code="DUP", amount=Decimal("1")))
    mysql_session.commit()

    mysql_session.add(_Probe(code="DUP", amount=Decimal("2")))
    with pytest.raises(IntegrityError):
        mysql_session.commit()
    mysql_session.rollback()

    count = mysql_session.execute(text("SELECT COUNT(*) FROM zz_foundation_probes")).scalar_one()
    assert count == 1


def test_alembic_upgrade_and_downgrade(mysql_engine: Engine):
    def version(connection) -> str | None:
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()

    with mysql_engine.begin() as connection:
        run_alembic(connection, command.upgrade, "head")
        assert version(connection) == HEAD

        run_alembic(connection, command.downgrade, "0001_baseline")
        assert version(connection) == "0001_baseline"
        assert not {"roles", "users", "products", "policies"} & set(
            inspect(connection).get_table_names()
        )

        run_alembic(connection, command.downgrade, "base")
        assert version(connection) is None

        # Leave the schema migrated for the rest of the suite.
        run_alembic(connection, command.upgrade, "head")
        assert version(connection) == HEAD
        assert {"roles", "users", "products", "policies"} <= set(
            inspect(connection).get_table_names()
        )
