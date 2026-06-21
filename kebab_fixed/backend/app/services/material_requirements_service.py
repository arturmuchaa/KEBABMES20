"""Zapotrzebowanie na surowiec dla zamówień (odwrócenie łańcucha produkcji).

Czysta logika (bez DB) + funkcje agregujące z zapytaniami. Łańcuch:
  qty*kg_per_unit = kg_output  →  kg_meat = kg_output/(1+f)  →  podział wg
  components (70/30)  →  surowiec (ćwiartka po yield lub filet 1:1).
"""
import json
from typing import Any, Dict, List, Optional

from app.db import query_all, query_one

MIESO_ZS = "mat-mieso-zs"
CWIARTKA = "mat-cwiartka"
DEFAULT_YIELD_PCT = 70.0
# Mięso z/s powstaje z rozbioru ćwiartki; pozostałe rodzaje przyjmowane 1:1.
MEAT_RAW_SOURCE: Dict[str, str] = {MIESO_ZS: CWIARTKA}


def meat_factor(ingredients: List[Dict[str, Any]]) -> float:
    """f = Σ qty_per_100kg/100 dla składników w kg/L lub is_unlimited."""
    total = 0.0
    for ing in ingredients or []:
        unit = (ing.get("unit") or "").lower()
        if unit in ("kg", "l") or ing.get("is_unlimited"):
            total += float(ing.get("qty_per_100kg") or 0)
    return total / 100.0


def kg_meat_from_output(kg_output: float, ingredients: List[Dict[str, Any]]) -> float:
    """Odwrócenie calc_kg_output: output = kg_meat*(1+f) → kg_meat = output/(1+f)."""
    if kg_output <= 0:
        return 0.0
    f = meat_factor(ingredients)
    return round(kg_output / (1.0 + f), 3)


def _any_pct(components: List[Dict[str, Any]]) -> bool:
    return any(float(c.get("pct") or 0) > 0 for c in components)


