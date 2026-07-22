"""Częściowe ważenia mięsa z otwartego pobrania (weigh-part): porcja od razu
wchodzi na lot mięsa, pobranie zostaje pending; complete sumuje porcje.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import (
    complete_deboning_take,
    correct_deboning_entry,
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


def _auto_dto(kg, gross, cart=6.0, e2=2.0, n=1):
    return SimpleNamespace(kg_meat=kg, kg_gross=gross, tare_cart_kg=cart,
                           tare_e2_kg=e2, e2_count=n, weigh_mode="auto")


def test_complete_po_czesciach_zeruje_pola_wagi_encji(db):
    """kg_meat encji = SUMA porcji, więc brutto/tary OSTATNIEJ porcji na encji
    kłamią (audyt 2026-07-22: brutto−tara−mięso do −101 kg na 423/424/425).
    Przy >1 ważeniu pola wagi encji → NULL; prawda porcji zostaje w
    deboning_take_weighings."""
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _auto_dto(100.0, gross=108.0))
    complete_deboning_take(entry["id"], _auto_dto(95.0, gross=103.0))
    row = query_one(
        "SELECT kg_gross, tare_cart_kg, tare_e2_kg, e2_count, kg_meat "
        "FROM deboning_entries WHERE id=%s", (entry["id"],),
    )
    assert float(row["kg_meat"]) == 195.0
    assert row["kg_gross"] is None and row["tare_cart_kg"] is None
    assert row["tare_e2_kg"] is None and row["e2_count"] is None
    w = query_one(
        "SELECT COUNT(*) AS n FROM deboning_take_weighings "
        "WHERE entry_id=%s AND kg_gross IS NOT NULL", (entry["id"],),
    )
    assert w["n"] == 2  # audyt wagi per porcja nietknięty


def test_complete_jednym_wazeniem_zachowuje_pola_wagi(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    complete_deboning_take(entry["id"], _auto_dto(195.0, gross=203.0))
    row = query_one(
        "SELECT kg_gross, tare_cart_kg FROM deboning_entries WHERE id=%s",
        (entry["id"],),
    )
    assert float(row["kg_gross"]) == 203.0 and float(row["tare_cart_kg"]) == 6.0


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


def _wpis_ryszarda():
    """Odtworzenie wpisu z incydentu prod 2026-07-21: 240 kg pobrania,
    mięso ważone na dwa razy (59,0 + 95,5 = 154,5 kg)."""
    _seed_batch(kg=400.0)
    entry = create_deboning_take(_take_dto(kg_taken=240.0))
    weigh_part_deboning_take(entry["id"], _meat_dto(59.0))
    complete_deboning_take(entry["id"], _meat_dto(95.5))
    return entry["id"]


def test_korekta_przeczaca_wazeniom_blokuje(db):
    entry_id = _wpis_ryszarda()
    assert float(query_one(
        "SELECT kg_meat FROM deboning_entries WHERE id=%s", (entry_id,)
    )["kg_meat"]) == 154.5

    with pytest.raises(HTTPException) as e:
        correct_deboning_entry(entry_id, None, 150.0, 97.0, "pomyłka", "biuro")
    # 409, nie 400 — UI musi odróżnić „potwierdź nadpisanie pomiaru" od
    # zwykłego błędu walidacji, żeby pokazać okno potwierdzenia
    assert e.value.status_code == 409
    assert "154,5" in e.value.detail and "2 ważeniach" in e.value.detail

    # wpis nietknięty — transakcja odrzucona w całości
    row = query_one("SELECT kg_quarter, kg_meat FROM deboning_entries WHERE id=%s", (entry_id,))
    assert float(row["kg_quarter"]) == 240.0 and float(row["kg_meat"]) == 154.5


def test_korekta_z_potwierdzeniem_nadpisuje_pomiar(db):
    entry_id = _wpis_ryszarda()
    correct_deboning_entry(
        entry_id, None, 150.0, 97.0, "pomyłka", "biuro", override_weighings=True
    )
    row = query_one("SELECT kg_quarter, kg_meat FROM deboning_entries WHERE id=%s", (entry_id,))
    assert float(row["kg_quarter"]) == 150.0 and float(row["kg_meat"]) == 97.0


def test_korekta_do_nierealnej_wydajnosci_blokuje(db):
    """Biuro nie miało żadnej walidacji wydajności — HMI ma ją od dawna."""
    entry_id = _wpis_ryszarda()
    # mięso bez zmian (zgodne z ważeniami), ale ćwiartka ścięta do 160 kg
    # → 154,5/160 = 96,6%, wydajność nierealna
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry(entry_id, None, 160.0, None, "korekta ćwiartki", "biuro")
    assert e.value.status_code == 400
    assert "nierealna" in e.value.detail
