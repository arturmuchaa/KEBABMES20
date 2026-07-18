"""Częściowe ważenia mięsa z otwartego pobrania (weigh-part): porcja od razu
wchodzi na lot mięsa, pobranie zostaje pending; complete sumuje porcje.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import (
    complete_deboning_take,
    create_deboning_take,
    delete_deboning_entry,
    list_deboning_entries,
    update_deboning_take,
    weigh_part_deboning_take,
)
from app.utils.ids import now_iso


def _seed_batch(batch_id="rb1", internal_no="800", kg=300.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,'Dostawca',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), kg, kg, now_iso()),
    )


def _take_dto(**kw):
    base = dict(raw_batch_id="rb1", worker_id="w1", worker_name="Jan",
                kg_taken=300.0, kg_quarter=None, session_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _meat_dto(kg, mode=None):
    return SimpleNamespace(kg_meat=kg, kg_gross=None, tare_cart_kg=None,
                           tare_e2_kg=None, e2_count=None, weigh_mode=mode)


def test_weigh_part_dopisuje_na_magazyn_a_wpis_zostaje_pending(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    row = query_one("SELECT status, kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert row["status"] == "pending"
    assert float(row["kg_meat"] or 0) == 0.0  # suma dopiero przy domknięciu
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE lot_no='800'")
    assert float(lot["kg_available"]) == 100.0
    w = query_one("SELECT COUNT(*) AS n, COALESCE(SUM(kg_meat),0) AS s FROM deboning_take_weighings")
    assert w["n"] == 1 and float(w["s"]) == 100.0
    mv = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE source_type='deboning' AND source_id=%s AND movement_type='IN'",
        (entry["id"],),
    )
    assert float(mv["q"]) == 100.0


def test_weigh_part_suma_nie_moze_przekroczyc_pobrania(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    with pytest.raises(HTTPException) as e:
        weigh_part_deboning_take(entry["id"], _meat_dto(250.0))
    assert e.value.status_code == 400


def test_weigh_part_na_domknietym_wpisie_409(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto(kg_taken=300.0))
    complete_deboning_take(entry["id"], _meat_dto(195.0))
    with pytest.raises(HTTPException) as e:
        weigh_part_deboning_take(entry["id"], _meat_dto(10.0))
    assert e.value.status_code == 409


def test_complete_po_czesciach_sumuje_i_nie_dubluje_magazynu(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    complete_deboning_take(entry["id"], _meat_dto(95.0))  # ostatnia porcja
    row = query_one(
        "SELECT status, kg_meat, yield_pct, kg_remainder FROM deboning_entries WHERE id=%s",
        (entry["id"],),
    )
    assert row["status"] == "complete"
    assert float(row["kg_meat"]) == 195.0          # 100 + 95
    assert float(row["yield_pct"]) == 65.0          # 195/300
    assert float(row["kg_remainder"]) == 105.0
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE lot_no='800'")
    assert float(lot["kg_available"]) == 195.0      # nie 100+195
    w = query_one("SELECT COUNT(*) AS n FROM deboning_take_weighings WHERE entry_id=%s", (entry["id"],))
    assert w["n"] == 2                              # obie porcje w historii


def test_complete_z_czesciami_waliduje_sume(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(200.0))
    with pytest.raises(HTTPException) as e:
        complete_deboning_take(entry["id"], _meat_dto(150.0))  # 350 > 300
    assert e.value.status_code == 400


def test_storno_pendingu_z_wazeniami_cofa_magazyn(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    delete_deboning_entry(entry["id"])
    assert query_one("SELECT id FROM deboning_entries WHERE id=%s", (entry["id"],)) is None
    assert query_one("SELECT id FROM meat_stock WHERE lot_no='800'") is None  # pusty lot znika
    b = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(b["kg_available"]) == 300.0
    assert query_one("SELECT id FROM deboning_take_weighings LIMIT 1") is None  # CASCADE
    assert query_one(
        "SELECT id FROM stock_movements WHERE source_type='deboning' AND source_id=%s LIMIT 1",
        (entry["id"],),
    ) is None


def test_storno_pendingu_blokada_gdy_mieso_zuzyte(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    # masowanie zabrało 60 kg z lotu — cofnięcie oddałoby mięso, którego nie ma
    execute("UPDATE meat_stock SET kg_available = 40 WHERE lot_no='800'")
    with pytest.raises(HTTPException) as e:
        delete_deboning_entry(entry["id"])
    assert e.value.status_code == 400


def test_edycja_pobrania_nie_zejdzie_ponizej_zwazonych(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    with pytest.raises(HTTPException) as e:
        update_deboning_take(entry["id"], SimpleNamespace(kg_taken=80.0))
    assert e.value.status_code == 400
    updated = update_deboning_take(entry["id"], SimpleNamespace(kg_taken=150.0))
    assert updated["kgTaken"] == 150.0


def test_lista_wpisow_ma_kg_meat_weighed_dla_pending(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    rows = list_deboning_entries(None)
    mine = next(r for r in rows if r["id"] == entry["id"])
    assert mine["kgMeatWeighed"] == 100.0
