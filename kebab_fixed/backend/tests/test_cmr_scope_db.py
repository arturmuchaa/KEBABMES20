"""CMR w dwóch wariantach: na drogę (całość) i pod fakturę."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all
from app.services.cmr_service import generate_cmr
from tests.conftest_split import _przygotuj_bez_podzialu, _przygotuj_z_podzialem

FORM = {"carrier_id": "", "plate": "KR 12345", "load_date": "2026-09-10"}


def test_cmr_calosc_ma_wszystkie_kilogramy(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości
    cmr = generate_cmr("o1", FORM, scope="calosc")
    assert cmr["payload"]["gross_kg"] == 800.0


def test_cmr_do_faktury_ma_tylko_czesc_fakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    cmr = generate_cmr("o1", FORM, scope="fv")
    assert cmr["payload"]["gross_kg"] == 300.0


def test_oba_cmr_istnieja_obok_siebie(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    generate_cmr("o1", FORM, scope="calosc")
    generate_cmr("o1", FORM, scope="fv")
    zakresy = sorted(r["scope"] for r in query_all(
        "SELECT scope FROM cmr_documents WHERE order_id='o1'"))
    assert zakresy == ["calosc", "fv"]


def test_bez_podzialu_cmr_dziala_jak_dotad(db):
    _przygotuj_bez_podzialu()
    cmr = generate_cmr("o1", FORM)
    assert cmr["payload"]["gross_kg"] == 800.0


def test_idempotencja_jest_per_zakres(db):
    """Powtórne wystawienie TEGO SAMEGO wariantu nie tworzy drugiego dokumentu
    — ale wariant obok niego dostaje własny numer. Zapytanie szukające CMR-a
    po samym `order_id` oddawałoby biuru dokument z drugiego wariantu."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    calosc = generate_cmr("o1", FORM, scope="calosc")
    fv = generate_cmr("o1", FORM, scope="fv")
    assert calosc["number"] != fv["number"]

    znowu_calosc = generate_cmr("o1", FORM, scope="calosc")
    znowu_fv = generate_cmr("o1", FORM, scope="fv")
    assert znowu_calosc["id"] == calosc["id"]
    assert znowu_fv["id"] == fv["id"]
    assert znowu_calosc["payload"]["gross_kg"] == 800.0
    assert znowu_fv["payload"]["gross_kg"] == 300.0
    assert len(query_all("SELECT id FROM cmr_documents WHERE order_id='o1'")) == 2


def test_cmr_do_faktury_bez_podzialu_odmawia(db):
    """Bez zapisanego podziału nie wiadomo, co jest fakturowane — odmowa
    zamiast cichego dokumentu na 0 kg (jak `wystaw_wz_klienta`)."""
    _przygotuj_bez_podzialu()
    with pytest.raises(HTTPException) as exc:
        generate_cmr("o1", FORM, scope="fv")
    assert exc.value.status_code == 400
    assert "podziału" in exc.value.detail


# ── Numeracja CMR: numer ma być UNIKALNY, nie „zwykle unikalny" ────────────
#
# `generate_cmr` bierze numer z `MAX(seq)+1` BEZ blokady. Powtórny odczyt
# wewnątrz transakcji zamyka okno dwukliku (ten sam `order_id` + `scope`),
# ale dwie NAPRAWDĘ równoległe transakcje w READ COMMITTED (dwa różne
# zamówienia, dwie osoby w biurze) policzą to samo `MAX+1` i obie wstawią
# swój wiersz. HDI tego problemu nie ma — `_next_hdi_seq` bierze `FOR UPDATE`
# na wierszu licznika.
#
# Indeks unikalny nie naprawia numeracji, tylko zamienia CICHY duplikat
# numeru na głośny błąd. Dwa listy przewozowe o tym samym numerze to
# dokumenty handlowe nie do rozróżnienia — cicho jest tu najgorzej
# (review końcowy, I5). Przebudowa numeracji na licznik z `FOR UPDATE`
# świadomie NIE wchodzi w tę falę.
def _wstaw_cmr(cid, seq, ym="2609"):
    execute(
        "INSERT INTO cmr_documents (id, number, seq, year_month, order_id, client_name, "
        " status, payload, issue_date, created_at, scope) "
        "VALUES (%s,%s,%s,%s,'o1','YBM Gastro GmbH','wystawiony','{}'::jsonb,"
        " '10.09.2026', now(), 'calosc')",
        (cid, f"{seq}/09/26", seq, ym))


def test_dwa_CMR_o_tym_samym_numerze_sa_odrzucane_przez_baze(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    _wstaw_cmr("cmr-a", seq=1)

    with pytest.raises(Exception) as e:
        _wstaw_cmr("cmr-b", seq=1)

    assert "ux_cmr_ym_seq" in str(e.value) or "unique" in str(e.value).lower(), e.value
    assert len(query_all("SELECT id FROM cmr_documents")) == 1


def test_ten_sam_numer_w_INNYM_miesiacu_jest_poprawny(db):
    """Numeracja startuje od 1 w każdym miesiącu — indeks nie może tego
    zablokować."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    _wstaw_cmr("cmr-a", seq=1, ym="2609")
    _wstaw_cmr("cmr-b", seq=1, ym="2610")
    assert len(query_all("SELECT id FROM cmr_documents")) == 2
