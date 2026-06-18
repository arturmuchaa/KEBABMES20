"""Pokrycie zamówienia zapasem magazynowym wyrobów gotowych.

Dokumenty z zamówienia (WZ/HDI/CMR) liczą produkcję z linii planu
(`production_plan_lines.client_order_id`). Produkcja "na magazyn" robiona
PRZED zamówieniem nie ma tego linku, mimo że fizycznie pokrywa zamówienie
(widok zamówień liczy ją do qty_done). Ten moduł domyka tę asymetrię:
brakującą część zamówienia uzupełnia porcjami z `finished_goods`
(dopasowanie po recepturze + wadze sztuki), żeby dokumenty dało się
wystawić także dla towaru zrobionego na magazyn.

Kolejność czerpania:
    1. wiersze już ostemplowane TYM zamówieniem (`client_order_no`) —
       liczą się pełnym qty (rozchód mógł już wyzerować qty_available),
    2. wiersze bez zamówienia — tylko qty_available, FIFO po dacie produkcji.

Wiersze powstałe z planów podpiętych pod to zamówienie są wykluczone —
te sztuki są już policzone w qty_done linii planu (anty-dublowanie).
"""
from typing import Any, Dict, List, Tuple

from app.db import query_all

Key = Tuple[str, float]


def _key(recipe_id: Any, kg_per_unit: Any) -> Key:
    return (str(recipe_id or ""), round(float(kg_per_unit or 0), 3))


def produced_by_key_from_plan_lines(plan_lines: List[Dict[str, Any]]) -> Dict[Key, int]:
    """Suma qty_done linii planu per (receptura, waga sztuki)."""
    out: Dict[Key, int] = {}
    for pl in plan_lines or []:
        k = _key(pl.get("recipe_id"), pl.get("kg_per_unit"))
        out[k] = out.get(k, 0) + int(pl.get("qty_done") or 0)
    return out


def compute_shortfalls(
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
    cartoned_by_key: Dict[Key, int] = None,
) -> Dict[Key, int]:
    """Ile sztuk per (receptura, waga) brakuje do pokrycia zamówienia po odjęciu
    produkcji zaraportowanej na planach tego zamówienia ORAZ sztuk już spakowanych
    do kartonów powiązanych z tym zamówieniem (anty-dublowanie z FIFO finished_goods)."""
    short: Dict[Key, int] = {}
    for ln in order_lines or []:
        k = _key(ln.get("recipe_id"), ln.get("kg_per_unit"))
        short[k] = short.get(k, 0) + int(ln.get("qty") or 0)
    for k, done in (produced_by_key or {}).items():
        if k in short:
            short[k] = short[k] - int(done or 0)
    for k, packed in (cartoned_by_key or {}).items():
        if k in short:
            short[k] = short[k] - int(packed or 0)
    return {k: v for k, v in short.items() if v > 0}


def portion_stock_rows(
    shortfalls: Dict[Key, int],
    fg_rows: List[Dict[str, Any]],
    order_no: str,
) -> List[Dict[str, Any]]:
    """Rozbij braki na porcje z wierszy finished_goods (w podanej kolejności).

    Wiersz ostemplowany tym zamówieniem wnosi swoje pełne ``qty`` (już
    rozdysponowane pod to zamówienie), pozostałe tylko ``qty_available``.
    Zwraca ``[{"fg": wiersz, "take": szt}]``.
    """
    remaining = dict(shortfalls or {})
    portions: List[Dict[str, Any]] = []
    for row in fg_rows or []:
        k = _key(row.get("recipe_id"), row.get("kg_per_unit"))
        need = int(remaining.get(k) or 0)
        if need <= 0:
            continue
        if order_no and (row.get("client_order_no") or "").strip() == order_no:
            pool = int(row.get("qty") or 0)
        else:
            pool = int(row.get("qty_available") or 0)
        take = min(need, pool)
        if take <= 0:
            continue
        portions.append({"fg": row, "take": take})
        remaining[k] = need - take
    return portions


def stock_portions_for_order(
    order_id: str,
    order_no: str,
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
) -> List[Dict[str, Any]]:
    """Porcje magazynowe pokrywające braki zamówienia (patrz moduł)."""
    # Sztuki spakowane do kartonów powiązanych z tym zamówieniem już je pokrywają —
    # wyklucz je z FIFO finished_goods, żeby nie liczyć ich drugi raz.
    cartoned_rows = query_all(
        """
        SELECT fu.recipe_id, fu.weight_kg, COUNT(*) AS qty
        FROM finished_units fu
        JOIN stock_cartons sc ON sc.id = fu.carton_id
        WHERE sc.linked_order_id = %s AND fu.status IN ('packed', 'shipped')
        GROUP BY fu.recipe_id, fu.weight_kg
        """,
        (order_id,),
    )
    cartoned_by_key = {
        _key(r["recipe_id"], r["weight_kg"]): int(r["qty"]) for r in cartoned_rows
    }
    shortfalls = compute_shortfalls(order_lines, produced_by_key, cartoned_by_key)
    if not shortfalls:
        return []
    fg_rows = query_all(
        """
        SELECT id, batch_no, recipe_id, recipe_name, product_type_name,
               kg_per_unit, qty, qty_available, qty_shipped,
               client_order_no, client_name, produced_date, created_at
        FROM finished_goods
        WHERE COALESCE(qty, 0) > 0
          AND (client_order_no = %s OR COALESCE(client_order_no, '') = '')
          AND COALESCE(source_production_id, '') NOT IN (
              SELECT DISTINCT pl.plan_id FROM production_plan_lines pl
              WHERE pl.client_order_id = %s)
        ORDER BY (client_order_no = %s) DESC,
                 produced_date ASC NULLS LAST, created_at ASC
        """,
        (order_no, order_id, order_no),
    )
    return portion_stock_rows(shortfalls, fg_rows, order_no)
