"""Mixing orders endpoints."""
from fastapi import APIRouter, Depends, Query

from app.models.mixing import FinishMixingSessionDto, MixingOrderCreate
from app.services import mixing_service as svc
from app.utils.auth import require_admin

router = APIRouter(prefix="/api/mixing-orders", tags=["mixing-orders"])


@router.get("")
def list_mixing_orders(status: str = Query("")):
    return svc.list_mixing_orders(status or None)


# IMPORTANT: /day-plan przed /{order_id}
@router.get("/day-plan")
def get_day_plan():
    """Dzisiejsza kolejka masowania (1→n) + rev do wykrywania zmian planu."""
    return svc.get_day_plan()


@router.put("/day-plan")
def save_day_plan(body: dict):
    """Upsert planu dnia: edycja/kolejność/anulowanie pozycji w kolejce."""
    return svc.save_day_plan(body.get("items") or [])


@router.get("/{order_id}")
def get_mixing_order(order_id: str):
    return svc.get_mixing_order(order_id)


@router.post("")
def create_mixing_order(dto: MixingOrderCreate):
    return svc.create_mixing_order(dto)


@router.patch("/{order_id}/confirm")
def confirm_mixing_order(order_id: str):
    return svc.confirm_mixing_order(order_id)


@router.patch("/{order_id}/start")
def start_mixing_order(order_id: str, body: dict):
    return svc.start_mixing_order(order_id, body)


@router.patch("/{order_id}/allocate")
def allocate_to_machine(order_id: str, body: dict):
    return svc.allocate_to_machine(order_id, body)


@router.patch("/{order_id}/confirm-step")
def confirm_mixing_step(order_id: str, body: dict):
    return svc.confirm_mixing_step(order_id, body)


@router.patch("/{order_id}/finish-session")
def finish_mixing_session(order_id: str, dto: FinishMixingSessionDto):
    return svc.finish_mixing_session(order_id, dto)


@router.patch("/{order_id}/auto-approve")
def auto_approve_mixing(order_id: str):
    return svc.auto_approve_mixing(order_id)


@router.patch("/{order_id}/cancel")
def cancel_mixing_order(order_id: str):
    return svc.cancel_mixing_order(order_id)


@router.post("/cleanup-stale", dependencies=[Depends(require_admin)])
def cleanup_stale():
    """Zamknij in_progress zlecenia bez aktywnej blokady maszyny.

    Do uruchamiania z systemd-timera (np. co 5 minut) albo ręcznie z biura.
    """
    return svc.cleanup_stale_in_progress()
