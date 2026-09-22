"""Waluta przy uzupełnianiu cen na WZ.

Zgłoszenie właściciela 22.09.2026: „uzupełnij ceny — nie mam możliwości
zmienić już wtedy na euro". Ceny działały; `currency` był parametrem
WYŁĄCZNIE przy tworzeniu dokumentu, więc WZ wystawiony z kursu rodził się
z PLN i zostawał z nim na zawsze.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.wz_service import update_wz_prices


def _wz(wid: str = "w1", status: str = "wstepny", currency: str = "PLN") -> str:
    """WZ z jedną pozycją 420 kg — wyceniany ZA KG (`total_kg` na linii)."""
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, "
        " lines, total_value, valued, status, currency, doc_series, issued_date) "
        "VALUES (%s,'WZ/1/09/26',1,'2609','YALCIN',%s::jsonb,0,FALSE,%s,%s,'WZ','22.09.2026')",
        (wid, json.dumps([
            {"name": "KEBAB UDO KIRMIZI", "qty": 28, "unit": "szt", "total_kg": 420.0},
        ]), status, currency))
    return wid


def _potracenie(did: str = "d1", wid: str = "w1") -> str:
    """Oczekujące potrącenie pracownika powiązane z tym WZ.

    `deduction_date` jest NOT NULL — data WZGLĘDNA, nigdy sztywna, żeby test
    nie zaczął kłamać po zmianie roku.
    """
    execute(
        "INSERT INTO worker_deductions (id, worker_id, deduction_date, description, "
        " amount, source_type, source_id, status) "
        "VALUES (%s,'p1',%s,'',0,'wz',%s,'pending')",
        (did, date.today(), wid))
    return did


def test_uzupelnienie_cen_przestawia_walute_na_euro(db):
    _wz()

    update_wz_prices("w1", [{"index": 0, "price": 3.10}],
                     currency="EUR", eur_rate=4.2750)

    doc = query_one("SELECT currency, eur_rate, total_value, valued "
                    "FROM wz_documents WHERE id='w1'")
    assert doc["currency"] == "EUR"
    assert float(doc["eur_rate"]) == pytest.approx(4.2750)
    assert float(doc["total_value"]) == pytest.approx(420.0 * 3.10)
    assert doc["valued"] is True


def test_bez_podanej_waluty_zostaje_ta_co_byla(db):
    """Zgodność wstecz: dotychczasowe wołanie bez waluty nie może jej ruszać."""
    _wz(currency="EUR")

    update_wz_prices("w1", [{"index": 0, "price": 3.10}])

    assert query_one("SELECT currency FROM wz_documents WHERE id='w1'")["currency"] == "EUR"


def test_potracenie_pracownika_zostaje_w_ZLOTOWKACH(db):
    """PUŁAPKA złapana przy pisaniu planu.

    `update_wz_prices` przepisuje wartość dokumentu na potrącenie pracownika,
    a pasek płacowy jest w ZŁOTÓWKACH i nie ma pola na walutę. Wartość w EUR
    wylądowałaby tam jako złotówki — potrącenie zaniżone o cały kurs (~4,3×),
    przy kwocie, która sama w sobie wygląda sensownie, więc nikt by tego nie
    zauważył.
    """
    _wz()
    _potracenie()

    update_wz_prices("w1", [{"index": 0, "price": 3.10}],
                     currency="EUR", eur_rate=4.2750)

    kwota = float(query_one("SELECT amount FROM worker_deductions WHERE id='d1'")["amount"])
    assert kwota == pytest.approx(420.0 * 3.10 * 4.2750, rel=1e-3)


def test_potracenie_w_PLN_bez_przeliczania(db):
    """Dokument złotówkowy — kwota idzie 1:1, bez mnożenia przez cokolwiek."""
    _wz()
    _potracenie()

    update_wz_prices("w1", [{"index": 0, "price": 12.50}])

    kwota = float(query_one("SELECT amount FROM worker_deductions WHERE id='d1'")["amount"])
    assert kwota == pytest.approx(420.0 * 12.50)


def test_EUR_bez_kursu_odmawia(db):
    """Bez kursu wartość w euro nie da się przeliczyć na pasek płacowy —
    lepiej odmówić, niż zapisać liczbę, której nie da się obronić."""
    _wz()

    with pytest.raises(HTTPException) as e:
        update_wz_prices("w1", [{"index": 0, "price": 3.10}], currency="EUR")
    assert e.value.status_code == 400


def test_nieznana_waluta_odmawia(db):
    _wz()

    with pytest.raises(HTTPException) as e:
        update_wz_prices("w1", [{"index": 0, "price": 3.10}], currency="USD", eur_rate=4.0)
    assert e.value.status_code == 400


def test_dokument_potwierdzony_odmawia_takze_zmiany_waluty(db):
    """Waluta nie może być furtką do edycji zamkniętego dokumentu."""
    _wz(status="potwierdzony")

    with pytest.raises(HTTPException) as e:
        update_wz_prices("w1", [{"index": 0, "price": 3.10}], currency="EUR", eur_rate=4.27)
    assert e.value.status_code == 409
