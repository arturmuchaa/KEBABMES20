"""Stub endpoints (batch-history, system-logs) — placeholders."""
from fastapi import APIRouter

router = APIRouter(tags=["stubs"])


@router.get("/api/batch-history")
def all_history():
    return []


@router.get("/api/system-logs")
def system_logs():
    return []
