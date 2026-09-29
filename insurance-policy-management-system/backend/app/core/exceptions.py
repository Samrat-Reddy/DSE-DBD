"""Application errors and the handlers that turn every failure into one JSON shape.

Every error response looks like:

    {"detail": "Human readable message.", "code": "not_found", "errors": [...]}

`detail` is always a string (the frontend `apiClient` displays it directly);
`errors` is only present for field-level problems such as validation failures.
Responses never contain SQL, stack traces, credentials or file paths; those go
to the server log only.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for errors raised deliberately by services and routes."""

    status_code = 500
    code = "internal_error"
    message = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        errors: list[dict[str, Any]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message = message or self.message
        self.errors = errors
        self.headers = headers
        super().__init__(self.message)


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"
    message = "Authentication is required."

    def __init__(self, message: str | None = None, **kwargs: Any) -> None:
        kwargs.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(message, **kwargs)


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"
    message = "You do not have permission to perform this action."


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    message = "The requested resource was not found."


class ConflictError(AppError):
    status_code = 409
    code = "conflict"
    message = "The request conflicts with the current state of the resource."


class UnprocessableError(AppError):
    """The request is well-formed but breaks a business rule."""

    status_code = 422
    code = "unprocessable"
    message = "The request could not be processed."


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "service_unavailable"
    message = "The service is temporarily unavailable."


# Codes for errors raised by FastAPI/Starlette itself (unknown route, bad method...).
_HTTP_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "too_many_requests",
}


def error_body(
    detail: str, code: str, errors: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"detail": detail, "code": code}
    if errors:
        body["errors"] = errors
    return body


def _request_context(request: Request) -> dict[str, str]:
    return {"method": request.method, "path": request.url.path}


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    log = logger.error if exc.status_code >= 500 else logger.info
    log(
        "Request failed: %s",
        exc.code,
        extra={**_request_context(request), "status": exc.status_code},
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(exc.message, exc.code, exc.errors),
        headers=exc.headers,
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _HTTP_STATUS_CODES.get(exc.status_code, "http_error")
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(detail, code),
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # The submitted `input` is deliberately dropped: it may contain passwords.
    errors = [
        {
            "field": ".".join(str(part) for part in err.get("loc", ())),
            "message": err.get("msg", "Invalid value."),
            "type": err.get("type", "value_error"),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=error_body("Request validation failed.", "validation_error", errors),
    )


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    # Services should catch expected constraint violations and raise ConflictError
    # with a domain message; this is the safety net for anything they miss.
    # Only the MySQL error number is logged; the message can echo row values.
    db_errno = _mysql_errno(exc)
    logger.warning(
        "Database integrity error", extra={**_request_context(request), "db_errno": db_errno}
    )
    return JSONResponse(
        status_code=409,
        content=error_body("The request conflicts with existing data.", "conflict"),
    )


# MySQL client/server error numbers that mean "cannot reach or use the server".
# Other OperationalErrors (e.g. 3819 CHECK constraint violated) are bugs -> 500.
_MYSQL_UNAVAILABLE_ERRNOS = {1040, 1045, 1049, 1053, 2002, 2003, 2005, 2006, 2013, 2055}


def _mysql_errno(exc: SQLAlchemyError) -> int | None:
    orig = getattr(exc, "orig", None)
    if orig is not None and orig.args and isinstance(orig.args[0], int):
        return orig.args[0]
    return None


async def database_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    db_errno = _mysql_errno(exc)
    if (isinstance(exc, DBAPIError) and exc.connection_invalidated) or (
        isinstance(exc, OperationalError) and db_errno in _MYSQL_UNAVAILABLE_ERRNOS
    ):
        logger.error(
            "Database unavailable",
            extra={**_request_context(request), "db_errno": db_errno},
            exc_info=exc,
        )
        return JSONResponse(
            status_code=503,
            content=error_body("The database is temporarily unavailable.", "database_unavailable"),
        )
    logger.error(
        "Unhandled database error",
        extra={**_request_context(request), "db_errno": db_errno},
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content=error_body(AppError.message, AppError.code),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception", extra=_request_context(request), exc_info=exc)
    return JSONResponse(status_code=500, content=error_body(AppError.message, AppError.code))


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(SQLAlchemyError, database_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
