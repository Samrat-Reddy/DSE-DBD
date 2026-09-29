"""Password hashing and JWT utilities (no database)."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import (
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="module")
def settings():
    return get_settings()


def _sign(claims: dict, key: str | None = None, algorithm: str = "HS256") -> str:
    return jwt.encode(
        claims, key or get_settings().jwt_secret_key.get_secret_value(), algorithm=algorithm
    )


def _claims(**overrides) -> dict:
    now = datetime.now(UTC)
    claims = {"sub": "42", "iss": "ipms-api", "iat": now, "exp": now + timedelta(minutes=5)}
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


# --- passwords --------------------------------------------------------------


def test_hash_is_argon2id_and_not_plaintext():
    hashed = hash_password(PASSWORD)
    assert hashed.startswith("$argon2id$")
    assert PASSWORD not in hashed


def test_same_password_hashes_differently_each_time():
    assert hash_password(PASSWORD) != hash_password(PASSWORD)


def test_verify_accepts_correct_password():
    assert verify_password(PASSWORD, hash_password(PASSWORD)) is True


def test_verify_rejects_wrong_password():
    hashed = hash_password(PASSWORD)
    assert verify_password("wrong password", hashed) is False
    assert verify_password(PASSWORD.upper(), hashed) is False
    assert verify_password("", hashed) is False


@pytest.mark.parametrize("stored", ["", "plaintext", "$argon2id$garbage", "$2b$12$bcryptish"])
def test_verify_treats_corrupt_hash_as_mismatch(stored):
    assert verify_password(PASSWORD, stored) is False


# --- JWT --------------------------------------------------------------------


def test_token_round_trip_returns_user_id(settings):
    assert decode_access_token(create_access_token(42, settings), settings) == 42


def test_token_carries_only_identity_claims(settings):
    claims = jwt.decode(
        create_access_token(7, settings),
        options={"verify_signature": False},
    )
    assert set(claims) == {"sub", "iss", "iat", "exp"}
    assert claims["sub"] == "7"
    assert claims["exp"] - claims["iat"] == settings.access_token_expire_minutes * 60


def test_expired_token_rejected(settings):
    issued = datetime.now(UTC) - timedelta(minutes=settings.access_token_expire_minutes + 1)
    token = create_access_token(1, settings, now=issued)
    with pytest.raises(InvalidTokenError, match="ExpiredSignatureError"):
        decode_access_token(token, settings)


@pytest.mark.parametrize("token", ["", "not-a-jwt", "a.b.c", "Bearer abc"])
def test_malformed_token_rejected(settings, token):
    with pytest.raises(InvalidTokenError):
        decode_access_token(token, settings)


def test_token_signed_with_other_secret_rejected(settings):
    token = _sign(_claims(), key="some-other-secret-that-is-long-enough-1234")
    with pytest.raises(InvalidTokenError, match="InvalidSignatureError"):
        decode_access_token(token, settings)


def test_unsigned_alg_none_token_rejected(settings):
    token = jwt.encode(_claims(), key=None, algorithm="none")
    with pytest.raises(InvalidTokenError):
        decode_access_token(token, settings)


def test_token_with_other_algorithm_rejected(settings):
    with pytest.raises(InvalidTokenError):
        decode_access_token(_sign(_claims(), algorithm="HS512"), settings)


@pytest.mark.parametrize("missing", ["sub", "exp", "iat", "iss"])
def test_token_missing_required_claim_rejected(settings, missing):
    claims = _claims()
    del claims[missing]
    with pytest.raises(InvalidTokenError):
        decode_access_token(_sign(claims), settings)


def test_token_from_other_issuer_rejected(settings):
    with pytest.raises(InvalidTokenError, match="InvalidIssuerError"):
        decode_access_token(_sign(_claims(iss="someone-else")), settings)


@pytest.mark.parametrize("subject", ["abc", "-1", "1.5", ""])
def test_token_with_non_numeric_subject_rejected(settings, subject):
    with pytest.raises(InvalidTokenError):
        decode_access_token(_sign(_claims(sub=subject)), settings)


def test_jwt_secret_is_required_and_long(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    with pytest.raises(ValidationError, match="jwt_secret_key"):
        Settings(_env_file=None)

    monkeypatch.setenv("JWT_SECRET_KEY", "too-short")
    with pytest.raises(ValidationError, match="jwt_secret_key"):
        Settings(_env_file=None)
