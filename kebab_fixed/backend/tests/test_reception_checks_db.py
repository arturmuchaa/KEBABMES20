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


def test_checks_for_range_zwraca_wpis_dostawy(db):
    """Karta 1.1.1 pobiera wpisy CAŁEGO miesiąca jednym żądaniem —
    `pending` nie wystarcza, bo zwraca wyłącznie braki."""
    from app.services.reception_checks_service import checks_for_range
    rid = _seed_przyjecie("rec-range")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    wpisy = checks_for_range("2026-08-01", "2026-08-31")
    assert [w["receptionId"] for w in wpisy] == [rid]
    assert wpisy[0]["tempChamber"] == 2.5
    # Podpisów jeszcze nie ma — pusty słownik, nie wywrócenie się na
    # nieistniejącej tabeli (kolumny f-k muszą działać przed l-m).
    assert wpisy[0]["signatures"] == {}


def test_checks_for_range_pomija_dostawy_spoza_zakresu(db):
    from app.services.reception_checks_service import checks_for_range
    rid = _seed_przyjecie("rec-poza")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    assert checks_for_range("2026-09-01", "2026-09-30") == []


def test_ocena_spoza_slownika_odrzucona(db):
    """Kolumny f/i/k karty 1.1.1 mają zamknięty zestaw wartości: b/z albo N,
    K albo N. Dowolny napis przeszedłby na wydruk i karta pokazałaby coś,
    czego legenda nie tłumaczy."""
    import pytest
    from pydantic import ValidationError
    for pole, zla in (("visual", "tak"), ("kgMatch", "ok"), ("verdict", "przyjete")):
        with pytest.raises(ValidationError):
            ReceptionCheckIn.model_validate({pole: zla})


def test_poprawne_oceny_przechodza(db):
    for pole, dobra in (("visual", "bz"), ("visual", "N"),
                        ("kgMatch", "bz"), ("kgMatch", "N"),
                        ("verdict", "K"), ("verdict", "N")):
        ReceptionCheckIn.model_validate({pole: dobra})


def test_puste_pole_oceny_nadal_dozwolone(db):
    """Wpis powstaje etapami — brak oceny to normalny stan, nie błąd."""
    m = ReceptionCheckIn.model_validate({"tempChamber": 2.5})
    assert m.visual is None and m.verdict is None


# ── Próg obowiązywania kontroli ─────────────────────────────────────
#
# Właściciel (2026-09-02): „kontrolę HACCP chciałbym od kolejnego przyjęcia,
# wstecz już nie będę uzupełniał, bo mam wersję papierową". Dostawy sprzed
# wdrożenia mają udokumentowaną kontrolę NA PAPIERZE — system nie ma prawa
# się o nie upominać, bo kafel od pierwszego dnia świeciłby 86 dostawami,
# których nikt nie ruszy, i przestałby cokolwiek znaczyć.
def _przyjecie(rid, kiedy, seq=1):
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,%s,%s,'2026-09','2026-09-01','sup-1','KOKO',%s) "
        "ON CONFLICT (id) DO NOTHING",
        (rid, f"{seq}/09", seq, kiedy),
    )
    return rid


def _prog(kiedy):
    from app.services.reception_checks_service import HACCP_FROM_KEY
    execute(
        "INSERT INTO app_settings (key, value) VALUES (%s, to_jsonb(%s::text)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (HACCP_FROM_KEY, kiedy),
    )


def test_dostawa_sprzed_progu_nie_upomina_sie(db):
    _prog("2026-09-02T12:00:00+00:00")
    _przyjecie("rec-stara", "2026-09-01 08:00:00+00", 1)
    assert all(r["receptionId"] != "rec-stara" for r in pending(365))


def test_dostawa_po_progu_upomina_sie(db):
    _prog("2026-09-02T12:00:00+00:00")
    _przyjecie("rec-nowa", "2026-09-02 14:00:00+00", 2)
    assert any(r["receptionId"] == "rec-nowa" for r in pending(365))


def test_bez_ustawionego_progu_obowiazuja_wszystkie(db):
    """Świeża instalacja u nowego klienta nie ma czego wyłączać."""
    execute("DELETE FROM app_settings WHERE key = 'haccp_checks_from'")
    _przyjecie("rec-bezprogu", "2026-09-01 08:00:00+00", 3)
    assert any(r["receptionId"] == "rec-bezprogu" for r in pending(365))


def test_prog_nie_blokuje_recznego_wypelnienia_starej_dostawy(db):
    """Biuro MOŻE uzupełnić starą dostawę, jeśli zechce — próg wycisza
    upominanie, a nie odbiera możliwości."""
    _prog("2026-09-02T12:00:00+00:00")
    rid = _przyjecie("rec-recznie", "2026-09-01 08:00:00+00", 4)
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    assert get_check(rid)["status"] == "komplet"


def test_prog_ustawia_sie_raz_i_nie_przesuwa_sie(db):
    """Migracje chodzą przy KAŻDYM starcie. Gdyby próg przesuwał się w przód,
    każdy restart wyciszałby dostawy, o które system ma się upominać."""
    from app.migrations import _ustaw_prog_kontroli_haccp
    from app.services.reception_checks_service import haccp_required_from
    execute("DELETE FROM app_settings WHERE key = 'haccp_checks_from'")
    _ustaw_prog_kontroli_haccp()
    pierwszy = haccp_required_from()
    assert pierwszy
    _ustaw_prog_kontroli_haccp()
    _ustaw_prog_kontroli_haccp()
    assert haccp_required_from() == pierwszy


def test_get_check_mowi_czy_kontrola_jest_wymagana(db):
    """Ekran musi wiedzieć, czy poganiać — inaczej stara dostawa świeci
    „Uzupełnij kontrolę HACCP" mimo papierowej wersji w segregatorze."""
    _prog("2026-09-02T12:00:00+00:00")
    stara = _przyjecie("rec-req-stara", "2026-09-01 08:00:00+00", 7)
    nowa = _przyjecie("rec-req-nowa", "2026-09-02 14:00:00+00", 8)
    assert get_check(stara)["required"] is False
    assert get_check(nowa)["required"] is True
