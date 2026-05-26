"""Kalkulacja ceny 1 kg wyrobu wg receptury.

Hybryda: średnie z realnych danych (nadpisywalne w zapytaniu) + parametry z app_settings.
Ceny składników/opakowań z OSTATNIEJ faktury danej pozycji (po ingredient_id/packaging_id).
Brak ceny → pozycja pokazana, ale niedoliczona, z flagą missingPrice.

Wzór (potwierdzony z użytkownikiem):
  koszt_mięsa/kg = (cena_ćwiartki + akord/kg_ćwiartki − %grzb×cena_grzb − %kości×cena_kości) / uzysk
  koszt_wsadu/100kg = 100 × koszt_mięsa/kg + Σ(skł.qty_per_100kg × cena_jedn)
  koszt_1kg (bez opak.) = koszt_wsadu / total_output_per_100kg + koszt_zakładu
  opakowanie/kg = Σ(cena_opakowania) / kg_na_sztukę
Akord liczony OD kg pobranej ćwiartki → w przeliczeniu na mięso dzielony przez uzysk.
"""
import json
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.models.cost import CostParams

logger = get_logger(__name__)

COST_PARAMS_KEY = "cost_params"
_DEFAULTS = {"backsPrice": 0.50, "bonesPrice": 0.02, "plantPerKg": 2.00}
_WINDOWS = {"all": None, "today": 1, "7d": 7, "30d": 30}


def _f(v, default: float = 0.0) -> float:
    """Bezpieczna konwersja Decimal/None/str → float."""
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _normalize_window(window: Optional[str]) -> str:
    key = (window or "all").strip().lower()
    if key not in _WINDOWS:
        raise HTTPException(400, "Nieprawidłowy zakres cen")
    return key


def _window_sql(date_expr: str, window: str) -> str:
    if window == "today":
        return f" AND {date_expr} = CURRENT_DATE"
    if window == "7d":
        return f" AND {date_expr} >= CURRENT_DATE - INTERVAL '6 days'"
    if window == "30d":
        return f" AND {date_expr} >= CURRENT_DATE - INTERVAL '29 days'"
    return ""


# ── Parametry (app_settings) ───────────────────────────────────────────
def get_params() -> Dict:
    row = query_one("SELECT value FROM app_settings WHERE key=%s", (COST_PARAMS_KEY,))
    val: Dict = {}
    if row:
        val = row["value"]
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = {}
    return {**_DEFAULTS, **(val or {})}


