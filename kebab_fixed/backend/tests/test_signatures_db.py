"""Podpisy elektroniczne: wzór, akt podpisania PIN-em, unieważnianie.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services.reception_checks_service import save_check
from app.services.signatures_service import (eligible, get_sample, save_sample,
                                             sign, signatures_for)
from app.utils.ids import now_iso
from app.utils.passwords import hash_secret

PNG = "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" * 2


def _pracownik(wid, imie, pin="1234", wykonal=True, sprawdzil=False):
    execute(
        "INSERT INTO workers (id, name, role, pin_hash, active, created_at, "
        "can_sign_performed, can_sign_checked) "
        "VALUES (%s,%s,'WORKER_PRODUCTION',%s,true,%s,%s,%s) "
        "ON CONFLICT (id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, "
        "can_sign_performed=EXCLUDED.can_sign_performed, "
        "can_sign_checked=EXCLUDED.can_sign_checked",
        (wid, imie, hash_secret(pin), now_iso(), wykonal, sprawdzil),
    )
    return wid


def _dostawa(rid="rec-sig"):
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'7/08',7,'2026-08','2026-08-14','sup-1','KOKO',%s) "
        "ON CONFLICT (id) DO NOTHING",
        (rid, now_iso()),
    )
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    return rid


# ── Wzór podpisu ────────────────────────────────────────────────────
def test_wzor_wymaga_poprawnego_pinu(db):
    """Kod serwisowy 0099 otwiera menu, ale NIE upoważnia kierownika do
    narysowania cudzego podpisu — stąd PIN przy samym wzorze."""
    w = _pracownik("w-1", "Jan K.")
    with pytest.raises(HTTPException) as e:
        save_sample(w, PNG, "9999")
    assert e.value.status_code in (401, 403)
    assert get_sample(w) is None


def test_wzor_zapisuje_sie_po_poprawnym_pinie(db):
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    assert get_sample(w)["png"] == PNG


def test_ponowny_zapis_nadpisuje_wzor(db):
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    save_sample(w, PNG + "AA", "1234")
    assert query_one(
        "SELECT count(*) AS n FROM signature_samples WHERE worker_id=%s", (w,))["n"] == 1


def test_za_duzy_wzor_odrzucony(db):
    """Wzór 600x200 waży kilkanaście kB. Większy plik to nie podpis,
    tylko czyjaś fotografia wysłana pomyłkowo albo złośliwie."""
    w = _pracownik("w-1", "Jan K.")
    with pytest.raises(HTTPException) as e:
        save_sample(w, "data:image/png;base64," + "A" * 300_000, "1234")
    assert e.value.status_code == 413


# ── Lista uprawnionych ──────────────────────────────────────────────
def test_eligible_pomija_osoby_bez_wzoru(db):
    _pracownik("w-1", "Jan K.")
    z_wzorem = _pracownik("w-2", "Ewa M.")
    save_sample(z_wzorem, PNG, "1234")
    assert [p["id"] for p in eligible("wykonal")] == ["w-2"]


def test_eligible_respektuje_uprawnienie_roli(db):
    w = _pracownik("w-1", "Jan K.", wykonal=True, sprawdzil=False)
    save_sample(w, PNG, "1234")
    assert eligible("sprawdzil") == []


def test_eligible_nieznana_rola_to_blad(db):
    with pytest.raises(HTTPException) as e:
        eligible("prezes")
    assert e.value.status_code == 422


# ── Akt podpisania ──────────────────────────────────────────────────
def test_podpis_bez_uprawnienia_odrzucony_mimo_dobrego_pinu(db):
    """Filtr listy w interfejsie NIE jest kontrolą dostępu."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.", wykonal=True, sprawdzil=False)
    save_sample(w, PNG, "1234")
    with pytest.raises(HTTPException) as e:
        sign("reception_check", rid, "sprawdzil", w, "1234")
    assert e.value.status_code == 403


def test_zly_pin_nie_tworzy_podpisu(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    with pytest.raises(HTTPException):
        sign("reception_check", rid, "wykonal", w, "0000")
    assert signatures_for("reception_check", rid) == []


def test_podpis_bez_wzoru_odrzucony(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    with pytest.raises(HTTPException) as e:
        sign("reception_check", rid, "wykonal", w, "1234")
    assert e.value.status_code == 400


def test_podpis_kopiuje_wzor_i_nazwisko(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    (p,) = signatures_for("reception_check", rid)
    assert p["signerName"] == "Jan K."
    assert p["png"] == PNG


def test_przerysowanie_wzoru_nie_zmienia_zlozonego_podpisu(db):
    """Dokument sprzed roku nie może się zmienić, gdy ktoś przerysuje wzór."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_sample(w, PNG + "ZMIENIONY", "1234")
    (p,) = signatures_for("reception_check", rid)
    assert p["png"] == PNG


def test_obie_role_moga_byc_tej_samej_osoby(db):
    """W sobotę bywa jeden człowiek — system ostrzega, nie blokuje."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.", wykonal=True, sprawdzil=True)
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    sign("reception_check", rid, "sprawdzil", w, "1234")
    assert len(signatures_for("reception_check", rid)) == 2


# ── Unieważnianie ───────────────────────────────────────────────────
def test_zmiana_temperatury_uniewaznia_podpis(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 9.9,
        "kgMatch": "bz", "verdict": "K",
    }))
    assert signatures_for("reception_check", rid) == []
    # Wiersz ZOSTAJE jako historia — ślad, że ktoś podpisał poprzednią wersję,
    # bywa przy sporze najważniejszy.
    assert query_one(
        "SELECT count(*) AS n FROM document_signatures WHERE doc_id=%s", (rid,))["n"] == 1


