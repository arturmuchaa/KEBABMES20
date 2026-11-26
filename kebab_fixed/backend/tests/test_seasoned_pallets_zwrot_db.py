"""Zwrot zważonej końcówki do chłodni (plan A, zad. 5).

Właściciel 26.11.2026: końcówka zawsze wraca do chłodni i jest ważona na wadze
paletowej; zachowuje numer partii i idzie jako pierwsza następnego dnia.
"""
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import seasoned_pallets_service as sp
from tests.test_seasoned_pallets_wywoz_db import DZIS, kod, linia, paleta, partia, plan

pytestmark = pytest.mark.usefixtures("db")


def _na_hali(kg=598.0):
    sm = partia(kg=kg); p = paleta(sm, kg=kg); pl = plan(); linia(pl, sm)
    sp.take_pallet(kod(p))
    return sm, p, pl


def test_zwrot_24kg_tworzy_koncowke():
    sm, p, _ = _na_hali()
    out = sp.return_pallet(kod(p), 24)
    stara = query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (p,))
    assert stara["status"] == "closed" and float(stara["kg_returned"]) == 24.0
    assert stara["returned_at"] is not None
    r = out["remainder"]
    assert r and r["kg"] == 24.0 and r["qr"] == "SP|" + r["id"]
    nowa = query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (r["id"],))
    assert nowa["status"] == "in_cold" and nowa["is_remainder"] and nowa["parent_id"] == p
    assert nowa["batch_no"] == "724" and nowa["seasoned_meat_id"] == sm
    assert nowa["recipe_id"] == stara["recipe_id"]
    assert nowa["pallet_no"] != stara["pallet_no"] and nowa["label_printed_at"] is None


def test_zwrot_zero_zamyka_bez_koncowki():
    _, p, _ = _na_hali()
    out = sp.return_pallet(kod(p), 0)
    assert out["remainder"] is None and out["closed"]
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (p,))["status"] == "closed"
    assert len(query_all("SELECT id FROM seasoned_pallets WHERE parent_id=%s", (p,))) == 0


def test_zwrot_wiecej_niz_wyjechalo_odrzucony():
    _, p, _ = _na_hali(kg=598)
    with pytest.raises(HTTPException) as e:
        sp.return_pallet(kod(p), 600)
    assert e.value.status_code == 409 and "więcej niż wyjechało" in e.value.detail
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (p,))["status"] == "on_hall"


def test_zwrot_palety_z_chlodni_odrzucony():
    sm = partia(); p = paleta(sm)
    with pytest.raises(HTTPException) as e:
        sp.return_pallet(kod(p), 10)
    assert e.value.status_code == 409 and "nie jest na hali" in e.value.detail


def test_zwrot_po_id_tez_dziala():
    _, p, _ = _na_hali()
    assert sp.return_pallet(p, 5)["remainder"]["kg"] == 5.0


def test_koncowke_mozna_znow_wywiezc():
    sm, p, _ = _na_hali()
    r = sp.return_pallet(kod(p), 24)["remainder"]
    # następny dzień: plan z tą partią (symulujemy, przesuwając dzisiejszy plan)
    execute("UPDATE production_plans SET status='done'")
    linia(plan(), sm, qty=1, kg=24)
    assert sp.take_pallet(kod(r["id"]))["ok"]
