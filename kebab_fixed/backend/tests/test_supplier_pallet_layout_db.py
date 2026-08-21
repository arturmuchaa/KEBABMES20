"""Układ palety per dostawca — ile pojemników wchodzi na jedną paletę.

KOKO wozi po 15 kg i układa 9 na warstwę × 4 warstwy = 36. Inny dostawca
kładzie 8 na warstwę = 32. Biuro drukuje z tego zawieszki na palety, więc
liczba musi siedzieć przy DOSTAWCY, a nie być stałą w kodzie.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.suppliers_service import (
    DEFAULT_CONTAINERS_PER_PALLET, list_suppliers, set_containers_per_pallet,
)
from app.utils.ids import now_iso


def _seed():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))


def test_domyslna_paleta_to_36_pojemnikow():
    assert DEFAULT_CONTAINERS_PER_PALLET == 36


def test_nieustawiony_dostawca_nie_ma_wlasnego_ukladu(db):
    _seed()
    assert list_suppliers()[0]["containers_per_pallet"] is None


def test_zapisany_uklad_wraca_z_kartoteki(db):
    _seed()
    set_containers_per_pallet("sup1", 32)
    assert list_suppliers()[0]["containers_per_pallet"] == 32


def test_zmiana_ukladu_nadpisuje_poprzedni(db):
    _seed()
    set_containers_per_pallet("sup1", 32)
    set_containers_per_pallet("sup1", 36)
    assert query_one("SELECT containers_per_pallet FROM suppliers WHERE id='sup1'"
                     )["containers_per_pallet"] == 36


def test_wyczyszczenie_ukladu_wraca_do_domyslnego(db):
    _seed()
    set_containers_per_pallet("sup1", 32)
    set_containers_per_pallet("sup1", None)
    assert list_suppliers()[0]["containers_per_pallet"] is None


@pytest.mark.parametrize("bledna", [0, -4, 1000])
def test_bezsensowny_uklad_odrzucony(db, bledna):
    # Zero pojemników na palecie dałoby nieskończoną liczbę zawieszek.
    _seed()
    with pytest.raises(HTTPException) as e:
        set_containers_per_pallet("sup1", bledna)
    assert e.value.status_code == 400


def test_nieznany_dostawca_daje_404(db):
    _seed()
    with pytest.raises(HTTPException) as e:
        set_containers_per_pallet("nie-ma-takiego", 36)
    assert e.value.status_code == 404
