"""FastAPI application factory. Run with `uvicorn app.main:app --reload`."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.router import api_router
from app.api.routes.auth import rbac_check_router
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.db.session import engine
from app.schemas.common import ErrorResponse

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    logger.info(
        "Application starting",
        extra={
            "environment": settings.app_env,
            "database": settings.database_url_safe,
            "cors_origins": settings.cors_origins,
        },
    )
    # A failed probe is logged but not fatal: the API still starts, liveness
    # stays green and /health/ready reports the outage until MySQL is back.
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        logger.info("Database connection verified")
    except SQLAlchemyError as exc:
        logger.error("Database connection failed at startup", extra={"error": type(exc).__name__})

    yield

    engine.dispose()
    logger.info("Application stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging("DEBUG" if settings.debug else settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="REST API for the Insurance Policy Management System, backed by MySQL.",
        lifespan=lifespan,
        responses={
            422: {"model": ErrorResponse, "description": "Validation error"},
            500: {"model": ErrorResponse, "description": "Unexpected server error"},
        },
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    if settings.app_env != "production":
        app.include_router(rbac_check_router, prefix=settings.api_prefix)
    return app


app = create_app()
