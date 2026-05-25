"""Kalkulacja kosztu 1 kg wyrobu wg receptury."""
from typing import Optional

from fastapi import APIRouter

from app.models.cost import CostParams
from app.services import cost_service as svc

router = APIRouter(prefix="/api/cost", tags=["cost"])


@router.get("/params")
def get_params():
    return svc.get_params()


@router.put("/params")
def save_params(dto: CostParams):
    return svc.save_params(dto)


@router.get("/averages")
def get_averages():
    return svc.get_averages()


@router.get("/recipe/{recipe_id}")
def recipe_cost(
    recipe_id: str,
    quarterPrice: Optional[float] = None,
    akord: Optional[float] = None,
    yieldPct: Optional[float] = None,
    backsPct: Optional[float] = None,
    bonesPct: Optional[float] = None,
    backsPrice: Optional[float] = None,
    bonesPrice: Optional[float] = None,
    plantPerKg: Optional[float] = None,
    packagingIds: Optional[str] = None,
    kgPerUnit: Optional[float] = None,
):
    ov = {
        "quarterPrice": quarterPrice,
        "akord": akord,
        "yieldPct": yieldPct,
        "backsPct": backsPct,
        "bonesPct": bonesPct,
        "backsPrice": backsPrice,
        "bonesPrice": bonesPrice,
        "plantPerKg": plantPerKg,
        "packagingIds": [p for p in (packagingIds.split(",") if packagingIds else []) if p],
        "kgPerUnit": kgPerUnit,
    }
    return svc.compute_recipe_cost(recipe_id, ov)
