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
