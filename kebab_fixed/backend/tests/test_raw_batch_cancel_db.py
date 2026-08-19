"""Anulowanie przyjęcia ćwiartki: zeruje stan i partia znika z magazynu/WZ.

Duch partii 415 (prod 2026-07-16): anulowana dostawa wisiała z 5010 kg na
magazynie surowca i w pickerze WZ, bo cancel_batch nie zerował kg_available,
a stock_raw() filtrował tylko po kg_available > 0 — bez statusu.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.raw_batches import RawBatchCreate
from app.services.raw_batches_service import cancel_batch, cancel_reception, create_batch
from app.services.wz_service import stock_raw
from app.utils.ids import now_iso


def _seed_raw(batch_id="rbc1", internal_no="415", kg=5010.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "KOKO", kg, kg, now_iso()),
    )


def test_cancel_zeruje_stan_i_partia_znika_z_magazynu(db):
    _seed_raw()
    assert any(r["internal_batch_no"] == "415" for r in stock_raw())

    cancel_batch("rbc1")

    row = query_one("SELECT status, kg_available FROM raw_batches WHERE id='rbc1'")
    assert row["status"] == "cancelled"
    assert float(row["kg_available"] or 0) == 0.0
    assert not any(r["internal_batch_no"] == "415" for r in stock_raw())


def _seed_supplier(sid="sup1"):
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, created_at) VALUES (%s,%s,%s,%s,%s)",
        (sid, "KOKO", "KOKO", "KOKO", now_iso()),
    )
    execute(
        "INSERT INTO raw_material_types (id, name, requires_deboning) VALUES "
        "('mat-cwiartka','Ćwiartka z kurczaka',true) ON CONFLICT (id) DO NOTHING"
    )
    return sid


def test_numer_usunietej_partii_wraca_do_puli(db):
    """Prod 2026-07-20: usunięto przyjęcie 423 i numer został zablokowany —
    „Partia 423 już istnieje" przy próbie przyjęcia pod tym samym numerem.
    Usunięta (anulowana) dostawa nie może rezerwować numeru."""
    sid = _seed_supplier()
    first = create_batch(RawBatchCreate(
        internalBatchNo="423", supplierId=sid, kgReceived=7005, pricePerKg=5,
    ))
    cancel_batch(first["id"])

    again = create_batch(RawBatchCreate(
        internalBatchNo="423", supplierId=sid, kgReceived=100, pricePerKg=6,
    ))

    assert again["internal_batch_no"] == "423"
    assert again["id"] != first["id"]
    # Numer wskazuje dokładnie jedną żywą partię — traceability i WZ szukają
    # dostawy po numerze, dwa trafienia dałyby losową datę uboju na dokumencie.
    live = query_all("SELECT id FROM raw_batches WHERE internal_batch_no='423'")
    assert len(live) == 1 and live[0]["id"] == again["id"]
    # Anulowana dostawa zostaje w historii (audyt), tylko bez numeru w puli.
    old = query_one("SELECT status, internal_batch_seq FROM raw_batches WHERE id=%s", (first["id"],))
    assert old["status"] == "cancelled"
    assert int(old["internal_batch_seq"]) == 423


def test_stock_raw_pomija_cancelled_nawet_ze_stanem(db):
    # Partie anulowane PRZED fixem mogły zostać ze stanem (jak 415 na prod) —
    # filtr w czytniku chroni niezależnie od zerowania przy anulowaniu.
    _seed_raw(batch_id="rbc2", internal_no="416")
    execute("UPDATE raw_batches SET status='cancelled' WHERE id='rbc2'")

    assert not any(r["internal_batch_no"] == "416" for r in stock_raw())


def test_cancel_domyka_ksiege_ruchow(db):
    """Audyt 2026-07-22: anulowanie zerowało kg_available bez ruchu — księga
    partii ANUL-* pokazywała duchy (+5010/+7005 kg). Po anulowaniu suma
    ruchów partii musi wynosić 0 (przyjęcie IN − anulowanie OUT)."""
    sid = _seed_supplier("sup-anul")
    created = create_batch(RawBatchCreate(
        internalBatchNo="430", supplierId=sid, kgReceived=5010, pricePerKg=5,
    ))
    cancel_batch(created["id"])
    ledger = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE product_type='raw' AND batch_id=%s", (created["id"],),
    )
    assert float(ledger["q"]) == 0.0
    mv = query_one(
        "SELECT movement_type, qty FROM stock_movements "
        "WHERE product_type='raw' AND batch_id=%s AND source_type='cancellation'",
        (created["id"],),
    )
    assert mv is not None and float(mv["qty"]) == -5010.0


# ── Anulowanie dostawy BEZ rozbioru (filet, mięso z/s) ────────────────────────
#
# Prod 2026-08-14: dostawę fileta wpisano jako mięso z/s i okazało się, że nie
# ma jej jak wycofać — taka dostawa ma lot w meat_stock już w sekundzie
# przyjęcia, więc strażnik „partia jest już użyta" blokował anulowanie ZAWSZE,
# nawet gdy nic z niej nie zeszło.

def _seed_filet_material():
    execute(
        "INSERT INTO raw_material_types (id, name, requires_deboning) VALUES "
        "('mat-filet-kurczak','Filet z kurczaka',false) ON CONFLICT (id) DO NOTHING"
    )


def _przyjmij_filet(sid, internal_no="480", kg=167.0):
    _seed_filet_material()
    return create_batch(RawBatchCreate(
        internalBatchNo=internal_no, supplierId=sid, kgReceived=kg, pricePerKg=10,
        materialTypeId="mat-filet-kurczak",
    ))


def test_nietkniety_filet_daje_sie_anulowac_i_znika_z_magazynu_miesa(db):
    sid = _seed_supplier("sup-filet")
    created = _przyjmij_filet(sid)
    lot = query_one("SELECT id, kg_available FROM meat_stock WHERE raw_batch_id=%s", (created["id"],))
    assert lot is not None and float(lot["kg_available"]) == 167.0

    cancel_batch(created["id"])

    lot_po = query_one("SELECT kg_available, status FROM meat_stock WHERE id=%s", (lot["id"],))
    assert float(lot_po["kg_available"]) == 0.0
    assert lot_po["status"] == "CANCELLED"
    # Księga lotu domknięta — bez tego kilogramy zostają duchem w magazynie.
    saldo = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE product_type='meat' AND batch_id=%s", (lot["id"],))
    assert float(saldo["q"]) == 0.0


def test_numer_anulowanej_dostawy_bez_rozbioru_wraca_do_puli_razem_z_lotem(db):
    """Prod 2026-08-19: biuro anulowało przez pomyłkę dostawę mięsa z/s (4700 kg)
    i nie mogło wpisać jej z powrotem pod tym samym numerem.

    Anulowanie oddawało numer PARTII, ale lot w `meat_stock` trzymał goły numer
    dalej, a `meat_stock.lot_no` ma UNIQUE — więc ponowne przyjęcie wywalało się
    na bazie. Okno anulowania obiecuje „numer wróci do puli", więc dla dostaw
    bez rozbioru musi to być prawda tak samo jak dla ćwiartki."""
    sid = _seed_supplier("sup-filet-pula")
    first = _przyjmij_filet(sid, internal_no="482", kg=4700.0)
    cancel_batch(first["id"])

    again = _przyjmij_filet(sid, internal_no="482", kg=4700.0)

    assert again["internal_batch_no"] == "482"
    assert again["id"] != first["id"]
    # Numer wskazuje dokładnie jeden ŻYWY lot — magazyn mięsa i picker WZ
    # szukają po numerze, dwa trafienia dałyby losowy stan.
    zywe = query_all(
        "SELECT id FROM meat_stock WHERE lot_no='482' AND status <> 'CANCELLED'")
    assert len(zywe) == 1
    assert float(query_one(
        "SELECT kg_available FROM meat_stock WHERE id=%s", (zywe[0]["id"],)
    )["kg_available"]) == 4700.0
    # Anulowany lot zostaje w historii — tylko bez numeru w puli.
    stary = query_one(
        "SELECT lot_no, status FROM meat_stock WHERE raw_batch_id=%s", (first["id"],))
    assert stary["status"] == "CANCELLED"
    assert stary["lot_no"] != "482"


def test_filet_ruszony_nadal_blokuje_anulowanie(db):
    sid = _seed_supplier("sup-filet2")
    created = _przyjmij_filet(sid, internal_no="481")
    # Cokolwiek zeszło z lotu (masowanie, WZ) — dostawy nie wolno wycofać.
    execute(
        "UPDATE meat_stock SET kg_available=100, kg_used=67 WHERE raw_batch_id=%s",
        (created["id"],),
    )

    with pytest.raises(HTTPException) as err:
        cancel_batch(created["id"])
    assert err.value.status_code == 409

    row = query_one("SELECT status FROM raw_batches WHERE id=%s", (created["id"],))
    assert row["status"] == "active"


def test_zarezerwowany_lot_blokuje_anulowanie(db):
    """Rezerwacja planu masowania to też użycie — plan trzyma te kilogramy."""
    sid = _seed_supplier("sup-filet3")
    created = _przyjmij_filet(sid, internal_no="482")
    execute("UPDATE meat_stock SET kg_reserved=167 WHERE raw_batch_id=%s", (created["id"],))

    with pytest.raises(HTTPException) as err:
        cancel_batch(created["id"])
    assert err.value.status_code == 409


def test_anulowanie_calego_dokumentu_zdejmuje_wszystkie_numery(db):
    sid = _seed_supplier("sup-dok")
    _seed_filet_material()
    rec_id = "rec-anul-1"
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        " received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'90/08',90,'2026-08','2026-08-14',%s,'KOKO',%s)",
        (rec_id, sid, now_iso()),
    )
    a = _przyjmij_filet(sid, internal_no="483", kg=100)
    b = _przyjmij_filet(sid, internal_no="484", kg=200)
    execute("UPDATE raw_batches SET reception_id=%s WHERE id IN (%s,%s)", (rec_id, a["id"], b["id"]))

    out = cancel_reception(rec_id)

    assert out["cancelled"] == 2
    for created in (a, b):
        row = query_one("SELECT status FROM raw_batches WHERE id=%s", (created["id"],))
        assert row["status"] == "cancelled"


def test_dokument_z_jednym_ruszonym_numerem_nie_anuluje_niczego(db):
    """Wszystko albo nic: dostawa wycofana w połowie rozjeżdża księgę."""
    sid = _seed_supplier("sup-dok2")
    _seed_filet_material()
    rec_id = "rec-anul-2"
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        " received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'91/08',91,'2026-08','2026-08-14',%s,'KOKO',%s)",
        (rec_id, sid, now_iso()),
    )
    a = _przyjmij_filet(sid, internal_no="485", kg=100)
    b = _przyjmij_filet(sid, internal_no="486", kg=200)
    execute("UPDATE raw_batches SET reception_id=%s WHERE id IN (%s,%s)", (rec_id, a["id"], b["id"]))
    execute("UPDATE meat_stock SET kg_available=50, kg_used=50 WHERE raw_batch_id=%s", (b["id"],))

    with pytest.raises(HTTPException) as err:
        cancel_reception(rec_id)
    assert err.value.status_code == 409

    # Pierwszy numer NIE mógł zostać anulowany „po drodze".
    row = query_one("SELECT status FROM raw_batches WHERE id=%s", (a["id"],))
    assert row["status"] == "active"
