"""Zapotrzebowanie na surowiec dla zamówień (odwrócenie łańcucha produkcji).

Czysta logika (bez DB) + funkcje agregujące z zapytaniami. Łańcuch:
  qty*kg_per_unit = kg_output  →  kg_meat = kg_output/(1+f)  →  podział wg
  components (70/30)  →  surowiec (ćwiartka po yield lub filet 1:1).
"""
from typing import Any, Dict, List, Optional

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
