"""Wsad w masownicy: załadunek zdejmuje paletę, odbiór księguje istniejącą ścieżką."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto, SpiceCartCreate
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/17/09/26", "r1", meat_kg),
    )
    return oid


def _partia(lot_no, kg=1000.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-09-17", "2026-10-01"),
    )
    return ms_id


def test_zaladunek_tworzy_wsad_i_zajmuje_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(
        orderId=oid, machineId=3, waterL=108,
        meat=[ChargeMeatDto(palletId=None, lotNo="511", meatStockId=ms, kg=600)]))
    assert ch["status"] == "mixing" and float(ch["kg_meat"]) == 600.0
    assert [c["machine_id"] for c in svc.list_charges()] == [3]


def test_druga_maszyna_nie_bierze_wsadu_gdy_juz_masuje():
    oid, ms = _zlecenie(), _partia("511")
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
            ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert "masownica" in str(e.value.detail).lower()


def test_wsad_zapisuje_sklad_miesny():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    sklad = query_all("SELECT lot_no, kg FROM mixing_charge_pallets WHERE charge_id=%s", (ch["id"],))
    assert [(s["lot_no"], float(s["kg"])) for s in sklad] == [("511", 200.0)]


def test_zaladunek_wsypuje_pojemnik():
    oid, ms = _zlecenie(), _partia("511")
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, cartId=cart["id"], meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert query_one("SELECT status FROM mixing_spice_carts WHERE id=%s", (cart["id"],))["status"] == "dumped"
    # Wsypany pojemnik nie rezerwuje już kilogramów — robi to wsad.
    assert svc.kg_prepared_of(oid) == 0.0


def test_zaladunek_bez_miesa_jest_odrzucany():
    oid = _zlecenie()
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[]))
    assert "mięs" in str(e.value.detail).lower()


def test_wsad_z_jednej_partii_nosi_jej_numer():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert ch["batch_no"] == "511"


def test_wsad_z_dwoch_partii_nie_zgaduje_numeru_partii():
    # Numer PP nadaje backend przy odbiorze (seasoned_batch_no_from_raw) —
    # panel nie może go wymyślić, bo licznik PP jest wspólny dla całego MES.
    oid = _zlecenie()
    a, b = _partia("511"), _partia("512")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=a, kg=100),
        ChargeMeatDto(lotNo="512", meatStockId=b, kg=100)]))
    assert ch["batch_no"] == ""


def test_odbior_zamyka_wsad_i_zwalnia_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert out["status"] == "done" and out["session_id"]
    assert svc.list_charges() == []


def test_odbior_ksieguje_zuzycie_miesa_przez_istniejaca_sciezke():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    stan = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", (ms,))
    assert float(stan["kg_used"]) == 200.0
    assert float(stan["kg_available"]) == 800.0


def test_odbior_zapisuje_sesje_na_wlasciwej_masownicy():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    sesja = query_one("SELECT machine_id FROM mixing_sessions WHERE id=%s", (out["session_id"],))
    assert sesja["machine_id"] == 3


def test_odbior_drugi_raz_nie_ksieguje_ponownie():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    with pytest.raises(HTTPException):
        svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert float(query_one("SELECT kg_used FROM meat_stock WHERE id=%s", (ms,))["kg_used"]) == 200.0


def test_odbior_zapisuje_kilogramy_z_paleciaka():
    # Księgowanie liczy wyrób z RECEPTURY; bez tej kolumny odczyt operatora
    # znikałby, a to on jest fizyką, którą biuro uzgadnia z teorią.
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    zapis = query_one("SELECT kg_output FROM mixing_charges WHERE id=%s", (ch["id"],))
    assert float(zapis["kg_output"]) == 232.5
