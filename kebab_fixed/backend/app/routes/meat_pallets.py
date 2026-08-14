"""Palety mięsa z ważenia zbiorczego — opis ułożenia dla masowni.

Zapis NIE rusza stanu magazynowego: mięso jest na stanie od rozbioru.
"""
from fastapi import APIRouter, Query

from app.models.meat_pallets import MeatPalletCreate
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


# UWAGA: trasa z parametrem MUSI stać po „" i „?day=", inaczej złapie oba.
@router.get("/{pallet_no:path}")
def get_pallet(pallet_no: str):
    """Paleta po numerze (PAL/14/08/26/2) — dodruk etykiety i kontrola odbioru.

    `:path`, bo numer palety zawiera ukośniki.
    """
    return svc.get_pallet(pallet_no)
