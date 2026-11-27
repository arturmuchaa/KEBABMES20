"""Etykiety mięsa drukuje tylko HMI masowni (właściciel 27.11.2026).

Biuro nie drukuje etykiet palet. Końcówka wraca do chłodni ze STARĄ etykietą
z masowni — skan tej etykiety ma wziąć żywą końcówkę. Palety sprzed wdrożenia
(stan chłodni z backfillu) nie mają etykiety z QR: hala wywozi je z listy
palet planu, bez skanu — ale tylko te, i tylko gdy są w dzisiejszym planie.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import seasoned_pallets_service as sp
from tests.test_seasoned_pallets_wywoz_db import kod, linia, paleta, partia, plan

pytestmark = pytest.mark.usefixtures("db")


def _koncowka_z(p, kg=24):
    sp.take_pallet(kod(p))
    return sp.return_pallet(kod(p), kg)["remainder"]["id"]


def _nastepny_dzien(sm, kg=24):
    execute("UPDATE production_plans SET status='done'")
    linia(plan(), sm, qty=1, kg=kg)


def test_skan_starej_etykiety_bierze_koncowke():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    r = _koncowka_z(p)
    _nastepny_dzien(sm)
    out = sp.take_pallet(kod(p))
    assert out["ok"] and out["palletId"] == r
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (r,))["status"] == "on_hall"


def test_skan_starej_etykiety_przechodzi_przez_kilka_koncowek():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    r1 = _koncowka_z(p, 300)
    _nastepny_dzien(sm, kg=10)
    r2 = _koncowka_z(r1, 50)
    _nastepny_dzien(sm)
    assert sp.take_pallet(kod(p))["palletId"] == r2


def test_skan_zuzytej_palety_bez_koncowki_dalej_odbity():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    sp.take_pallet(kod(p)); sp.return_pallet(kod(p), 0)
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(p))
    assert e.value.status_code == 409 and "zużyta" in e.value.detail


def _bez_etykiety(sm, kg=598.0):
    p = paleta(sm, kg=kg)
    execute("UPDATE seasoned_pallets SET no_label=true WHERE id=%s", (p,))
    return p


def test_paleta_bez_etykiety_wyjezdza_z_listy_po_id():
    sm = partia(); p = _bez_etykiety(sm); pl = plan(); linia(pl, sm)
    out = sp.take_pallet(p, "Kierownik", pl)
    assert out["ok"] and out["palletId"] == p


def test_paleta_z_etykieta_nie_wyjezdza_bez_skanu():
    sm = partia(); p = paleta(sm); pl = plan(); linia(pl, sm)
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(p, "Kierownik", pl)
    assert e.value.status_code == 404
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (p,))["status"] == "in_cold"


def test_paleta_bez_etykiety_spoza_planu_dalej_zablokowana():
    sm = partia(); p = _bez_etykiety(sm); inna = partia("999"); pl = plan(); linia(pl, inna, batch_no="999")
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(p, "Kierownik", pl)
    assert e.value.status_code == 409


def test_koncowka_palety_bez_etykiety_tez_bez_etykiety():
    sm = partia(); p = _bez_etykiety(sm); linia(plan(), sm)
    sp.take_pallet(p)
    r = sp.return_pallet(p, 24)["remainder"]["id"]
    assert query_one("SELECT no_label FROM seasoned_pallets WHERE id=%s", (r,))["no_label"] is True
    assert sp.pallet_out(query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (r,)))["noLabel"] is True


def test_migracja_oznacza_tylko_palety_z_backfillu_i_ich_koncowki():
    from app.migrations import _mark_pallets_without_label
    sm = partia()
    stara1, stara2, nowa = paleta(sm), paleta(sm), paleta(sm)
    execute("UPDATE seasoned_pallets SET created_at='2026-11-27 09:57:00+00' WHERE id IN (%s,%s)", (stara1, stara2))
    execute("UPDATE seasoned_pallets SET created_at='2026-11-27 15:00:00+00' WHERE id=%s", (nowa,))
    konc = paleta(sm)
    execute("UPDATE seasoned_pallets SET is_remainder=true, parent_id=%s, created_at='2026-11-28 10:00:00+00' WHERE id=%s", (stara1, konc))
    execute("DELETE FROM sequences WHERE key='seasoned_pallets_no_label'")
    _mark_pallets_without_label()
    flagi = {pid: query_one("SELECT no_label FROM seasoned_pallets WHERE id=%s", (pid,))["no_label"]
             for pid in (stara1, stara2, nowa, konc)}
    assert flagi == {stara1: True, stara2: True, nowa: False, konc: True}
