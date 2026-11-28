"""Kontrola VAT UE odbiorcy (27.11.2026).

Właściciel: przy każdej wysyłce sprawdzić w VIES, czy klient nadal ma aktywny
VAT UE; nieaktywny = tylko ostrzeżenie i faktura z VAT. Awaria VIES nie może
zmienić statusu ani zatrzymać papierów. Każde sprawdzenie zostaje w historii
(numer potwierdzenia = dowód przy WDT 0 %).
Testy DB — bez TEST_DATABASE_URL skip.
"""
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import vat_ue_service as svc


def _klient(cid, nip, country=""):
    execute("INSERT INTO clients (id, code, name, nip, country) VALUES (%s,%s,%s,%s,%s)",
            (cid, cid, f"Klient {cid}", nip, country or ("PL" if nip[:2].isdigit() or not nip else nip[:2])))


def _vies(monkeypatch, wynik=None, blad=None):
    wolania = []

    def _check(vat, **kw):
        wolania.append((vat, kw))
        if blad is not None:
            raise blad
        return {"vatNumber": vat, "valid": True, "traderName": "X", "traderAddress": "A",
                "requestIdentifier": "WAPI1", "requestDate": "", "userError": "VALID",
                **(wynik or {})}
    monkeypatch.setattr(svc, "vies_check", _check)
    return wolania


def test_aktywny_zapisuje_status_i_historie(db, monkeypatch):
    _klient("at1", "ATU12345675")
    _vies(monkeypatch)
    out = svc.sprawdz_klienta("at1", context="reczne", operator="biuro")
    assert out["status"] == "aktywny"
    assert out["request_id"] == "WAPI1"
    c = query_one("SELECT vat_ue_status, vat_ue_request_id, vat_ue_checked_at FROM clients WHERE id='at1'")
    assert c["vat_ue_status"] == "aktywny" and c["vat_ue_request_id"] == "WAPI1"
    assert c["vat_ue_checked_at"] is not None
    h = query_all("SELECT * FROM vat_ue_checks")
    assert len(h) == 1 and h[0]["context"] == "reczne" and h[0]["operator"] == "biuro"


def test_nieaktywny_zapisuje_status(db, monkeypatch):
    _klient("at1", "ATU12345675")
    _vies(monkeypatch, {"valid": False, "requestIdentifier": "WAPI2", "userError": "INVALID"})
    out = svc.sprawdz_klienta("at1", context="wz", order_id="o1")
    assert out["status"] == "nieaktywny"
    assert query_one("SELECT vat_ue_status FROM clients WHERE id='at1'")["vat_ue_status"] == "nieaktywny"
    assert query_one("SELECT order_id FROM vat_ue_checks")["order_id"] == "o1"


def test_blad_nie_nadpisuje_statusu(db, monkeypatch):
    _klient("at1", "ATU12345675")
    _vies(monkeypatch)
    svc.sprawdz_klienta("at1", context="reczne")
    _vies(monkeypatch, blad=HTTPException(503, "VIES chwilowo niedostępny (MS_UNAVAILABLE)"))
    out = svc.sprawdz_klienta("at1", context="reczne")
    assert out["status"] == "blad"
    assert "VIES" in out["komunikat"]
    assert out["ostatni_pewny"]["status"] == "aktywny"
    assert out["ostatni_pewny"]["request_id"] == "WAPI1"
    assert query_one("SELECT vat_ue_status FROM clients WHERE id='at1'")["vat_ue_status"] == "aktywny"
    assert query_one("SELECT count(*) AS n FROM vat_ue_checks")["n"] == 2


def test_klient_pl_nie_dotyczy(db, monkeypatch):
    _klient("pl1", "1112223334")
    wolania = _vies(monkeypatch)
    assert svc.sprawdz_klienta("pl1", context="reczne")["status"] == "nie_dotyczy"
    assert wolania == []
    assert query_one("SELECT count(*) AS n FROM vat_ue_checks")["n"] == 0


def test_klient_spoza_ue_nie_dotyczy(db, monkeypatch):
    _klient("ch1", "CHE123456789", "CH")
    _vies(monkeypatch)
    assert svc.sprawdz_klienta("ch1", context="reczne")["status"] == "nie_dotyczy"


def test_brak_numeru_vat_to_blad_nie_500(db, monkeypatch):
    _klient("de1", "", "DE")
    wolania = _vies(monkeypatch)
    out = svc.sprawdz_klienta("de1", context="kurs")
    assert out["status"] == "blad"
    assert "brak numeru VAT UE" in out["komunikat"]
    assert wolania == []
    assert query_one("SELECT error FROM vat_ue_checks")["error"] != ""


def test_nieznany_klient_404(db, monkeypatch):
    _vies(monkeypatch)
    try:
        svc.sprawdz_klienta("nie-ma", context="reczne")
    except HTTPException as e:
        assert e.status_code == 404
    else:
        raise AssertionError("oczekiwano 404")


def _kurs(lid, zamowienia):
    execute("INSERT INTO loadings (id, plate) VALUES (%s,'KR1')", (lid,))
    for oid, cid in zamowienia:
        execute("INSERT INTO client_orders (id, order_no, client_id, client_name) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (id) DO NOTHING", (oid, oid, cid, cid))
        execute("INSERT INTO loading_orders (loading_id, order_id) VALUES (%s,%s)", (lid, oid))


