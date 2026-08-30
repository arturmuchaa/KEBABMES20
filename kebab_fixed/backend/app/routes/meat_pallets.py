"""Palety mięsa z ważenia zbiorczego — opis ułożenia dla masowni.

Zapis NIE rusza stanu magazynowego: mięso jest na stanie od rozbioru.
"""
from fastapi import APIRouter, Query, Request

from app.models.meat_pallets import MeatPalletCreate, MeatPalletUpdate
from app.services import meat_pallets_service as svc

router = APIRouter(prefix="/api/meat-pallets", tags=["meat-pallets"])


@router.post("")
def create_pallet(dto: MeatPalletCreate):
    """Zapisz skompletowaną paletę / wózek i zwróć ją z nadanym numerem."""
    return svc.create_pallet(dto)


@router.get("")
def list_pallets(day: str = Query("", alias="day")):
    """Palety dnia produkcyjnego — podgląd i dodruk z biura."""
    return {"data": svc.list_pallets(day)}


def _subject_of(request: Request) -> str:
    """Kto poprawia — do śladu korekty. Pusty, gdy sesji nie ma."""
    subject = getattr(request.state, "subject", None) or {}
    return str(subject.get("username") or subject.get("id") or "")


@router.patch("/{pallet_no:path}")
def correct_pallet(pallet_no: str, dto: MeatPalletUpdate, request: Request):
    """Korekta palety z biura: waga netto, pojemniki i skład partii.

    Istnieje, bo pomyłka na dokumencie identyfikowalności nie może wymagać
    dostępu do bazy produkcyjnej (24.08.2026 — cztery palety poprawiane ręcznie).
    """
    return svc.update_pallet(pallet_no, dto, _subject_of(request))


@router.delete("/{pallet_no:path}")
def delete_pallet(pallet_no: str, reason: str = Query(...), request: Request = None):
    """Zdejmij paletę (miękko) — operator zapisał ją przez pomyłkę.

    Powód OBOWIĄZKOWY: paleta znika masowni z oczu, więc musi zostać ślad,
    kto i dlaczego ją zdjął.
    """
    return svc.usun_palete(pallet_no, reason, _subject_of(request) if request else "")


# UWAGA: trasa z parametrem MUSI stać po „" i „?day=", inaczej złapie oba.
@router.get("/{pallet_no:path}")
def get_pallet(pallet_no: str):
    """Paleta po numerze (PAL/14/08/26/2) — dodruk etykiety i kontrola odbioru.

    `:path`, bo numer palety zawiera ukośniki.
    """
    return svc.get_pallet(pallet_no)
