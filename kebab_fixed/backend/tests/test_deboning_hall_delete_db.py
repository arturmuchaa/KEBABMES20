"""Usunięcie wpisu rozbioru Z HALI — operator prostuje własną pomyłkę.

Okno „Cofnij" na HMI trwa 60 s i dotyczy tylko OSTATNIEGO wpisu, a backend
przyjmował cofnięcie do 15 minut. Operator, który zauważył pomyłkę po godzinie,
nie miał już czego kliknąć — jedyną drogą było biuro (prod: właściciel na
urlopie, hala została sama).

Ścieżka hali omija WYŁĄCZNIE limit wieku. Zmiana zamknięta/zatwierdzona
blokuje dalej (to jest różnica między halą a biurem), tak samo zużyte mięso
i rozliczone uboczne — wiek to procedura, tamto fizyka.

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import delete_deboning_entry
from app.utils.ids import cuid, now_iso


def _seed(status="open", kg_quarter=200.0, kg_meat=132.0):
    """Partia + lot mięsa + zamknięty wpis w sesji o zadanym statusie."""
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-adrian','Adrian','rozbior',0.5) ON CONFLICT (id) DO NOTHING"
    )
    # production_sessions nie jest w liście TRUNCATE conftestu — sesja przeżywa
    # test, więc status ustawiamy także przy ponownym seedzie.
    execute(
        "INSERT INTO production_sessions (id, session_date, process_type, status, created_at)"
        " VALUES ('s1', CURRENT_DATE, 'deboning', %s, now())"
        " ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status",
        (status,),
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
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, session_id, worker_id,"
        " worker_name, kg_quarter, kg_meat, yield_pct, created_at, completed_at)"
        " VALUES ('e1','rb1','900','s1','w-adrian','Adrian',%s,%s,66.0, now(), now())",
        (kg_quarter, kg_meat),
    )
    execute(
        "INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type,"
        " source_type, source_id, created_at) VALUES"
        " (%s,'raw','rb1',%s,'OUT','deboning','e1',now()),"
        " (%s,'meat','ms1',%s,'IN','deboning','e1',now())",
        (cuid(), -kg_quarter, cuid(), kg_meat),
    )


def _postarz_wpis(godzin=6):
    execute(
        "UPDATE deboning_entries SET created_at = now() - (%s || ' hours')::interval "
        "WHERE id='e1'", (godzin,))


def test_hala_usuwa_wpis_starszy_niz_okno_i_oddaje_kilogramy(db):
    _seed()
    _postarz_wpis()
    przed = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")

    delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")

    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries WHERE id='e1'")["n"] == 0
    po = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(po["kg_available"]) - float(przed["kg_available"]) == 200.0
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements WHERE source_id='e1'")["n"] == 0


def test_hala_nie_musi_podawac_powodu(db):
    """Na ekranie dotykowym wpisywanie powodu to bariera — ślad i tak zostaje."""
    _seed()
    _postarz_wpis()
    delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries WHERE id='e1'")["n"] == 0


def test_hala_zostawia_slad_kto_usunal(db):
    _seed()
    _postarz_wpis()
    delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")

    slad = query_one(
        "SELECT by_subject, changes FROM deboning_entry_corrections WHERE entry_id='e1'")
    assert slad is not None
    assert slad["by_subject"] == "ANATOLII"
    assert float(slad["changes"]["usuniety"]["kgMeat"]) == 132.0
    assert slad["changes"]["usuniety"]["worker"] == "Adrian"


@pytest.mark.parametrize("status", ["closed", "approved"])
def test_hala_nie_rusza_zmiany_zamknietej_ani_zatwierdzonej(db, status):
    """To jest granica między halą a biurem: dzień domknięty prostuje biuro."""
    _seed(status=status)
    _postarz_wpis()
    with pytest.raises(HTTPException):
        delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries WHERE id='e1'")["n"] == 1


def test_hala_nie_omija_blokady_zuzytego_miesa(db):
    """Wiek to procedura, zużyte mięso to fizyka — tego nie przepuszczamy."""
    _seed()
    _postarz_wpis()
    execute("UPDATE meat_stock SET kg_available = 10 WHERE id='ms1'")
    with pytest.raises(HTTPException) as err:
        delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")
    assert "zużyte" in err.value.detail
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries WHERE id='e1'")["n"] == 1


def test_hala_nie_omija_blokady_rozliczonych_ubocznych(db):
    _seed()
    _postarz_wpis()
    execute("UPDATE deboning_entries SET kg_backs = 40 WHERE id='e1'")
    with pytest.raises(HTTPException):
        delete_deboning_entry("e1", hall_correction=True, by_subject="ANATOLII")
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries WHERE id='e1'")["n"] == 1