def save_params(dto: CostParams) -> Dict:
    payload = {
        "backsPrice": dto.backs_price,
        "bonesPrice": dto.bones_price,
        "plantPerKg": dto.plant_per_kg,
    }
    execute(
        """INSERT INTO app_settings (key, value, updated_at)
           VALUES (%s, %s::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        (COST_PARAMS_KEY, json.dumps(payload)),
    )
    logger.info("cost.params.saved")
    return payload


# ── Średnie z realnych danych ──────────────────────────────────────────
def get_averages(window: Optional[str] = None) -> Dict:
    window_key = _normalize_window(window)
    q = query_one(
        f"""SELECT COUNT(*) AS rows,
                   SUM(price_per_kg * kg_received) / NULLIF(SUM(kg_received), 0) AS v
           FROM raw_batches
           WHERE price_per_kg > 0 AND kg_received > 0
             {_window_sql("COALESCE(received_date, created_at::date)", window_key)}"""
    )
    quarter_price = round(_f(q and q.get("v")), 4)

    a = query_one(
        """SELECT AVG(rate_per_kg) AS v FROM workers
           WHERE active = true AND rate_per_kg > 0
             AND (LOWER(role) LIKE %s OR LOWER(role) LIKE %s)""",
        ("%rozb%", "%debon%"),
    )
    akord = round(_f(a and a.get("v")), 4)

    d = query_one(
        f"""SELECT COUNT(*) AS rows,
                  SUM(kg_meat) AS meat, SUM(kg_backs) AS backs,
                  SUM(kg_bones) AS bones, SUM(kg_quarter) AS quarter,
                  AVG(NULLIF(yield_pct, 0)) AS avg_yield
           FROM deboning_entries
           WHERE kg_quarter > 0
             {_window_sql("created_at::date", window_key)}"""
    )
    quarter_sum = _f(d and d.get("quarter"))
    if quarter_sum > 0:
        yield_pct = round(_f(d.get("meat")) / quarter_sum * 100, 2)
        backs_pct = round(_f(d.get("backs")) / quarter_sum * 100, 2)
        bones_pct = round(_f(d.get("bones")) / quarter_sum * 100, 2)
    else:
        yield_pct = round(_f(d and d.get("avg_yield")), 2)
        backs_pct = 0.0
        bones_pct = 0.0

    result = {
        "quarterPrice": quarter_price,
        "akord": akord,
        "yieldPct": yield_pct,
        "backsPct": backs_pct,
        "bonesPct": bones_pct,
    }
    if window_key == "all":
        return result

    fallback = get_averages("all")
    if int(q.get("rows") or 0) == 0:
        result["quarterPrice"] = fallback["quarterPrice"]
    if int(d.get("rows") or 0) == 0:
        result["yieldPct"] = fallback["yieldPct"]
        result["backsPct"] = fallback["backsPct"]
        result["bonesPct"] = fallback["bonesPct"]
    return result


def _invoice_price(category: str, id_col: str, id_val: str, window: str) -> Optional[float]:
    """Cena jednostkowa danej pozycji z wybranego zakresu dat z fallbackiem do all-time."""
    if not id_val:
        return None
    row = query_one(
        f"""SELECT COUNT(*) AS rows,
                   SUM(unit_price * CASE WHEN COALESCE(qty, 0) > 0 THEN qty ELSE 1 END)
                     / NULLIF(SUM(CASE WHEN COALESCE(qty, 0) > 0 THEN qty ELSE 1 END), 0) AS avg_price
            FROM invoices
            WHERE category = %s AND {id_col} = %s AND unit_price > 0
              {_window_sql("COALESCE(invoice_date, created_at::date)", window)}""",
        (category, id_val),
    )
    if row and int(row.get("rows") or 0) > 0 and row.get("avg_price") is not None:
        return _f(row.get("avg_price"))
    if window != "all":
        return _invoice_price(category, id_col, id_val, "all")
    latest = query_one(
        f"""SELECT unit_price FROM invoices
            WHERE category = %s AND {id_col} = %s AND unit_price > 0
            ORDER BY invoice_date DESC NULLS LAST, created_at DESC
            LIMIT 1""",
        (category, id_val),
    )
    return _f(latest.get("unit_price")) if latest else None


def list_recipe_price_overview() -> List[Dict]:
    recipes = query_all(
        "SELECT id, name, product_type_name, total_output_per_100kg FROM recipes WHERE active = true ORDER BY name"
    )
    out: List[Dict] = []
    for recipe in recipes:
        prices: Dict[str, Dict] = {}
        for window in ("today", "7d", "30d"):
            calc = compute_recipe_cost(recipe["id"], {"window": window})
            prices[window] = {
                "costPerKg": round(_f(calc.get("costPerKgBase")), 4),
                "hasMissingPrice": bool(calc.get("hasMissingPrice")),
            }
        out.append(
            {
                "recipeId": recipe["id"],
                "recipeName": recipe.get("name"),
                "productTypeName": recipe.get("product_type_name"),
                "totalOutputPer100kg": round(_f(recipe.get("total_output_per_100kg"), 100.0), 3),
                "prices": prices,
            }
        )
    return out


# ── Kalkulacja ─────────────────────────────────────────────────────────
def compute_recipe_cost(recipe_id: str, ov: Dict) -> Dict:
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,))
    if not recipe:
        raise HTTPException(404, "Receptura nie znaleziona")
    ings = query_all(
        "SELECT * FROM recipe_ingredients WHERE recipe_id=%s ORDER BY ingredient_name",
        (recipe_id,),
    )

    window = _normalize_window(str(ov.get("window") or "all"))
    avg = get_averages(window)
    params = get_params()

    def pick(key: str, src: Dict, src_key: str) -> float:
        v = ov.get(key)
        return _f(v) if v is not None else _f(src.get(src_key))

    quarter_price = pick("quarterPrice", avg, "quarterPrice")
    akord = pick("akord", avg, "akord")
    yield_pct = pick("yieldPct", avg, "yieldPct")
    backs_pct = pick("backsPct", avg, "backsPct")
    bones_pct = pick("bonesPct", avg, "bonesPct")
    backs_price = pick("backsPrice", params, "backsPrice")
    bones_price = pick("bonesPrice", params, "bonesPrice")
    plant_per_kg = pick("plantPerKg", params, "plantPerKg")

    net_quarter = (
        quarter_price + akord
        - (backs_pct / 100.0) * backs_price
        - (bones_pct / 100.0) * bones_price
    )
    meat_cost_per_kg = net_quarter / (yield_pct / 100.0) if yield_pct > 0 else 0.0
    meat_cost_100 = meat_cost_per_kg * 100.0

    ing_lines: List[Dict] = []
    ing_total_100 = 0.0
    any_missing = False
    for ing in ings:
        qty = _f(ing.get("qty_per_100kg"))
        price = _invoice_price(
            "PRZYPRAWY_I_DODATKI", "ingredient_id", ing.get("ingredient_id") or "", window
        )
        missing = price is None
        cost = round(qty * price, 4) if price is not None else 0.0
        if missing:
            any_missing = True
        else:
            ing_total_100 += cost
        ing_lines.append({
            "ingredientId": ing.get("ingredient_id"),
            "name": ing.get("ingredient_name"),
            "unit": ing.get("unit"),
            "qtyPer100kg": qty,
            "unitPrice": price,
            "costPer100kg": cost,
            "missingPrice": missing,
        })

    output = _f(recipe.get("total_output_per_100kg")) or 100.0
    wsad_100 = meat_cost_100 + ing_total_100
    cost_per_kg_base = (wsad_100 / output if output > 0 else 0.0) + plant_per_kg

    pkg_lines: List[Dict] = []
    pkg_unit_sum = 0.0
    pkg_missing = False
    pkg_ids = ov.get("packagingIds") or []
    kg_per_unit = _f(ov.get("kgPerUnit"))
    for pid in pkg_ids:
        prow = query_one("SELECT id, name FROM packaging WHERE id=%s", (pid,))
        price = _invoice_price("OPAKOWANIA_TULEJE", "packaging_id", pid, window)
        missing = price is None
        if missing:
            pkg_missing = True
        else:
            pkg_unit_sum += price
        pkg_lines.append({
            "packagingId": pid,
            "name": prow.get("name") if prow else pid,
            "unitPrice": price,
            "missingPrice": missing,
        })
    packaging_per_kg = (pkg_unit_sum / kg_per_unit) if kg_per_unit > 0 else 0.0
    cost_per_kg_total = cost_per_kg_base + packaging_per_kg

    return {
        "recipeId": recipe_id,
        "recipeName": recipe.get("name"),
        "productTypeName": recipe.get("product_type_name"),
        "window": window,
        "outputPer100kg": round(output, 3),
        "params": {
            "quarterPrice": round(quarter_price, 4),
            "akord": round(akord, 4),
            "yieldPct": round(yield_pct, 2),
            "backsPct": round(backs_pct, 2),
            "bonesPct": round(bones_pct, 2),
            "backsPrice": round(backs_price, 4),
            "bonesPrice": round(bones_price, 4),
            "plantPerKg": round(plant_per_kg, 4),
        },
        "meatCostPerKg": round(meat_cost_per_kg, 4),
        "meatCostPer100kg": round(meat_cost_100, 2),
        "ingredients": ing_lines,
        "ingredientsCostPer100kg": round(ing_total_100, 2),
        "plantPerKg": round(plant_per_kg, 4),
        "costPerKgBase": round(cost_per_kg_base, 4),
        "packaging": pkg_lines,
        "packagingPerKg": round(packaging_per_kg, 4),
        "kgPerUnit": kg_per_unit,
        "costPerKgWithPackaging": round(cost_per_kg_total, 4),
        "hasMissingPrice": any_missing or pkg_missing,
    }
