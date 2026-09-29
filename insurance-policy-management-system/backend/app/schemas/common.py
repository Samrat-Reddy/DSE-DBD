"""Response schemas shared across the API."""

from typing import Literal

from pydantic import BaseModel


class FieldError(BaseModel):
    field: str
    message: str
    type: str


class ErrorResponse(BaseModel):
    detail: str
    code: str
    errors: list[FieldError] | None = None


class LivenessResponse(BaseModel):
    status: Literal["ok"]
    app: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "unavailable"]
    database: Literal["ok", "unavailable"]
