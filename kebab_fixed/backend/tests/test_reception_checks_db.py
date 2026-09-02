"""Wpis kontroli HACCP przy przyjęciu (karta 1.1.1, kolumny f-k).

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date, timedelta

from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services.reception_checks_service import get_check, pending, save_check
from app.utils.ids import now_iso


def _seed_przyjecie(rid="rec-haccp-1"):
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'7/08',7,'2026-08','2026-08-14','sup-1','KOKO',%s) "
        "ON CONFLICT (id) DO NOTHING",
        (rid, now_iso()),
    )
    return rid


def test_dostawa_bez_wpisu_daje_pusty_szkic_nie_blad(db):
    rid = _seed_przyjecie()
    check = get_check(rid)
    assert check["receptionId"] == rid
    assert check["visual"] is None
    assert check["tempChamber"] is None
    assert check["status"] == "brak"


def test_zapis_i_odczyt_wpisu(db):
    rid = _seed_przyjecie()
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "notes": "", "verdict": "K",
    }))
    check = get_check(rid)
    assert check["tempChamber"] == 2.5
    assert check["verdict"] == "K"
    assert check["status"] == "komplet"


def test_powtorny_zapis_aktualizuje_ten_sam_wiersz(db):
    rid = _seed_przyjecie()
    dto = {"visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
           "kgMatch": "bz", "verdict": "K"}
    save_check(rid, ReceptionCheckIn.model_validate(dto))
    save_check(rid, ReceptionCheckIn.model_validate({**dto, "tempMeat": 3.9}))
    assert query_one(
        "SELECT count(*) AS n FROM reception_checks WHERE reception_id=%s", (rid,)
    )["n"] == 1
    assert get_check(rid)["tempMeat"] == 3.9


def test_wpis_bez_kwalifikacji_jest_niepelny(db):
    rid = _seed_przyjecie()
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1, "kgMatch": "bz",
    }))
    assert get_check(rid)["status"] == "niepelne"


def test_temperatura_zero_liczy_sie_jako_pomiar(db):
    """0 °C to POMIAR, nie brak pomiaru. Gdyby ktoś „uprościł" warunek
    w check_status do `if check.get(k)`, zero cicho zniknęłoby z karty
    i dostawa z komorą na granicy wyglądałaby na nieskontrolowaną."""
    rid = _seed_przyjecie("rec-zero")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 0, "tempMeat": 0,
        "kgMatch": "bz", "verdict": "K",
    }))
    check = get_check(rid)
    assert check["tempChamber"] == 0
    assert check["status"] == "komplet"


def test_pending_pomija_dostawy_z_kompletem(db):
    wczoraj = (date.today() - timedelta(days=1)).isoformat()
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES ('rec-p1','1/08',1,'2026-08',%s,'sup-1','KOKO',%s),"
        "       ('rec-p2','2/08',2,'2026-08',%s,'sup-1','KOKO',%s)",
        (wczoraj, now_iso(), wczoraj, now_iso()),
    )
    save_check("rec-p1", ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.0, "tempMeat": 3.0,
        "kgMatch": "bz", "verdict": "K",
    }))
    braki = {r["receptionId"] for r in pending(14)}
    assert "rec-p1" not in braki
    assert "rec-p2" in braki


def test_pending_nie_siega_poza_okno_dni(db):
    dawno = (date.today() - timedelta(days=40)).isoformat()
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES ('rec-stare','9/07',9,'2026-07',%s,'sup-1','KOKO',%s)",
        (dawno, now_iso()),
    )
    assert all(r["receptionId"] != "rec-stare" for r in pending(14))
