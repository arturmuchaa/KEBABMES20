"""Przerwy przeżywają odświeżenie ekranu.

Do 27.08.2026 `BreakState` żył w `useState` HMI i ginął przy odświeżeniu —
a razem z nim blokada zapisu sztuk, która na nim stoi.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.services.production_breaks_service import end_break, list_breaks, start_break


def _plan():
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )


def test_rozpoczeta_przerwa_jest_widoczna_po_ponownym_odczycie(db):
    _plan()
    start_break("pp1")

    przerwy = list_breaks("pp1")
    assert len(przerwy) == 1
    assert przerwy[0]["endedAt"] is None


def test_zakonczenie_domyka_trwajaca_przerwe(db):
    _plan()
    start_break("pp1")
    end_break("pp1")

    przerwy = list_breaks("pp1")
    assert len(przerwy) == 1
    assert przerwy[0]["endedAt"] is not None


def test_druga_przerwa_nie_otwiera_sie_gdy_jedna_trwa(db):
    """Podwójne dotknięcie „Przerwa" nie może zostawić dwóch otwartych —
    czas przerwy liczyłby się podwójnie."""
    _plan()
    start_break("pp1")
    start_break("pp1")

    otwarte = query_all(
        "SELECT 1 FROM production_breaks WHERE plan_id='pp1' AND ended_at IS NULL"
    )
    assert len(otwarte) == 1


def test_zakonczenie_bez_trwajacej_przerwy_nic_nie_psuje(db):
    _plan()
    assert end_break("pp1")["ended"] == 0


def test_kolejne_przerwy_tego_samego_dnia_sa_osobnymi_wierszami(db):
    _plan()
    start_break("pp1"); end_break("pp1")
    start_break("pp1"); end_break("pp1")

    assert len(list_breaks("pp1")) == 2
