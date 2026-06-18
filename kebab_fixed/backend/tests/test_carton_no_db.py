"""Testy: globalny unikalny numer kartonu (= paleta).

Karton = paleta (`order_pallets`). Każda paleta dostaje globalny, sekwencyjny
numer `carton_no` (format 6-cyfrowy '000001'), nadawany przy tworzeniu.
Skaner sztuki pokazuje go jako lokalizację dla sztuk spakowanych.

Testy DB wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.models.orders import PalletDto, PalletItemDto
from app.services.pallets_service import save_pallets
from app.utils.ids import cuid, format_carton_no, now_iso


# ── Format numeru (bez DB) ─────────────────────────────────────────────
def test_format_carton_no_pads_to_six_digits():
    assert format_carton_no(1) == "000001"
    assert format_carton_no(42) == "000042"
    assert format_carton_no(123456) == "123456"


def test_format_carton_no_above_million_does_not_truncate():
    assert format_carton_no(1234567) == "1234567"


# ── Nadanie numeru przy tworzeniu palety ───────────────────────────────
def _seed_order_with_line(order_id, line_id, qty=10):
    execute("INSERT INTO client_orders (id, order_no) VALUES (%s,%s)", (order_id, "ZAM/" + order_id))
    execute(
        "INSERT INTO client_order_lines (id, order_id, qty, kg_per_unit, total_kg) "
        "VALUES (%s,%s,%s,1,%s)",
        (line_id, order_id, qty, qty),
    )


def test_save_pallets_assigns_sequential_carton_no(db):
    _seed_order_with_line("oc_seq", "lc_seq", qty=10)
    save_pallets("oc_seq", [
        PalletDto(notes="", items=[PalletItemDto(order_line_id="lc_seq", qty=5)]),
        PalletDto(notes="", items=[PalletItemDto(order_line_id="lc_seq", qty=5)]),
    ])
    rows = query_all("SELECT pallet_no, carton_no FROM order_pallets WHERE order_id='oc_seq' ORDER BY pallet_no")
    assert len(rows) == 2
    cartons = [r["carton_no"] for r in rows]
    # globalnie sekwencyjne, niepuste, różne
    assert all(c is not None for c in cartons)
    assert cartons[0] != cartons[1]
    assert cartons[1] == cartons[0] + 1


def test_save_pallets_preserves_carton_no_on_reedit(db):
    # Ponowny zapis palety o tym samym pallet_no NIE zmienia jej numeru kartonu.
    _seed_order_with_line("oc_keep", "lc_keep", qty=10)
    save_pallets("oc_keep", [PalletDto(notes="", items=[PalletItemDto(order_line_id="lc_keep", qty=5)])])
    first = query_all("SELECT carton_no FROM order_pallets WHERE order_id='oc_keep'")[0]["carton_no"]
    save_pallets("oc_keep", [PalletDto(notes="zmiana", items=[PalletItemDto(order_line_id="lc_keep", qty=6)])])
    second = query_all("SELECT carton_no FROM order_pallets WHERE order_id='oc_keep'")[0]["carton_no"]
    assert second == first
