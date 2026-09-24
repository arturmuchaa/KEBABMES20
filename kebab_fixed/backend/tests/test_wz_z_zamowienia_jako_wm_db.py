"""„Wystaw WZ" na zamówieniu BEZ PODZIAŁU wystawia WM, nie WZ.

Decyzja właściciela 24.09.2026: „klienci powinni dostać sam WM, nie WZ —
WM po to, aby ściągnąć ze stanu, a WZ wtedy, jak dzielimy FV i WZ".
Doprecyzowanie: „Słowacy mają dostawać HDI, nie WZ, ale dostaną też FV".

Układ po zmianie:

    bez podziału   →  WM (rusza stan) + HDI (papier dla klienta) + faktura
    z podziałem    →  WM (rusza stan) + WZ (część poza fakturą) + faktura

Skąd temat: SOFMON, MEPA, VATAN i CEVDET odbierają własnym transportem, więc
nigdy nie przechodzą przez skanowanie auta (w bazie: ZERO kursów). Biuro
wystawia im papiery wprost z zamówienia, a ta droga robiła zwykły WZ.
Obie ścieżki „po skanie" (`wystaw_komplet`) były już poprawne.

To NIE jest kosmetyka: rozrachunki z odbiorcami liczą obciążenia z WZ
i z faktur. Dopóki zamówienie fakturowane w całości rodzi WZ, ten sam towar
policzyłby się DWA RAZY (patrz specyfikacja rozrachunków z 24.09.2026).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.db import query_all, query_one
from app.services.wz_service import create_wz_from_order
from tests.conftest_split import _przygotuj_bez_podzialu, _przygotuj_z_podzialem


def _dokumenty(oid="o1"):
    return query_all(
        "SELECT number, doc_series, split_scope FROM wz_documents "
        "WHERE source_type='order' AND source_id=%s ORDER BY created_at", (oid,))


def test_bez_podzialu_powstaje_dokument_serii_WM(db):
    """Sedno decyzji: dokument rusza stan, więc jest WEWNĘTRZNY."""
    _przygotuj_bez_podzialu()

    create_wz_from_order("o1")

    assert [(d["doc_series"], d["split_scope"]) for d in _dokumenty()] == [("WM", "calosc")]


def test_numer_dostaje_serie_WM(db):
    """Numeracja idzie własną serią — WM/NN/MM/RR, nie WZ/NN/MM/RR."""
    _przygotuj_bez_podzialu()

    doc = create_wz_from_order("o1")

    assert doc["number"].startswith("WM/")


def test_powtorne_wystawienie_oddaje_TEN_SAM_dokument(db):
    """PUŁAPKA KOLEJNOŚCI: strażnik podziału odmawia, gdy zamówienie ma
    dokument ze `split_scope`. Nowy dokument ma `split_scope='calosc'`, więc
    drugie kliknięcie odbiłoby się o WŁASNY papier — zamiast go oddać.
    Idempotencja musi być sprawdzana PRZED strażnikiem."""
    _przygotuj_bez_podzialu()

    pierwszy = create_wz_from_order("o1")
    drugi = create_wz_from_order("o1")

    assert pierwszy["number"] == drugi["number"]
    assert len(_dokumenty()) == 1


def test_HISTORYCZNY_zwykly_WZ_dalej_jest_oddawany(db):
    """Zgodność wstecz: 177 dokumentów w bazie to zwykłe WZ ze
    `split_scope IS NULL`. Wejście na stare zamówienie ma oddać TAMTEN
    dokument, a nie dorobić do niego WM."""
    _przygotuj_bez_podzialu()
    from app.db import execute
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, total_value, status, currency, pallets_h1, "
        " pallets_other, issued_date, release_date, doc_series, split_scope, created_at) "
        "VALUES ('stary','WZ/7/09/26',7,'2609','order','o1','YBM Gastro GmbH',false,"
        " '[]'::jsonb,0,'wstepny','PLN',0,0,'2026-09-07','2026-09-07','WZ',NULL,now())")

    doc = create_wz_from_order("o1")

    assert doc["number"] == "WZ/7/09/26"
    assert len(_dokumenty()) == 1


def test_przy_podziale_oddaje_TEN_SAM_dokument_wewnetrzny(db):
    """Obie drogi tworzą ten sam WM, więc druga oddaje dokument pierwszej —
    bez drugiego rozchodu magazynu."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    from app.services.split_documents_service import wystaw_wz_wewnetrzny
    wm = wystaw_wz_wewnetrzny("o1")

    assert create_wz_from_order("o1")["number"] == wm["number"]


def test_WZ_KLIENTA_blokuje_ta_droge(db):
    """Gdy komplet wystawił już papier DLA KLIENTA, biuro ma wrócić do
    kompletu — inaczej dwie drogi opisywałyby tę samą wysyłkę inaczej."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    from app.services.split_documents_service import (wystaw_wz_klienta,
                                                      wystaw_wz_wewnetrzny)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")

    with pytest.raises(HTTPException) as e:
        create_wz_from_order("o1")
    assert e.value.status_code == 400


def test_dokument_rusza_stan_magazynu(db):
    """WM jest jedynym dokumentem tej wysyłki, który zdejmuje wyrób —
    zmiana serii nie może tego zgubić."""
    _przygotuj_bez_podzialu()
    przed = query_one("SELECT SUM(qty_available) AS n FROM finished_goods")["n"]

    create_wz_from_order("o1")

    po = query_one("SELECT SUM(qty_available) AS n FROM finished_goods")["n"]
    assert float(po) < float(przed)
