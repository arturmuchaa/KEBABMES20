"""Ingredient endpoints."""
from typing import Optional

from fastapi import APIRouter, Query

from app.models.ingredients import IngredientCreate, IngredientReceptionCreate
from app.services import ingredients_service as svc

router = APIRouter(tags=["ingredients"])


@router.get("/api/ingredients")
def list_ingredients():
    return svc.list_ingredients()


@router.get("/api/ingredients/stock")
def ingredient_stock():
    return svc.ingredient_stock()


@router.post("/api/ingredients")
def create_ingredient(dto: IngredientCreate):
    return svc.create_ingredient(dto)


@router.patch("/api/ingredients/{ingredient_id}/deactivate")
def deactivate_ingredient(ingredient_id: str):
    svc.deactivate_ingredient(ingredient_id)
    return {"ok": True}


@router.get("/api/ingredient-receipts")
def list_ingredient_receipts():
    return svc.list_ingredient_receipts()


@router.post("/api/ingredient-receipts")
def create_ingredient_receipt(body: dict):
    return svc.create_ingredient_receipt(body)


# ─── Przyjęcie DDFiP (przyprawy, dodatki, opakowania) — instrukcja 1.3 oPRP ──
#
# RBAC: bez wpisu w `permissions.py` te trasy wpadają pod domyślne „office" —
# i tak ma być. Przyjęcie artykułów pomocniczych rejestruje BIURO, hala nie ma
# tu czego szukać.


# WAŻNE: /next-number musi stać PRZED trasami z {reception_id}.
@router.get("/api/ingredient-receptions/next-number")
def next_ddfip_number(when: Optional[str] = Query(None, alias="date")):
    """Podpowiedź numeru „DF/1/08" na podany dzień (bez rezerwacji)."""
    return svc.next_ddfip_number(when)


@router.get("/api/ingredient-receptions")
def list_ingredient_receptions(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """Rejestr dostaw DDFiP — źródło karty 1.3.1 (zakres = miesiąc karty)."""
    return svc.list_ingredient_receptions(date_from=date_from, date_to=date_to)


@router.post("/api/ingredient-receptions")
def create_ingredient_reception(dto: IngredientReceptionCreate):
    return svc.create_ingredient_reception(dto)


@router.get("/api/ingredient-receptions/{reception_id}")
def get_ingredient_reception(reception_id: str):
    return svc.get_ingredient_reception(reception_id)
