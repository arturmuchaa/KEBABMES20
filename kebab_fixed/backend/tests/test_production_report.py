"""Karta realizacji produkcji (2.5.1 oPRP) — składanie sekcji.

Wzorzec: aktualna księga HACCP 2026.01.525. Testy pilnują zapisów, które
czyta weterynaria — przede wszystkim SKŁADU PARTII PP.
"""
from app.services.production_report_service import (
    build_card_no,
    format_origin,
    format_packages,
)


def test_numer_karty_wg_instrukcji_2_5():
    # „PK — produkcja kebabu, numer kolejny, miesiąc, rok" (instrukcja 2.5)
    assert build_card_no(1, "2026-08-03") == "PK/1/08/26"
    assert build_card_no(12, "2026-08-13") == "PK/12/08/26"
    assert build_card_no(4, "2026-12-31") == "PK/4/12/26"


# ── SKŁAD PARTII PP — to, o co pyta weterynaria ───────────────────────

def test_sklad_partii_laczonej_co_do_kilograma():
    # PP1 z karty: 118 kg = 60 kg z wsadu 440 + 58 kg z wsadu 441
    assert format_origin([
        {"raw_no": "440", "kg": 60.0},
        {"raw_no": "441", "kg": 58.0},
    ]) == "440 — 60 kg, 441 — 58 kg"


def test_partia_z_jednego_wsadu_nie_dubluje_numeru():
    # numer stoi wtedy we własnej kolumnie — powtarzanie byłoby szumem
    assert format_origin([{"raw_no": "440", "kg": 600.0}]) == ""


def test_sklad_pomija_wsady_zerowe():
    assert format_origin([
        {"raw_no": "440", "kg": 60.0},
        {"raw_no": "441", "kg": 0.0},
    ]) == ""


def test_sklad_z_trzech_wsadow():
    assert format_origin([
        {"raw_no": "470", "kg": 16.2},
        {"raw_no": "472", "kg": 8.5},
        {"raw_no": "PP13", "kg": 5.3},
    ]) == "470 — 16.2 kg, 472 — 8.5 kg, PP13 — 5.3 kg"


# ── PAKOWANIE — zapis opakowań z karty papierowej ─────────────────────

def test_opakowania_grupowane_po_masie_malejaco():
    # z karty: „18 × 40 kg, 1 × 25 kg"
    assert format_packages([
        {"qty": 10, "kg_per_unit": 40},
        {"qty": 1, "kg_per_unit": 25},
        {"qty": 8, "kg_per_unit": 40},
    ]) == "18 × 40 kg, 1 × 25 kg"


def test_opakowania_trzy_masy():
    # z karty: „2 × 40 kg, 19 × 25 kg, 19 × 10 kg"
    assert format_packages([
        {"qty": 19, "kg_per_unit": 10},
        {"qty": 2, "kg_per_unit": 40},
        {"qty": 19, "kg_per_unit": 25},
    ]) == "2 × 40 kg, 19 × 25 kg, 19 × 10 kg"


def test_opakowania_pomijaja_puste_pozycje():
    assert format_packages([
        {"qty": 0, "kg_per_unit": 40},
        {"qty": 5, "kg_per_unit": 25},
        {"qty": 3, "kg_per_unit": 0},
    ]) == "5 × 25 kg"
    assert format_packages([]) == ""
