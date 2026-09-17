"""Panel masowania — mięso, pojemniki z przyprawami, wsady."""
from fastapi import APIRouter

from app.services import masownia_service as svc

router = APIRouter(prefix="/api/masownia", tags=["masownia"])


@router.get("/mieso")
def list_meat():
    """Kafelki mięsa: palety z ważenia zbiorczego i partie bez palet."""
    return svc.list_meat()
