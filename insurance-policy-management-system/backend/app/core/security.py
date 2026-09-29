"""Password hashing (Argon2id) and JWT access tokens.

Pure functions with no database access, so they are unit-testable in isolation.
"""

from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings

# argon2-cffi defaults follow RFC 9106's recommended Argon2id parameters.
_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Return a salted Argon2id hash (algorithm, parameters and salt encoded in it)."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Check a password against a stored hash.

    The comparison happens inside the Argon2 library in constant time. A corrupt
    or foreign hash counts as a mismatch rather than an error.
    """
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


# Verified against when the email is unknown, so a failed login takes the same
# time whether or not the account exists (no user enumeration by timing).
DUMMY_PASSWORD_HASH = hash_password("not-a-real-password")


class InvalidTokenError(Exception):
    """The token is missing, malformed, expired, or its claims are invalid."""


def create_access_token(user_id: int, settings: Settings, *, now: datetime | None = None) -> str:
    """Sign a token identifying the user.

    Claims are deliberately minimal: the subject, issuer and validity window.
    Role and active status are NOT embedded; they are read from MySQL on every
    request so a role change or deactivation takes effect immediately.
    """
    issued_at = now or datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "iss": settings.jwt_issuer,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(
        claims, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_access_token(token: str, settings: Settings) -> int:
    """Validate signature, expiry and issuer; return the user id from `sub`."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            # Pinning the algorithm rejects `alg: none` and algorithm-confusion tokens.
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "iss", "iat", "exp"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(type(exc).__name__) from None

    subject = claims["sub"]
    if not isinstance(subject, str) or not subject.isdigit():
        raise InvalidTokenError("InvalidSubject")
    return int(subject)
