"""Ważenie pełnego kartonu przy wjeździe do mroźni (spec 2026-09-29).

Pełny karton → ważenie zapisane + karton w mroźni. Niezgodna waga NIE
blokuje (tylko werdykt). Niepełny się nie waży. Rozpisana paleta bez
skanu sztuk nie ma czego porównać — `full` fałszywe.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.magazyn_pakowanie_service import skanuj_sztuke
from app.services.mroznia_wazenie_service import ostatnie_wazenie, sprawdz, zwaz_i_wstaw
from app.services.settings_service import get_pallet_types, save_pallet_types
from app.utils.unit_codes import unit_qr
from tests.test_magazyn_pakowanie_db import _karton, _paleta, _receptury, _sztuka


@pytest.fixture(autouse=True)
def _domyslne_palety(db):
    # app_settings nie jest w TRUNCATE conftestu — lista z innego testu by przeciekła.
    execute("DELETE FROM app_settings WHERE key='magazyn_pallet_tares'")
    yield


def _pelny_karton(n=3, kg=15.0):
    _receptury()
    k = _karton("YALCIN", qty=n, kg=kg)
    for i in range(n):
        _sztuka(f"u{i}", kg=kg)
        skanuj_sztuke(unit_qr(f"u{i}"), k["id"])
    return k


def test_pelny_karton_magazynowy_sprawdz(db):
    k = _pelny_karton()
    info = sprawdz(f"SCARTON|{k['id']}")
    assert info["result"] == "OK" and info["kind"] == "stock"
    assert info["full"] is True and info["inColdStorage"] is False
    assert info["netKg"] == 45.0
    assert info["lines"] == [{"qty": 3, "kgPerUnit": 15.0, "recipeName": "KIRMIZI", "productTypeName": ""}]


def test_zwazenie_zgodne_wstawia_do_mrozni(db):
    k = _pelny_karton()
    w = zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto", "Jan")
    assert w["ok"] is True and w["grossKg"] == 80.0 and w["netKg"] == 45.0
    assert w["palletTypeName"] == "EURO" and w["operator"] == "Jan" and w["weighMode"] == "auto"
    assert w["lines"][0]["qty"] == 3 and w["code"] == f"SCARTON|{k['id']}"
    assert query_one("SELECT cold_storage_at FROM stock_cartons WHERE id=%s", (k["id"],))["cold_storage_at"]


def test_niezgodna_tez_wjezdza(db):
    k = _pelny_karton()
    w = zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 120.0, "manual")
    assert w["ok"] is False and w["diffKg"] == 40.0 and w["weighMode"] == "manual"
    assert query_one("SELECT cold_storage_at FROM stock_cartons WHERE id=%s", (k["id"],))["cold_storage_at"]


def test_ponowne_wazenie_dopisuje_ostatnie_wygrywa(db):
    k = _pelny_karton()
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 120.0, "auto")
    assert sprawdz(f"SCARTON|{k['id']}")["inColdStorage"] is True
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto")
    assert len(query_all("SELECT id FROM cold_storage_weighings WHERE container_id=%s", (k["id"],))) == 2
    assert ostatnie_wazenie(k["id"])["grossKg"] == 80.0


def test_niepelny_karton_sie_nie_wazy(db):
    _receptury()
    k = _karton("YALCIN", qty=3)
    _sztuka("u1")
    skanuj_sztuke(unit_qr("u1"), k["id"])
    assert sprawdz(f"SCARTON|{k['id']}")["full"] is False
    assert sprawdz(f"SCARTON|{k['id']}")["open"] is True
    with pytest.raises(HTTPException) as e:
        zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto")
    assert e.value.status_code == 409
    assert query_one("SELECT cold_storage_at FROM stock_cartons WHERE id=%s", (k["id"],))["cold_storage_at"] is None


def test_paleta_zamowienia_pelna_i_rozpisana(db):
    _receptury()
    pid = _paleta("o1", "YALCIN", qty=2)
    kod = "PAL|o1|1"
    # rozpisana, bez sztuk — nie ma czego ważyć, wjeżdża starym skanem
    assert sprawdz(kod)["full"] is False and sprawdz(kod)["open"] is False
    _sztuka("p0")
    skanuj_sztuke(unit_qr("p0"), pid)
    assert sprawdz(kod)["open"] is True and sprawdz(kod)["full"] is False
    _sztuka("p1")
    skanuj_sztuke(unit_qr("p1"), pid)
    info = sprawdz(kod)
    assert info["full"] is True and info["netKg"] == 30.0 and info["orderNo"] == "YALCIN/Z/1"
    w = zwaz_i_wstaw(kod, "jednorazowa", 55.0, "auto", "Ola")
    assert w["ok"] is True and w["containerKind"] == "order" and w["code"] == kod
    assert query_one("SELECT status FROM order_pallets WHERE id=%s", (pid,))["status"] == "cold_storage"


def test_zla_paleta_i_zla_waga(db):
    k = _pelny_karton()
    with pytest.raises(HTTPException):
        zwaz_i_wstaw(f"SCARTON|{k['id']}", "nie-ma", 80.0, "auto")
    with pytest.raises(HTTPException):
        zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 0, "auto")
    assert query_one("SELECT cold_storage_at FROM stock_cartons WHERE id=%s", (k["id"],))["cold_storage_at"] is None


def test_nieznany_kod(db):
    assert sprawdz("SCARTON|" + "a" * 20)["result"] == "INVALID"
    assert sprawdz("cokolwiek")["result"] == "INVALID"


def test_palety_z_biura(db):
    assert [p["id"] for p in get_pallet_types()] == ["jednorazowa", "euro", "plastikowa"]
    save_pallet_types([{"id": "euro", "name": "EURO", "tareMinKg": 34, "tareMaxKg": 36, "marginPct": 2}])
    assert get_pallet_types() == [{"id": "euro", "name": "EURO", "tareMinKg": 34.0, "tareMaxKg": 36.0, "marginPct": 2.0}]


def test_wykaz_partii_w_kartonie_i_w_wazeniu(db):
    """Właściciel 29.09.2026: etykieta ma rozpisać partie — „3 szt 290926 591,
    12 szt 290926 592". Liczone ze SZTUK w kartonie, zapisane z ważeniem."""
    k = _pelny_karton(n=3)
    execute("UPDATE finished_units SET batch_no='290926 592' WHERE id IN ('u0','u1')")
    execute("UPDATE finished_units SET batch_no='290926 591' WHERE id='u2'")
    info = sprawdz(f"SCARTON|{k['id']}")
    assert info["batches"] == [{"batchNo": "290926 591", "qty": 1}, {"batchNo": "290926 592", "qty": 2}]
    w = zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto")
    assert w["batches"] == info["batches"]
    # dodruk czyta zapis z chwili ważenia, nie żywy stan
    execute("UPDATE finished_units SET batch_no='X' WHERE id='u2'")
    assert ostatnie_wazenie(k["id"])["batches"][0]["batchNo"] == "290926 591"


