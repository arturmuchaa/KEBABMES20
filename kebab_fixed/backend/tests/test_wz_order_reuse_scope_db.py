"""Zapytania o „istniejący WZ" (`create_wz_from_order`, `generate_wz` /
`should_reuse`) NIE mogą znaleźć dokumentu z PODZIAŁU wysyłki (WM / WZ
klienta) i zwrócić go jako zwykły WZ zamówienia.

Stary przycisk „Wystaw WZ" (`create_wz_from_order`) i `generate_wz` szukają
istniejącego dokumentu po samym `(source_type, source_id)` — bez
`doc_series` ani `split_scope`. Dokument wewnętrzny WM powstaje PIERWSZY
(biuro wystawia go zanim wystawi WZ klienta), więc `ORDER BY created_at
LIMIT 1` trafia właśnie w niego: biuro klika stary „Wystaw WZ" i dostaje
dokument serii WM z adnotacją „DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI"
jako WZ dla klienta, cicho, bez ostrzeżenia (review Task 4, fix round 3,
2026-09-10).

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest

from app.db import execute, query_one
from app.services.wz_service import create_wz_from_order, generate_wz
from tests.conftest_split import _przygotuj_bez_podzialu, _przygotuj_z_podzialem


def _dokument_podzialu(oid="o1", series="WM", split_scope="calosc", nr=1):
    """Minimalny wiersz `wz_documents` z podziału wysyłki — NIE dotyka
    magazynu. Testuje samo ZAPYTANIE o istniejący dokument (`create_wz_from_
    order`/`generate_wz`), nie rozchód WM — ten ma własne testy w
    `test_split_documents_db.py`."""
    wid = f"dok-podzialu-{oid}-{series}-{nr}"
    number = f"{series}/{nr}/09/26"
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, total_value, status, currency, pallets_h1, "
        " pallets_other, issued_date, release_date, doc_series, split_scope, created_at) "
        "VALUES (%s,%s,%s,'09/26','order',%s,'YBM Gastro GmbH',false,'[]'::jsonb,0,"
        " 'wstepny','PLN',0,0,'2026-09-09','2026-09-09',%s,%s,now())",
        (wid, number, nr, oid, series, split_scope))
    return {"id": wid, "number": number}


def test_stary_wz_nie_podbiera_dokumentu_wewnetrznego_wm(db):
    """FINDING: bez filtra `create_wz_from_order` zwróciłby WM (powstaje
    PIERWSZY, `ORDER BY created_at LIMIT 1` trafia w niego) jako zwykły WZ
    dla klienta — z adnotacją „NIE WYDAWAĆ KLIENTOWI"."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = _dokument_podzialu("o1", series="WM", split_scope="calosc")

    with pytest.raises(Exception) as e:
        create_wz_from_order("o1")

    assert wm["number"] in str(e.value)
    assert "drugi raz" in str(e.value)


def test_stary_wz_nie_podbiera_wz_klienta(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wzk = _dokument_podzialu("o1", series="WZ", split_scope="wz_klienta")

    with pytest.raises(Exception) as e:
        create_wz_from_order("o1")

    assert wzk["number"] in str(e.value)


def test_stary_wz_NIE_zdejmuje_stanu_drugi_raz_po_podziale(db):
    """Sedno sprawy — dokument to papier, rozchód to pieniądze.

    Samo „nie zwróć dokumentu z podziału" nie wystarczyło: po zawężeniu
    zapytań (fix round 3) stara ścieżka nie znajdowała już NICZEGO, więc
    budowała WZ od zera i zdejmowała stan po raz drugi. Ten test pilnuje
    magazynu, nie treści komunikatu."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    _dokument_podzialu("o1", series="WM", split_scope="calosc")
    przed = query_one(
        "SELECT COALESCE(SUM(qty_available),0) AS s FROM finished_goods")["s"]
    ruchow_przed = query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"]

    with pytest.raises(Exception):
        create_wz_from_order("o1")

    po = query_one("SELECT COALESCE(SUM(qty_available),0) AS s FROM finished_goods")["s"]
    ruchow_po = query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"]
    assert po == przed, "stara ścieżka ruszyła magazyn mimo istniejącego podziału"
    assert ruchow_po == ruchow_przed


def test_ANULOWANY_podzial_nie_blokuje_starego_wz(db):
    """Odmowa musi być odwracalna: biuro anuluje dokumenty podziału (towar
    wraca na stan) i wraca do zwykłego WZ. Inaczej zamówienie raz podzielone
    zostawałoby zablokowane na zawsze."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = _dokument_podzialu("o1", series="WM", split_scope="calosc")
    execute("UPDATE wz_documents SET status='anulowany' WHERE id=%s", (wm["id"],))

    nowy = create_wz_from_order("o1")

    assert nowy["id"] != wm["id"]
    assert nowy["number"].startswith("WZ/")


def test_stary_wz_nadal_zwraca_zwykly_historyczny_wz(db):
    """177 realnych dokumentów ma `split_scope IS NULL` (historyczne, sprzed
    tej kolumny) — idempotencja starej ścieżki dla NICH nie może się zepsuć,
    to ważniejsze niż nowe zachowanie."""
    _przygotuj_bez_podzialu()
    pierwszy = create_wz_from_order("o1")
    drugi = create_wz_from_order("o1")
    assert drugi["id"] == pierwszy["id"], "stary WZ przestał być idempotentny"


def test_generate_wz_nie_podbiera_dokumentu_z_podzialu(db):
    """`should_reuse`/`generate_wz` mają to samo zawężenie co `create_wz_
    from_order` — inna funkcja, ten sam bug klasy „znajdzie cokolwiek pod
    source_id"."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = _dokument_podzialu("o1", series="WM", split_scope="calosc")

    with pytest.raises(Exception) as e:
        generate_wz(
            source_type="order", source_id="o1",
            buyer={"name": "YBM Gastro GmbH", "address": "", "nip": ""},
            items=[{"name": "Test", "qty": 1, "unit": "szt"}], valued=False)

    assert wm["number"] in str(e.value)


def test_generate_wz_z_INNEGO_zrodla_guard_nie_dotyczy(db):
    """Guard patrzy tylko na `source_type='order'` — WZ ręczny albo z innego
    źródła nie ma z podziałem zamówienia nic wspólnego i musi przechodzić."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    _dokument_podzialu("o1", series="WM", split_scope="calosc")

    nowy = generate_wz(
        source_type="pallets", source_id="o1",
        buyer={"name": "YBM Gastro GmbH", "address": "", "nip": ""},
        items=[{"name": "Test", "qty": 1, "unit": "szt"}], valued=False)

    assert nowy["number"].startswith("WZ/")