def normalize_components(
    components: Optional[List[Dict[str, Any]]],
    fallback_components: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Skład produkcyjny → lista {material_type_id, name, pct}. Pusty (po
    odfiltrowaniu pct<=0) → produkt jednoskładnikowy mięso z/s 100%."""
    raw = components if (components and _any_pct(components)) else (fallback_components or [])
    out: List[Dict[str, Any]] = []
    for c in raw:
        pct = float(c.get("pct") or 0)
        if pct <= 0:
            continue
        out.append({
            "material_type_id": c.get("materialTypeId") or c.get("material_type_id") or MIESO_ZS,
            "name": c.get("name") or "",
            "pct": pct,
        })
    if not out:
        return [{"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 100.0}]
    return out


def _raw_for(meat_type: str) -> str:
    return MEAT_RAW_SOURCE.get(meat_type, meat_type)


def requirements_for_line(
    kg_output: float,
    ingredients: List[Dict[str, Any]],
    components: Optional[List[Dict[str, Any]]],
    fallback_components: Optional[List[Dict[str, Any]]],
    yield_pct: float,
    name_of: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Rozbicie jednej pozycji (kg_output gotowego produktu) na surowiec."""
    kg_meat = kg_meat_from_output(kg_output, ingredients)
    comps = normalize_components(components, fallback_components)
    rows: List[Dict[str, Any]] = []
    for c in comps:
        meat_type = c["material_type_id"]
        kg_meat_comp = round(kg_meat * c["pct"] / 100.0, 3)
        raw_type = _raw_for(meat_type)
        requires_deboning = raw_type != meat_type
        if requires_deboning and yield_pct > 0:
            kg_raw = round(kg_meat_comp / (yield_pct / 100.0), 3)
        else:
            kg_raw = kg_meat_comp
        rows.append({
            "meat_type_id": meat_type,
            "meat_name": c["name"] or name_of.get(meat_type, meat_type),
            "kg_meat": kg_meat_comp,
            "raw_type_id": raw_type,
            "raw_name": name_of.get(raw_type, raw_type),
            "requires_deboning": requires_deboning,
            "kg_raw": kg_raw,
        })
    return rows


def aggregate_meat_need(line_rows: List[List[Dict[str, Any]]]) -> Dict[str, float]:
    """Suma kg mięsa per meat_type po wszystkich pozycjach."""
    out: Dict[str, float] = {}
    for rows in line_rows or []:
        for r in rows:
            mt = r["meat_type_id"]
            out[mt] = round(out.get(mt, 0.0) + float(r["kg_meat"]), 3)
    return out


def compute_net_shortage(
    need_meat_by_type: Dict[str, float],
    stock_by_type: Dict[str, float],
    yield_pct: float,
    name_of: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Niedobór netto surowca vs magazyn. Kaskada dla mięsa z/s: najpierw zużyj
    gotowe mięso z/s, brakującą resztę przelicz na ćwiartkę i odejmij stan
    ćwiartki. Pozostałe rodzaje: potrzeba − stan, 1:1. Netto nieujemne."""
    rows: List[Dict[str, Any]] = []
    for meat_type, need in (need_meat_by_type or {}).items():
        raw_type = _raw_for(meat_type)
        if raw_type != meat_type:  # mięso z/s → ćwiartka
            avail_meat = float((stock_by_type or {}).get(meat_type, 0.0))
            brak_meat = max(0.0, float(need) - avail_meat)
            need_raw = round(brak_meat / (yield_pct / 100.0), 3) if yield_pct > 0 else 0.0
            kg_meat = round(brak_meat, 3)  # ile mięsa z/s da ta ćwiartka
        else:                       # filet/indyk 1:1
            need_raw = round(float(need), 3)
            kg_meat = need_raw
        avail_raw = float((stock_by_type or {}).get(raw_type, 0.0))
        rows.append({
            "raw_type_id": raw_type,
            "raw_name": name_of.get(raw_type, raw_type),
            "kg_needed_raw": need_raw,
            "kg_meat": kg_meat,
            "kg_available": round(avail_raw, 3),
            "kg_net_shortage": round(max(0.0, need_raw - avail_raw), 3),
        })
    return rows


# ── Warstwa DB + orkiestracja ────────────────────────────────────────────
def material_names() -> Dict[str, str]:
    rows = query_all("SELECT id, name FROM raw_material_types")
    return {r["id"]: r["name"] for r in rows}


def recipe_ingredients(recipe_id: str) -> List[Dict[str, Any]]:
    if not recipe_id:
        return []
    return query_all(
        """
        SELECT ri.qty_per_100kg, ri.unit,
               COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
        """,
        (recipe_id,),
    )


def _parse_components(val: Any) -> List[Dict[str, Any]]:
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            return []
    return val if isinstance(val, list) else []


def components_for(product_type_id: str, recipe_id: str):
    """Zwraca (primary, fallback): product_types.components > recipes.components."""
    primary: List[Dict[str, Any]] = []
    fallback: List[Dict[str, Any]] = []
    if product_type_id:
        row = query_one("SELECT components FROM product_types WHERE id = %s", (product_type_id,))
        if row:
            primary = _parse_components(row.get("components"))
    if recipe_id:
        row = query_one("SELECT components FROM recipes WHERE id = %s", (recipe_id,))
        if row:
            fallback = _parse_components(row.get("components"))
    return primary, fallback


def _sum_by_raw(line_rows: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Suma per surowiec: kg_raw (np. ćwiartka) + kg_meat (mięso, które z niego wyjdzie)."""
    agg: Dict[str, Dict[str, Any]] = {}
    for rows in line_rows:
        for r in rows:
            rt = r["raw_type_id"]
            if rt not in agg:
                agg[rt] = {"raw_type_id": rt, "raw_name": r["raw_name"], "kg_raw": 0.0, "kg_meat": 0.0}
            agg[rt]["kg_raw"] = round(agg[rt]["kg_raw"] + float(r["kg_raw"]), 3)
            agg[rt]["kg_meat"] = round(agg[rt]["kg_meat"] + float(r.get("kg_meat") or 0), 3)
    return list(agg.values())


def compute_reduced_need(
    out_by_recipe: Dict[str, float],
    recipe_meta: Dict[str, Dict[str, Any]],
    seasoned_free: Dict[str, float],
    planned_out: Dict[str, float],
    yield_pct: float,
    name_of: Dict[str, str],
):
    """Per receptura: od zapotrzebowania na wyrób (output) odejmij gotowe mięso
    przyprawione (seasoned_free) i output aktywnych planów (planned_out), dopiero
    z reszty policz zapotrzebowanie na mięso. Zwraca (need_meat_by_type, rows)."""
    need: Dict[str, float] = {}
    rows_all: List[List[Dict[str, Any]]] = []
    for rid, out in (out_by_recipe or {}).items():
        reduced = max(0.0, float(out)
                      - float((seasoned_free or {}).get(rid, 0.0))
                      - float((planned_out or {}).get(rid, 0.0)))
        meta = (recipe_meta or {}).get(rid, {})
        rws = requirements_for_line(
            reduced, meta.get("ingredients", []), meta.get("primary", []),
            meta.get("fallback", []), yield_pct, name_of,
        )
        rows_all.append(rws)
        for mt, kg in aggregate_meat_need([rws]).items():
            need[mt] = round(need.get(mt, 0.0) + kg, 3)
    return need, rows_all


def _rows_for_items(items: List[Dict[str, Any]], yield_pct: float, names: Dict[str, str]):
    """items: [{qty, kg_per_unit, recipe_id, product_type_id}] → (flat_lines, per_line_rows)."""
    flat: List[Dict[str, Any]] = []
    per_line: List[List[Dict[str, Any]]] = []
    for idx, it in enumerate(items):
        kg_output = float(it.get("qty") or 0) * float(it.get("kg_per_unit") or 0)
        if kg_output <= 0:
            per_line.append([])
            continue
        ings = recipe_ingredients(it.get("recipe_id") or "")
        primary, fallback = components_for(it.get("product_type_id") or "", it.get("recipe_id") or "")
        rows = requirements_for_line(kg_output, ings, primary, fallback, yield_pct, names)
        for r in rows:
            flat.append({**r, "line_index": idx})
        per_line.append(rows)
    return flat, per_line


def preview_requirements(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    from app.services.settings_service import get_deboning_yield_pct
    yield_pct = get_deboning_yield_pct()
    names = material_names()
    flat, per_line = _rows_for_items(items, yield_pct, names)
    return {"lines": flat, "totals_by_raw": _sum_by_raw(per_line), "yield_pct": yield_pct}


def requirements_for_order(order_id: str, basis: str = "total") -> Dict[str, Any]:
    from app.services.orders_service import get_order
    order = get_order(order_id)
    items: List[Dict[str, Any]] = []
    for ln in order.get("lines", []):
        qty = float(ln.get("qty") or 0)
        if basis == "remaining":
            qty = max(0.0, qty - float(ln.get("qty_done") or 0))
        items.append({
            "qty": qty,
            "kg_per_unit": ln.get("kg_per_unit"),
            "recipe_id": ln.get("recipe_id"),
            "product_type_id": ln.get("product_type_id"),
        })
    return preview_requirements(items)


def _stock_by_type() -> Dict[str, float]:
    """Stan dostępny: ćwiartka z raw_batches(active), mięso z/s+filet+indyk z meat_stock."""
    out: Dict[str, float] = {}
    for r in query_all(
        "SELECT material_type_id, COALESCE(SUM(kg_available),0) AS kg "
        "FROM raw_batches WHERE status='active' GROUP BY material_type_id"
    ):
        out[r["material_type_id"]] = out.get(r["material_type_id"], 0.0) + float(r["kg"] or 0)
    for r in query_all(
        "SELECT material_type_id, COALESCE(SUM(kg_available - COALESCE(kg_reserved,0)),0) AS kg "
        "FROM meat_stock GROUP BY material_type_id"
    ):
        out[r["material_type_id"]] = out.get(r["material_type_id"], 0.0) + float(r["kg"] or 0)
    return out


def seasoned_free_by_recipe() -> Dict[str, float]:
    """Wolne mięso przyprawione per receptura (kg_available − kg_reserved)."""
    out: Dict[str, float] = {}
    for r in query_all(
        "SELECT recipe_id, COALESCE(SUM(kg_available - COALESCE(kg_reserved,0)),0) AS kg "
        "FROM seasoned_meat GROUP BY recipe_id"
    ):
        if r.get("recipe_id"):
            out[r["recipe_id"]] = out.get(r["recipe_id"], 0.0) + float(r["kg"] or 0)
    return out


def active_plan_output_by_recipe() -> Dict[str, float]:
    """Output (kg) zaplanowanej, niewykonanej produkcji z AKTYWNYCH planów
    (status='active' = mięso zarezerwowane), per receptura."""
    out: Dict[str, float] = {}
    for r in query_all(
        """
        SELECT pl.recipe_id,
               COALESCE(SUM((pl.qty - pl.qty_done) * pl.kg_per_unit), 0) AS kg
        FROM production_plan_lines pl
        JOIN production_plans pp ON pp.id = pl.plan_id
        WHERE pp.status = 'active' AND pl.qty > pl.qty_done
        GROUP BY pl.recipe_id
        """
    ):
        if r.get("recipe_id"):
            out[r["recipe_id"]] = out.get(r["recipe_id"], 0.0) + float(r["kg"] or 0)
    return out


def requirements_summary() -> Dict[str, Any]:
    from app.services.settings_service import get_deboning_yield_pct
    from app.services.orders_service import get_order, list_orders
    yield_pct = get_deboning_yield_pct()
    names = material_names()
    total_lines: List[List[Dict[str, Any]]] = []
    remaining_lines: List[List[Dict[str, Any]]] = []
    # Zapotrzebowanie na wyrób (output) per receptura — dla niedoboru netto z pipeline.
    out_by_recipe: Dict[str, float] = {}
    recipe_pt: Dict[str, str] = {}
    for o in list_orders(None):
        if (o.get("status") or "") in ("done", "cancelled"):
            continue
        order = get_order(o["id"])
        items_total, items_rem = [], []
        for ln in order.get("lines", []):
            qty = float(ln.get("qty") or 0)
            rem = max(0.0, qty - float(ln.get("qty_done") or 0))
            rid = ln.get("recipe_id") or ""
            base = {"kg_per_unit": ln.get("kg_per_unit"), "recipe_id": rid,
                    "product_type_id": ln.get("product_type_id")}
            items_total.append({**base, "qty": qty})
            items_rem.append({**base, "qty": rem})
            if rid:
                out_by_recipe[rid] = round(
                    out_by_recipe.get(rid, 0.0) + rem * float(ln.get("kg_per_unit") or 0), 3)
                recipe_pt.setdefault(rid, ln.get("product_type_id") or "")
        _, pl_total = _rows_for_items(items_total, yield_pct, names)
        _, pl_rem = _rows_for_items(items_rem, yield_pct, names)
        total_lines.extend(pl_total)
        remaining_lines.extend(pl_rem)
    # Pipeline: odejmij gotowe przyprawione + output aktywnych planów per receptura.
    recipe_meta: Dict[str, Dict[str, Any]] = {}
    for rid, pt in recipe_pt.items():
        primary, fallback = components_for(pt, rid)
        recipe_meta[rid] = {"ingredients": recipe_ingredients(rid),
                            "primary": primary, "fallback": fallback}
    reduced_need, _ = compute_reduced_need(
        out_by_recipe, recipe_meta,
        seasoned_free_by_recipe(), active_plan_output_by_recipe(),
        yield_pct, names,
    )
    net = compute_net_shortage(reduced_need, _stock_by_type(), yield_pct, names)
    return {
        "total": _sum_by_raw(total_lines),
        "remaining": _sum_by_raw(remaining_lines),
        "net_shortage": net,
        "yield_pct": yield_pct,
    }
