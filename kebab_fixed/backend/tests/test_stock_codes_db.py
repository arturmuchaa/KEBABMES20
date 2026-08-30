"""Nadawanie kodów przy zakładaniu pozycji magazynu (baza).

Reguła jest jedna: kod podany przez biuro wygrywa, kod zajęty jest odrzucany
WPROST. Cicha zgoda na duplikat to dokładnie to, co zrobiło z PAK-001 numer
dwóch różnych tulei.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.ingredients import IngredientCreate
from app.models.packaging import PackagingReceive
from app.services.ingredients_service import create_ingredient
from app.services.packaging_service import receive_packaging
from app.utils.ids import cuid, now_iso


def _pak(**kw):
    base = dict(name="METAL 70CM", type="tuleja", unit="szt", qty=0)
    base.update(kw)
    return PackagingReceive.model_validate(base)


class TestKodOpakowania:
    def test_tuleja_dostaje_kod_czytelny_z_nazwy(self, db):
        row = receive_packaging(_pak())
        assert row["code"] == "TUL-M70"

    def test_opakowanie_bez_rozmiaru_dostaje_licznik(self, db):
        row = receive_packaging(_pak(name="Folia stretch", type="opakowanie"))
        assert row["code"].startswith("OPA-")

    def test_kod_podany_przez_biuro_wygrywa(self, db):
        row = receive_packaging(_pak(code="tul-x99"))
        assert row["code"] == "TUL-X99", "kod normalizowany do wielkich liter"

    def test_kod_zajety_odrzucony_wprost(self, db):
        receive_packaging(_pak(code="TUL-Z1"))
        with pytest.raises(HTTPException) as e:
            receive_packaging(_pak(name="KARTON 70CM", code="TUL-Z1"))
        assert e.value.status_code == 400
        assert "zajęty" in e.value.detail

    def test_druga_tuleja_o_tej_samej_nazwie_nie_dubluje_kodu(self, db):
        # Magazyn scala po nazwie, więc to jest DOŁOŻENIE do istniejącej —
        # kod ma zostać jeden, a nie powstać drugi taki sam.
        receive_packaging(_pak(qty=10))
        receive_packaging(_pak(qty=5))
        kody = [r["code"] for r in query_all("SELECT code FROM packaging")]
        assert kody == ["TUL-M70"]

    def test_kolejne_pozycje_nie_zderzaja_sie_kodami(self, db):
        for n in ("Folia A", "Folia B", "Folia C"):
            receive_packaging(_pak(name=n, type="opakowanie"))
        kody = [r["code"] for r in query_all("SELECT code FROM packaging")]
        assert len(kody) == len(set(kody)) == 3

    def test_licznik_omija_kod_zajety_recznie(self, db):
        # Biuro wpisało OPA-001 z ręki; automat ma pójść dalej, nie stanąć.
        receive_packaging(_pak(name="Folia reczna", type="opakowanie", code="OPA-001"))
        row = receive_packaging(_pak(name="Folia automat", type="opakowanie"))
        assert row["code"] != "OPA-001"


class TestKodSkladnika:
    def test_nowy_skladnik_dostaje_kod(self, db):
        row = create_ingredient(IngredientCreate.model_validate(
            {"name": "Papryka ostra", "unit": "kg", "category": "other"}))
        assert row["code"].startswith("SKL-")

    def test_dwa_skladniki_maja_rozne_kody(self, db):
        a = create_ingredient(IngredientCreate.model_validate({"name": "A", "unit": "kg"}))
        b = create_ingredient(IngredientCreate.model_validate({"name": "B", "unit": "kg"}))
        assert a["code"] != b["code"]

    def test_kod_zajety_odrzucony(self, db):
        create_ingredient(IngredientCreate.model_validate(
            {"name": "A", "unit": "kg", "code": "SKL-900"}))
        with pytest.raises(HTTPException) as e:
            create_ingredient(IngredientCreate.model_validate(
                {"name": "B", "unit": "kg", "code": "SKL-900"}))
        assert e.value.status_code == 400


class TestIndeksUnikalny:
    def test_baza_nie_wpusci_dwoch_pozycji_o_tym_samym_kodzie(self, db):
        receive_packaging(_pak(code="TUL-Q1"))
        with pytest.raises(Exception):
            # Z pominięciem serwisu — pilnuje tego INDEKS, nie tylko kod aplikacji.
            execute("INSERT INTO packaging (id,code,name,type,unit,kg_initial,"
                    "kg_available,kg_used,created_at) VALUES (%s,'TUL-Q1','INNA',"
                    "'tuleja','szt',0,0,0,%s)", (cuid(), now_iso()))

    def test_pozycja_BEZ_kodu_jest_dozwolona(self, db):
        # Indeks jest częściowy: historyczne wiersze bez kodu mają prawo istnieć.
        execute("INSERT INTO packaging (id,code,name,type,unit,kg_initial,"
                "kg_available,kg_used,created_at) VALUES (%s,'','BEZ KODU 1',"
                "'inne','szt',0,0,0,%s)", (cuid(), now_iso()))
        execute("INSERT INTO packaging (id,code,name,type,unit,kg_initial,"
                "kg_available,kg_used,created_at) VALUES (%s,'','BEZ KODU 2',"
                "'inne','szt',0,0,0,%s)", (cuid(), now_iso()))
        assert query_one("SELECT count(*) c FROM packaging WHERE code=''")["c"] == 2
