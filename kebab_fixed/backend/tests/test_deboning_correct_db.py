"""Korekta wpisu rozbioru z biura: pracownik + kg, działa na ZATWIERDZONEJ
zmianie, wymaga powodu, zapisuje historię. Testy DB — bez TEST_DATABASE_URL skip."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import (
    correct_deboning_entry,
    deboning_stats,
    list_entry_corrections,
)
from app.utils.ids import now_iso


def _seed(kg_quarter=200.0, kg_meat=132.0, session_status="approved"):
    """Partia + lot mięsa + wpis Adriana w ZATWIERDZONEJ zmianie (jak na prod)."""
    # workers i production_sessions NIE są czyszczone przez fixture `db`
    # (TRUNCATE łapie tylko raw_batches/meat_stock + CASCADE na wpisy), więc
    # seed musi być idempotentny — inaczej drugi test w pliku bije w PK.
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-adrian','Adrian','rozbior',0.5), ('w-raschad','Raschad','rozbior',0.5) "
        "ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES ('rb1','900',900,'Dostawca',1000,800,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_initial, kg_available, created_at)"
        " VALUES ('ms1','900',%s,%s, now())",
        (kg_meat, kg_meat),
    )
    # session_date i process_type są NOT NULL — bez nich INSERT padnie.
    execute(
        "INSERT INTO production_sessions (id, session_date, process_type, status, started_at)"
        " VALUES ('s1', CURRENT_DATE, 'deboning', %s, now())"
        " ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status",
        (session_status,),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, session_id, created_at, completed_at)"
        " VALUES ('e1','rb1','900','w-adrian','Adrian',%s,%s,66.0,'s1', now(), now())",
        (kg_quarter, kg_meat),
    )


def test_korekta_dziala_na_zatwierdzonej_zmianie(db):
    """Sedno sprawy: wpisy starsze niż dziś są ZAWSZE w sesji 'approved',
    a każda dotychczasowa ścieżka odmawiała („Sesja zatwierdzona")."""
    _seed(session_status="approved")
    out = correct_deboning_entry("e1", "w-raschad", None, None, "pomyłka operatora")
    assert out["workerName"] == "Raschad"
    row = query_one("SELECT worker_id, worker_name FROM deboning_entries WHERE id='e1'")
    assert row["worker_id"] == "w-raschad" and row["worker_name"] == "Raschad"


def test_zmiana_pracownika_przenosi_akord(db):
    """Robocizna liczy się z rate_per_kg × kg ćwiartki per wpis i grupuje po
    worker_id — zmiana pracownika ma sama naprawić rozliczenie."""
    _seed()
    today = date.today().isoformat()
    before = {w["workerName"]: w for w in deboning_stats(today, today)["workers"]}
    assert "Adrian" in before
    correct_deboning_entry("e1", "w-raschad", None, None, "pomyłka operatora")
    after = {w["workerName"]: w for w in deboning_stats(today, today)["workers"]}
    assert "Raschad" in after and "Adrian" not in after
    assert after["Raschad"]["kgQuarter"] == 200.0


def test_korekta_cwiartki_zwraca_roznice_do_partii(db):
    _seed(kg_quarter=200.0)
    correct_deboning_entry("e1", None, 180.0, None, "za dużo wpisane")
    # 20 kg wraca na partię: 800 → 820
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")["kg_available"]) == 820.0
    assert float(query_one("SELECT kg_quarter FROM deboning_entries WHERE id='e1'")["kg_quarter"]) == 180.0


def test_korekta_miesa_koryguje_lot(db):
    _seed(kg_meat=132.0)
    correct_deboning_entry("e1", None, None, 140.0, "źle zważone")
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE id='ms1'")
    assert float(lot["kg_available"]) == 140.0
    assert float(query_one("SELECT yield_pct FROM deboning_entries WHERE id='e1'")["yield_pct"]) == 70.0


def test_powod_jest_wymagany(db):
    _seed()
    for bad in ("", "   ", "ok"):
        with pytest.raises(HTTPException) as e:
            correct_deboning_entry("e1", "w-raschad", None, None, bad)
        assert e.value.status_code == 400


def test_brak_zmian_odrzucony(db):
    _seed()
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, None, "bez zmian")
    assert e.value.status_code == 400


def test_mieso_nie_moze_przekroczyc_cwiartki(db):
    _seed(kg_quarter=200.0)
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, 250.0, "literówka")
    assert e.value.status_code == 400


def test_mieso_juz_zuzyte_daje_czytelny_blad(db):
    """Mięso poszło w masowanie — zdjęcie go z lotu musi dać 400, a nie ujemny stan."""
    _seed(kg_meat=132.0)
    execute("UPDATE meat_stock SET kg_available=0 WHERE id='ms1'")
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, 100.0, "korekta")
    assert e.value.status_code == 400


def test_historia_zapisuje_powod_i_diff(db):
    _seed(kg_quarter=200.0)
    correct_deboning_entry("e1", "w-raschad", 180.0, None, "pomyłka operatora", by_subject="am")
    h = list_entry_corrections("e1")
    assert len(h) == 1
    assert h[0]["reason"] == "pomyłka operatora"
    assert h[0]["bySubject"] == "am"
    assert h[0]["changes"]["worker"] == {"from": "Adrian", "to": "Raschad"}
    assert h[0]["changes"]["kgQuarter"] == {"from": 200.0, "to": 180.0}