def test_sprawdz_kurs_tylko_zagraniczni_raz_na_klienta(db, monkeypatch):
    _klient("at1", "ATU12345675")
    _klient("pl1", "1112223334")
    _kurs("k1", [("o1", "at1"), ("o2", "at1"), ("o3", "pl1")])
    wolania = _vies(monkeypatch)
    out = svc.sprawdz_kurs("k1", operator="biuro")
    assert [w["client_id"] for w in out] == ["at1"]
    assert len(wolania) == 1
    h = query_all("SELECT loading_id, context FROM vat_ue_checks")
    assert h == [{"loading_id": "k1", "context": "kurs"}]


def test_historia_najnowsze_pierwsze(db, monkeypatch):
    _klient("at1", "ATU12345675")
    _vies(monkeypatch, {"requestIdentifier": "A"})
    svc.sprawdz_klienta("at1", context="reczne")
    execute("UPDATE vat_ue_checks SET checked_at = now() - interval '1 day'")
    _vies(monkeypatch, {"requestIdentifier": "B"})
    svc.sprawdz_klienta("at1", context="reczne")
    assert [h["request_id"] for h in svc.historia("at1")] == ["B", "A"]


# ── Task 6: wystawienie z kursu dopełnia kontrolę (bez blokady) ──────

def _kurs_zagraniczny():
    from tests.test_finalize_loading_db import _FORMA_CMR, _kurs_do_wystawienia
    kurs = _kurs_do_wystawienia()
    execute("UPDATE clients SET nip='ATU12345675', country='AT' WHERE id='c1'")
    return kurs, _FORMA_CMR


def test_wystaw_z_kursu_dopelnia_sprawdzenie(db, monkeypatch):
    from app.services.loading_service import wystaw_z_kursu
    kurs, forma = _kurs_zagraniczny()
    wolania = _vies(monkeypatch)
    wystaw_z_kursu(kurs, [{"order_id": "o1", "cel_kg": 300.0}], forma)
    assert len(wolania) == 1
    assert wolania[0][1] == {"timeout": 8, "attempts": 1}
    h = query_all("SELECT context, loading_id FROM vat_ue_checks")
    assert h == [{"context": "kurs", "loading_id": kurs}]


def test_wystaw_z_kursu_nie_dubluje(db, monkeypatch):
    from app.services.loading_service import wystaw_z_kursu
    kurs, forma = _kurs_zagraniczny()
    _vies(monkeypatch)
    svc.sprawdz_kurs(kurs)
    wolania = _vies(monkeypatch)
    wystaw_z_kursu(kurs, [{"order_id": "o1", "cel_kg": 300.0}], forma)
    assert wolania == []
    assert query_one("SELECT count(*) AS n FROM vat_ue_checks")["n"] == 1


def test_wystaw_z_kursu_dziala_gdy_vies_pada(db, monkeypatch):
    from app.services.loading_service import wystaw_z_kursu
    kurs, forma = _kurs_zagraniczny()
    _vies(monkeypatch, blad=RuntimeError("siec padla"))
    wynik = wystaw_z_kursu(kurs, [{"order_id": "o1", "cel_kg": 300.0}], forma)
    assert wynik["orders"][0]["wm"]["number"].startswith("WM/")


def test_wystaw_z_kursu_przezywa_wyjatek_uslugi(db, monkeypatch):
    """Nawet błąd samej usługi VAT UE (np. baza) nie może zatrzymać papierów."""
    from app.services import loading_service
    kurs, forma = _kurs_zagraniczny()

    def _wybuch(*a, **k):
        raise RuntimeError("cokolwiek")
    monkeypatch.setattr(svc, "sprawdz_klienta", _wybuch)
    wynik = loading_service.wystaw_z_kursu(kurs, [{"order_id": "o1", "cel_kg": 300.0}], forma)
    assert wynik["ok"] is True


def test_sprawdzenie_zostaje_gdy_wystawienie_odmowi(db, monkeypatch):
    """Przegląd 27.11: sprawdzenie VIES szło w transakcji dokumentów — odmowa
    wystawienia cofała dowód sprawdzenia i status klienta."""
    from fastapi import HTTPException as HE
    from app.services.loading_service import wystaw_z_kursu
    kurs, forma = _kurs_zagraniczny()
    _vies(monkeypatch)
    try:
        wystaw_z_kursu(kurs, [{"order_id": "nie-z-tego-kursu", "cel_kg": 1.0}], forma)
    except HE as e:
        assert e.status_code == 400
    else:
        raise AssertionError("oczekiwano odmowy")
    assert query_one("SELECT count(*) AS n FROM vat_ue_checks")["n"] == 1
    assert query_one("SELECT vat_ue_status FROM clients WHERE id='c1'")["vat_ue_status"] == "aktywny"


def test_sprawdz_kurs_krotko(db, monkeypatch):
    """Przegląd 27.11: okno papierów czekało 15 s × 3 próby na klienta (504 z nginx)."""
    _klient("at1", "ATU12345675")
    _kurs("k1", [("o1", "at1")])
    wolania = _vies(monkeypatch)
    svc.sprawdz_kurs("k1")
    assert wolania[0][1] == {"timeout": 8, "attempts": 1}
