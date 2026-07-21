"""Dwufazowy rozbiór: pobranie (pending) → domknięcie mięsem → storno.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.deboning import DeboningTakeCreate, DeboningTakeComplete, DeboningTakeUpdate
from app.services.deboning_service import (
    create_deboning_take,
    complete_deboning_take,
    delete_deboning_entry,
    deboning_stats,
    update_deboning_take,
)
from app.utils.ids import now_iso


def _seed_cwiartka_batch(batch_id="rb1", internal_no="700", kg=100.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", kg, kg, now_iso()),
    )


# ── Faza 1: pobranie ──────────────────────────────────────────────────
def test_take_tworzy_wpis_pending_bez_miesa(db):
    _seed_cwiartka_batch(internal_no="700", kg=100.0)
    entry = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    assert entry["status"] == "pending"
    assert entry["kgTaken"] == 60.0
    assert entry["kgMeat"] == 0
    row = query_one("SELECT status, kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert row["status"] == "pending"


def test_take_zdejmuje_surowiec_z_partii(db):
    _seed_cwiartka_batch(internal_no="701", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 40.0


def test_take_nie_tworzy_lotu_miesa(db):
    _seed_cwiartka_batch(internal_no="702", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    ms = query_one("SELECT id FROM meat_stock WHERE lot_no='702'")
    assert ms is None


# ── Faza 2: domknięcie mięsem ─────────────────────────────────────────
def test_complete_domyka_wpis_i_tworzy_lot_miesa(db):
    _seed_cwiartka_batch(internal_no="710", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    done = complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    assert done["status"] == "complete"
    assert done["kgMeat"] == 70.0
    ms = query_one("SELECT kg_available FROM meat_stock WHERE lot_no='710'")
    assert ms and float(ms["kg_available"]) == 70.0


def test_complete_nie_rusza_surowca_drugi_raz(db):
    _seed_cwiartka_batch(internal_no="711", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 0.0  # zeszło raz przy pobraniu


def test_complete_zla_wydajnosc_blokuje(db):
    _seed_cwiartka_batch(internal_no="712", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=20.0))
    assert ei.value.status_code == 400


def test_podwojne_domkniecie_odrzucone(db):
    _seed_cwiartka_batch(internal_no="713", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=60.0))
    assert ei.value.status_code == 409


# ── Storno pending + statystyki ───────────────────────────────────────
def test_storno_pending_oddaje_surowiec(db):
    _seed_cwiartka_batch(internal_no="720", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    delete_deboning_entry(take["id"])
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 100.0
    row = query_one("SELECT id FROM deboning_entries WHERE id=%s", (take["id"],))
    assert row is None


def test_stats_pomija_pending(db):
    _seed_cwiartka_batch(internal_no="721", kg=200.0)
    # pending: 60 kg ćwiartki, 0 mięsa — nie może zaniżyć wydajności
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    assert stats["summary"]["kgMeat"] == 0.0
    assert stats["summary"]["quarters"] == 0  # pending nie liczy się jako sztuka
    assert stats["byBatch"] == []  # uzysk per partia też bez pending


def test_dobranie_scala_sie_w_jedno_pobranie(db):
    """Anatoli 135 + 300 ma być JEDNYM pobraniem 435 (prod 2026-07-09)."""
    _seed_cwiartka_batch(internal_no="740", kg=500.0)
    t1 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli", kg_taken=135.0,
    ))
    t2 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli", kg_taken=300.0,
    ))
    assert t2["id"] == t1["id"]
    assert t2["kgTaken"] == 435.0
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 65.0
    # jeden ruch OUT o łącznej masie
    mv = query_one(
        "SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE source_type='deboning' AND source_id=%s AND movement_type='OUT'",
        (t1["id"],),
    )
    assert int(mv["c"]) == 1 and float(mv["q"]) == -435.0  # OUT = ujemne kg
    # storno scalonego pobrania oddaje CAŁOŚĆ
    delete_deboning_entry(t1["id"])
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 500.0


def test_edycja_pobrania_koryguje_partie(db):
    _seed_cwiartka_batch(internal_no="741", kg=500.0)
    t = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Jan", kg_taken=200.0,
    ))
    upd = update_deboning_take(t["id"], DeboningTakeUpdate(kg_taken=150.0))
    assert upd["kgTaken"] == 150.0
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 350.0  # 500 - 150
    mv = query_one(
        "SELECT qty FROM stock_movements WHERE source_type='deboning' AND source_id=%s "
        "AND movement_type='OUT'", (t["id"],),
    )
    assert float(mv["qty"]) == -150.0  # OUT = ujemne kg
    # edycja ponad dostępność blokuje
    with pytest.raises(HTTPException) as ei:
        update_deboning_take(t["id"], DeboningTakeUpdate(kg_taken=999.0))
    assert ei.value.status_code == 400


def test_backfill_abp_pomija_pending(db):
    """Backfill ABP nie może wygenerować lotu 'other' z całej ćwiartki
    pending — zablokowałoby to poprawne loty przy domknięciu (idempotencja)."""
    from app.services.byproducts_service import backfill_byproduct_lots

    _seed_cwiartka_batch(internal_no="730", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    backfill_byproduct_lots()
    lots = query_one(
        "SELECT COUNT(*) AS c FROM byproduct_lots WHERE deboning_entry_id=%s",
        (take["id"],),
    )
    assert int(lots["c"]) == 0  # pending nietknięty
    # po domknięciu powstają właściwe loty ABP
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    lots = query_one(
        "SELECT COUNT(*) AS c FROM byproduct_lots WHERE deboning_entry_id=%s",
        (take["id"],),
    )
    assert int(lots["c"]) > 0


# ── Gwarancje „nic nie znika" (prod 2026-07-09) ───────────────────────
def _seed_session(session_id: str, status: str = "open"):
    execute(
        "INSERT INTO production_sessions (id, session_date, process_type, status, started_at, created_at) "
        "VALUES (%s, CURRENT_DATE, 'deboning', %s, now(), %s)",
        (session_id, status, now_iso()),
    )


def test_pobranie_wyczerpujace_partie_konczy_dopiero_po_zwazeniu_miesa(db):
    """Pobrania potrafią wyczerpać kg_available na długo przed zważeniem
    mięsa — partia NIE jest zakończona, dopóki ktokolwiek czeka z mięsem
    (prod 2026-07-10, partia 408). Zakończenie = domknięcie OSTATNIEGO
    pobrania; wtedy rekord ubocznych (gwarancja serwerowa)."""
    from app.services.batch_byproducts_service import get as get_byproducts, pending

    _seed_cwiartka_batch(internal_no="750", kg=200.0)
    t1 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Jan", kg_taken=100.0,
    ))
    t2 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w2", worker_name="Adam", kg_taken=100.0,
    ))
    # kg_available = 0, ale dwa otwarte pobrania → partia wciąż AKTYWNA
    assert get_byproducts("rb1") is None
    complete_deboning_take(t1["id"], DeboningTakeComplete(kg_meat=66.0))
    assert get_byproducts("rb1") is None  # Adam nadal czeka z mięsem
    complete_deboning_take(t2["id"], DeboningTakeComplete(kg_meat=66.0))
    rec = get_byproducts("rb1")
    assert rec and rec["finishedAt"] is not None  # ostatni domknął → koniec
    assert any(p["rawBatchId"] == "rb1" for p in pending())


def test_wpis_wyczerpujacy_partie_auto_zakancza(db):
    from app.models.deboning import DeboningEntryCreate
    from app.services.deboning_service import create_deboning_entry
    from app.services.batch_byproducts_service import get as get_byproducts

    _seed_cwiartka_batch(internal_no="751", kg=100.0)
    create_deboning_entry(DeboningEntryCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0, kg_meat=66.0,
    ))
    rec = get_byproducts("rb1")
    assert rec and rec["finishedAt"] is not None


def test_edycja_pobrania_do_wyczerpania_nie_konczy_przed_zwazeniem(db):
    from app.services.batch_byproducts_service import get as get_byproducts

    _seed_cwiartka_batch(internal_no="752", kg=100.0)
    t = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Jan", kg_taken=60.0,
    ))
    assert get_byproducts("rb1") is None  # 40 kg zostaje — partia żyje
    update_deboning_take(t["id"], DeboningTakeUpdate(kg_taken=100.0))
    # wyczerpana, ale pobranie czeka na mięso → partia wciąż aktywna
    assert get_byproducts("rb1") is None
    complete_deboning_take(t["id"], DeboningTakeComplete(kg_meat=66.0))
    rec = get_byproducts("rb1")
    assert rec and rec["finishedAt"] is not None


def test_dobranie_nie_scala_sie_miedzy_sesjami(db):
    """Dobranie DZISIAJ nie może doliczyć się do niewidocznego pobrania z
    wczorajszej sesji — kg schodziłoby z partii bez śladu na ekranie."""
    from app.utils.ids import cuid as _cuid
    from app.services.deboning_service import list_deboning_entries

    s_old, s_new = _cuid(), _cuid()
    _seed_session(s_old)
    _seed_cwiartka_batch(internal_no="753", kg=500.0)
    t1 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli",
        kg_taken=135.0, session_id=s_old,
    ))
    execute("UPDATE production_sessions SET status='closed' WHERE id=%s", (s_old,))
    _seed_session(s_new)
    t2 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli",
        kg_taken=300.0, session_id=s_new,
    ))
    assert t2["id"] != t1["id"]  # osobne pobrania per sesja
    # HMI nowej sesji widzi OBA otwarte pobrania (with_open_takes)
    ids = {e["id"] for e in list_deboning_entries(s_new, with_open_takes=True)}
    assert {t1["id"], t2["id"]} <= ids
    # bez flagi (biuro, podsumowania) — tylko wpisy tej sesji
    ids_plain = {e["id"] for e in list_deboning_entries(s_new)}
    assert t1["id"] not in ids_plain


def test_domkniecie_pobrania_po_zamknieciu_sesji_przepina_do_otwartej(db):
    """Pobranie „przez noc": sesja z dnia pobrania zamknięta → domknięcie
    mięsem przepina wpis do dzisiejszej otwartej sesji zamiast blokować."""
    from app.utils.ids import cuid as _cuid

    s_old, s_new = _cuid(), _cuid()
    _seed_session(s_old)
    _seed_cwiartka_batch(internal_no="754", kg=200.0)
    t = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Jan",
        kg_taken=200.0, session_id=s_old,
    ))
    execute("UPDATE production_sessions SET status='closed' WHERE id=%s", (s_old,))
    _seed_session(s_new)
    done = complete_deboning_take(t["id"], DeboningTakeComplete(kg_meat=132.0))
    assert done["status"] == "complete"
    row = query_one("SELECT session_id FROM deboning_entries WHERE id=%s", (t["id"],))
    assert row["session_id"] == s_new
    # bez żadnej otwartej sesji — dalej blokada (nie zgadujemy dnia)
    execute("UPDATE production_sessions SET status='closed' WHERE id=%s", (s_new,))


def test_stats_licza_pobranie_w_dniu_POBRANIA_nie_zwazenia(db):
    """Pobranie należy do dnia, w którym pracownik WZIĄŁ ćwiartkę — nawet gdy
    mięso zważył nazajutrz.

    ZMIANA KONTRAKTU wobec prod 2026-07-10 (wcześniej liczyło się w dniu
    ZWAŻENIA). Powód: akord płaci się za kg POBRANEJ ćwiartki, więc dzień
    pobrania decyduje o tym, na czyj dzień spada wypłata. Prod 2026-07-21:
    wpis Ryszarda z 20.07 (240 kg, domknięty 21.07 o 06:10) doliczał się do
    21.07 — kafelek HMI pokazywał 390 kg zamiast 150 kg.

    Feed „Ostatnie wpisy" NADAL niesie czas ZWAŻENIA — poprawka po incydencie
    z Anatolim dotyczyła kolejności w obrębie dnia, nie przypisania do dnia.
    """
    _seed_cwiartka_batch(internal_no="760", kg=200.0)
    t = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli", kg_taken=200.0,
    ))
    # pobranie „wczoraj", mięso zważone dziś
    execute(
        "UPDATE deboning_entries SET created_at = created_at - INTERVAL '1 day' WHERE id=%s",
        (t["id"],),
    )
    complete_deboning_take(t["id"], DeboningTakeComplete(kg_meat=132.0))
    today = date.today().isoformat()
    from datetime import timedelta
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    stats_t = deboning_stats(today, today)
    assert stats_t["summary"]["kgQuarter"] == 0.0  # NIE dolicza się do dziś
    assert stats_t["summary"]["kgMeat"] == 0.0

    stats_y = deboning_stats(yesterday, yesterday)
    assert stats_y["summary"]["kgQuarter"] == 200.0  # dzień POBRANIA
    assert stats_y["summary"]["kgMeat"] == 132.0
    assert stats_y["byDay"][0]["date"] == yesterday
    assert stats_y["workers"][0]["kgQuarter"] == 200.0  # akord na właściwy dzień
    # feed nadal ze znacznikiem ZWAŻENIA, mimo że wpis należy do wczoraj
    assert stats_y["recent"] and stats_y["recent"][0]["workerName"] == "Anatoli"
    assert stats_y["recent"][0]["at"][:10] == today
