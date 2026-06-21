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
        else:                       # filet/indyk 1:1
            need_raw = round(float(need), 3)
        avail_raw = float((stock_by_type or {}).get(raw_type, 0.0))
        rows.append({
            "raw_type_id": raw_type,
            "raw_name": name_of.get(raw_type, raw_type),
            "kg_needed_raw": need_raw,
            "kg_available": round(avail_raw, 3),
            "kg_net_shortage": round(max(0.0, need_raw - avail_raw), 3),
        })
    return rows
