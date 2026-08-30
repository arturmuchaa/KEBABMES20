"""Katalog wyrobów — rejestr tego, co zakład faktycznie sprzedaje (baza)."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.product_catalog_service import (
    list_product_catalog, refresh_product_catalog, update_product_catalog_entry,
)
from app.utils.ids import cuid, now_iso


def _slowniki():
    # Nazwa przez PARAMETR, nie w literale: „100%" w SQL psycopg2 czyta jako
    # placeholder i wywraca zapytanie na IndexError.
    execute("INSERT INTO product_types (id,name,active,created_at) "
            "VALUES ('pt-udo',%s,true,%s) ON CONFLICT (id) DO NOTHING",
            ("KEBAB UDO 100%", now_iso()))
    execute("INSERT INTO recipes (id,name,active,created_at) "
            "VALUES ('rec-kir','KIRMIZI',true,%s) ON CONFLICT (id) DO NOTHING", (now_iso(),))
    execute("INSERT INTO packaging (id,code,name,type,unit,kg_initial,kg_available,kg_used,created_at) "
            "VALUES ('pak-m60','TUL-M60','METAL 60CM','tuleja','szt',0,0,0,%s) "
            "ON CONFLICT (id) DO NOTHING", (now_iso(),))


def _wyrob(kg=20.0, rodzaj="KEBAB UDO 100%", receptura="KIRMIZI", tuleja="METAL 60CM"):
    execute(
        "INSERT INTO finished_goods (id, batch_no, product_type_id, product_type_name, "
        "recipe_id, recipe_name, packaging_id, packaging_name, kg_per_unit, qty, "
        "qty_available, total_kg, created_at) "
        "VALUES (%s,'B1','pt-udo',%s,'rec-kir',%s,'pak-m60',%s,%s,1,1,%s,%s)",
        (cuid(), rodzaj, receptura, tuleja, kg, kg, now_iso()))


class TestOdswiezanie:
    def test_kombinacja_z_produkcji_trafia_do_katalogu(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        kat = list_product_catalog()
        assert len(kat) == 1
        assert kat[0]["code"] == "UDO100-KIRMIZI-M60-20"

    def test_rodzaj_i_receptura_dostaja_kod(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        assert query_one("SELECT code FROM product_types WHERE id='pt-udo'")["code"] == "UDO100"
        assert query_one("SELECT code FROM recipes WHERE id='rec-kir'")["code"] == "KIRMIZI"

    def test_rozna_gramatura_to_OSOBNA_pozycja(self, db):
        _slowniki(); _wyrob(kg=20.0); _wyrob(kg=30.0)
        refresh_product_catalog()
        assert len(list_product_catalog()) == 2

    def test_powtorne_odswiezenie_nie_dubluje(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        wynik = refresh_product_catalog()
        assert wynik["added"] == 0
        assert len(list_product_catalog()) == 1

    def test_kombinacja_bez_RODZAJU_jest_pomijana(self, db):
        # Dane sprzed wymagania rodzaju przy wpisie wyrobu — 41 z 95 kombinacji
        # w produkcji. W katalogu byłyby pozycjami, których nikt nie nazwie.
        _slowniki(); _wyrob(rodzaj="")
        refresh_product_catalog()
        assert list_product_catalog() == []

    def test_odswiezenie_NIE_nadpisuje_kodu_poprawionego_recznie(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        poz = list_product_catalog()[0]
        update_product_catalog_entry(poz["id"], {"code": "UDO-20"})
        refresh_product_catalog()
        assert query_one("SELECT code FROM product_catalog WHERE id=%s",
                         (poz["id"],))["code"] == "UDO-20"

    def test_nowa_kombinacja_dochodzi_przy_kolejnym_odswiezeniu(self, db):
        _slowniki(); _wyrob(kg=20.0)
        refresh_product_catalog()
        _wyrob(kg=40.0)
        assert refresh_product_catalog()["added"] == 1
        assert len(list_product_catalog()) == 2


class TestEdycja:
    def test_kod_da_sie_poprawic(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        poz = list_product_catalog()[0]
        assert update_product_catalog_entry(poz["id"], {"code": "udo 20"})["code"] == "UDO20"

    def test_kod_zajety_odrzucony(self, db):
        _slowniki(); _wyrob(kg=20.0); _wyrob(kg=30.0)
        refresh_product_catalog()
        a, b = list_product_catalog()
        with pytest.raises(HTTPException) as e:
            update_product_catalog_entry(b["id"], {"code": a["code"]})
        assert e.value.status_code == 400

    def test_pusty_kod_odrzucony(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        poz = list_product_catalog()[0]
        with pytest.raises(HTTPException):
            update_product_catalog_entry(poz["id"], {"code": "  "})

    def test_pozycje_sie_WYGASZA_a_nie_kasuje(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        poz = list_product_catalog()[0]
        update_product_catalog_entry(poz["id"], {"active": False})
        assert list_product_catalog(only_active=True) == []
        # Historia zostaje czytelna — pozycja nadal jest w katalogu.
        assert len(list_product_catalog()) == 1

    def test_czworki_NIE_da_sie_podmienic(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        poz = list_product_catalog()[0]
        update_product_catalog_entry(poz["id"], {"kg_per_unit": 999, "product_type_name": "CO INNEGO"})
        po = query_one("SELECT * FROM product_catalog WHERE id=%s", (poz["id"],))
        assert po["kg_per_unit"] == 20.0
        assert po["product_type_name"] == "KEBAB UDO 100%"

    def test_nieznana_pozycja_daje_404(self, db):
        with pytest.raises(HTTPException) as e:
            update_product_catalog_entry("nie-ma", {"code": "X"})
        assert e.value.status_code == 404


class TestIndeksy:
    def test_ta_sama_czworka_nie_wejdzie_dwa_razy(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        with pytest.raises(Exception):
            execute("INSERT INTO product_catalog (id,code,product_type_name,recipe_name,"
                    "packaging_name,kg_per_unit,active,created_at) "
                    "VALUES (%s,'INNY-KOD',%s,'KIRMIZI','METAL 60CM',20,true,%s)",
                    (cuid(), "KEBAB UDO 100%", now_iso()))

    def test_dwie_pozycje_o_tym_samym_kodzie_nie_wejda(self, db):
        _slowniki(); _wyrob()
        refresh_product_catalog()
        with pytest.raises(Exception):
            execute("INSERT INTO product_catalog (id,code,product_type_name,recipe_name,"
                    "packaging_name,kg_per_unit,active,created_at) "
                    "VALUES (%s,'UDO100-KIRMIZI-M60-20',%s,'KIRMIZI',"
                    "'METAL 60CM',99,true,%s)", (cuid(), "KEBAB UDO 100%", now_iso()))
