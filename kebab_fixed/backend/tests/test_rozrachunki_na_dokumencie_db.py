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
