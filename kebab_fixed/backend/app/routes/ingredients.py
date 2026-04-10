"""Ingredient endpoints."""
from fastapi import APIRouter

from app.models.ingredients import IngredientCreate
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
