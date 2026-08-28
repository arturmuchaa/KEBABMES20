"""Rodzaj komponentowy jako część tożsamości wiersza wyrobu gotowego.

KEBAB UDO 100% i KEBAB MIX 95/5 potrafią mieć ten sam przepis, tuleję, klienta,
wagę sztuki I TĘ SAMĄ PARTIĘ — różni je wyłącznie skład mięsa. Do 28.08.2026
klucz scalania wiersza nie brał `product_type_id`, więc drugi rodzaj dopisywał
się do pierwszego, a jego nazwa przepadała bezpowrotnie: w bazie zostawał jeden
wiersz z rodzajem tego wpisu, który akurat trafił pierwszy.

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest

from app.db import query_all, transaction
from app.models.production import FinishDayEntry
from app.services.finished_goods_service import _upsert_goods_row

PLAN = {"id": "plan-rodzaj", "plan_no": "PL-RODZAJ"}
LINEAGE = {"mixing_order_ids": [], "seasoned_meat_ids": [], "deboning_entry_ids": []}
DZIEN = "2026-08-28"
PARTIA = "280826 507"


def _wpis(**kw) -> FinishDayEntry:
    dane = dict(
        plan_line_id="", qty=10, worker_names=[], kg_per_unit=25.0,
        product_type_id="pt-udo", product_type_name="KEBAB UDO 100%",
        recipe_id="rec-kirmizi", recipe_name="KIRMIZI",
        packaging_id="pkg-1", packaging_name="METAL 65",
        client_name="Truva gastro s.r.o.",
    )
    dane.update(kw)
    return FinishDayEntry(**dane)


def _zapisz(entry: FinishDayEntry, qty: int) -> None:
    with transaction() as conn:
        _upsert_goods_row(
            conn, PLAN, entry, DZIEN, PARTIA, qty,
            round(qty * entry.kg_per_unit, 3), [], LINEAGE,
        )


def _wiersze():
    return query_all(
        "SELECT product_type_name, qty, total_kg FROM finished_goods "
        "WHERE produced_date=%s AND batch_no=%s ORDER BY product_type_name",
        (DZIEN, PARTIA),
    )


def test_dwa_rodzaje_z_tej_samej_partii_nie_scalaja_sie(db):
    _zapisz(_wpis(product_type_id="pt-udo", product_type_name="KEBAB UDO 100%"), 30)
    _zapisz(_wpis(product_type_id="pt-mix", product_type_name="KEBAB MIX 95/5"), 68)

    wiersze = _wiersze()
    assert len(wiersze) == 2, "rodzaje zlały się w jeden wiersz"
    assert [w["product_type_name"] for w in wiersze] == [
        "KEBAB MIX 95/5", "KEBAB UDO 100%",
    ]
    ile = {w["product_type_name"]: int(w["qty"]) for w in wiersze}
    assert ile == {"KEBAB UDO 100%": 30, "KEBAB MIX 95/5": 68}


def test_ten_sam_rodzaj_nadal_dopisuje_sie_do_jednego_wiersza(db):
    """Dosypywanie tego samego SKU ma dalej trafiać w istniejący wiersz —
    inaczej magazyn zamieniłby się w listę pojedynczych zapisów."""
    _zapisz(_wpis(), 12)
    _zapisz(_wpis(), 18)

    wiersze = _wiersze()
    assert len(wiersze) == 1
    assert int(wiersze[0]["qty"]) == 30
    assert float(wiersze[0]["total_kg"]) == pytest.approx(750.0)
