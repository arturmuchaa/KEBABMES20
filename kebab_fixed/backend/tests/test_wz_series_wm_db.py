# backend/tests/test_wz_series_wm_db.py
"""Seria WM — WZ wewnętrzny, którego klient nie dostaje.

Właściciel (2026-09-09) wybrał OSOBNĄ serię: seria WZ zostaje wyłącznie dla
dokumentów wychodzących do klientów.
"""
from app.db import query_all
from app.services.wz_service import format_wz_number


def test_numer_wm_ma_wlasny_prefiks():
    assert format_wz_number(7, "2609", series="WM") == "WM/7/09/26"


def test_numer_wz_bez_zmian():
    assert format_wz_number(7, "2609") == "WZ/7/09/26"


def test_serie_licza_sie_niezaleznie(db):
    """WM/1 i WZ/1 mogą istnieć obok siebie — to dwa różne rejestry."""
    from app.db import transaction
    from app.services.wz_service import _insert_wz, _seller_block
    with transaction() as conn:
        wz = _insert_wz(conn, source_type="manual", source_id=None, seller=_seller_block(),
                        buyer={"name": "KLIENT"}, valued=False, lines=[], total=0.0,
                        place="Rudawa", issued="2026-09-09", released="2026-09-09", notes="")
        wm = _insert_wz(conn, source_type="manual", source_id=None, seller=_seller_block(),
                        buyer={"name": "KLIENT"}, valued=False, lines=[], total=0.0,
                        place="Rudawa", issued="2026-09-09", released="2026-09-09", notes="",
                        series="WM")
    numery = {r["id"]: (r["number"], r["doc_series"]) for r in query_all(
        "SELECT id, number, doc_series FROM wz_documents")}
    assert numery[wz][1] == "WZ" and numery[wz][0].startswith("WZ/")
    assert numery[wm][1] == "WM" and numery[wm][0].startswith("WM/")
