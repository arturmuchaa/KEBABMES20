"""Rejestr wydruków — zapis po każdym wydruku i lista dla zamówienia."""
from typing import List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth.audit import _subject_label
from app.services import druk_rejestr_service as svc

router = APIRouter(prefix="/api/druk", tags=["druk"])


class WpisRejestru(BaseModel):
    rodzaj: str
    tytul: str = ""
    orderId: Optional[str] = None
    palletIds: List[str] = Field(default_factory=list)
    dokumentId: Optional[str] = None
    drukarka: str = ""
    zasobnik: str = ""
    kopie: int = 1
    stron: Optional[int] = None
    komputer: str = ""
    klientId: str = ""


def _operator(request: Request) -> str:
    s = getattr(request.state, "subject", None)
    if isinstance(s, dict) and s.get("name"):
        return str(s["name"])
    return _subject_label(s) or ""


@router.post("/rejestr")
def zapisz(body: WpisRejestru, request: Request):
    return svc.zapisz(body.model_dump(), _operator(request))


@router.get("/rejestr")
def lista(order_id: str):
    return svc.lista(order_id)
