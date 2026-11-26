"""Palety mięsa przyprawionego — paleta po masowaniu to partia na hali.

Spec: docs/superpowers/specs/2026-11-26-plan-produkcji-partie-design.md.
Paleta powstaje przy odbiorze z masownicy z wagą z paleciaka. Kierownik
skanuje jej QR (`SP|<id>`) przy wywozie na halę, a końcówka wraca zważona
jako nowa paleta tej samej partii.
"""
from __future__ import annotations

from typing import Any, Dict

from app.db import cx_execute_returning, cx_query_one
from app.utils.ids import cuid

QR_PREFIX = "SP|"


def qr_of(pallet_id: str) -> str:
    return QR_PREFIX + pallet_id


def create_from_charge(conn, charge: Dict[str, Any], kg_output: float) -> Dict[str, Any]:
    """Paleta z odebranego wsadu. Idempotentna po `charge_id`."""
    istniejaca = cx_query_one(
        conn, "SELECT * FROM seasoned_pallets WHERE charge_id=%s", (charge["id"],))
    if istniejaca:
        return istniejaca
    zlecenie = cx_query_one(
        conn, "SELECT recipe_id, recipe_name FROM mixing_orders WHERE id=%s",
        (charge.get("order_id"),)) or {}
    recipe_id = zlecenie.get("recipe_id") or ""
    sm = cx_query_one(
        conn,
        "SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s "
        "ORDER BY created_at DESC LIMIT 1",
        (charge.get("batch_no") or "", recipe_id),
    ) or {}
    return cx_execute_returning(
        conn,
        """
        INSERT INTO seasoned_pallets
            (id, pallet_no, charge_id, seasoned_meat_id, batch_no, recipe_id,
             recipe_name, kg_weighed, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'in_cold')
        RETURNING *
        """,
        (cuid(), charge.get("out_pallet_no"), charge["id"], sm.get("id"),
         charge.get("batch_no") or "", recipe_id, zlecenie.get("recipe_name") or "",
         round(float(kg_output), 3)),
    )
