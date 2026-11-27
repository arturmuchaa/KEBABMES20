"""Szablony etykiet kebabów (projektor w PROTRIMA, 27.11.2026).

Szablon zawsze należy do klienta; rodzaj i receptura opcjonalne ('' = każdy).
Dobór: najbardziej szczegółowy aktywny szablon klienta.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all
from app.services import label_designs_service as svc

pytestmark = pytest.mark.usefixtures("db")

PDF = "data:application/pdf;base64,JVBERi0xLjQK"
PNG = "data:image/png;base64,iVBORw0KGgo="


@pytest.fixture(autouse=True)
def slownik(db):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES ('cz','ZAG','OKAYTEKIN KG','ZAGROS'), ('cy','YAL','EMIN GMBH','YALCIN')")
    execute("INSERT INTO product_types (id, name) VALUES ('udo','KEBAB UDO 100%%'), ('mix','KEBAB MIX 70/30')")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('kir','KIRMIZI','udo'), ('bey','BEYAZ','udo')")


def a4(**kw):
    d = {"name": "ZAGROS · A4", "clientId": "cz", "productTypeId": "", "recipeId": "", "printMode": "a4",
         "backgroundPdf": PDF, "backgroundPng": PNG, "labelsPerSheet": 2,
         "slotOffset": {"dxMm": 105, "dyMm": 0},
         "calibration": {"dxMm": -0.2, "dyMm": 0, "scale": 99.5},
         "fields": [{"id": "f1", "kind": "weight", "xMm": 32.2, "yMm": 22.2, "font": "arial", "sizePt": 36, "bold": True},
                    {"id": "f2", "kind": "qr", "xMm": 4.2, "yMm": 250.0, "qrMm": 31}],
         "slot2Fields": {"f2": {"id": "f2", "kind": "qr", "xMm": 110.0, "yMm": 251.0, "qrMm": 31}}}
    d.update(kw)
    return d


def zebra(**kw):
    d = {"name": "YALCIN · Zebra", "clientId": "cy", "printMode": "zebra", "backgroundZpl": "^GFA,2,2,1,FF",
         "backgroundPng": PNG, "widthMm": 100, "heightMm": 150, "dpi": 203, "sourceName": "yalcin.prn",
         "fields": [{"id": "w", "kind": "weight", "xMm": 40, "yMm": 60, "sizePt": 40, "rotation": 90}]}
    d.update(kw)
    return d


def test_zapis_i_odczyt_szablonu_a4():
    out = svc.save_design(a4(), "biuro")
    d = svc.get_design(out["id"])
    assert d["printMode"] == "a4" and d["clientId"] == "cz" and d["labelsPerSheet"] == 2
    assert d["fields"][0]["xMm"] == 32.2 and d["fields"][0]["bold"] is True
    assert d["slot2Fields"]["f2"]["xMm"] == 110.0
    assert d["calibration"]["scale"] == 99.5 and d["slotOffset"]["dxMm"] == 105
    assert d["backgroundPdf"] == PDF and d["updatedBy"] == "biuro"
    rev = query_all("SELECT revision FROM label_design_revisions WHERE design_id=%s", (out["id"],))
    assert [r["revision"] for r in rev] == [1]
    lista = svc.list_designs()
    assert lista[0]["clientName"] == "ZAGROS" and "backgroundPdf" not in lista[0]


def test_druga_wersja_dopisuje_rewizje():
    out = svc.save_design(a4(), "biuro")
    svc.save_design({**a4(), "id": out["id"], "name": "ZAGROS · nowy"}, "Ania")
    d = svc.get_design(out["id"])
    assert d["name"] == "ZAGROS · nowy" and d["updatedBy"] == "Ania"
    assert sorted(r["revision"] for r in query_all(
        "SELECT revision FROM label_design_revisions WHERE design_id=%s", (out["id"],))) == [1, 2]


def test_dobor_najbardziej_szczegolowy():
    ogolny = svc.save_design(a4(name="ogólny"), "b")["id"]
    rec = svc.save_design(a4(name="kirmizi", recipeId="kir"), "b")["id"]
    pelny = svc.save_design(a4(name="udo kirmizi", productTypeId="udo", recipeId="kir"), "b")["id"]
    rodz = svc.save_design(a4(name="mix", productTypeId="mix"), "b")["id"]
    assert svc.resolve_design("cz", "udo", "kir")["id"] == pelny
    assert svc.resolve_design("cz", "mix", "kir")["id"] == rec
    assert svc.resolve_design("cz", "mix", "bey")["id"] == rodz
    assert svc.resolve_design("cz", "udo", "bey")["id"] == ogolny
    assert svc.resolve_design("cy", "udo", "kir") is None


def test_dwa_aktywne_na_to_samo_przypisanie_409():
    svc.save_design(a4(name="pierwszy", recipeId="kir"), "b")
    with pytest.raises(HTTPException) as e:
        svc.save_design(a4(name="drugi", recipeId="kir"), "b")
    assert e.value.status_code == 409 and "pierwszy" in e.value.detail


def test_usuniety_nie_jest_dobierany():
    sid = svc.save_design(a4(), "b")["id"]
    svc.delete_design(sid)
    assert svc.resolve_design("cz", "udo", "kir") is None
    assert svc.list_designs() == []
    svc.save_design(a4(name="po usunięciu"), "b")  # przypisanie znów wolne


def test_zebra_wymaga_tla_i_rozmiaru():
    sid = svc.save_design(zebra(), "b")["id"]
    assert svc.get_design(sid)["fields"][0]["rotation"] == 90
    with pytest.raises(HTTPException) as e:
        svc.save_design(zebra(backgroundZpl="", name="bez tła"), "b")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        svc.save_design(zebra(widthMm=0, name="bez rozmiaru"), "b")
    assert e.value.status_code == 400


def test_szablon_wymaga_klienta():
    with pytest.raises(HTTPException) as e:
        svc.save_design(a4(clientId=""), "b")
    assert e.value.status_code == 400 and "klienta" in e.value.detail
