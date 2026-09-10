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
from app.services.wz_service import KOMUNIKAT_ANULUJ_PODZIAL

logger = get_logger(__name__)

#: Podział wolno zmieniać TYLKO dopóki nie ma na nim papierów.
_KOMUNIKAT_PO_WYSTAWIENIU = (
    "Zamówienie ma już wystawione dokumenty z podziału ({numer}) — zmiana podziału "
    "rozjechałaby je między sobą: WZ dla klienta jest już wystawiony i zostaje taki, "
    "jaki jest, a papiery pod fakturę przeliczyłyby się na nowo. Żeby zmienić podział, "
    + KOMUNIKAT_ANULUJ_PODZIAL + ".")


def _odmow_gdy_dokumenty_wystawione(order_id: str) -> None:
    """Guard na `zapisz_podzial` i `wyczysc_podzial`.

    Po wystawieniu kompletu zmiana podziału rozjeżdża dokumenty MIĘDZY SOBĄ:
    `wystaw_wz_klienta` jest idempotentny i oddaje STARY dokument bez
    odświeżenia, a kolejne kliknięcie kompletu ODŚWIEŻA CMR i HDI wariantu
    `fv` do nowego podziału. Wydrukowany WZ dla klienta mówiłby wtedy co
    innego niż papiery pod fakturę — dla jednej wysyłki i bez ostrzeżenia.

    `wyczysc_podzial` jest jeszcze gorszy: kasuje `qty_invoice` oraz
    `invoice_kg_target` POD wystawionymi dokumentami, po czym warianty `fv`
    zaczynają odmawiać, a papiery zostają bez pokrycia w danych zamówienia.

    Odmowa jest w pełni odwracalna — `anuluj_dokumenty_podzialu` zwraca towar
    na stan i odblokowuje podział (review Task 7, runda 1, finding 3).
    """
    dokument = query_one(
        "SELECT number FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "AND split_scope IS NOT NULL AND COALESCE(status,'')<>'anulowany' "
        "ORDER BY created_at LIMIT 1", (order_id,))
    if dokument:
        raise HTTPException(400, _KOMUNIKAT_PO_WYSTAWIENIU.format(numer=dokument["number"]))


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
    _odmow_gdy_dokumenty_wystawione(order_id)
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
    _odmow_gdy_dokumenty_wystawione(order_id)
    with transaction() as conn:
        cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=NULL WHERE order_id=%s",
                   (order_id,))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=NULL WHERE id=%s",
                   (order_id,))
