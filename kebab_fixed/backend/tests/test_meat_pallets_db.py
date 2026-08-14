"""Ważenie zbiorcze mięsa: paleta to OPIS, nie ruch magazynowy.

Mięso jest na stanie od rozbioru — ten ekran tylko zapisuje, co na czym leży,
żeby operator masowania wiedział, co zabiera do masownicy.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import query_all, query_one
from app.models.meat_pallets import MeatPalletCreate
from app.services.meat_pallets_service import create_pallet, get_pallet


def _dto(**over):
    baza = {
        "targetKg": 600, "stackKg": None, "kgNet": 600, "containers": 30,
        "carrierLabel": "H1", "carrierKg": 18, "operator": "ANATOLII",
        "productionDate": "2026-08-14", "expiryDate": "2026-08-19",
        "lots": [{"lotNo": "475", "kg": 420}, {"lotNo": "476", "kg": 180}],
    }
    baza.update(over)
    return MeatPalletCreate.model_validate(baza)


def test_zapis_palety_ze_skladem(db):
    out = create_pallet(_dto())

    assert out["pallet_no"].startswith("PAL/14/08/26")
    lots = query_all(
        "SELECT lot_no, kg FROM meat_pallet_lots WHERE pallet_id=%s ORDER BY seq",
        (out["id"],))
    assert [(l["lot_no"], float(l["kg"])) for l in lots] == [("475", 420.0), ("476", 180.0)]


def test_numer_palety_rosnie_w_obrebie_dnia(db):
    """Numeracja jak sesje rozbioru: pierwsza dziś bez indeksu, kolejne /2, /3."""
    a = create_pallet(_dto())
    b = create_pallet(_dto())
    assert a["pallet_no"] == "PAL/14/08/26"
    assert b["pallet_no"] == "PAL/14/08/26/2"


def test_suma_skladu_musi_sie_zgadzac_z_waga(db):
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(lots=[{"lotNo": "475", "kg": 100}]))
    assert err.value.status_code == 400
    assert query_one("SELECT COUNT(*) AS n FROM meat_pallets")["n"] == 0


def test_paleta_NIE_rusza_stanu_magazynowego(db):
    """Regresja: to ma być wyłącznie opis. Każdy ruch tutaj byłby podwójnym
    księgowaniem mięsa, które jest na stanie już od rozbioru."""
    create_pallet(_dto())
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"] == 0


def test_odczyt_po_numerze_do_dodruku(db):
    out = create_pallet(_dto())
    rec = get_pallet(out["pallet_no"])
    assert float(rec["kg_net"]) == 600.0
    assert [l["lot_no"] for l in rec["lots"]] == ["475", "476"]


def test_nieznana_paleta_daje_404(db):
    with pytest.raises(HTTPException) as err:
        get_pallet("PAL/01/01/26/9")
    assert err.value.status_code == 404


def test_paleta_bez_skladu_nie_przechodzi(db):
    """Etykieta bez partii nie mówi masowni nic — a po to ten ekran jest."""
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(lots=[]))
    assert err.value.status_code == 400
