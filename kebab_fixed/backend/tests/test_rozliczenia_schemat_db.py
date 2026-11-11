"""Schemat panelu rozliczeń z odbiorcami (tabele rozl_*).

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import psycopg2.errors
import pytest

from app.db import execute, query_one
from app.migrations import run_migrations


def _klient(cid="c1"):
    execute("INSERT INTO clients (id, code, name) VALUES (%s, %s, 'TEST')", (cid, cid.upper()))


def _faktura(id_, client_id="c1", numer="FV 1/2026"):
    execute(
        "INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, termin) "
        "VALUES (%s, %s, 'fv', 'reczna', %s, '2026-11-09', '2026-11-16')",
        (id_, client_id, numer))


def _wz(id_, source_id):
    execute(
        "INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, source_id, numer, data_dok, termin) "
        "VALUES (%s, NULL, 'wz', 'mes_wz', %s, 'WZ 1', '2026-11-09', '2026-11-09')",
        (id_, source_id))


def test_migracje_sa_idempotentne(db):
    run_migrations()
    run_migrations()


def test_klient_ma_domyslne_ustawienia_rozliczen(db):
    _klient()
    row = query_one("SELECT rozl_termin_wz, rozl_termin_fv, rozl_forma_wz, rozl_forma_fv, "
                    "rozl_notatka FROM clients WHERE id='c1'")
    assert row["rozl_termin_wz"] == 0
    assert row["rozl_termin_fv"] == 7
    assert row["rozl_forma_wz"] == "gotowka"
    assert row["rozl_forma_fv"] == "przelew"
    assert row["rozl_notatka"] == ""


def test_duplikat_faktury_klienta_odrzucony_dopoki_pierwsza_nie_usunieta(db):
    _klient()
    _faktura("d1")
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _faktura("d2")
    execute("UPDATE rozl_dokumenty SET usuniety_at = now() WHERE id='d1'")
    _faktura("d2")


def test_drugi_mes_wz_z_tym_samym_source_id_odrzucony(db):
    _wz("d1", "wz-1")
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _wz("d2", "wz-1")


def test_wplata_zerowa_odrzucona(db):
    _klient()
    with pytest.raises(psycopg2.errors.CheckViolation):
        execute("INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data) "
                "VALUES ('w1','c1','fv','przelew',0,'PLN','2026-11-09')")


def test_data_startu_rozliczen_domyslnie_2026_11_09(db):
    row = query_one("SELECT value FROM app_settings WHERE key='rozliczenia_start'")
    assert row["value"] == "2026-11-09"
