"""Walidacja partii obowiązkowych w planie dnia masowania."""
import pytest
from fastapi import HTTPException
from app.services.mixing_service import validate_day_plan_item


def _item(**kw):
    base = {"recipeId": "r1", "meatKg": 100,
            "meatLots": [{"meatLotId": "L1", "kgPlanned": 100}]}
    base.update(kw)
    return base


def test_valid_item_passes():
    validate_day_plan_item(_item(), is_untouchable=False)  # nie rzuca


def test_untouchable_skips_lot_check():
    # in_progress/done — partie nietykalne, brak lotów nie jest błędem
    validate_day_plan_item(_item(meatLots=[]), is_untouchable=True)


def test_missing_recipe_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(recipeId=""), is_untouchable=False)
    assert e.value.status_code == 400


def test_zero_kg_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(meatKg=0), is_untouchable=False)
    assert e.value.status_code == 400


def test_missing_lots_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(meatLots=[]), is_untouchable=False)
    assert e.value.status_code == 400


def test_lots_sum_mismatch_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(
            _item(meatKg=100, meatLots=[{"meatLotId": "L1", "kgPlanned": 60}]),
            is_untouchable=False,
        )
    assert e.value.status_code == 400


def test_lots_sum_within_tolerance_passes():
    # tolerancja 0.5 kg — drobne zaokrąglenia OK
    validate_day_plan_item(
        _item(meatKg=100, meatLots=[{"meatLotId": "L1", "kgPlanned": 99.7}]),
        is_untouchable=False,
    )
