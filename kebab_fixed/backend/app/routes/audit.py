"""Podgląd dziennika audytu (tylko admin — patrz ADMIN_PREFIXES)."""
from fastapi import APIRouter, Query

from app.db import query_all

router = APIRouter(prefix="/api/audit-log", tags=["audit"])


@router.get("")
def list_audit(limit: int = Query(200, ge=1, le=1000)):
    """Najnowsze wpisy audytu (kto/co/kiedy)."""
    rows = query_all(
        "SELECT id, at, subject, method, path, status, ip "
        "FROM audit_log ORDER BY at DESC LIMIT %s",
        (limit,),
    )
    return [
        {
            "id": r["id"],
            "at": str(r["at"]),
            "subject": r.get("subject"),
            "method": r["method"],
            "path": r["path"],
            "status": r.get("status"),
            "ip": r.get("ip"),
        }
        for r in rows
    ]
