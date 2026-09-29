"""Authentication and user schemas. None of them carries a password hash."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr

from app.models import RoleName

# Passwords are SecretStr so they never show up in reprs or logs, and have an
# upper bound so multi-megabyte "passwords" are not fed to Argon2.


class LoginRequest(BaseModel):
    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 (OAuth token type, not a secret)
    expires_in: int = Field(description="Seconds until the access token expires.")


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: RoleName


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    first_name: str
    last_name: str
    is_active: bool
    role: RoleOut


class UserCreate(BaseModel):
    email: EmailStr = Field(max_length=254)
    password: SecretStr = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role: RoleName
    is_active: bool = True


class UserStatusUpdate(BaseModel):
    is_active: bool


class AccessCheckResponse(BaseModel):
    message: str
    role: RoleName
