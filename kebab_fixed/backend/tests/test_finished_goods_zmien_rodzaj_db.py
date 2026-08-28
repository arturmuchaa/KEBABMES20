"""Korekta rodzaju na wierszu wyrobu gotowego.

Rodzaj jest częścią tożsamości wyrobu — UDO 100% i MIX 95/5 mają tę samą
recepturę, tuleję i wagę sztuki, a inny skład mięsa i inną cenę. Pomyłka przy
wpisie robi na magazynie towar, którego tam nie ma, a jedyną drogą naprawy był
dotąd SQL wprost na produkcji (Truva 80 × 20 kg, 28.08.2026).

Granica: poprawiamy TYLKO wiersz, z którego nic nie wyjechało. Po wydaniu
rodzaj stoi już na WZ i HDI u klienta.

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.finished_goods_service import zmien_rodzaj


def _rodzaj(pid, nazwa):
    execute("INSERT INTO product_types (id, name) VALUES (%s,%s) "
            "ON CONFLICT (id) DO NOTHING", (pid, nazwa))


def _wyrob(fid="f1", pt="pt-udo", ptn="KEBAB UDO 100%", qty=80, wydane=0):
    execute(
        "INSERT INTO finished_goods (id, batch_no, product_type_id, product_type_name, "
        " recipe_id, recipe_name, qty, kg_per_unit, total_kg, qty_available, "
        " qty_shipped, client_name, produced_date) "
        "VALUES (%s,'280826 509/516',%s,%s,'r1','KIRMIZI',%s,20,%s,%s,%s,"
        " 'Truva gastro s.r.o.','2026-08-28')",
        (fid, pt, ptn, qty, qty * 20, qty - wydane, wydane))


def _rodzaj_wiersza(fid="f1"):
    r = query_one("SELECT product_type_id, product_type_name FROM finished_goods WHERE id=%s",
                  (fid,))
    return r["product_type_id"], r["product_type_name"]


def test_poprawia_rodzaj_na_niewydanym_wierszu(db):
    _rodzaj("pt-udo", "KEBAB UDO 100%")
    _rodzaj("pt-mix", "KEBAB MIX 95/5")
    _wyrob()

    out = zmien_rodzaj("f1", "pt-mix")

    assert _rodzaj_wiersza() == ("pt-mix", "KEBAB MIX 95/5")
    # Odpowiedź mówi, CO było — biuro widzi, że trafiło we właściwy wiersz.
    assert out["poprzedni"] == "KEBAB UDO 100%"


def test_nie_rusza_wiersza_z_ktorego_cos_wyjechalo(db):
    """Rodzaj stoi na wystawionym WZ i HDI — cicha zmiana rozjechałaby magazyn
    z dokumentami u klienta."""
    _rodzaj("pt-udo", "KEBAB UDO 100%")
    _rodzaj("pt-mix", "KEBAB MIX 95/5")
    _wyrob(qty=80, wydane=30)

    with pytest.raises(HTTPException) as e:
        zmien_rodzaj("f1", "pt-mix")

    assert e.value.status_code == 409
    assert "30" in e.value.detail
    assert _rodzaj_wiersza() == ("pt-udo", "KEBAB UDO 100%")   # bez zmian


def test_nieznany_rodzaj_odrzucony(db):
    _rodzaj("pt-udo", "KEBAB UDO 100%")
    _wyrob()

    with pytest.raises(HTTPException) as e:
        zmien_rodzaj("f1", "pt-nie-ma")
    assert e.value.status_code == 404
    assert _rodzaj_wiersza() == ("pt-udo", "KEBAB UDO 100%")


def test_nieznany_wiersz_odrzucony(db):
    _rodzaj("pt-mix", "KEBAB MIX 95/5")
    with pytest.raises(HTTPException) as e:
        zmien_rodzaj("nie-ma", "pt-mix")
    assert e.value.status_code == 404