# ── Wyjazd z mroźni (cofnięcie na poprawki) — 29.09.2026 ──────────────────
from app.services.mroznia_wazenie_service import wazenia_w_mrozni, wyjedz_z_mrozni


def test_wyjazd_kartonu_magazynowego_wraca_do_pakowania(db):
    k = _pelny_karton()
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto")
    w = wyjedz_z_mrozni(f"SCARTON|{k['id']}", "Jan")
    assert w["result"] == "SUCCESS"
    assert query_one("SELECT cold_storage_at FROM stock_cartons WHERE id=%s", (k["id"],))["cold_storage_at"] is None
    # pełny karton poza mroźnią → przy ponownym wjeździe znów ważenie
    info = sprawdz(f"SCARTON|{k['id']}")
    assert info["full"] is True and info["inColdStorage"] is False


def test_wyjazd_palety_zamowienia_pelnej_wraca_jako_spakowana(db):
    _receptury()
    pid = _paleta("o1", "YALCIN", qty=1)
    _sztuka("p1")
    skanuj_sztuke(unit_qr("p1"), pid)
    zwaz_i_wstaw("PAL|o1|1", "euro", 50.0, "auto")
    assert wyjedz_z_mrozni("http://h/m/p/o1/1")["result"] == "SUCCESS"
    assert query_one("SELECT status, cold_storage_at FROM order_pallets WHERE id=%s", (pid,)) == \
        {"status": "packed", "cold_storage_at": None}


