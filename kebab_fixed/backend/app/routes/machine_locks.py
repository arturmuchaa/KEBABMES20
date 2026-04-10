"""Machine locks endpoints."""
from fastapi import APIRouter

from app.services import machine_locks_service as svc

router = APIRouter(prefix="/api/machine-locks", tags=["machine-locks"])


@router.get("")
def list_locks():
    return svc.list_locks()


@router.post("")
def lock_machine(body: dict):
    return svc.lock_machine(body)


@router.get("/{machine_id}")
def is_locked(machine_id: int):
    return svc.is_locked(machine_id)


@router.delete("/{machine_id}")
def unlock_machine(machine_id: int):
    return svc.unlock_machine(machine_id)
