"""Schemat panelu masowania — pojemniki z przyprawami i wsady w masownicach."""
import pytest

from app.db import query_all, query_one

pytestmark = pytest.mark.usefixtures("db")


def _kolumny(tabela):
    return {
        r["column_name"]
        for r in query_all(
            "SELECT column_name FROM information_schema.columns WHERE table_name=%s",
            (tabela,),
        )
    }


def test_pojemnik_ma_komplet_kolumn():
    assert {"id", "cart_no", "order_id", "recipe_id", "kg_target", "status",
            "ingredients", "created_at", "dumped_at", "charge_id"} <= _kolumny("mixing_spice_carts")


def test_wsad_ma_komplet_kolumn():
    assert {"id", "order_id", "machine_id", "cart_id", "kg_meat", "water_l",
            "batch_no", "status", "started_at", "finished_at", "session_id"} <= _kolumny("mixing_charges")


def test_sklad_wsadu_ma_komplet_kolumn():
    assert {"id", "charge_id", "pallet_id", "lot_no", "meat_stock_id", "kg"} <= _kolumny("mixing_charge_pallets")


def test_numer_paczki_przypraw_jest_jednorazowy():
    """Przyprawy idą do WORKÓW (18.09.2026), numer leci ciągle od 1.

    Stary strażnik trzymał numer w zakresie 1–6, bo tyle było fizycznych
    pojemników wracających po umyciu. Worek nie wraca, więc numer nie może się
    powtórzyć — tego pilnuje unikalny indeks, a limit 1–6 musiał odpaść.
    """
    assert query_one(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint "
        "WHERE conname='mixing_spice_carts_cart_no_ck'"
    ) is None, "limit 1–6 opisywał pojemniki, nie worki"

    assert query_one(
        "SELECT indexname FROM pg_indexes WHERE indexname='idx_spice_cart_no_nowe'"
    ) is not None, "numer nowej paczki musi być unikalny"


def test_paczka_zapisuje_liczbe_workow():
    assert query_one(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='mixing_spice_carts' AND column_name='bags'"
    ) is not None
