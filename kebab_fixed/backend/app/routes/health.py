"""Health check endpoint."""
from fastapi import APIRouter

from app.db import healthcheck

router = APIRouter(tags=["health"])


@router.get("/api/health")
@router.get("/health")
def health():
    return healthcheck()
