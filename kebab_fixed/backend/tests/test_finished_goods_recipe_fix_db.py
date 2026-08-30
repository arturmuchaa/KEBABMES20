"""Korekta receptury na wierszu magazynu wyrobu gotowego.

Pokrycie zamówienia dopasowuje po (rodzaj, receptura, tuleja, waga), więc
sztuki wpisane z INNĄ recepturą leżą na magazynie, ale zamówienia nie
pokrywają — a na ekranie nie widać dlaczego, bo rodzaj i gramatura się
zgadzają. ZAGROS 30.08.2026: zamówienie na 6 szt. KEBAB YAPRAK 30 kg
w recepturze SHAORMA TRUVA + AROMAT widziało 4, bo 2 sztuki wpisano
w recepturze YAPRAK.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.finished_goods_service import zmien_recepture
from app.utils.ids import cuid, now_iso


def _receptury():
    for rid, nazwa in (("rec-shaorma", "SHAORMA TRUVA + AROMAT"), ("rec-yaprak", "YAPRAK")):
        execute("INSERT INTO recipes (id, name, active, created_at) VALUES (%s,%s,true,%s) "
                "ON CONFLICT (id) DO NOTHING", (rid, nazwa, now_iso()))


def _wyrob(recipe_id="rec-yaprak", recipe_name="YAPRAK", qty=2, shipped=0):
    fid = cuid()
    execute(
        "INSERT INTO finished_goods (id, batch_no, product_type_id, product_type_name, "
        "recipe_id, recipe_name, kg_per_unit, qty, qty_available, qty_shipped, total_kg, "
        "created_at) VALUES (%s,'B1','pt-yaprak','KEBAB YAPRAK',%s,%s,30,%s,%s,%s,%s,%s)",
        (fid, recipe_id, recipe_name, qty, qty - shipped, shipped, qty * 30, now_iso()))
    return fid


class TestKorektaReceptury:
    def test_poprawia_recepture_na_wierszu(self, db):
        _receptury()
        fid = _wyrob()
        out = zmien_recepture(fid, "rec-shaorma")
        assert out["recipeName"] == "SHAORMA TRUVA + AROMAT"
        assert out["poprzednia"] == "YAPRAK"
        row = query_one("SELECT recipe_id, recipe_name FROM finished_goods WHERE id=%s", (fid,))
        assert row["recipe_id"] == "rec-shaorma"
        assert row["recipe_name"] == "SHAORMA TRUVA + AROMAT"

    def test_nie_rusza_ilosci_ani_wagi(self, db):
        _receptury()
        fid = _wyrob(qty=2)
        zmien_recepture(fid, "rec-shaorma")
        row = query_one("SELECT qty, qty_available, kg_per_unit, total_kg "
                        "FROM finished_goods WHERE id=%s", (fid,))
        assert (row["qty"], row["qty_available"], row["kg_per_unit"], row["total_kg"]) == (2, 2, 30, 60)

    def test_wydana_partia_jest_ZAMKNIETA(self, db):
        # Po wydaniu receptura stoi na WZ i HDI u klienta — cicha zmiana
        # rozjechałaby magazyn z dokumentami.
        _receptury()
        fid = _wyrob(qty=5, shipped=3)
        with pytest.raises(HTTPException) as e:
            zmien_recepture(fid, "rec-shaorma")
        assert e.value.status_code == 409
        assert "3 szt" in e.value.detail

    def test_nieznana_receptura_odrzucona(self, db):
        _receptury()
        fid = _wyrob()
        with pytest.raises(HTTPException) as e:
            zmien_recepture(fid, "nie-ma-takiej")
        assert e.value.status_code == 404

    def test_nieznany_wiersz_odrzucony(self, db):
        _receptury()
        with pytest.raises(HTTPException) as e:
            zmien_recepture("nie-ma-wiersza", "rec-shaorma")
        assert e.value.status_code == 404

    def test_rodzaj_zostaje_nietkniety(self, db):
        # Korekta receptury to NIE korekta rodzaju — to osobne pomyłki.
        _receptury()
        fid = _wyrob()
        zmien_recepture(fid, "rec-shaorma")
        row = query_one("SELECT product_type_id, product_type_name "
                        "FROM finished_goods WHERE id=%s", (fid,))
        assert row["product_type_name"] == "KEBAB YAPRAK"
        assert row["product_type_id"] == "pt-yaprak"
