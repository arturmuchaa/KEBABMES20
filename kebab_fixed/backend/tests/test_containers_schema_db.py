"""Schemat salda pojemników — sprawdza, że migracje FAKTYCZNIE się wykonały.

run_migrations() połyka błędy pojedynczych instrukcji (loguje warning i idzie
dalej), więc „migrations.done" w logu NIE dowodzi, że tabele powstały.
Ten test weryfikuje DANE, nie flagę.
"""
import pytest

from app.db import execute, query_one
from app.utils.ids import cuid, now_iso


def test_tabele_pojemnikowe_istnieja_i_przyjmuja_dane(db):
    pid = cuid()
    execute(
        "INSERT INTO container_partners (id, nip, name, address, created_at) "
        "VALUES (%s,%s,%s,%s,%s)",
        (pid, "5130064478", "FHUP MAREK KSIĘŻYC", "Rudawa", now_iso()))
    execute(
        "INSERT INTO container_movements "
        "(id, partner_id, asset_type, qty, source_type, source_id, movement_date, created_at) "
        "VALUES (%s,%s,'e2',400,'raw_batch','rb1',%s,%s)",
        (cuid(), pid, "2026-07-29", now_iso()))
    row = query_one(
        "SELECT COALESCE(SUM(qty),0) AS saldo FROM container_movements WHERE partner_id=%s",
        (pid,))
    assert int(row["saldo"]) == 400


def test_nip_jest_unikalny_ale_pusty_nip_nie_blokuje(db):
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (cuid(), "5130064478", "A", now_iso()))
    with pytest.raises(Exception):
        execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
                (cuid(), "5130064478", "B", now_iso()))
    # dwaj partnerzy bez NIP-u współistnieją
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (cuid(), "Bez NIP 1", now_iso()))
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (cuid(), "Bez NIP 2", now_iso()))


def test_nieznany_rodzaj_nosnika_odrzucony(db):
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (pid, "X", now_iso()))
    with pytest.raises(Exception):
        execute(
            "INSERT INTO container_movements "
            "(id, partner_id, asset_type, qty, source_type, movement_date, created_at) "
            "VALUES (%s,%s,'skrzynka',1,'manual',%s,%s)",
            (cuid(), pid, "2026-07-29", now_iso()))


def test_kolumny_kalibru_na_przyjeciu_i_palet_na_wz(db):
    rb_id = cuid()
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, kg_received, kg_available, "
        "container_kg, containers_count, pallets_h1, pallets_other, created_at) "
        "VALUES (%s,'900',6000,6000,15,400,10,2,%s)", (rb_id, now_iso()))
    r = query_one("SELECT container_kg, containers_count, pallets_h1, pallets_other "
                  "FROM raw_batches WHERE id=%s", (rb_id,))
    assert float(r["container_kg"]) == 15.0
    assert r["containers_count"] == 400
    assert r["pallets_h1"] == 10
    assert r["pallets_other"] == 2

    # wz_documents NIE jest w _TRUNCATE (dokumenty przeżywają między testami),
    # więc identyfikator musi być losowy — stały sypałby się przy drugim
    # uruchomieniu pakietu.
    wz_id = cuid()
    execute(
        "INSERT INTO wz_documents (id, number, year_month, pallets_h1, pallets_other) "
        "VALUES (%s,'WZ/1/07/26','2607',3,1)", (wz_id,))
    w = query_one("SELECT pallets_h1, pallets_other FROM wz_documents WHERE id=%s", (wz_id,))
    assert w["pallets_h1"] == 3
    assert w["pallets_other"] == 1