def test_zapis_bez_zmiany_tresci_nie_rusza_podpisu(db):
    """Ponowne zapisanie tych samych danych nie może zrzucić podpisu —
    biuro klika „Zapisz" także wtedy, gdy niczego nie zmieniło."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    assert len(signatures_for("reception_check", rid)) == 1


def test_po_uniewaznieniu_da_sie_podpisac_ponownie(db):
    """Indeks częściowy: unieważnione podpisy mogą się powtarzać, aktywny
    jest jeden na (dokument, rola)."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 9.9,
        "kgMatch": "bz", "verdict": "K",
    }))
    sign("reception_check", rid, "wykonal", w, "1234")
    assert len(signatures_for("reception_check", rid)) == 1
    assert query_one(
        "SELECT count(*) AS n FROM document_signatures WHERE doc_id=%s", (rid,))["n"] == 2


# ── Uprawnienia w kartotece ─────────────────────────────────────────
def test_uprawnienia_podpisu_przechodza_przez_kartoteke(db):
    """Zaznaczenie w panelu Pracownicy MUSI dojść do bazy — bez tego
    dialog podpisu pokazuje pustą listę i nikt nie wie dlaczego."""
    from app.models.workers import WorkerCreate, WorkerUpdate
    from app.services.workers_service import create_worker, update_worker

    w = create_worker(WorkerCreate.model_validate({
        "name": "Kierownik Test", "pin": "4321",
        "can_sign_performed": True, "can_sign_checked": True,
    }))
    assert w["can_sign_performed"] is True
    assert w["can_sign_checked"] is True

    # Odebranie uprawnienia też musi działać — inaczej nie da się cofnąć
    # nadania po zmianie stanowiska.
    po = update_worker(w["id"], WorkerUpdate.model_validate({"can_sign_checked": False}))
    assert po["can_sign_performed"] is True
    assert po["can_sign_checked"] is False


def test_pracownik_bez_uprawnien_domyslnie_nie_podpisuje(db):
    """Domyślnie NIKT nie ma prawa podpisu — nadaje się je świadomie."""
    from app.models.workers import WorkerCreate
    from app.services.workers_service import create_worker

    w = create_worker(WorkerCreate.model_validate({"name": "Nowy Test", "pin": "1111"}))
    assert w["can_sign_performed"] is False
    assert w["can_sign_checked"] is False


def test_podpis_niesie_workerid_dla_ostrzezenia(db):
    """Ekran ostrzega „ta sama osoba podpisze obie role" — porównuje po
    identyfikatorze, więc bez `workerId` ostrzeżenie nigdy by nie padło."""
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    (p,) = signatures_for("reception_check", rid)
    assert p["workerId"] == "w-1"


# ── Kod odpowiedzi przy złym PIN-ie ─────────────────────────────────
def test_zly_pin_NIE_zwraca_401(db):
    """BŁĄD Z PRODUKCJI (02.09.2026): „daję zapis i kiosk się restartuje".

    Klient API traktuje KAŻDE 401 jako wygaśnięcie sesji: czyści token
    i przeładowuje kiosk (`location.reload()` w lib/api.ts). Zły PIN to nie
    utrata sesji — sesja operatora jest w porządku, odrzucone jest jedno
    poświadczenie. 401 kasował operatorowi zalogowanie i wyrzucał go na
    ekran PIN, a wzór się nie zapisywał.
    """
    w = _pracownik("w-1", "Jan K.")
    with pytest.raises(HTTPException) as e:
        save_sample(w, PNG, "9999")
    assert e.value.status_code != 401, "401 przeładowuje kiosk — użyj 403"
    assert e.value.status_code == 403


def test_zly_pin_przy_podpisie_tez_nie_zwraca_401(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    with pytest.raises(HTTPException) as e:
        sign("reception_check", rid, "wykonal", w, "0000")
    assert e.value.status_code == 403


def test_blokada_konta_nadal_ma_swoj_kod(db):
    """423 zostaje — to inny stan niż zła próba i klient go nie myli z sesją."""
    from app.db import execute as ex
    w = _pracownik("w-1", "Jan K.")
    ex("UPDATE workers SET locked_until = now() + interval '10 minutes' WHERE id=%s", (w,))
    with pytest.raises(HTTPException) as e:
        save_sample(w, PNG, "1234")
    assert e.value.status_code == 423
