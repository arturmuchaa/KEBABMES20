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


@router.put("/{client_id}/rozliczenie")
def ustaw_rozliczenie(client_id: str, body: dict):
    """Włącznik rozrachunków i waluta rozliczeniowa kontrahenta.

    Waluta jest per klient — przy niezerowym saldzie serwis odmawia jej
    zmiany, bo kwot nie przelicza.
    """
    return svc.ustaw_rozliczenie(
        client_id, bool(body.get("enabled")), body.get("currency") or "PLN",
        body.get("basis"))   # brak pola = nie ruszaj podstawy
