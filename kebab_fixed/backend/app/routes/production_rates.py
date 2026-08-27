"""Tempo produkcji — dla prognozy zakończenia na HMI."""
from fastapi import APIRouter

from app.services import production_rates_service as svc

router = APIRouter(prefix="/api/production-rates", tags=["production-rates"])


@router.get("")
def current_rates():
    """Ziarno, tempo globalne i tempa per receptura (już po kurczeniu)."""
    return svc.current_rates()
