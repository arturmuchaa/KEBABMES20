"""Podpisy elektroniczne — wzory (HMI rozbioru) i akt podpisania (biuro).

Dwa routery, bo dostęp jest różny: wzór rysuje hala pod kodem serwisowym
0099, a dokument podpisuje biuro. Rozstrzyga to `auth/permissions.py`.
"""
from fastapi import APIRouter, HTTPException, Query

from app.models.signatures import SignatureSampleIn, SignIn
from app.services import signatures_service as svc

router = APIRouter(prefix="/api/signatures", tags=["signatures"])
samples_router = APIRouter(prefix="/api/signature-samples", tags=["signatures"])


# UWAGA: /eligible i /doc MUSZĄ stać przed ewentualnymi trasami z parametrem,
# inaczej wpadną jako identyfikator (ta sama pułapka co /next-number
# w routes/receptions.py).
@router.get("/eligible")
def eligible(role: str = Query(..., description="wykonal | sprawdzil")):
    """Pracownicy uprawnieni do tej roli i mający wzór podpisu."""
    return svc.eligible(role)


@router.get("/doc")
def for_doc(doc_type: str = Query(..., alias="docType"),
            doc_id: str = Query(..., alias="docId")):
    """AKTYWNE podpisy dokumentu — unieważnione nie wychodzą na zewnątrz."""
    return svc.signatures_for(doc_type, doc_id)


@router.post("")
def sign(dto: SignIn):
    return svc.sign(dto.doc_type, dto.doc_id, dto.role, dto.worker_id, dto.pin)


@samples_router.get("/{worker_id}")
def get_sample(worker_id: str):
    wzor = svc.get_sample(worker_id)
    if not wzor:
        raise HTTPException(404, "Pracownik nie ma wzoru podpisu")
    return wzor


@samples_router.put("/{worker_id}")
def put_sample(worker_id: str, dto: SignatureSampleIn):
    return svc.save_sample(worker_id, dto.png, dto.pin)
