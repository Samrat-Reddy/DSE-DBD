"""Aggregates every versioned route module under the API prefix."""

from fastapi import APIRouter

from app.api.routes import auth, health, policies, products, users

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(products.router)
api_router.include_router(policies.router)
