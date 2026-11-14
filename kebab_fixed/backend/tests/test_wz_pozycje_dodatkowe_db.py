"""Pozycje dodatkowe na WZ/WM: z ręki (jogurt) i z magazynu surowca (łój).

Zasada (właściciel 14.11.2026): WM = wszystko, co wyszło z magazynu (rusza
stan); WZ = dokument dla klienta do zapłaty (Rozrachunki liczą tylko WZ).
"""
import json

from app.db import execute, query_one, transaction
from app.services.split_documents_service import anuluj_dokumenty_podzialu, wystaw_wz_wewnetrzny
from app.services.wz_service import create_manual_wz, cancel_wz, wydaj_surowiec
from app.utils.ids import now_iso
from tests.conftest_split import _przygotuj_z_podzialem


def _loj(kg=100.0, bid="rb-loj", no="950"):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,'KOKO',%s,%s,'active','mat-loj-otokowy','Łój wołowy otokowy',%s)",
        (bid, no, kg, kg, now_iso()))
    return bid


def _kg(bid="rb-loj"):
    return float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (bid,))["kg_available"])


def _dopisz_recznie_na_wm(wm_id, sel):
    """Do Task 2: linia surowca wpisana na WM przez wspólny rozchód."""
    with transaction() as conn:
        pola = wydaj_surowiec(conn, wm_id, sel)
        row = query_one("SELECT lines FROM wz_documents WHERE id=%s", (wm_id,))
        lines = row["lines"] or []
        lines.append({"name": sel["name"], "qty": sel["qty"], "unit": "kg", **pola})
        conn.cursor().execute("UPDATE wz_documents SET lines=%s WHERE id=%s", (json.dumps(lines), wm_id))


def test_anulowanie_kompletu_oddaje_dopisany_surowiec(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1")
    bid = _loj()
    _dopisz_recznie_na_wm(wm["id"], {"stock_type": "raw", "stock_id": bid, "qty": 15.0, "name": "Łój wołowy otokowy"})
    assert _kg(bid) == 85.0
    anuluj_dokumenty_podzialu("o1")
    assert _kg(bid) == 100.0


def test_cancel_wz_raw_bez_zmian(db):
    from tests.conftest_split import _firma, _klient
    _firma(); _klient()
    bid = _loj()
    wz = create_manual_wz(buyer={"name": "VATAN"}, selections=[
        {"stock_type": "raw", "stock_id": bid, "qty": 15.0, "name": "Łój wołowy otokowy", "unit": "kg", "price": 2}])
    assert _kg(bid) == 85.0
    cancel_wz(wz["id"])
    assert _kg(bid) == 100.0
