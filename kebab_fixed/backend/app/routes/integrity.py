"""Endpoint kontroli spójności danych magazynowych.

Chroniony rolą admin (patrz ADMIN_PREFIXES w app/auth/permissions.py),
bo raport ujawnia stan magazynów całego zakładu.
"""
from fastapi import APIRouter

from app.services.integrity_service import run_integrity_checks

router = APIRouter(tags=["admin"])


@router.get("/api/admin/integrity")
def integrity():
    """Raport spójności: 11 reguł, każda z liczbą naruszeń i opisem.

    Wywoływany ręcznie przez biuro oraz cyklicznie przez
    kebab-integrity.timer (raz dziennie, po backupie).
    """
    return run_integrity_checks()
