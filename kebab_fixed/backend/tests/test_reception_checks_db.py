"""Wpis kontroli HACCP przy przyjęciu (karta 1.1.1, kolumny f-k).

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services.reception_checks_service import get_check, save_check
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
