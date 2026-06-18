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
    """Czysta logika dopasowania kartonu mieszanego. Sugestia na karton tylko gdy
    KAŻDA jego pozycja (packed_qty>0) pasuje do jakiejś linii zamówienia tego klienta.
    Podpięcie do pierwszej pasującej linii; qty = suma spakowanych sztuk."""
    out: List[Dict[str, Any]] = []
    for c in cartons:
        lines = [l for l in (c.get("lines") or []) if int(l.get("packed_qty") or 0) > 0]
        if not lines:
            continue
        matched_line = None
        all_ok = True
        for cl in lines:
            spec = {"client_id": c.get("client_id"), **cl}
            ol = next((o for o in order_lines if _line_matches(spec, order_client_id, o)), None)
            if ol is None:
                all_ok = False
                break
            matched_line = matched_line or ol
        if not all_ok or matched_line is None:
            continue
        out.append({
            "cartonId": c["id"],
            "cartonNo": c.get("carton_no"),
            "orderLineId": matched_line["id"],
            "qty": sum(int(l.get("packed_qty") or 0) for l in lines),
            "lines": lines,
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
        SELECT id, carton_no, client_id, recipe_id, recipe_name, product_type_id,
               product_type_name, packaging_id, packaging_name, kg_per_unit, packed_qty
        FROM stock_cartons
        WHERE linked_order_id IS NULL
        """,
    )
    for c in cartons:
        lns = query_all(
            "SELECT recipe_id, recipe_name, product_type_id, product_type_name, "
            "       packaging_id, packaging_name, kg_per_unit, packed_qty "
            "FROM stock_carton_lines WHERE carton_id=%s",
            (c["id"],),
        )
        if lns:
            c["lines"] = lns
        elif int(c.get("packed_qty") or 0) > 0:
            # Karton „legacy" bez pozycji — potraktuj nagłówek jako jedną pozycję.
            c["lines"] = [{
                "recipe_id": c.get("recipe_id"), "recipe_name": c.get("recipe_name"),
                "product_type_id": c.get("product_type_id"),
                "product_type_name": c.get("product_type_name"),
                "packaging_id": c.get("packaging_id"), "packaging_name": c.get("packaging_name"),
                "kg_per_unit": c.get("kg_per_unit"), "packed_qty": c.get("packed_qty"),
            }]
        else:
            c["lines"] = []
    return match_cartons(order.get("client_id") or "", lines, cartons)
