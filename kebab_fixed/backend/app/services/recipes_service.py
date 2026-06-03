from typing import Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.recipes import RecipeCreate, RecipeIngredientDto
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _load_ingredients(conn, recipe_id: str) -> List[Dict]:
    return cx_query_all(
        conn,
        """
        SELECT ri.*, COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
        """,
        (recipe_id,),
    )


def _enrich_ingredient(conn, ing: RecipeIngredientDto) -> tuple:
    name = ing.ingredient_name
    unit = ing.unit
    if not name or not unit or unit == "kg":
        row = cx_query_one(
            conn, "SELECT name, unit FROM ingredients WHERE id=%s", (ing.ingredient_id,)
        )
        if row:
            name = row["name"]
            unit = row["unit"]
    return name, unit


def list_recipes() -> List[Dict]:
    with transaction() as conn:
        recipes = cx_query_all(
            conn, "SELECT * FROM recipes WHERE active = true ORDER BY name"
        )
        for r in recipes:
            r["ingredients"] = _load_ingredients(conn, r["id"])
        return recipes


def get_recipe(recipe_id: str) -> Dict:
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,))
        if not row:
            raise HTTPException(404, "Receptura nie znaleziona")
        row["ingredients"] = _load_ingredients(conn, row["id"])
        return row


def create_recipe(dto: RecipeCreate) -> Dict:
    auto_output = round(
        100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3
    )
    with transaction() as conn:
        row = cx_query_one(
            conn,
            """
            INSERT INTO recipes
                (id, name, product_type_id, product_type_name,
                 total_output_per_100kg, shelf_life_days, active, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,true,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.name,
                dto.product_type_id or None,
                dto.product_type_name,
                auto_output,
                dto.shelf_life_days,
                dto.notes or None,
                now_iso(),
            ),
        )
        for ing in dto.ingredients:
            name, unit = _enrich_ingredient(conn, ing)
            cx_execute(
                conn,
                """
                INSERT INTO recipe_ingredients
                    (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (cuid(), row["id"], ing.ingredient_id, name, unit, ing.qty_per_100kg),
            )
        row["ingredients"] = _load_ingredients(conn, row["id"])
        logger.info("recipe.created", extra={"recipe_id": row["id"], "recipe_name": dto.name})
        return row


def update_recipe(recipe_id: str, dto: RecipeCreate) -> Dict:
    auto_output = round(
        100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3
    )
    with transaction() as conn:
        cx_execute(
            conn,
            """
            UPDATE recipes
            SET name=%s, product_type_id=%s, product_type_name=%s,
                total_output_per_100kg=%s, shelf_life_days=%s, notes=%s, updated_at=%s
            WHERE id=%s
            """,
            (
                dto.name,
                dto.product_type_id or None,
                dto.product_type_name,
                auto_output,
                dto.shelf_life_days,
                dto.notes or None,
                now_iso(),
                recipe_id,
            ),
        )
        cx_execute(conn, "DELETE FROM recipe_ingredients WHERE recipe_id=%s", (recipe_id,))
        for ing in dto.ingredients:
            name, unit = _enrich_ingredient(conn, ing)
            cx_execute(
                conn,
                """
                INSERT INTO recipe_ingredients
                    (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (cuid(), recipe_id, ing.ingredient_id, name, unit, ing.qty_per_100kg),
            )
        row = cx_query_one(conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,))
        if not row:
            raise HTTPException(404, "Receptura nie znaleziona")
        row["ingredients"] = _load_ingredients(conn, recipe_id)
        logger.info("recipe.updated", extra={"recipe_id": recipe_id})
        return row


def deactivate_recipe(recipe_id: str) -> None:
    with transaction() as conn:
        cx_execute(conn, "UPDATE recipes SET active=false WHERE id=%s", (recipe_id,))
        logger.info("recipe.deactivated", extra={"recipe_id": recipe_id})


def calculate_recipe(recipe_id: str, kg: float) -> Dict:
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,))
    if not recipe:
        raise HTTPException(404, "Receptura nie znaleziona")
    ingredients = query_all(
        "SELECT * FROM recipe_ingredients WHERE recipe_id=%s", (recipe_id,)
    )
    factor = kg / 100.0
    return {
        "recipe_id": recipe_id,
        "kg": kg,
        "ingredients": [
            {**ing, "qty_needed": round(float(ing["qty_per_100kg"]) * factor, 3)}
            for ing in ingredients
        ],
    }


def calc_kg_output(recipe_id: Optional[str], kg_meat: float) -> float:
    """Yield = meat + kg/L ingredients. g/ml ingredients are negligible."""
    if not recipe_id or kg_meat <= 0:
        return round(kg_meat, 3)
    ings = query_all(
        """
        SELECT ri.qty_per_100kg, ri.unit, COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
        """,
        (recipe_id,),
    )
    additional = sum(
        float(ing.get("qty_per_100kg") or 0) * kg_meat / 100
        for ing in ings
        if (ing.get("unit") or "").lower() in ("kg", "l") or ing.get("is_unlimited")
    )
    return round(kg_meat + additional, 3)
