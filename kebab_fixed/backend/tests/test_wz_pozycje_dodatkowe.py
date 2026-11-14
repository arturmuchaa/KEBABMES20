"""Czyste funkcje pozycji dodatkowych WZ (bez bazy)."""
import pytest
from fastapi import HTTPException

from app.services.wz_pozycje_dodatkowe import linia_reczna


def test_jogurt_w_sztukach_z_cena_z_przecinkiem():
    l = linia_reczna({"lineId": "L1", "name": "Jogurt naturalny", "qty": "10", "unit": "szt",
                      "price": "4,50", "vatRate": 5}, True)
    assert l["stock_type"] == "reczna" and l["line_id"] == "L1"
    assert l["qty"] == 10 and l["unit"] == "szt"
    assert l["price"] == 4.5 and l["value"] == 45.0 and l["vat_rate"] == 5.0
    assert "total_kg" not in l and "stock_id" not in l


def test_pozycja_w_kg_liczy_po_kilogramach():
    l = linia_reczna({"name": "Ser", "qty": "15,5", "unit": "kg", "price": "2"}, True)
    assert l["total_kg"] == 15.5 and l["value"] == 31.0
    assert l["line_id"]  # nadany, gdy klient nie przysłał


def test_niewyceniona_bez_ceny():
    l = linia_reczna({"name": "Jogurt", "qty": "3", "unit": "opak."}, False)
    assert l["price"] is None and l["value"] is None


@pytest.mark.parametrize("zle", [
    {"name": "  ", "qty": "1", "unit": "szt"},
    {"name": "Jogurt", "qty": "0", "unit": "szt"},
    {"name": "Jogurt", "qty": "abc", "unit": "szt"},
    {"name": "Jogurt", "qty": "1", "unit": "litr"},
])
def test_odmowa_zlych_danych(zle):
    with pytest.raises(HTTPException) as e:
        linia_reczna(zle, True)
    assert e.value.status_code == 400


# ── Task 3: pozycje dodatkowe nie są wyrobem ─────────────────────────────
WYROB = {"stock_type": "fg", "stock_id": "f1", "recipe_id": "r1", "kg_per_unit": 25.0,
         "batch_no": "P1", "qty": 4, "total_kg": 100.0, "name": "KEBAB"}
JOG = {"stock_type": "reczna", "line_id": "J1", "name": "Jogurt", "qty": 10, "unit": "szt"}
LOJ = {"stock_type": "raw", "stock_id": "rb", "line_id": "L1", "name": "Łój", "qty": 15.0,
       "unit": "kg", "total_kg": 15.0, "batch_no": "950"}


def test_linie_wyrobu_pomija_dodatkowe_a_stare_bez_typu_zostawia():
    from app.services.wz_service import linie_wyrobu
    stara = {k: v for k, v in WYROB.items() if k != "stock_type"}
    assert linie_wyrobu([WYROB, JOG, LOJ, stara]) == [WYROB, stara]


def test_weryfikacja_zaladunku_nie_widzi_rozjazdu_od_jogurtu_i_loju():
    from app.services.loading_service import _line_key, verify_wz_against_loaded
    loaded = {_line_key("r1", 25.0, "P1"): {"qty": 4, "kg": 100.0}}
    status, diff = verify_wz_against_loaded([WYROB, JOG, LOJ], loaded)
    assert status == "potwierdzony"
    assert all(d.get("diff", 0) == 0 for d in diff)


def test_kg_wm_w_pokryciu_kursu_tylko_z_wyrobu():
    from app.services.split_documents_service import _kg_z_linii
    assert _kg_z_linii([WYROB, LOJ, JOG]) == 100.0
