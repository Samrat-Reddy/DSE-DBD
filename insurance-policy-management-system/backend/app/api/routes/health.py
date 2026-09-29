"""Liveness and readiness probes."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db, ping_database
from app.schemas.common import LivenessResponse, ReadinessResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["Health"])


def _liveness(settings: Settings) -> LivenessResponse:
    return LivenessResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )


@router.get("", response_model=LivenessResponse, summary="Health (alias of /health/live)")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> LivenessResponse:
    return _liveness(settings)


@router.get("/live", response_model=LivenessResponse, summary="Liveness: the process is serving")
def liveness(settings: Annotated[Settings, Depends(get_settings)]) -> LivenessResponse:
    """Does not touch MySQL, so it stays green while the database is down."""
    return _liveness(settings)


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness: the API can reach MySQL",
    responses={503: {"model": ReadinessResponse, "description": "MySQL is unreachable"}},
)
def readiness(db: Annotated[Session, Depends(get_db)]) -> ReadinessResponse | JSONResponse:
    try:
        ping_database(db)
    except SQLAlchemyError as exc:
        # Log the exception type only: driver messages can include host/user details.
        logger.error(
            "Readiness check failed: database unreachable", extra={"error": type(exc).__name__}
        )
        return JSONResponse(
            status_code=503,
            content=ReadinessResponse(status="unavailable", database="unavailable").model_dump(),
        )
    return ReadinessResponse(status="ready", database="ok")
