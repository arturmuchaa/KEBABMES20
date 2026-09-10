"""HDI: na całość zawsze, do faktury na życzenie, do części na WZ NIGDY.

Właściciel (2026-09-09): „tylko HDI i na całość i HDI drugie do faktury,
do WZ nie".
"""
import pytest
from fastapi import HTTPException

from app.db import query_all, query_one
from app.services.cmr_service import generate_cmr
from app.services.hdi_service import generate_hdi
from tests.conftest_split import _przygotuj_bez_podzialu, _przygotuj_z_podzialem

FORM_CMR = {"carrier_id": "", "plate": "KR 12345", "load_date": "2026-09-10"}


def test_hdi_na_calosc_obejmuje_cale_zamowienie(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi = generate_hdi("o1")
    assert float(hdi["totals"]["kg"]) == 800.0


def test_hdi_do_faktury_obejmuje_tylko_czesc_fakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi = generate_hdi("o1", scope="fv")
    assert float(hdi["totals"]["kg"]) == 300.0


def test_oba_hdi_maja_rozne_numery(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    a = generate_hdi("o1")
    b = generate_hdi("o1", scope="fv")
    assert a["number"] != b["number"]


def test_hdi_do_czesci_na_wz_jest_ODRZUCANY(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    with pytest.raises(Exception) as e:
        generate_hdi("o1", scope="wz")
    assert "wz" in str(e.value).lower()
    assert query_all("SELECT id FROM hdi_documents") == []


def test_bez_podzialu_hdi_dziala_jak_dotad(db):
    _przygotuj_bez_podzialu()
    assert float(generate_hdi("o1")["totals"]["kg"]) == 800.0


def test_idempotencja_jest_per_zakres(db):
    """Powtórne wystawienie TEGO SAMEGO wariantu nie nabija drugiego numeru
    — a wariant obok niego ma własny. Numer HDI jest SPALANY po wydaniu
    ([[kebab-hdi-numeracja]]), więc zapytanie po samym `order_id` nie tylko
    oddałoby biuru dokument na złą ilość, ale przy wystawianiu drugiego
    wariantu paliłoby kolejne numery."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    calosc = generate_hdi("o1")
    fv = generate_hdi("o1", scope="fv")
    assert calosc["number"] != fv["number"]

    znowu_calosc = generate_hdi("o1")
    znowu_fv = generate_hdi("o1", scope="fv")
    assert znowu_calosc["id"] == calosc["id"]
    assert znowu_fv["id"] == fv["id"]
    assert float(znowu_calosc["totals"]["kg"]) == 800.0
    assert float(znowu_fv["totals"]["kg"]) == 300.0
    assert len(query_all("SELECT id FROM hdi_documents WHERE order_id='o1'")) == 2


def test_numeracja_dwoch_wariantow_bez_dziury(db):
    """Dwa warianty biorą DWA KOLEJNE numery, a licznik `sequences`
    (`hdi_seq:RRMM`) stoi dokładnie na tym drugim — bez dziury i bez
    rozjazdu z tabelą dokumentów."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    calosc = generate_hdi("o1")
    fv = generate_hdi("o1", scope="fv")

    seqs = sorted(r["seq"] for r in query_all(
        "SELECT seq FROM hdi_documents WHERE order_id='o1'"))
    assert seqs == [1, 2]
    assert calosc["number"].startswith("1/")
    assert fv["number"].startswith("2/")
    licznik = query_one("SELECT value FROM sequences WHERE key LIKE 'hdi_seq:%%'")
    assert int(licznik["value"]) == 2


def test_hdi_do_faktury_bez_podzialu_odmawia(db):
    """Bez zapisanego podziału nie wiadomo, co jest fakturowane — odmowa
    zamiast cichego dokumentu na całość (wzorzec z `wystaw_wz_klienta`
    i `generate_cmr`)."""
    _przygotuj_bez_podzialu()
    with pytest.raises(HTTPException) as exc:
        generate_hdi("o1", scope="fv")
    assert exc.value.status_code == 400
    assert "podziału" in exc.value.detail


def test_hdi_do_faktury_ma_partie_z_dokumentu_na_calosc(db):
    """HDI to dokument IDENTYFIKACYJNY — wariant do faktury musi wskazywać
    te same partie co dokument na całość (jest jego podzbiorem), a nie
    wymyślać własne."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    calosc = generate_hdi("o1")
    fv = generate_hdi("o1", scope="fv")

    def partie(hdi_id):
        items = query_one("SELECT items FROM hdi_documents WHERE id=%s", (hdi_id,))["items"]
        return {b["partia"] for it in items for b in it["batches"]}

    assert partie(fv["id"])
    assert partie(fv["id"]) <= partie(calosc["id"])
    fv_items = query_one("SELECT items FROM hdi_documents WHERE id=%s", (fv["id"],))["items"]
    assert sum(it["qty"] for it in fv_items) == 12       # 11 szt. r1 + 1 szt. r2


# ── Punkt dodany do briefu (wyszedł z Taska 5): numer HDI cytowany na CMR ──

def test_cmr_cytuje_HDI_tego_samego_wariantu(db):
    """CMR „na drogę" jedzie z kierowcą i ma w załącznikach numer HDI NA
    CAŁOŚĆ; CMR pod fakturę — numer HDI do faktury. Zapytanie po samym
    `order_id` (ORDER BY created_at DESC) wpisywało na CMR na drogę numer
    HDI wystawionego PÓŹNIEJ, czyli tego do faktury — papier jadący z
    towarem powoływałby się na dokument na inną ilość."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi_calosc = generate_hdi("o1")
    hdi_fv = generate_hdi("o1", scope="fv")

    cmr_calosc = generate_cmr("o1", FORM_CMR, scope="calosc")
    cmr_fv = generate_cmr("o1", FORM_CMR, scope="fv")

    assert cmr_calosc["payload"]["attachments"]["hdi_number"] == hdi_calosc["number"]
    assert cmr_fv["payload"]["attachments"]["hdi_number"] == hdi_fv["number"]
    assert hdi_calosc["number"] != hdi_fv["number"]


def test_cmr_bez_HDI_swojego_wariantu_nie_podstawia_cudzego(db):
    """Gdy HDI danego wariantu jeszcze nie ma, załącznik zostaje PUSTY —
    tak samo jak dziś dla zamówienia bez żadnego HDI. Podstawienie numeru
    drugiego wariantu byłoby cichym błędem na papierze."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi_fv = generate_hdi("o1", scope="fv")      # HDI na całość jeszcze nie wystawione

    cmr_calosc = generate_cmr("o1", FORM_CMR, scope="calosc")
    assert cmr_calosc["payload"]["attachments"]["hdi_number"] == ""

    # ...a wariant, który swój dokument ma, cytuje go normalnie.
    cmr_fv = generate_cmr("o1", FORM_CMR, scope="fv")
    assert cmr_fv["payload"]["attachments"]["hdi_number"] == hdi_fv["number"]
