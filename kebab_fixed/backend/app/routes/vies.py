"""VIES VAT lookup endpoint."""
from fastapi import APIRouter, Query

from app.services import vies_service as svc

router = APIRouter(prefix="/api/vies", tags=["vies"])


@router.get("/lookup")
def vies_lookup(vat: str = Query(...)):
    return svc.vies_lookup(vat)
