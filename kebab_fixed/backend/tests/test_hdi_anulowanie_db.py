"""Anulowanie HDI i cofnięcie realizacji zamówienia.

25.09.2026, SAS ISSA: po omyłkowym WZ zamówienie zostało w „Zrealizowanych",
a HDI dla zamówienia zamkniętego wychodzi ZAMROŻONE — biuro nie miało jak
tego odkręcić bez ręcznej zmiany w bazie. HDI nie dało się też anulować
w ogóle.

Zasady:
* anulowane HDI zostaje w rejestrze, a numer jest SPALONY — papier mógł już
  pojechać z towarem ([[kebab-hdi-numeracja]]);
* kolejne „HDI" z zamówienia wystawia NOWY dokument z nowym numerem, a CMR
  nie cytuje numeru anulowanego;
* realizację cofamy tylko, gdy nie trzyma jej żaden aktywny dokument
  wydania — zamówienie naprawdę wydane, otwarte na nowo, zaczęłoby znów
  brać towar z puli.

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.cmr_service import generate_cmr
from app.services.hdi_service import anuluj_hdi, generate_hdi
from app.services.orders_service import cofnij_realizacje
from tests.conftest_split import _przygotuj_bez_podzialu

FORM_CMR = {"carrier_id": "", "plate": "KR 12345", "load_date": "2026-09-10"}


def _status_hdi(hid):
    return query_one("SELECT status, number FROM hdi_documents WHERE id=%s", (hid,))


# ── Anulowanie HDI ─────────────────────────────────────────────────────────

def test_anulowane_hdi_zostaje_w_rejestrze_z_numerem(db):
    _przygotuj_bez_podzialu()
    hdi = generate_hdi("o1")

    anuluj_hdi(hdi["id"])

    po = _status_hdi(hdi["id"])
    assert po["status"] == "anulowany"
    assert po["number"] == hdi["number"], "numer zostaje — papier mógł pojechać"


def test_drugie_anulowanie_odmawia(db):
    _przygotuj_bez_podzialu()
    hdi = generate_hdi("o1")
    anuluj_hdi(hdi["id"])

    with pytest.raises(HTTPException) as e:
        anuluj_hdi(hdi["id"])
    assert e.value.status_code == 409


def test_nieistniejace_hdi_404(db):
    with pytest.raises(HTTPException) as e:
        anuluj_hdi("nie-ma")
    assert e.value.status_code == 404


def test_po_anulowaniu_HDI_wystawia_sie_NOWE_z_nowym_numerem(db):
    _przygotuj_bez_podzialu()
    stare = generate_hdi("o1")
    anuluj_hdi(stare["id"])

    nowe = generate_hdi("o1")

    assert nowe["id"] != stare["id"]
    assert nowe["number"] != stare["number"], "numer anulowanego jest spalony"
    assert nowe["status"] == "wstepny"


def test_CMR_nie_cytuje_anulowanego_HDI(db):
    _przygotuj_bez_podzialu()
    hdi = generate_hdi("o1")
    anuluj_hdi(hdi["id"])

    cmr = generate_cmr("o1", FORM_CMR)

    assert cmr["payload"]["attachments"]["hdi_number"] == ""


# ── Cofnięcie realizacji zamówienia ────────────────────────────────────────

def _status_zam():
    return query_one("SELECT status FROM client_orders WHERE id='o1'")["status"]


def test_cofniecie_realizacji_przywraca_potwierdzone(db):
    _przygotuj_bez_podzialu()
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")

    cofnij_realizacje("o1")

    assert _status_zam() == "confirmed"


def test_po_cofnieciu_HDI_liczy_sie_od_nowa(db):
    """Sedno ISSY: zamknięte zamówienie oddaje HDI zamrożone."""
    _przygotuj_bez_podzialu()
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")

    cofnij_realizacje("o1")
    hdi = generate_hdi("o1")

    assert not hdi.get("frozen")


def test_aktywny_dokument_wydania_blokuje_cofniecie(db):
    _przygotuj_bez_podzialu()
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")
    execute("INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
            " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, "
            " issued_date, created_at) VALUES ('w1','WZ/7/09/26',7,'2609','order','o1',"
            " 'K',false,'[]'::jsonb,'wstepny','PLN',0,0,'2026-09-25',now())")

    with pytest.raises(HTTPException) as e:
        cofnij_realizacje("o1")

    assert e.value.status_code == 409
    assert "WZ/7/09/26" in e.value.detail, "biuro musi wiedzieć, co anulować"
    assert _status_zam() == "done"


def test_anulowany_dokument_NIE_blokuje(db):
    _przygotuj_bez_podzialu()
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")
    execute("INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
            " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, "
            " issued_date, created_at) VALUES ('w1','ANUL WZ/7/09/26',9001,'2609','order','o1',"
            " 'K',false,'[]'::jsonb,'anulowany','PLN',0,0,'2026-09-25',now())")

    cofnij_realizacje("o1")

    assert _status_zam() == "confirmed"


def test_cofnac_mozna_tylko_zrealizowane(db):
    _przygotuj_bez_podzialu()   # status 'confirmed'

    with pytest.raises(HTTPException) as e:
        cofnij_realizacje("o1")
    assert e.value.status_code == 409
    assert _status_zam() == "confirmed"
