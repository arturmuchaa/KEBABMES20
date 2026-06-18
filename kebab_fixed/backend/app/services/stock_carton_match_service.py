"""Dopasowanie kartonu magazynowego (finished_goods na magazyn) do zamówienia.

Karton magazynowy wiąże się z linią zamówienia tylko przy pełnej zgodności:
klient + receptura + rodzaj (product_type) + tuleja (packaging) + waga (kg_per_unit).
System sugeruje, biuro zatwierdza (patrz finished_goods_service.assign_stock_carton_to_order).
"""
from typing import Any, Dict, List

from app.db import query_all, query_one


def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


def _line_matches(carton: Dict[str, Any], order_client_id: str, line: Dict[str, Any]) -> bool:
    return (
        (carton.get("client_id") or "") == (order_client_id or "")
        and (carton.get("recipe_id") or "") == (line.get("recipe_id") or "")
        and (carton.get("product_type_id") or "") == (line.get("product_type_id") or "")
        and (carton.get("packaging_id") or "") == (line.get("packaging_id") or "")
        and _kg(carton.get("kg_per_unit")) == _kg(line.get("kg_per_unit"))
    )


def match_cartons(
    order_client_id: str,
    order_lines: List[Dict[str, Any]],
    cartons: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Czysta logika dopasowania. Zwraca jedną sugestię na karton, podpiętą do
    pierwszej pasującej linii zamówienia."""
    out: List[Dict[str, Any]] = []
    for c in cartons:
        if int(c.get("qty_available") or 0) <= 0:
            continue
        line = next((ln for ln in order_lines if _line_matches(c, order_client_id, ln)), None)
        if not line:
            continue
        out.append({
            "cartonId": c["id"],
            "cartonNo": c.get("carton_no"),
            "orderLineId": line["id"],
            "qty": int(c.get("qty_available") or 0),
            "kgPerUnit": _kg(c.get("kg_per_unit")),
            "batchNo": c.get("batch_no") or "",
            "productTypeName": c.get("product_type_name") or "",
            "recipeName": c.get("recipe_name") or "",
            "packagingName": c.get("packaging_name") or "",
        })
    return out


def suggestions_for_order(order_id: str) -> List[Dict[str, Any]]:
    """Pasujące kartony magazynowe (stock_cartons) dla zamówienia.

    Bierze kartony niezwiązane z żadnym zamówieniem (linked_order_id NULL),
    dopasowane po client_id + recipe_id + product_type_id + packaging_id + kg_per_unit.
    """
    order = query_one(
        "SELECT id, client_id FROM client_orders WHERE id=%s", (order_id,)
    )
    if not order:
        return []
    lines = query_all(
        "SELECT id, recipe_id, product_type_id, packaging_id, kg_per_unit, qty "
        "FROM client_order_lines WHERE order_id=%s",
        (order_id,),
    )
    cartons = query_all(
        """
        SELECT id, carton_no, client_id, recipe_id, product_type_id, packaging_id,
               kg_per_unit, target_qty AS qty_available, '' AS batch_no,
               product_type_name, recipe_name, packaging_name
        FROM stock_cartons
        WHERE linked_order_id IS NULL
          AND COALESCE(packed_qty, 0) > 0
        """,
    )
    return match_cartons(order.get("client_id") or "", lines, cartons)
