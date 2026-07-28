"""Kartoteka pracownika: wszystkie pobrania jednej osoby z porcjami ważeń.

Powstała po reklamacji z hali (DENYS, 22.07.2026: „pobrałem 60 kg więcej") —
biuro musiało grzebać w SQL, żeby zobaczyć pojedyncze ważenia pracownika.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from types import SimpleNamespace

from app.db import execute
from app.services.deboning_service import (
    complete_deboning_take,
    create_deboning_take,
    weigh_part_deboning_take,
    worker_entries,
)
from app.utils.ids import now_iso


def _seed_batch(batch_id="rb1", internal_no="900", kg=2000.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,'Dostawca',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), kg, kg, now_iso()),
    )


def _take(worker_id, worker_name, kg):
    return create_deboning_take(SimpleNamespace(
        raw_batch_id="rb1", worker_id=worker_id, worker_name=worker_name,
        kg_taken=kg, kg_quarter=None, session_id=None))


def _meat(kg, mode="auto", gross=None, cart=None, e2=None, e2kg=None):
    return SimpleNamespace(kg_meat=kg, kg_gross=gross, tare_cart_kg=cart,
                           tare_e2_kg=e2kg, e2_count=e2, weigh_mode=mode)


def test_kartoteka_zwraca_pobrania_tylko_wybranego_pracownika(db):
    _seed_batch()
    a = _take("w1", "DENYS", 150.0)
    _take("w2", "RYSZARD", 120.0)
    complete_deboning_take(a["id"], _meat(99.5))

    res = worker_entries("w1")
    assert [e["rawBatchNo"] for e in res["data"]] == ["900"]
    assert res["summary"]["entries"] == 1
    assert res["summary"]["kgQuarter"] == 150.0
    assert res["summary"]["kgMeat"] == 99.5
    assert res["summary"]["avgYield"] == 66.33


def test_kartoteka_pokazuje_kazde_wazenie_porcji_z_audytem_wagi(db):
    """Sedno reklamacji: biuro musi zobaczyć, ILE PORCJI i jak zważonych
    złożyło się na pobranie — nie samą sumę."""
    _seed_batch()
    e = _take("w1", "DENYS", 300.0)
    weigh_part_deboning_take(e["id"], _meat(100.0, gross=115.0, cart=5.5, e2=5, e2kg=10.0))
    complete_deboning_take(e["id"], _meat(95.0, gross=110.5, cart=5.5, e2=5, e2kg=10.0))

    entry = worker_entries("w1")["data"][0]
    assert entry["kgMeat"] == 195.0
    assert len(entry["weighings"]) == 2
    w0 = entry["weighings"][0]
    assert (w0["kgMeat"], w0["kgGross"], w0["tareCartKg"], w0["e2Count"]) == (100.0, 115.0, 5.5, 5)
    assert w0["weighMode"] == "auto"
    assert entry["portions"] == 2


def test_kartoteka_bez_dat_daje_calosc_a_z_datami_tnie_zakres(db):
    _seed_batch()
    old = _take("w1", "DENYS", 100.0)
    complete_deboning_take(old["id"], _meat(65.0))
    execute("UPDATE deboning_entries SET created_at = created_at - INTERVAL '10 days' WHERE id=%s",
            (old["id"],))
    new = _take("w1", "DENYS", 200.0)
    complete_deboning_take(new["id"], _meat(130.0))

    assert worker_entries("w1")["summary"]["entries"] == 2          # całość
    today = worker_entries("w1")["data"][0]["dayLocal"]
    weziete = worker_entries("w1", str(today), str(today))
    assert weziete["summary"]["entries"] == 1
    assert weziete["summary"]["kgQuarter"] == 200.0


def test_kartoteka_liczy_dni_robocze_i_znaczy_korekty(db):
    """Liczba dni z pracą (do „kg/dzień") oraz flaga, że wpis był poprawiany
    z biura — bez niej biuro nie wie, czy patrzy na pomiar, czy na korektę."""
    _seed_batch()
    e = _take("w1", "DENYS", 150.0)
    complete_deboning_take(e["id"], _meat(99.0))
    execute(
        "INSERT INTO deboning_entry_corrections (id, entry_id, at, by_subject, reason, changes) "
        "VALUES ('corr1', %s, now(), 'biuro', 'pomyłka', '{\"kgMeat\": {\"from\": 90, \"to\": 99}}')",
        (e["id"],),
    )
    res = worker_entries("w1")
    assert res["summary"]["days"] == 1
    assert res["data"][0]["corrected"] is True
