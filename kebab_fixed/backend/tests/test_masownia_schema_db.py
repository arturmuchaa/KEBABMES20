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


def test_numer_pojemnika_jest_z_zakresu_1_6():
    # Numer pojemnika to CAŁA tożsamość odważonych przypraw — etykieta z mokrego
    # pojemnika odpada, więc numer musi być jednym z sześciu istniejących.
    check = query_one(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint "
        "WHERE conname='mixing_spice_carts_cart_no_ck'"
    )
    assert check is not None, "brak strażnika numeru pojemnika"
    assert "1" in check["def"] and "6" in check["def"]
