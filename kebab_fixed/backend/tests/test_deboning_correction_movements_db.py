"""Korekty wpisu rozbioru muszą iść w parze z księgą ruchów (stock_movements).

Audyt 2026-07-22: correct_deboning_entry i update_deboning_entry korygowały
raw_batches/meat_stock BEZ ruchu magazynowego — księga rozjeżdżała się ze
stanem (prod: partia 404 +75 kg, lot 412 +10 kg), a kartoteka partii
pokazywała przesunięte salda historyczne. Testy DB — bez TEST_DATABASE_URL skip.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.deboning import DeboningEntryUpdate
from app.services.deboning_service import (
    change_deboning_entry_batch,
    complete_deboning_take,
    correct_deboning_entry,
    create_deboning_take,
    delete_deboning_entry,
    update_deboning_entry,
    weigh_part_deboning_take,
)
from app.utils.ids import cuid, now_iso


def _seed(kg_quarter=200.0, kg_meat=132.0):
    """Partia + lot mięsa + zakończony wpis Adriana Z RUCHAMI jak po create."""
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-adrian','Adrian','rozbior',0.5) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES ('rb1','900',900,'Dostawca',1000,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (1000 - kg_quarter, now_iso()),
    )
    execute(
        "INSERT INTO meat_stock (id, lot_no, raw_batch_id, raw_batch_no, kg_initial,"
        " kg_available, created_at) VALUES ('ms1','900','rb1','900',%s,%s, now())",
        (kg_meat, kg_meat),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, created_at, completed_at)"
        " VALUES ('e1','rb1','900','w-adrian','Adrian',%s,%s,66.0, now(), now())",
        (kg_quarter, kg_meat),
    )
    execute(
        "INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type,"
        " source_type, source_id, created_at) VALUES"
        " (%s,'raw','rb1',%s,'OUT','deboning','e1',now()),"
        " (%s,'meat','ms1',%s,'IN','deboning','e1',now())",
        (cuid(), -kg_quarter, cuid(), kg_meat),
    )


def _raw_ledger():
    r = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements"
        " WHERE product_type='raw' AND batch_id='rb1'"
        " AND source_type IN ('deboning','deboning_correction')"
    )
    return float(r["q"])


def _meat_ledger():
    r = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements"
        " WHERE product_type='meat' AND batch_id='ms1'"
        " AND source_type IN ('deboning','deboning_correction')"
    )
    return float(r["q"])


def test_korekta_biurowa_dopisuje_ruchy_korekcyjne(db):
    _seed()
    correct_deboning_entry("e1", None, 180.0, 120.0, "pomyłka wagi", "biuro")
    # Księga = stan: ruchy raw sumują się do −nowej ćwiartki, meat do nowego mięsa.
    assert _raw_ledger() == pytest.approx(-180.0)
    assert _meat_ledger() == pytest.approx(120.0)
    corr = query_one(
        "SELECT movement_type, qty FROM stock_movements"
        " WHERE source_type='deboning_correction' AND product_type='raw' AND source_id='e1'"
    )
    assert corr is not None and corr["movement_type"] == "IN"  # oddane 20 kg


def test_patch_hmi_synchronizuje_ruchy_i_pisze_slad(db):
    _seed()
    update_deboning_entry("e1", DeboningEntryUpdate(kgTaken=220.0, kgMeat=140.0))
    assert _raw_ledger() == pytest.approx(-220.0)
    assert _meat_ledger() == pytest.approx(140.0)
    # Edycja kg bez śladu audytowego = niewidzialna zmiana akordu (incydent 424).
    trail = query_one(
        "SELECT reason, changes FROM deboning_entry_corrections WHERE entry_id='e1'"
    )
    assert trail is not None
    assert trail["changes"].get("kgQuarter") == {"from": 200.0, "to": 220.0}
    assert trail["changes"].get("kgMeat") == {"from": 132.0, "to": 140.0}


def test_patch_hmi_bez_zmiany_kg_nie_pisze_sladu(db):
    """Rozdział grzbietów/kości (zakończenie partii) to rutyna, nie korekta."""
    _seed()
    update_deboning_entry("e1", DeboningEntryUpdate(kgBacks=40.0, kgBones=20.0))
    assert query_one(
        "SELECT id FROM deboning_entry_corrections WHERE entry_id='e1'"
    ) is None
    assert _raw_ledger() == pytest.approx(-200.0)  # ruchy nietknięte


def _take_dto(**kw):
    base = dict(raw_batch_id="rb2", worker_id="w-adrian", worker_name="Adrian",
                kg_taken=300.0, kg_quarter=None, session_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _meat_dto(kg):
    return SimpleNamespace(kg_meat=kg, kg_gross=None, tare_cart_kg=None,
                           tare_e2_kg=None, e2_count=None, weigh_mode=None)


def test_patch_hmi_blokuje_nadpisanie_pomiaru_z_wagi(db):
    """PATCH z HMI nie może po cichu nadpisać kg zmierzonych przez wagę —
    dokładnie mechanizm incydentu 424, tylko od strony hali."""
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES ('rb2','901',901,'Dostawca',400,400,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(59.0))
    complete_deboning_take(entry["id"], _meat_dto(95.5))
    with pytest.raises(HTTPException) as e:
        update_deboning_entry(entry["id"], DeboningEntryUpdate(kgMeat=97.0))
    assert e.value.status_code == 409
    row = query_one("SELECT kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert float(row["kg_meat"]) == 154.5  # pomiar nietknięty


def test_storno_sprzata_takze_ruchy_korekcyjne(db):
    _seed()
    correct_deboning_entry("e1", None, 180.0, 120.0, "pomyłka wagi", "biuro")
    delete_deboning_entry("e1")
    left = query_one(
        "SELECT COUNT(*) AS n FROM stock_movements WHERE source_id='e1'"
    )
    assert left["n"] == 0  # bez sierot w księdze


def test_zmiana_partii_przenosi_ruchy_korekcyjne(db):
    _seed()
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES ('rb9','909',909,'Dostawca',1000,1000,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )
    correct_deboning_entry("e1", None, 180.0, 120.0, "pomyłka wagi", "biuro")
    change_deboning_entry_batch("e1", "rb9")
    stray = query_one(
        "SELECT COUNT(*) AS n FROM stock_movements"
        " WHERE product_type='raw' AND source_id='e1' AND batch_id <> 'rb9'"
    )
    assert stray["n"] == 0  # wszystkie ruchy raw wpisu wskazują nową partię


def test_migracja_domyka_dryf_ksiegi(db):
    """Naprawa danych historycznych: korekty sprzed fixa zmieniły wpisy bez
    ruchów — migracja dopisuje ruch domykający różnicę; drugi przebieg nic
    nie zmienia (idempotencja)."""
    from app.migrations import _reconcile_deboning_ledger

    _seed()
    # historyczna korekta bez ruchu: stan/wpis zmienione, księga nie
    execute("UPDATE deboning_entries SET kg_quarter=275, kg_meat=142 WHERE id='e1'")
    _reconcile_deboning_ledger()
    assert _raw_ledger() == pytest.approx(-275.0)
    assert _meat_ledger() == pytest.approx(142.0)
    _reconcile_deboning_ledger()
    assert _raw_ledger() == pytest.approx(-275.0)
    assert _meat_ledger() == pytest.approx(142.0)
