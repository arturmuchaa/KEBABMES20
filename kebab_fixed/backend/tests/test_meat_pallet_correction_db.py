"""Korekta palety ważenia zbiorczego z biura.

POWÓD ISTNIENIA: 24.08.2026 cztery palety trzeba było poprawić ręcznie w bazie
— trzy razy zła partia (ekran podpowiadał najstarszy lot z puli), raz brak
liczby pojemników (218 kg zamiast 200, bo tara E2 nie została odjęta).
`routes/meat_pallets.py` miał wyłącznie create/list/get, więc każda pomyłka
na dokumencie identyfikowalności wymagała dostępu do bazy produkcyjnej.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.meat_pallets import MeatPalletCreate, MeatPalletUpdate
from app.services.meat_pallets_service import create_pallet, update_pallet


def _lot(lot_no: str, kg_initial: float):
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_initial, kg_available, created_at) "
        "VALUES (%s,%s,%s,%s, now())",
        (f"ms-{lot_no}", lot_no, kg_initial, kg_initial),
    )


def _paleta(**over):
    baza = {
        "targetKg": 200, "stackKg": 200, "kgNet": 218, "containers": 0,
        "carrierLabel": "wózek 5,5", "carrierKg": 6, "operator": "MARCIN",
        "productionDate": "2026-08-24", "expiryDate": "2026-08-31",
        "lots": [{"lotNo": "504", "kg": 218}],
    }
    baza.update(over)
    return create_pallet(MeatPalletCreate.model_validate(baza))


def _korekta(**over):
    baza = {"kgNet": 200, "containers": 9, "reason": "operator nie wpisał pojemników",
            "lots": [{"lotNo": "504", "kg": 200}]}
    baza.update(over)
    return MeatPalletUpdate.model_validate(baza)


def test_korekta_wagi_i_pojemnikow(db):
    _lot("504", 700.0)
    p = _paleta()

    out = update_pallet(p["pallet_no"], _korekta(), subject="biuro@kebab")

    assert float(out["kg_net"]) == 200.0
    assert int(out["containers"]) == 9
    lots = query_all("SELECT lot_no, kg FROM meat_pallet_lots WHERE pallet_id=%s", (p["id"],))
    assert [(l["lot_no"], float(l["kg"])) for l in lots] == [("504", 200.0)]


def test_wlasne_kilogramy_palety_nie_licza_sie_dwa_razy(db):
    """Pułapka: limit partii sumuje WSZYSTKIE palety, więc bez wyłączenia
    poprawianej z rachunku korekta 218 -> 200 wyglądałaby na przekroczenie."""
    _lot("504", 250.0)            # partia dała tylko 250 kg
    p = _paleta()                 # zajęła 218 z 250
    out = update_pallet(p["pallet_no"], _korekta(kgNet=240, lots=[{"lotNo": "504", "kg": 240}]),
                        subject="biuro@kebab")
    assert float(out["kg_net"]) == 240.0


def test_korekta_ponad_wydajnosc_partii_odrzucona(db):
    _lot("504", 250.0)
    p = _paleta()
    with pytest.raises(HTTPException) as err:
        update_pallet(p["pallet_no"], _korekta(kgNet=300, lots=[{"lotNo": "504", "kg": 300}]),
                      subject="biuro@kebab")
    assert "504" in err.value.detail


def test_zmiana_partii_na_wlasciwa(db):
    """Najczęstsza pomyłka 24.08: ekran podpowiedział najstarszy lot z puli."""
    _lot("485", 2560.0)
    _lot("503", 700.0)
    p = _paleta(kgNet=200, containers=9, lots=[{"lotNo": "485", "kg": 200}])

    update_pallet(p["pallet_no"],
                  _korekta(kgNet=200, lots=[{"lotNo": "503", "kg": 200}],
                           reason="ważono 503, ekran podpowiedział 485"),
                  subject="biuro@kebab")

    lots = query_all("SELECT lot_no FROM meat_pallet_lots WHERE pallet_id=%s", (p["id"],))
    assert [l["lot_no"] for l in lots] == ["503"]


def test_suma_skladu_musi_sie_zgadzac_z_waga(db):
    _lot("504", 700.0)
    p = _paleta()
    with pytest.raises(HTTPException) as err:
        update_pallet(p["pallet_no"], _korekta(kgNet=200, lots=[{"lotNo": "504", "kg": 150}]),
                      subject="biuro@kebab")
    assert "składu" in err.value.detail


def test_korekta_zostawia_slad_ze_stanem_sprzed_zmiany(db):
    """Bez stanu SPRZED zmiany korekta jest nieodróżnialna od zmyślenia."""
    _lot("504", 700.0)
    p = _paleta()

    update_pallet(p["pallet_no"], _korekta(), subject="biuro@kebab")

    slad = query_one(
        "SELECT by_subject, reason, changes FROM meat_pallet_corrections WHERE pallet_id=%s",
        (p["id"],))
    assert slad["by_subject"] == "biuro@kebab"
    assert "pojemnik" in slad["reason"]
    assert float(slad["changes"]["before"]["kg_net"]) == 218.0
    assert int(slad["changes"]["before"]["containers"]) == 0
    assert slad["changes"]["before"]["lots"] == [{"lot_no": "504", "kg": 218.0}]


def test_korekta_bez_powodu_odrzucona(db):
    _lot("504", 700.0)
    p = _paleta()
    with pytest.raises(Exception):
        update_pallet(p["pallet_no"], _korekta(reason="  "), subject="biuro@kebab")


def test_nieistniejaca_paleta(db):
    with pytest.raises(HTTPException) as err:
        update_pallet("PAL/99/99/99", _korekta(), subject="biuro@kebab")
    assert err.value.status_code == 404
