"""Saldo drukowane NA dokumencie i rozliczenie CAŁEJ dostawy.

Właściciel 24.09.2026: „do każdej WZ i do faktury drukowało się saldo
niezapłaconych FV lub WZ; będę podpinał klientowi do dokumentów" oraz
„kartkę mu robię na całość" (TRUVA: dostawa 8250 kg, faktura 3200 kg).

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from app.db import execute
from app.services.rozrachunki_service import saldo_na_dokument


def _klient(cid="c1"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES (%s,%s,'TRUVA',true)", (cid, cid.upper()))
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES (%s,0,'PLN','2026-09-01')", (cid,))


def _wz(wid, cid, numer, data, wartosc, seq=1):
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES (%s,%s,%s,'TRUVA') ON CONFLICT (id) DO NOTHING",
            (f"ord-{wid}", f"ZAM/{wid}", cid))
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, currency, source_type, source_id, "
        " issued_date) "
        "VALUES (%s,%s,%s,'2609','TRUVA','[]'::jsonb,%s,true,'wstepny','WZ','PLN',"
        " 'order',%s,%s)",
        (wid, numer, seq, wartosc, f"ord-{wid}", data))


def test_dokument_biezacy_NIE_liczy_sie_jako_zaleglosc(db):
    """Review Focus 5. Klient dostaje WZ i widzi je w „niezapłaconych"
    tego samego papieru — to wygląda na pomyłkę biura."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)
    _wz("w2", "c1", "WZ/2/09/26", "2026-09-15", 3000.0, seq=2)

    blok = saldo_na_dokument("c1", "w2")

    assert [p["number"] for p in blok["pozycje"]] == ["WZ/1/09/26"]
    assert blok["dokument_biezacy"]["number"] == "WZ/2/09/26"


def test_saldo_przed_i_po_tym_dokumencie(db):
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)
    _wz("w2", "c1", "WZ/2/09/26", "2026-09-15", 3000.0, seq=2)

    blok = saldo_na_dokument("c1", "w2")

    assert blok["saldo_przed"] == -1000.0
    assert blok["saldo_po"] == -4000.0


def test_pierwszy_dokument_klienta_ma_zerowe_saldo_przed(db):
    """Nie ma zaległości — blok ma to powiedzieć, a nie zniknąć."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)

    blok = saldo_na_dokument("c1", "w1")

    assert blok["pozycje"] == []
    assert blok["saldo_przed"] == 0.0
    assert blok["saldo_po"] == -1000.0


def test_blok_niesie_CHWILE_policzenia(db):
    """Dokument drukowany ponownie za tydzień pokaże inne saldo — i tak ma
    być. Bez daty na papierze dwa wydruki tego samego WZ pokazują różne
    kwoty i nikt nie wie, który jest aktualny."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)

    assert saldo_na_dokument("c1", "w1")["policzono"]


