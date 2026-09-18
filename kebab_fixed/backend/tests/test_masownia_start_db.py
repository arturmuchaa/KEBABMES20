"""Start masownicy jest ŚWIADOMĄ decyzją operatora.

Właściciel 18.09.2026: „żeby się nie puszczały automatycznie, tylko operator
świadomie potwierdzał albo świadomie czekał i puścił wszystkie równocześnie".
Załadunek zostawia więc maszynę pełną, ale stojącą — cykl liczy się dopiero
od startu.
"""
import pytest
from fastapi import HTTPException

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


def _partia(lot_no, kg=3000.0):
    ms = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms, lot_no, kg, kg, "2026-09-18", "2026-10-02"),
    )
    return ms


def _zaladuj(oid, ms, machine, kg=200.0):
    return svc.load_charge(ChargeCreate(orderId=oid, machineId=machine, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=kg)]))


def test_zaladunek_nie_uruchamia_maszyny():
    oid, ms = _zlecenie(), _partia("511")
    ch = _zaladuj(oid, ms, 1)
    assert ch["status"] == "loaded"
    assert ch["started_at"] is None, "cykl nie ma prawa lecieć przed startem"
    assert ch["loaded_at"] is not None


def test_start_uruchamia_odliczanie():
    oid, ms = _zlecenie(), _partia("511")
    ch = _zaladuj(oid, ms, 1)
    svc.start_charge(ch["id"])
    w_bazie = query_one("SELECT status, started_at FROM mixing_charges WHERE id=%s", (ch["id"],))
    assert w_bazie["status"] == "mixing"
    assert w_bazie["started_at"] is not None


def test_drugi_start_tego_samego_wsadu_nie_przestawia_zegara():
    """Podwójne dotknięcie nie może cofnąć maszyny o pełny cykl."""
    oid, ms = _zlecenie(), _partia("511")
    ch = _zaladuj(oid, ms, 1)
    svc.start_charge(ch["id"])
    with pytest.raises(HTTPException):
        svc.start_charge(ch["id"])


def test_start_wszystkich_puszcza_rownoczesnie():
    """Trzy maszyny ładowane po kolei mają ruszyć z tym samym stemplem."""
    oid, ms = _zlecenie(), _partia("511")
    for maszyna in (1, 2, 3):
        _zaladuj(oid, ms, maszyna)

    wynik = svc.start_all_charges()
    assert wynik["started"] == 3 and wynik["machines"] == [1, 2, 3]

    stemple = {str(r["started_at"]) for r in
               [query_one("SELECT started_at FROM mixing_charges WHERE machine_id=%s", (m,))
                for m in (1, 2, 3)]}
    assert len(stemple) == 1, "wsady puszczone razem muszą mieć jeden czas startu"


def test_start_wszystkich_nie_rusza_juz_pracujacych():
    oid, ms = _zlecenie(), _partia("511")
    a = _zaladuj(oid, ms, 1)
    svc.start_charge(a["id"])
    start_a = query_one("SELECT started_at FROM mixing_charges WHERE id=%s", (a["id"],))["started_at"]

    _zaladuj(oid, ms, 2)
    assert svc.start_all_charges()["started"] == 1

    assert query_one(
        "SELECT started_at FROM mixing_charges WHERE id=%s", (a["id"],)
    )["started_at"] == start_a


def test_zaladowana_maszyna_jest_zajeta():
    """Stojący, ale pełny wsad blokuje maszynę tak samo jak pracujący."""
    oid, ms = _zlecenie(), _partia("511")
    _zaladuj(oid, ms, 1)
    with pytest.raises(HTTPException) as e:
        _zaladuj(oid, ms, 1)
    assert "masownica" in str(e.value.detail).lower()


def test_zaladowany_wsad_trzyma_mieso():
    """Mięso wzięte do stojącej maszyny nie może wrócić na panel jako wolne."""
    oid, ms = _zlecenie(), _partia("511")
    _zaladuj(oid, ms, 1, kg=200)
    lot = next(l for l in svc.list_meat()["lots"] if l["meat_stock_id"] == ms)
    assert float(lot["kg_in_machine"]) == 200.0


def test_zaladowany_wsad_da_sie_anulowac():
    oid, ms = _zlecenie(), _partia("511")
    ch = _zaladuj(oid, ms, 1)
    svc.cancel_charge(ch["id"], "pomyłka")
    assert query_one("SELECT status FROM mixing_charges WHERE id=%s", (ch["id"],))["status"] == "cancelled"


def test_odbior_stojacego_wsadu_jest_odrzucany():
    """Nie ma odbioru z maszyny, która nigdy nie ruszyła."""
    oid, ms = _zlecenie(), _partia("511")
    ch = _zaladuj(oid, ms, 1)
    with pytest.raises(HTTPException):
        svc.finish_charge(ch["id"], ChargeFinish(kgOutput=230))
