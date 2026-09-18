"""Historia dzisiejszego mieszania — pod kafelkiem „Wymieszane".

Właściciel 18.09.2026: „na dole w sekcji wymieszane po kliknięciu cała lista
dzisiejszego mieszania podzielona na maszyny i tam można było dodrukować
etykiety ponownie". Lista musi nieść skład partii, bo z niego składa się
etykieta — dodruk nie może zgadywać, co poszło do wsadu.
"""
import pytest

from app.db import execute, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=3000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,'MAS/18/09/26','r1',%s,0,'confirmed')",
        (oid, meat_kg),
    )
    return oid


def _partia(lot_no="511", kg=3000.0):
    ms = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms, lot_no, kg, kg, "2026-09-18", "2026-10-02"),
    )
    return ms


def _przerobiony(oid, ms, machine, kg=200.0, kg_out=248.0):
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=machine, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=kg)]))
    svc.start_charge(ch["id"])
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=kg_out))
    return ch


def test_pokazuje_dzisiejsze_odbiory_z_podzialem_na_maszyny():
    oid, ms = _zlecenie(), _partia()
    _przerobiony(oid, ms, 1)
    _przerobiony(oid, ms, 3)

    dzis = svc.list_charges_today()
    assert [w["machine_id"] for w in dzis] == [1, 3], "posortowane po masownicy"
    assert all(w["status"] == "done" for w in dzis)


def test_niesie_sklad_partii_do_dodruku_etykiety():
    oid, ms = _zlecenie(), _partia()
    _przerobiony(oid, ms, 2)

    w = svc.list_charges_today()[0]
    assert w["meat"] and w["meat"][0]["lot_no"] == "511"
    assert w["batch_no"] == "511"
    assert w["kg_output"] == 248.0


def test_wsad_stojacy_w_masownicy_nie_jest_jeszcze_historia():
    oid, ms = _zlecenie(), _partia()
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.start_charge(ch["id"])
    assert svc.list_charges_today() == []


def test_wczorajsze_odbiory_nie_zasmiecaja_dzisiejszej_listy():
    oid, ms = _zlecenie(), _partia()
    ch = _przerobiony(oid, ms, 1)
    execute("UPDATE mixing_charges SET finished_at = now() - interval '1 day' WHERE id=%s", (ch["id"],))
    assert svc.list_charges_today() == []


def test_anulowany_wsad_nie_wchodzi_do_historii():
    oid, ms = _zlecenie(), _partia()
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.cancel_charge(ch["id"], "pomyłka")
    assert svc.list_charges_today() == []


def test_paleta_wyrobu_dostaje_wlasny_numer_przy_odbiorze():
    """Paleta mięsa przyprawionego numerowana CIĄGIEM, własnym torem.

    Właściciel 18.09.2026: „palety mięsa przyprawionego mają być numerowane też
    ciągiem jak ważenie przypraw, tylko swoim torem". Numer idzie na etykietę —
    po nim hala rozpoznaje paletę, gdy dwie partie tej samej receptury stoją
    obok siebie.
    """
    oid, ms = _zlecenie(), _partia()
    a = _przerobiony(oid, ms, 1)
    b = _przerobiony(oid, ms, 2)

    na = query_one("SELECT out_pallet_no FROM mixing_charges WHERE id=%s", (a["id"],))["out_pallet_no"]
    nb = query_one("SELECT out_pallet_no FROM mixing_charges WHERE id=%s", (b["id"],))["out_pallet_no"]
    assert na >= 1 and nb == na + 1, "numery palet idą ciągiem"


def test_numer_palety_wyrobu_jest_niezalezny_od_numeru_paczki_przypraw():
    """Dwa tory: paczki przypraw mają swój licznik, palety wyrobu swój."""
    from app.models.masownia import SpiceCartCreate

    oid, ms = _zlecenie(), _partia()
    svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))
    svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))
    ch = _przerobiony(oid, ms, 1)

    paleta = query_one("SELECT out_pallet_no FROM mixing_charges WHERE id=%s", (ch["id"],))["out_pallet_no"]
    assert paleta == 1, "paczki przypraw nie przesuwają licznika palet wyrobu"


def test_historia_dnia_niesie_numer_palety():
    oid, ms = _zlecenie(), _partia()
    _przerobiony(oid, ms, 3)
    assert svc.list_charges_today()[0]["out_pallet_no"] >= 1


def test_stojacy_wsad_nie_ma_jeszcze_numeru_palety():
    """Paleta powstaje przy ODBIORZE — wcześniej nie ma czego numerować."""
    oid, ms = _zlecenie(), _partia()
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.start_charge(ch["id"])
    assert query_one(
        "SELECT out_pallet_no FROM mixing_charges WHERE id=%s", (ch["id"],)
    )["out_pallet_no"] is None