def test_dokument_spoza_salda_nie_wywraca_bloku(db):
    """Wydruk dokumentu, którego w rozrachunkach nie ma (sprzed odcięcia
    albo niewycenionego) — blok pokazuje zaległości bez pozycji bieżącej."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)

    blok = saldo_na_dokument("c1", "nie-ma-takiego")

    assert blok["dokument_biezacy"] is None
    assert blok["saldo_przed"] == blok["saldo_po"] == -1000.0


# ─── C2: kartka nie może liczyć bieżącej dostawy jako zaległości ────────
#
# Recenzja 24.09.2026: `rozliczenie_dostawy` brało BIEŻĄCE saldo karty jako
# `saldo_przed`, a to saldo zawiera już WZ wystawiony z TEJ dostawy. Potem
# doliczało wartość całej dostawy jeszcze raz. Linia opisana jako
# „Zadłużenie z poprzednich dostaw / BORÇLAR" zawierała dostawę bieżącą.

def _priced_wz(wid, oid, cid, numer, data, wartosc, seria="WZ", zakres=None, seq=1):
    """Dokument PRZYPIĘTY DO ISTNIEJĄCEGO zamówienia — tak jak w podziale
    wysyłki, gdzie WM i WZ klienta dzielą jedno `source_id`."""
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, split_scope, currency, source_type, "
        " source_id, issued_date) "
        "VALUES (%s,%s,%s,'2609','TRUVA',%s::jsonb,%s,true,'wstepny',%s,%s,'PLN',"
        " 'order',%s,%s)",
        (wid, numer, seq,
         '[{"name":"KIRMIZI","qty":10,"kg_per_unit":25.0,"total_kg":250.0}]',
         wartosc, seria, zakres, oid, data))


def test_kartka_NIE_liczy_biezacej_dostawy_jako_zaleglosci(db):
    """Rozjazd, który to dawało, był równy wartości dostawy trzymanej przez
    klienta w ręku."""
    from app.services.rozrachunki_service import rozliczenie_dostawy
    _klient()
    # Poprzednia dostawa — to JEST zaległość.
    _wz("w0", "c1", "WZ/1/09/26", "2026-09-05", 37000.0)
    # Bieżąca dostawa: WM na całość + WZ klienta na część.
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES ('ord9','ZAM/9','c1','TRUVA')")
    _priced_wz("wm9", "ord9", "c1", "WM/9/09/26", "2026-09-20", 0.0,
               seria="WM", zakres="calosc", seq=9)
    _priced_wz("wz9", "ord9", "c1", "WZ/9/09/26", "2026-09-20", 16160.0,
               seria="WZ", zakres="wz_klienta", seq=10)

    wynik = rozliczenie_dostawy("ord9", {"KIRMIZI": 3.20})

    # Zaległość to WYŁĄCZNIE poprzednia dostawa.
    assert wynik["saldo_przed"] == -37000.0


def test_kartka_bez_zaleglosci_pokazuje_zero(db):
    """Pierwsza dostawa klienta — linia BORÇLAR ma być zerem, a nie
    wartością tej dostawy."""
    from app.services.rozrachunki_service import rozliczenie_dostawy
    _klient()
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES ('ord9','ZAM/9','c1','TRUVA')")
    _priced_wz("wm9", "ord9", "c1", "WM/9/09/26", "2026-09-20", 0.0,
               seria="WM", zakres="calosc", seq=9)
    _priced_wz("wz9", "ord9", "c1", "WZ/9/09/26", "2026-09-20", 16160.0,
               seria="WZ", zakres="wz_klienta", seq=10)

    assert rozliczenie_dostawy("ord9", {})["saldo_przed"] == 0.0


# ─── I5: bez salda otwarcia NIE drukujemy zaległości ────────────────────

def test_bez_salda_otwarcia_kartka_ODMAWIA(db):
    """Brak odcięcia przepuszcza CAŁĄ historię, więc linia „Zadłużenie
    z poprzednich dostaw" pokazałaby sumę wszystkich WZ tego klienta —
    dokładnie te „177 dokumentów doliczonych na wierzchu", przed czym broni
    cała specyfikacja, tyle że na papierze jadącym do kontrahenta.

    Lepiej odmówić wydruku niż wydrukować kwotę, której nikt nie obroni."""
    import pytest
    from fastapi import HTTPException
    from app.services.rozrachunki_service import rozliczenie_dostawy
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES ('c1','C1','TRUVA',true)")          # BEZ salda otwarcia
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES ('ord9','ZAM/9','c1','TRUVA')")
    _priced_wz("wm9", "ord9", "c1", "WM/9/09/26", "2026-09-20", 1000.0,
               seria="WM", zakres="calosc", seq=9)

    with pytest.raises(HTTPException) as e:
        rozliczenie_dostawy("ord9", {})
    assert e.value.status_code == 400
    assert "saldo otwarcia" in str(e.value.detail).lower()


def test_bez_salda_otwarcia_blok_na_dokumencie_ODMAWIA(db):
    import pytest
    from fastapi import HTTPException
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES ('c1','C1','TRUVA',true)")
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)

    with pytest.raises(HTTPException) as e:
        saldo_na_dokument("c1", "w1")
    assert e.value.status_code == 400


# ─── I8 z recenzji: kartka MUSI brać dokument na całość ─────────────────

def test_kartka_bierze_dokument_NA_CALOSC_a_nie_WZ_klienta(db):
    """Zapytanie sortowało po `created_at` bez filtra serii. Gdy WM powstał
    PÓŹNIEJ niż WZ klienta (np. po korekcie), kartka opisywała 5050 kg
    zamiast 8250 — czyli mniej towaru, niż klient dostał."""
    from app.services.rozrachunki_service import rozliczenie_dostawy
    _klient()
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES ('ord9','ZAM/9','c1','TRUVA')")
    # WZ klienta powstaje PIERWSZY, WM po nim.
    _priced_wz("wz9", "ord9", "c1", "WZ/9/09/26", "2026-09-20", 16160.0,
               seria="WZ", zakres="wz_klienta", seq=10)
    _priced_wz("wm9", "ord9", "c1", "WM/9/09/26", "2026-09-20", 0.0,
               seria="WM", zakres="calosc", seq=9)

    assert rozliczenie_dostawy("ord9", {})["dokument"] == "WM/9/09/26"


def test_brak_dokumentu_na_calosc_ODMAWIA_zamiast_zgadywac(db):
    """Lepiej powiedzieć „nie ma z czego", niż wydrukować kartkę opisującą
    część dostawy — klient porówna ją z towarem i wyjdzie niezgodność."""
    import pytest
    from fastapi import HTTPException
    from app.services.rozrachunki_service import rozliczenie_dostawy
    _klient()
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES ('ord9','ZAM/9','c1','TRUVA')")
    _priced_wz("wz9", "ord9", "c1", "WZ/9/09/26", "2026-09-20", 16160.0,
               seria="WZ", zakres="wz_klienta", seq=10)

    with pytest.raises(HTTPException) as e:
        rozliczenie_dostawy("ord9", {})
    assert e.value.status_code == 400
    assert "całość" in str(e.value.detail).lower()
