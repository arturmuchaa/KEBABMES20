"""Client endpoints."""
from fastapi import APIRouter

from app.models.clients import ClientCreate
from app.services import clients_service as svc

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("")
def list_clients():
    return svc.list_clients()


@router.post("")
def create_client(dto: ClientCreate):
    return svc.create_client(dto)


@router.put("/{client_id}")
def update_client(client_id: str, dto: ClientCreate):
    return svc.update_client(client_id, dto)


@router.patch("/{client_id}/deactivate")
def deactivate_client(client_id: str):
    svc.deactivate_client(client_id)
    return {"ok": True}
