"""WZ wystawiony na pracownika dopisuje potrącenie do jego rozliczenia.

Pracownicy kupują ćwiartkę/mięso na własny użytek, biuro wystawia WZ, żeby
zeszło ze stanów (prod: WZ/3/08/26 „DENYS" 56 zł, WZ/50/07/26 „RAJA" 14 zł,
oba bez NIP). Rozchód i potrącenie są w JEDNEJ transakcji — albo oba, albo
żadne.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.wz_service import cancel_wz, create_manual_wz, update_wz_prices


def _worker(wid="w1", name="VADYM"):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,true) "
        "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, active=true",
        (wid, name),
    )


def _batch(bid="rb1", no="500", kg=1000):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES (%s,%s,%s,'Dostawca',%s,%s,'open','mat-cwiartka',"
        "'Ćwiartka z kurczaka',10,now())",
        (bid, no, int(no), kg, kg),
    )
    return bid


def _wz(payroll_deduction=None, qty=5.0, price=11.2):
    return create_manual_wz(
        buyer={"name": "VADYM", "address": "", "nip": ""},
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": qty, "price": price, "batch_no": "500"}],
        valued=True,
        issued_date="2026-08-04",
        payroll_deduction=payroll_deduction,
    )


def test_wz_zaklada_potracenie_oczekujace(db):
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})

    rows = query_all("SELECT * FROM worker_deductions WHERE worker_id='w1'")
    assert len(rows) == 1
    d = rows[0]
    assert float(d["amount"]) == 56.0
    assert d["status"] == "pending"
    assert d["source_type"] == "wz"
    assert d["source_id"] == doc["id"]
    assert str(d["deduction_date"]) == "2026-08-04"
    # Na pasku ma stać asortyment, nie numer dokumentu.
    assert d["description"] == "Ćwiartka 5 kg × 11,20 zł"
    assert doc["number"] not in d["description"]


def test_bez_wskazania_pracownika_nie_ma_potracenia(db):
    _worker()
    _batch()
    _wz(None)
    assert query_all("SELECT * FROM worker_deductions") == []


def test_brak_stanu_cofa_takze_potracenie(db):
    """Rollback musi objąć potrącenie — inaczej zostałoby po nieudanym WZ."""
    _worker()
    _batch(kg=1)
    with pytest.raises(HTTPException):
        _wz({"workerId": "w1", "amount": 56.0}, qty=500.0)
    assert query_all("SELECT * FROM worker_deductions") == []
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")["kg_available"]) == 1


# ── Cykl życia ────────────────────────────────────────────────────────

def test_anulowanie_wz_anuluje_oczekujace_potracenie(db):
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    res = cancel_wz(doc["id"])

    d = query_one("SELECT status FROM worker_deductions WHERE source_id=%s", (doc["id"],))
    assert d["status"] == "cancelled"
    assert res.get("deductionWarning") is None


def test_anulowanie_nie_rusza_potracenia_juz_rozliczonego(db):
    """Pieniądze są już na pasku — cichy powrót zostawiłby rozjazd."""
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    execute(
        "UPDATE worker_deductions SET status='settled', settlement_id='s1' "
        "WHERE source_id=%s",
        (doc["id"],),
    )
    res = cancel_wz(doc["id"])

    d = query_one("SELECT status FROM worker_deductions WHERE source_id=%s", (doc["id"],))
    assert d["status"] == "settled"
    assert "rozliczone" in (res.get("deductionWarning") or "").lower()


def test_zmiana_cen_aktualizuje_oczekujace_potracenie(db):
    """Ceny bywają dopisywane po wystawieniu — potrącenie ma iść za nimi."""
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    update_wz_prices(doc["id"], [{"index": 0, "price": 20.0}])

    d = query_one("SELECT amount, description FROM worker_deductions WHERE source_id=%s",
                  (doc["id"],))
    assert float(d["amount"]) == 100.0  # 5 kg × 20,00
    # Opis MUSI iść za ceną — inaczej pasek pokazuje 11,20 zł przy kwocie 100 zł.
    assert d["description"] == "Ćwiartka 5 kg × 20 zł"
