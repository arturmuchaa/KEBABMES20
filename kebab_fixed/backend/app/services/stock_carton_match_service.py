"""Dopasowanie kartonu magazynowego do zamówienia (zgodność wsteczna).

Reguły żyją w `stock_carton_link_service` (wspólne dla sugestii, przeglądu
i zapisu): klient ten sam albo karton niczyj, ścisła zgodność KAŻDEJ pozycji
(receptura + rodzaj + tuleja/packaging_id + waga), cały karton mieści się
w wolnej ilości zamówienia. System sugeruje, biuro zatwierdza.
"""
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.services import stock_carton_link_service as link


def match_cartons(
    order_client_id: str,
    order_lines: List[Dict[str, Any]],
    cartons: List[Dict[str, Any]],
    reserved: Optional[Dict[Any, int]] = None,
) -> List[Dict[str, Any]]:
    """Czysta logika: karton pasuje tylko w CAŁOŚCI (każda pozycja z
    packed_qty>0 ma ścisły odpowiednik, powtórzone specyfikacje sumowane,
    suma mieści się w wolnej ilości). Podpięcie do pierwszej pasującej linii."""
    out: List[Dict[str, Any]] = []
    for c in cartons:
        lines = [l for l in (c.get("lines") or []) if int(l.get("packed_qty") or 0) > 0]
        if not lines:
            continue
        if link.match_reason(c, lines, order_client_id, order_lines,
                             carton_res=reserved, qty_field="packed_qty"):
            continue
        first = link.spec_key(lines[0])
        matched_line = next(o for o in order_lines if link.spec_key(o) == first)
        out.append({
            "cartonId": c["id"],
            "cartonNo": c.get("carton_no"),
            "orderLineId": matched_line["id"],
            "qty": sum(int(l.get("packed_qty") or 0) for l in lines),
            "lines": lines,
        })
    return out


def suggestions_for_order(order_id: str) -> List[Dict[str, Any]]:
    """Kartony DOSTĘPNE do przypisania — dawny kształt odpowiedzi."""
    try:
        opts = link.options_for_order(order_id)
    except HTTPException as e:  # brak zamówienia → pusta lista, jak dawniej
        if e.status_code == 404:
            return []
        raise
    if opts["assignBlockedReason"]:
        return []
    out = []
    for v in opts["available"]:
        out.append({
            "cartonId": v["cartonId"],
            "cartonNo": v["cartonNo"],
            "orderLineId": v["orderLineId"],
            "qty": v["packedQty"],
            "lines": [{"recipe_name": l["recipeName"], "product_type_name": l["productTypeName"],
                       "packaging_name": l["packagingName"], "kg_per_unit": l["kgPerUnit"],
                       "packed_qty": l["packedQty"]} for l in v["lines"]],
        })
    return out
