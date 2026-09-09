"""Podział zamówienia zapisany na pozycjach — podgląd i zapis.

Podgląd NIE zapisuje: biuro ogląda tabelę, poprawia pojedynczą pozycję
i dopiero wtedy zatwierdza.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.order_split import podziel_pozycje

logger = get_logger(__name__)


def _linie(order_id: str) -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, qty, kg_per_unit, recipe_name, product_type_name, position "
        "FROM client_order_lines WHERE order_id=%s ORDER BY position", (order_id,))


def podglad_podzialu(order_id: str, cel_kg: float) -> Dict[str, Any]:
    """Jak rozłoży się podział — bez zapisu."""
    linie = _linie(order_id)
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    obliczone = podziel_pozycje(
        [{"id": l["id"], "qty": int(l["qty"] or 0),
          "kg_per_unit": float(l["kg_per_unit"] or 0)} for l in linie], cel_kg)
    po_id = {w["id"]: w for w in obliczone["lines"]}
    lines = []
    for l in linie:
        na_fv = int(po_id[l["id"]]["qty_invoice"])
        lines.append({
            "id": l["id"], "position": l["position"],
            "recipe_name": l.get("recipe_name") or "",
            "product_type_name": l.get("product_type_name") or "",
            "kg_per_unit": float(l["kg_per_unit"] or 0),
            "qty": int(l["qty"] or 0),
            "qty_invoice": na_fv,
            "qty_wz": int(l["qty"] or 0) - na_fv,
        })
    kg_fv = sum(x["qty_invoice"] * x["kg_per_unit"] for x in lines)
    kg_all = sum(x["qty"] * x["kg_per_unit"] for x in lines)
    return {"order_id": order_id, "cel_kg": float(cel_kg or 0), "lines": lines,
            "kg_fv": round(kg_fv, 3), "kg_wz": round(kg_all - kg_fv, 3),
            "kg_calosc": round(kg_all, 3),
            "trafiono": obliczone["trafiono"],
            "odchylka": round(kg_fv - float(cel_kg or 0), 3)}


def zapisz_podzial(order_id: str, cel_kg: float,
                   per_line: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Utrwala podział na pozycjach. `per_line` nadpisuje wyliczenie."""
    podglad = podglad_podzialu(order_id, cel_kg)
    korekty = per_line or {}
    for l in podglad["lines"]:
        if l["id"] in korekty:
            reczne = int(korekty[l["id"]])
            if reczne < 0 or reczne > l["qty"]:
                raise HTTPException(
                    400,
                    f"Pozycja {l['recipe_name']} {l['kg_per_unit']} kg: nie można dać "
                    f"na fakturę {reczne} szt, zamówiono {l['qty']}")
            l["qty_invoice"] = reczne
            l["qty_wz"] = l["qty"] - reczne

    with transaction() as conn:
        for l in podglad["lines"]:
            cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=%s WHERE id=%s",
                       (l["qty_invoice"], l["id"]))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=%s WHERE id=%s",
                   (float(cel_kg or 0), order_id))
    logger.info("order.split.saved", extra={"order_id": order_id, "cel_kg": float(cel_kg or 0)})
    kg_fv = sum(l["qty_invoice"] * l["kg_per_unit"] for l in podglad["lines"])
    podglad["kg_fv"] = round(kg_fv, 3)
    podglad["kg_wz"] = round(podglad["kg_calosc"] - kg_fv, 3)
    return podglad


def wyczysc_podzial(order_id: str) -> None:
    """Kasuje podział — zamówienie wraca do zachowania sprzed tej zmiany."""
    with transaction() as conn:
        cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=NULL WHERE order_id=%s",
                   (order_id,))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=NULL WHERE id=%s",
                   (order_id,))
