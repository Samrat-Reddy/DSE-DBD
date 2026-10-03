"""Aggregates every versioned route module under the API prefix."""

from fastapi import APIRouter

from app.api.routes import (
    auth,
    claims,
    commissions,
    health,
    policies,
    premiums,
    products,
    renewals,
    reports,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(products.router)
api_router.include_router(policies.router)
api_router.include_router(premiums.router)
api_router.include_router(claims.router)
api_router.include_router(renewals.router)
api_router.include_router(commissions.router)
api_router.include_router(reports.router)
