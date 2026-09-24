import json
import re
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.recipes import RecipeCreate, RecipeIngredientDto
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _load_ingredients(conn, recipe_id: str) -> List[Dict]:
    # ORDER BY seq — bez tego Postgres nie gwarantuje kolejności wierszy;
    # operator ma widzieć przyprawy w TEJ SAMEJ kolejności, w jakiej
    # planista je dodał do receptury (spójność z wydrukiem planu).
    return cx_query_all(
        conn,
        """
        SELECT ri.*, COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
        ORDER BY ri.seq
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


def _validate_components(dto: RecipeCreate) -> str:
    """Skład produkcyjny (JSON dla kolumny recipes.components).
    Udziały muszą sumować się do 100% (z tolerancją zaokrągleń)."""
    comps = [c for c in (dto.components or []) if float(c.pct or 0) > 0]
    if comps:
        total = sum(float(c.pct) for c in comps)
        if abs(total - 100.0) > 0.5:
            raise HTTPException(
                400, f"Udziały komponentów muszą sumować się do 100% (jest {total:g}%)"
            )
    return json.dumps([
        {
            "materialTypeId": c.material_type_id,
            "materialName": c.material_name,
            "pct": float(c.pct),
        }
        for c in comps
    ])


def create_recipe(dto: RecipeCreate) -> Dict:
    auto_output = round(
        100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3
    )
    components_json = _validate_components(dto)
    with transaction() as conn:
        row = cx_query_one(
            conn,
            """
            INSERT INTO recipes
                (id, name, product_type_id, product_type_name,
                 total_output_per_100kg, shelf_life_days, mixing_minutes, active, notes,
                 components, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,true,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.name,
                dto.product_type_id or None,
                dto.product_type_name,
                auto_output,
                dto.shelf_life_days,
                _minuty_masowania(dto),
                dto.notes or None,
                components_json,
                now_iso(),
            ),
        )
        for seq, ing in enumerate(dto.ingredients):
            name, unit = _enrich_ingredient(conn, ing)
            cx_execute(
                conn,
                """
                INSERT INTO recipe_ingredients
                    (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg, seq)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (cuid(), row["id"], ing.ingredient_id, name, unit, ing.qty_per_100kg, seq),
            )
        row["ingredients"] = _load_ingredients(conn, row["id"])
        logger.info("recipe.created", extra={"recipe_id": row["id"], "recipe_name": dto.name})
        return row


def _minuty_masowania(dto: RecipeCreate) -> Optional[int]:
    """Czas masowania receptury albo None (= standardowe 50 minut w masowni).

    Zero i wartości ujemne odrzucamy do None: „0 minut" znaczyłoby dla panelu
    wsad gotowy do odbioru w chwili załadunku.
    """
    m = dto.mixing_minutes
    return int(m) if m is not None and int(m) > 0 else None


def update_recipe(recipe_id: str, dto: RecipeCreate) -> Dict:
    auto_output = round(
        100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3
    )
    components_json = _validate_components(dto)
    with transaction() as conn:
        cx_execute(
            conn,
            """
            UPDATE recipes
            SET name=%s, product_type_id=%s, product_type_name=%s,
                total_output_per_100kg=%s, shelf_life_days=%s, mixing_minutes=%s, notes=%s,
                components=%s, updated_at=%s
            WHERE id=%s
            """,
            (
                dto.name,
                dto.product_type_id or None,
                dto.product_type_name,
                auto_output,
                dto.shelf_life_days,
                _minuty_masowania(dto),
                dto.notes or None,
                components_json,
                now_iso(),
                recipe_id,
            ),
        )
        cx_execute(conn, "DELETE FROM recipe_ingredients WHERE recipe_id=%s", (recipe_id,))
        for seq, ing in enumerate(dto.ingredients):
            name, unit = _enrich_ingredient(conn, ing)
            cx_execute(
                conn,
                """
                INSERT INTO recipe_ingredients
                    (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg, seq)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (cuid(), recipe_id, ing.ingredient_id, name, unit, ing.qty_per_100kg, seq),
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


_SUFIKS_KOPII = re.compile(r"\((\d+)\)\s*$")


def _nazwa_kopii(conn, nazwa: str) -> str:
    """„KIRMIZI" → „KIRMIZI(1)"; gdy ta jest zajęta, kolejny wolny numer.

    Numerujemy od nazwy BAZOWEJ, więc duplikat duplikatu daje „KIRMIZI(2)",
    a nie „KIRMIZI(1)(1)" — po kilku kopiach to drugie jest nie do czytania.

    Nazwy czytamy w całości zamiast filtrować LIKE-iem: receptur są dziesiątki,
    a `%` albo `_` w nazwie robi z LIKE wieloznacznik i cicho zmienia wynik.
    """
    baza = _SUFIKS_KOPII.sub("", nazwa or "").strip()
    zajete = {r["name"] for r in cx_query_all(conn, "SELECT name FROM recipes")}
    n = 1
    while f"{baza}({n})" in zajete:
        n += 1
    return f"{baza}({n})"


def duplicate_recipe(recipe_id: str) -> Dict:
    """Kopia receptury pod nową nazwą — z przyprawami i składem produkcyjnym.

    Właściciel 24.09.2026: receptury różnią się często jednym składnikiem,
    a przepisywanie kilkunastu przypraw ręcznie to proszenie się o literówkę
    w gramaturze.

    Kolumny wyliczamy WPROST, nie przez `SELECT *` → `INSERT`: `recipes.code`
    ma unikalny indeks, więc skopiowany kod albo wywaliłby zapis, albo (gdyby
    indeks kiedyś zniknął) wskazywał w katalogu wyrobów dwie różne receptury.
    Kod nadaje się osobno, tak samo jak przy zakładaniu receptury.
    """
    with transaction() as conn:
        src = cx_query_one(conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,))
        if not src:
            raise HTTPException(404, "Receptura nie znaleziona")

        nowy = cuid()
        row = cx_query_one(
            conn,
            """
            INSERT INTO recipes
                (id, name, product_type_id, product_type_name,
                 total_output_per_100kg, shelf_life_days, mixing_minutes, active, notes,
                 components, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,true,%s,%s,%s)
            RETURNING *
            """,
            (
                nowy,
                _nazwa_kopii(conn, src["name"]),
                src["product_type_id"],
                src["product_type_name"],
                src["total_output_per_100kg"],
                src["shelf_life_days"],
                src["mixing_minutes"],
                src["notes"],
                json.dumps(src["components"] or []),
                now_iso(),
            ),
        )
        # `seq` przepisujemy z oryginału, a nie numerujemy od nowa: kolejność
        # składników jest znacząca (woda ZAWSZE ostatnia) i tak samo trafia
        # na wydruk planu masowania.
        for ing in cx_query_all(
            conn,
            "SELECT * FROM recipe_ingredients WHERE recipe_id=%s ORDER BY seq",
            (recipe_id,),
        ):
            cx_execute(
                conn,
                """
                INSERT INTO recipe_ingredients
                    (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg, seq)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (cuid(), nowy, ing["ingredient_id"], ing["ingredient_name"],
                 ing["unit"], ing["qty_per_100kg"], ing["seq"]),
            )

        row["ingredients"] = _load_ingredients(conn, nowy)
        logger.info("recipe.duplicated",
                    extra={"recipe_id": nowy, "zrodlo_receptury": recipe_id})
        return row


def calculate_recipe(recipe_id: str, kg: float) -> Dict:
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,))
    if not recipe:
        raise HTTPException(404, "Receptura nie znaleziona")
    ingredients = query_all(
        "SELECT * FROM recipe_ingredients WHERE recipe_id=%s ORDER BY seq", (recipe_id,)
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
