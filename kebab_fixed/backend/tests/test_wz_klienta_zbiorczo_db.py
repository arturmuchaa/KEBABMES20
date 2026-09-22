"""WZ dla klienta ma pozycje ZBIORCZE, WM zostaje per partia.

Właściciel 22.09.2026: „na WZ dla klienta ogólna nazwa, a nie każda sztuka;
na WM już każda sztuka". Grupujemy po pozycji cennikowej (rodzaj+receptura),
bo „kebab z kurczaka ma inną cenę niż yaprak", a ceny uzupełnia się PO
wystawieniu — więc podział nie może wynikać z ceny.
"""
from __future__ import annotations

import pytest

from app.services.split_documents_service import _scal_pozycje_cennikowe
from app.services.wz_service import build_wz_lines


def _poz(nazwa_pelna, baza, qty, kgpu, pt, r):
    return {"name": nazwa_pelna, "name_base": baza, "qty": qty, "unit": "szt",
            "kg_per_unit": kgpu, "total_kg": round(qty * kgpu, 3),
            "product_type_id": pt, "recipe_id": r}


def test_scala_pozycje_roznace_sie_tylko_gramatura():
    """Dwie gramatury tej samej pary rodzaj+receptura to JEDNA pozycja
    cennikowa — klient ma zobaczyć jedną linię z sumą kilogramów."""
    items = [
        _poz("KEBAB UDO KIRMIZI 15kg", "KEBAB UDO KIRMIZI", 10, 15.0, "pt1", "r1"),
        _poz("KEBAB UDO KIRMIZI 30kg", "KEBAB UDO KIRMIZI", 9, 30.0, "pt1", "r1"),
    ]

    out = _scal_pozycje_cennikowe(items)

    assert len(out) == 1
    assert out[0]["name"] == "KEBAB UDO KIRMIZI"
    assert out[0]["qty"] == 19
    assert out[0]["total_kg"] == pytest.approx(420.0)
    # Gramatura przestaje opisywać scaloną linię — jej obecność kłamałaby
    # na wydruku („19 szt × 15 kg" przy 420 kg).
    assert "kg_per_unit" not in out[0]


def test_rozne_receptury_zostaja_osobno():
    """Kebab z kurczaka ma inną cenę niż yaprak — scalenie ich w jedną linię
    dałoby dokument, którego nie da się poprawnie wycenić."""
    items = [
        _poz("KEBAB UDO KIRMIZI 15kg", "KEBAB UDO KIRMIZI", 10, 15.0, "pt1", "r1"),
        _poz("KEBAB MIX YAPRAK 25kg", "KEBAB MIX YAPRAK", 10, 25.0, "pt2", "r2"),
    ]

    out = _scal_pozycje_cennikowe(items)

    assert len(out) == 2
    assert {o["name"] for o in out} == {"KEBAB UDO KIRMIZI", "KEBAB MIX YAPRAK"}


def test_ten_sam_rodzaj_rozna_receptura_zostaje_osobno():
    """Dwie receptury na tym samym rodzaju to dwie pozycje cennikowe —
    dokładnie przypadek, który w HDI wymusił rodzaj W NAZWIE (zgłoszenie
    TRUVA, 29.08.2026)."""
    items = [
        _poz("KEBAB UDO KIRMIZI 15kg", "KEBAB UDO KIRMIZI", 10, 15.0, "pt1", "r1"),
        _poz("KEBAB UDO YAPRAK 15kg", "KEBAB UDO YAPRAK", 5, 15.0, "pt1", "r2"),
    ]

    assert len(_scal_pozycje_cennikowe(items)) == 2


def test_pusta_lista_zostaje_pusta():
    assert _scal_pozycje_cennikowe([]) == []


def test_build_wz_lines_respektuje_podane_total_kg():
    """Pozycja zbiorcza niesie sumę kilogramów WPROST — qty*kg_per_unit
    (19 szt × jedna gramatura) opisywałoby ją błędnie."""
    lines, _ = build_wz_lines(
        [{"name": "KEBAB UDO KIRMIZI", "qty": 19, "unit": "szt", "total_kg": 420.0}],
        valued=False)

    assert lines[0]["total_kg"] == pytest.approx(420.0)
    assert "kg_per_unit" not in lines[0]


def test_build_wz_lines_bez_total_kg_liczy_po_staremu():
    """Zgodność wstecz: pozycja z gramaturą i bez jawnej sumy liczy się tak
    jak dotąd — inaczej rozsypałby się WM i każdy ręczny WZ."""
    lines, _ = build_wz_lines(
        [{"name": "KEBAB UDO KIRMIZI 15kg", "qty": 10, "unit": "szt", "kg_per_unit": 15.0}],
        valued=False)

    assert lines[0]["total_kg"] == pytest.approx(150.0)
    assert lines[0]["kg_per_unit"] == pytest.approx(15.0)


def test_wycena_zbiorczej_pozycji_idzie_ZA_KG():
    """Cena kontrahenta jest za kilogram — wartość liczy się z sumy kg,
    nie z liczby sztuk."""
    lines, total = build_wz_lines(
        [{"name": "KEBAB UDO KIRMIZI", "qty": 19, "unit": "szt",
          "total_kg": 420.0, "price": 12.50}],
        valued=True)

    assert lines[0]["value"] == pytest.approx(420.0 * 12.50)
    assert total == pytest.approx(420.0 * 12.50)
