"""Rozliczenia — KPI należności w złotówkach po kursie NBP (D14, 12.11.2026).

Właściciel: „główna suma należności na KPI w przeliczeniu na złotówki według
aktualnego kursu, a pod spodem ile w zł, a ile w euro”.

`lista()["podsumowanie"]` dostaje `kurs_eur` ({kurs, tabela, data} albo None)
i kwoty `naleznosci_pln`, `po_terminie_pln`, `obrot_pln`, `nadplaty_pln`
= PLN + EUR × kurs (half-up do groszy). Kurs — tylko z `fx_service`
(NBP tabela A); bez kursu pola są None, nigdy zmyślony kurs.

Sieć podmieniona (`fx_service._fetch`) — testy bez internetu.
"""
from __future__ import annotations

import json
import urllib.error
from datetime import date

import pytest

from app.services import fx_service
from app.services.rozliczenia_service import lista
from tests.test_rozliczenia_odczyt_db import _faktura, _klient

DZIS = date(2026, 11, 12)


def _nbp(mid, no="221/A/NBP/2026", dzien="2026-11-12"):
    wolania = []

    def _fetch(url):
        wolania.append(url)
        return json.dumps({"table": "A", "code": "EUR", "rates": [
            {"no": "220/A/NBP/2026", "effectiveDate": "2026-11-10", "mid": 4.2},
            {"no": no, "effectiveDate": dzien, "mid": mid}]}).encode()
    return _fetch, wolania


@pytest.fixture
def kurs_425(monkeypatch):
    fetch, wolania = _nbp(4.25)
    monkeypatch.setattr(fx_service, "_fetch", fetch)
    monkeypatch.setattr(fx_service, "_today", lambda: DZIS)
    return wolania


def test_naleznosci_w_zlotowkach_pln_plus_eur_razy_kurs(db, kurs_425):
    _klient("pl", "POLSKI", waluta="PLN")
    _klient("eu", "ZAGRANICZNY", waluta="EUR")
    _faktura("pl", "FV/1", date(2026, 11, 10), 1000, waluta="PLN")
    _faktura("eu", "FV/2", date(2026, 11, 10), 100, waluta="EUR")

    p = lista(dzis=DZIS)["podsumowanie"]

    assert p["kurs_eur"] == {"kurs": 4.25, "tabela": "221/A/NBP/2026", "data": "2026-11-12"}
    assert p["naleznosci_pln"] == 1425.0
    assert p["po_terminie_pln"] == 0.0
    assert p["nadplaty_pln"] == 0.0
    # rozbicie per waluta bez zmian
    assert p["PLN"]["naleznosci"] == 1000.0
    assert p["EUR"]["naleznosci"] == 100.0
    # kurs z dnia „dziś” listy
    assert kurs_425 and kurs_425[0].endswith("2026-11-12/?format=json")


def test_przeliczenie_po_terminie_i_obrot(db, kurs_425):
    _klient("pl", "POLSKI", waluta="PLN")
    _klient("eu", "ZAGRANICZNY", waluta="EUR")
    # start rozliczeń 09.11; termin 10.11 → 12.11 po terminie
    _faktura("pl", "FV/1", date(2026, 11, 9), 200, waluta="PLN", termin=date(2026, 11, 10))
    _faktura("eu", "FV/2", date(2026, 11, 9), 10, waluta="EUR", termin=date(2026, 11, 10))

    p = lista(dzis=DZIS, od=date(2026, 11, 1), do=date(2026, 11, 30))["podsumowanie"]

    assert p["po_terminie_pln"] == 242.5
    assert p["obrot_pln"] == 242.5


def test_przeliczenie_zaokragla_half_up_do_groszy(db, kurs_425):
    _klient("pl", "POLSKI", waluta="PLN")
    _klient("eu", "ZAGRANICZNY", waluta="EUR")
    _faktura("pl", "FV/1", date(2026, 11, 10), 0.01, waluta="PLN")
    _faktura("eu", "FV/2", date(2026, 11, 10), 1.30, waluta="EUR")   # 1,30 × 4,25 = 5,525

    assert lista(dzis=DZIS)["podsumowanie"]["naleznosci_pln"] == 5.54   # 0,01 + 5,53 (half-even dałoby 5,53)


def test_brak_kursu_nbp_daje_null_a_lista_dziala(db, monkeypatch):
    def _awaria(url):
        raise urllib.error.URLError("NBP nie odpowiada")
    monkeypatch.setattr(fx_service, "_fetch", _awaria)
    monkeypatch.setattr(fx_service, "_today", lambda: DZIS)
    _klient("pl", "POLSKI", waluta="PLN")
    _klient("eu", "ZAGRANICZNY", waluta="EUR")
    _faktura("pl", "FV/1", date(2026, 11, 10), 1000, waluta="PLN")
    _faktura("eu", "FV/2", date(2026, 11, 10), 100, waluta="EUR")

    l = lista(dzis=DZIS)
    p = l["podsumowanie"]

    assert p["kurs_eur"] is None
    for pole in ("naleznosci_pln", "po_terminie_pln", "obrot_pln", "nadplaty_pln"):
        assert p[pole] is None
    assert p["PLN"]["naleznosci"] == 1000.0 and p["EUR"]["naleznosci"] == 100.0
    assert {k["id"] for k in l["kontrahenci"]} == {"pl", "eu"}


def test_same_zlotowki_bez_pytania_nbp(db, kurs_425):
    _klient("pl", "POLSKI", waluta="PLN")
    _faktura("pl", "FV/1", date(2026, 11, 10), 1000, waluta="PLN")

    p = lista(dzis=DZIS)["podsumowanie"]

    assert kurs_425 == []
    assert p["kurs_eur"] is None
    assert p["naleznosci_pln"] == 1000.0
