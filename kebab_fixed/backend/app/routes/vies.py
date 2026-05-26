"""VIES VAT and Polish NIP lookup endpoints."""
from fastapi import APIRouter, Query

from app.services import company_lookup_service as company_svc
from app.services import vies_service as svc

router = APIRouter(prefix="/api/vies", tags=["vies"])


@router.get("/lookup")
def vies_lookup(vat: str = Query(...)):
    return svc.vies_lookup(vat)


gus_router = APIRouter(tags=["gus"])


@gus_router.get("/api/gus/{nip}")
def gus_lookup(nip: str):
    return company_svc.gus_lookup(nip)


@gus_router.get("/api/nip/lookup")
def nip_lookup(nip: str = Query(...)):
    return company_svc.nip_lookup(nip)
