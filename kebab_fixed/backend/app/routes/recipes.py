"""Recipe endpoints."""
from fastapi import APIRouter, Query

from app.models.recipes import RecipeCreate
from app.services import recipes_service as svc

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("")
def list_recipes(archived: bool = Query(False)):
    return svc.list_recipes(archived)


@router.get("/usage")
def recipes_usage():
    """Użycie wszystkich receptur (zamówienia, masowania, stany) — kolumna listy."""
    return svc.recipes_usage()


@router.get("/{recipe_id}")
def get_recipe(recipe_id: str):
    return svc.get_recipe(recipe_id)


@router.post("")
def create_recipe(dto: RecipeCreate):
    return svc.create_recipe(dto)


@router.put("/{recipe_id}")
def update_recipe(recipe_id: str, dto: RecipeCreate):
    return svc.update_recipe(recipe_id, dto)


@router.post("/{recipe_id}/duplicate")
def duplicate_recipe(recipe_id: str):
    """Kopia receptury pod nazwą „…(1)" — receptury różnią się często jednym
    składnikiem, a przepisywanie przypraw ręcznie to literówka w gramaturze."""
    return svc.duplicate_recipe(recipe_id)


@router.patch("/{recipe_id}/deactivate")
def deactivate_recipe(recipe_id: str):
    svc.deactivate_recipe(recipe_id)
    return {"ok": True}


@router.patch("/{recipe_id}/activate")
def activate_recipe(recipe_id: str):
    return svc.activate_recipe(recipe_id)


@router.get("/{recipe_id}/usage")
def recipe_usage(recipe_id: str):
    return svc.recipe_usage(recipe_id)


@router.get("/{recipe_id}/calculate")
def calculate_recipe(recipe_id: str, kg: float = Query(100)):
    return svc.calculate_recipe(recipe_id, kg)
