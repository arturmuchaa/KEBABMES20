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


def list_recipes(archived: bool = False) -> List[Dict]:
    """Aktywne receptury albo — `archived=True` — wycofane (do przywrócenia)."""
    with transaction() as conn:
        recipes = cx_query_all(
            conn, "SELECT * FROM recipes WHERE active = %s ORDER BY name", (not archived,)
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


# Zamówienie „otwarte" i masowanie „niedokończone" — te same definicje co
# w pokryciu zamówień i planie masowania.
_OTWARTE_ZAMOWIENIE = "o.status NOT IN ('done', 'cancelled')"
_MASOWANIE_W_TOKU = "status IN ('planned', 'confirmed', 'in_progress')"


def _blokady_wycofania(conn, recipe_id: str) -> List[str]:
    """Powody, dla których receptury nie wolno wycofać — pusta lista = wolno.

    Wycofana receptura znika z list wyboru, a otwarte zamówienie i zaplanowane
    masowanie dalej by jej potrzebowały: biuro nie mogłoby poprawić pozycji,
    a panel masowni szukałby przypraw receptury, której „nie ma".
    """
    powody: List[str] = []
    zam = cx_query_all(
        conn,
        f"""
        SELECT DISTINCT o.order_no
        FROM client_order_lines l JOIN client_orders o ON o.id = l.order_id
        WHERE l.recipe_id = %s AND {_OTWARTE_ZAMOWIENIE}
        ORDER BY o.order_no
        """,
        (recipe_id,),
    )
    if zam:
        nr = ", ".join(z["order_no"] for z in zam[:5]) + (" …" if len(zam) > 5 else "")
        powody.append(f"otwarte zamówienia ({len(zam)}): {nr}")
    mas = cx_query_one(
        conn,
        f"SELECT COUNT(*) AS n FROM mixing_orders WHERE recipe_id = %s AND {_MASOWANIE_W_TOKU}",
        (recipe_id,),
    )
    if mas and int(mas["n"]):
        powody.append(f"niedokończone masowania ({int(mas['n'])})")
    return powody


def deactivate_recipe(recipe_id: str) -> None:
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id FROM recipes WHERE id=%s", (recipe_id,))
        if not row:
            raise HTTPException(404, "Receptura nie znaleziona")
        powody = _blokady_wycofania(conn, recipe_id)
        if powody:
            raise HTTPException(
                409, "Receptura jest w użyciu — " + "; ".join(powody)
                + ". Wycofaj ją po zamknięciu zamówień i masowań.",
            )
        cx_execute(conn, "UPDATE recipes SET active=false, updated_at=%s WHERE id=%s",
                   (now_iso(), recipe_id))
        logger.info("recipe.deactivated", extra={"recipe_id": recipe_id})


def activate_recipe(recipe_id: str) -> Dict:
    """Przywrócenie wycofanej receptury — z tym samym składem i kodem."""
    with transaction() as conn:
        row = cx_query_one(
            conn, "UPDATE recipes SET active=true, updated_at=%s WHERE id=%s RETURNING *",
            (now_iso(), recipe_id),
        )
        if not row:
            raise HTTPException(404, "Receptura nie znaleziona")
        row["ingredients"] = _load_ingredients(conn, recipe_id)
        logger.info("recipe.activated", extra={"recipe_id": recipe_id})
        return row


def _f(v) -> float:
    return round(float(v or 0), 3)


def recipes_usage() -> List[Dict]:
    """Gdzie receptury są dziś w użyciu — jeden przebieg dla całej listy.

    Kolumna „W użyciu" na liście receptur i blokada wycofania biorą to samo
    źródło, więc biuro widzi powód, zanim kliknie „Wycofaj".
    """
    rows = query_all(
        f"""
        SELECT r.id AS recipe_id,
          (SELECT COUNT(DISTINCT o.id) FROM client_order_lines l
             JOIN client_orders o ON o.id = l.order_id
            WHERE l.recipe_id = r.id AND {_OTWARTE_ZAMOWIENIE}) AS open_orders,
          (SELECT COALESCE(SUM(l.total_kg), 0) FROM client_order_lines l
             JOIN client_orders o ON o.id = l.order_id
            WHERE l.recipe_id = r.id AND {_OTWARTE_ZAMOWIENIE}) AS open_orders_kg,
          (SELECT COUNT(*) FROM mixing_orders m
            WHERE m.recipe_id = r.id AND m.{_MASOWANIE_W_TOKU}) AS planned_mixing,
          (SELECT COALESCE(SUM(s.kg_available), 0) FROM seasoned_meat s
            WHERE s.recipe_id = r.id AND s.kg_available > 0) AS seasoned_kg,
          (SELECT COALESCE(SUM(g.qty_available * g.kg_per_unit), 0) FROM finished_goods g
            WHERE g.recipe_id = r.id AND g.qty_available > 0) AS finished_kg,
          (SELECT COUNT(*) FROM product_catalog c
            WHERE c.recipe_id = r.id AND c.active) AS catalog_items,
          (SELECT MAX(s.created_at) FROM seasoned_meat s
            WHERE s.recipe_id = r.id) AS last_mixed_at
        FROM recipes r
        """
    )
    return [
        {
            "recipeId": r["recipe_id"],
            "openOrders": int(r["open_orders"] or 0),
            "openOrdersKg": _f(r["open_orders_kg"]),
            "plannedMixing": int(r["planned_mixing"] or 0),
            "seasonedKg": _f(r["seasoned_kg"]),
            "finishedKg": _f(r["finished_kg"]),
            "catalogItems": int(r["catalog_items"] or 0),
            "lastMixedAt": r["last_mixed_at"].isoformat() if hasattr(r["last_mixed_at"], "isoformat")
            else r["last_mixed_at"],
        }
        for r in rows
    ]


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def recipe_usage(recipe_id: str) -> Dict:
    """Szczegóły użycia jednej receptury: zamówienia, masowania, partie, katalog."""
    if not query_one("SELECT id FROM recipes WHERE id=%s", (recipe_id,)):
        raise HTTPException(404, "Receptura nie znaleziona")
    zamowienia = query_all(
        f"""
        SELECT o.id, o.order_no, o.client_name, o.delivery_date, o.status,
               SUM(l.qty) AS qty, SUM(l.total_kg) AS kg
        FROM client_order_lines l JOIN client_orders o ON o.id = l.order_id
        WHERE l.recipe_id = %s AND {_OTWARTE_ZAMOWIENIE}
        GROUP BY o.id, o.order_no, o.client_name, o.delivery_date, o.status
        ORDER BY o.delivery_date NULLS LAST, o.order_no
        """,
        (recipe_id,),
    )
    masowania = query_all(
        f"""
        SELECT id, order_no, meat_kg, planned_output_kg, status, created_at
        FROM mixing_orders WHERE recipe_id = %s AND {_MASOWANIE_W_TOKU}
        ORDER BY created_at
        """,
        (recipe_id,),
    )
    partie = query_all(
        """
        SELECT id, batch_no, kg_available, expiry_date, created_at
        FROM seasoned_meat WHERE recipe_id = %s AND kg_available > 0
        ORDER BY created_at
        """,
        (recipe_id,),
    )
    katalog = query_all(
        """
        SELECT id, code, product_type_name, packaging_name, kg_per_unit
        FROM product_catalog WHERE recipe_id = %s AND active
        ORDER BY product_type_name, kg_per_unit
        """,
        (recipe_id,),
    )
    with transaction() as conn:
        powody = _blokady_wycofania(conn, recipe_id)
    return {
        "recipeId": recipe_id,
        "orders": [
            {"id": z["id"], "orderNo": z["order_no"], "clientName": z["client_name"] or "",
             "deliveryDate": _iso(z["delivery_date"]), "status": z["status"],
             "qty": int(z["qty"] or 0), "kg": _f(z["kg"])}
            for z in zamowienia
        ],
        "mixing": [
            {"id": m["id"], "orderNo": m["order_no"], "meatKg": _f(m["meat_kg"]),
             "outputKg": _f(m["planned_output_kg"]), "status": m["status"],
             "createdAt": _iso(m["created_at"])}
            for m in masowania
        ],
        "seasoned": [
            {"id": p["id"], "batchNo": p["batch_no"], "kgAvailable": _f(p["kg_available"]),
             "expiryDate": _iso(p["expiry_date"]), "createdAt": _iso(p["created_at"])}
            for p in partie
        ],
        "catalog": [
            {"id": c["id"], "code": c["code"], "productTypeName": c["product_type_name"],
             "packagingName": c["packaging_name"], "kgPerUnit": _f(c["kg_per_unit"])}
            for c in katalog
        ],
        "blockers": powody,
    }


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
