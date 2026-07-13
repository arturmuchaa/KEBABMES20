"""Seasoned meat endpoints."""
from fastapi import APIRouter, HTTPException

from app.logging_config import get_logger
from app.services import seasoned_meat_service as svc

router = APIRouter(prefix="/api/seasoned-meat", tags=["seasoned-meat"])

logger = get_logger(__name__)


@router.get("/all")
def list_all_seasoned():
    return svc.list_all_seasoned()


@router.get("")
def list_seasoned():
    return svc.list_seasoned()


@router.get("/{batch_id}/trace")
def seasoned_trace(batch_id: str):
    return svc.seasoned_trace(batch_id)


@router.post("/{seasoned_id}/reconcile")
def reconcile_seasoned(seasoned_id: str, body: dict):
    """Ręczna korekta/zamknięcie partii przyprawionej (uzgodnienie teoria↔fizyka).
    body: { targetKg?: number, reason?: str, close?: bool }."""
    close = bool(body.get("close"))
    target_kg = float(body.get("targetKg") or body.get("target_kg") or 0)
    reason = str(body.get("reason") or "")
    return svc.reconcile_seasoned_batch(seasoned_id, target_kg, reason, close)


@router.post("/from-order/{order_id}", deprecated=True)
def seasoned_from_order(order_id: str, body: dict):
    # Endpoint zwracał IN na seasoned_meat bez OUT na meat_stock —
    # tworzył partię z powietrza, łamiąc kontrakt CLAUDE.md. Frontend
    # (MixingTabletPage) nigdy go nie wywołuje; właściwy przepływ to
    # PATCH /api/mixing-orders/{id}/finish-session.
    logger.warning(
        "seasoned_from_order.deprecated_call",
        extra={"order_id": order_id, "body_keys": list((body or {}).keys())},
    )
    raise HTTPException(
        status_code=410,
        detail=(
            "Endpoint wycofany. Użyj PATCH /api/mixing-orders/{id}/finish-session "
            "(proper transformation z OUT meat → IN seasoned i pełnym audytem)."
        ),
    )
