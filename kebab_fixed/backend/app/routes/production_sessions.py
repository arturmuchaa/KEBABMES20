"""Production sessions endpoints."""
from fastapi import APIRouter, Query

from app.services import production_sessions_service as svc

router = APIRouter(prefix="/api/production-sessions", tags=["production-sessions"])


@router.get("")
def list_sessions(process_type: str = Query("deboning", alias="processType")):
    return svc.list_sessions(process_type)


@router.get("/active")
def get_active_session(process_type: str = Query("deboning", alias="processType")):
    return svc.get_active_session(process_type)


@router.get("/pending")
def list_pending():
    """Sesje czekające na potwierdzenie biura (w tym auto-domknięte zaległe)."""
    return svc.list_pending()


@router.get("/{session_id}")
def get_session(session_id: str):
    return svc.get_session_by_id(session_id)


@router.post("")
def start_session(body: dict):
    return svc.start_session(body)


@router.patch("/{session_id}/close")
def close_session(session_id: str, body: dict):
    return svc.close_session(session_id, body)


@router.patch("/{session_id}/approve")
def approve_session(session_id: str, body: dict):
    return svc.approve_session(session_id, body)