def test_wyjazd_kartonu_spoza_mrozni_to_NOT_IN(db):
    k = _pelny_karton()
    assert wyjedz_z_mrozni(f"SCARTON|{k['id']}")["result"] == "NOT_IN_COLD"
    assert wyjedz_z_mrozni("cokolwiek")["result"] == "INVALID"


def test_wazenia_w_mrozni_mowia_ktory_niezwazony(db):
    k = _pelny_karton()
    from app.services.magazyn_pakowanie_service import wstaw_karton_do_mrozni
    wstaw_karton_do_mrozni(f"SCARTON|{k['id']}")          # „zważ później"
    assert wazenia_w_mrozni() == {}
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 120.0, "auto")
    stan = wazenia_w_mrozni()
    assert stan[k["id"]]["ok"] is False and stan[k["id"]]["grossKg"] == 120.0


def test_status_kartonu_na_karte(db):
    """Karta kartonu (skan kartonu z mroźni) pokazuje status, skład i partie."""
    _receptury()
    k = _karton("YALCIN", qty=2)
    assert sprawdz(f"SCARTON|{k['id']}")["status"] == "packing"
    for i in range(2):
        _sztuka(f"u{i}")
        skanuj_sztuke(unit_qr(f"u{i}"), k["id"])
    assert sprawdz(f"SCARTON|{k['id']}")["status"] == "full"
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 65.0, "auto")
    info = sprawdz(f"SCARTON|{k['id']}")
    assert info["status"] == "cold_storage" and info["batches"] == [{"batchNo": "200926 1", "qty": 2}]
    assert info["lastWeighing"]["grossKg"] == 65.0
    execute("UPDATE stock_cartons SET loaded_vehicle_id='v1' WHERE id=%s", (k["id"],))
    na_aucie = sprawdz(f"SCARTON|{k['id']}")
    assert na_aucie["result"] == "GONE" and na_aucie["status"] == "loaded" and na_aucie["qty"] == 2


def test_rozpisana_paleta_to_planned(db):
    _receptury()
    _paleta("o1", "YALCIN", qty=2)
    assert sprawdz("PAL|o1|1")["status"] == "planned"



def test_partie_pelnym_numerem_gdy_sztuka_ma_sam_numer(db):
    """Produkcja: finished_units.batch_no = „598", pełny numer z daty produkcji."""
    k = _pelny_karton(n=2)
    execute("UPDATE finished_units SET batch_no='598', produced_date='2026-09-29'")
    assert sprawdz(f"SCARTON|{k['id']}")["batches"] == [{"batchNo": "290926 598", "qty": 2}]



def test_stare_wazenie_z_krotkim_numerem_dodruk_pelny(db):
    """Produkcja 29.09: dwa ważenia kartonu 297 zapisały „598" — dodruk ma pełny numer."""
    k = _pelny_karton(n=2)
    execute("UPDATE finished_units SET batch_no='598', produced_date='2026-09-29'")
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 70.0, "auto")
    execute("""UPDATE cold_storage_weighings SET batches='[{"qty": 2, "batchNo": "598"}]'::jsonb""")
    assert ostatnie_wazenie(k["id"])["batches"] == [{"qty": 2, "batchNo": "290926 598"}]
