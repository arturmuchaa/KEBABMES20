"""Recipe endpoints."""
from fastapi import APIRouter, Query

from app.models.recipes import RecipeCreate
from app.services import recipes_service as svc

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("")
def list_recipes():
    return svc.list_recipes()


@router.get("/{recipe_id}")
def get_recipe(recipe_id: str):
    return svc.get_recipe(recipe_id)


@router.post("")
def create_recipe(dto: RecipeCreate):
    return svc.create_recipe(dto)


@router.put("/{recipe_id}")
def update_recipe(recipe_id: str, dto: RecipeCreate):
    return svc.update_recipe(recipe_id, dto)


@router.patch("/{recipe_id}/deactivate")
def deactivate_recipe(recipe_id: str):
    svc.deactivate_recipe(recipe_id)
    return {"ok": True}


@router.get("/{recipe_id}/calculate")
def calculate_recipe(recipe_id: str, kg: float = Query(100)):
    return svc.calculate_recipe(recipe_id, kg)
