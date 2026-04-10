from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.orders import ClientOrderCreate, OrderLineCreate
from app.utils.ids import cuid, next_seq, now_iso
from datetime import datetime

logger = get_logger(__name__)


def _resolve_line_names(conn, line: OrderLineCreate) -> Tuple[str, str, str]:
    recipe_name = line.recipe_name
    product_type_name = line.product_type_name
    if not recipe_name and line.recipe_id:
        r = cx_query_one(
            conn,
            "SELECT name, product_type_name FROM recipes WHERE id=%s",
            (line.recipe_id,),
        )
        if r:
            recipe_name = r["name"] or ""
            if not product_type_name:
                product_type_name = r.get("product_type_name") or ""
    if not product_type_name and line.product_type_id:
        pt = cx_query_one(
            conn, "SELECT name FROM product_types WHERE id=%s", (line.product_type_id,)
        )
        if pt:
            product_type_name = pt["name"] or ""
    packaging_name = line.packaging_name
    if not packaging_name and line.packaging_id:
        pkg = cx_query_one(
            conn, "SELECT name FROM packaging WHERE id=%s", (line.packaging_id,)
        )
        if pkg:
            packaging_name = pkg["name"] or ""
    return recipe_name or "", product_type_name or "", packaging_name or ""


def list_orders(status: str | None) -> List[Dict]:
    sql = "SELECT * FROM client_orders"
    params: list = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    orders = query_all(sql, params or None)
    for o in orders:
        lines = query_all(
            "SELECT * FROM client_order_lines WHERE order_id = %s", (o["id"],)
        )
        for line in lines:
            if not line.get("recipe_name") and line.get("recipe_id"):
                r = query_one(
                    "SELECT name, product_type_name FROM recipes WHERE id=%s",
                    (line["recipe_id"],),
                )
                if r:
                    line["recipe_name"] = r["name"] or ""
                    if not line.get("product_type_name"):
                        line["product_type_name"] = r.get("product_type_name") or ""
            if not line.get("product_type_name") and line.get("product_type_id"):
                pt = query_one(
                    "SELECT name FROM product_types WHERE id=%s",
                    (line["product_type_id"],),
                )
                if pt:
                    line["product_type_name"] = pt["name"] or ""
            if not line.get("packaging_name") and line.get("packaging_id"):
                pkg = query_one(
                    "SELECT name FROM packaging WHERE id=%s", (line["packaging_id"],)
                )
                if pkg:
                    line["packaging_name"] = pkg["name"] or ""

        done_rows = query_all(
            """
            SELECT recipe_id, kg_per_unit, SUM(qty) AS qty_done
            FROM finished_goods
            WHERE client_order_no = %s
            GROUP BY recipe_id, kg_per_unit
            """,
            (o["order_no"],),
        )
        done_map: dict = {
            f"{dr['recipe_id']}|{float(dr['kg_per_unit'])}": int(dr["qty_done"] or 0)
            for dr in done_rows
        }
        unlinked_rows = query_all(
            """
            SELECT recipe_id, kg_per_unit, SUM(qty) AS qty_done
            FROM finished_goods
            WHERE (client_order_no IS NULL OR client_order_no = '')
            GROUP BY recipe_id, kg_per_unit
            """
        )
        unlinked_map: dict = {
            f"{dr['recipe_id']}|{float(dr['kg_per_unit'])}": int(dr["qty_done"] or 0)
            for dr in unlinked_rows
        }
        for line in lines:
            key = f"{line['recipe_id']}|{float(line['kg_per_unit'])}"
            line["qty_done"] = done_map.get(key, 0) + unlinked_map.get(key, 0)
        o["lines"] = lines
    return orders


def create_order(dto: ClientOrderCreate) -> Dict:
    seq = next_seq("client_order_seq")
    year = datetime.now().year
    total_kg = sum(l.qty * l.kg_per_unit for l in dto.lines)
    total_units = sum(l.qty for l in dto.lines)

    with transaction() as conn:
        client = cx_query_one(
            conn, "SELECT * FROM clients WHERE id = %s", (dto.client_id,)
        )
        if not client:
            raise HTTPException(404, "Klient nie znaleziony")

        order = cx_execute_returning(
            conn,
            """
            INSERT INTO client_orders
                (id, order_no, client_id, client_name, order_date, delivery_date,
                 total_kg, total_units, status, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'draft',%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                f"ZAM-{year}-{str(seq).zfill(3)}",
                dto.client_id,
                client["name"],
                dto.order_date,
                dto.delivery_date or None,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                now_iso(),
            ),
        )
        assert order is not None

        for line in dto.lines:
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order["id"],
                    line.qty,
                    line.kg_per_unit,
                    round(line.qty * line.kg_per_unit, 3),
                    line.product_type_id or None,
                    ptn or None,
                    line.recipe_id,
                    rn or None,
                    line.packaging_id or None,
                    pkgn or None,
                ),
            )

        order["lines"] = cx_query_all(
            conn,
            "SELECT * FROM client_order_lines WHERE order_id = %s",
            (order["id"],),
        )
    logger.info("order.created", extra={"order_id": order["id"]})
    return order


def update_order_status(order_id: str, status: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE client_orders SET status=%s WHERE id=%s RETURNING *",
            (status, order_id),
        )
    if not row:
        raise HTTPException(404, "Zamówienie nie znalezione")
    logger.info("order.status_updated", extra={"order_id": order_id, "status": status})
    return row


def delete_order(order_id: str) -> Dict[str, bool]:
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT status FROM client_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        if order["status"] not in ("draft", "confirmed"):
            raise HTTPException(
                400,
                "Można usunąć tylko zamówienie w statusie Szkic lub Potwierdzone",
            )
        cx_execute(conn, "DELETE FROM client_orders WHERE id=%s", (order_id,))
    logger.info("order.deleted", extra={"order_id": order_id})
    return {"ok": True}


def update_order(order_id: str, dto: ClientOrderCreate) -> Dict:
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        if order["status"] not in ("draft", "confirmed"):
            raise HTTPException(
                400,
                "Można edytować tylko zamówienia w statusie Szkic lub Potwierdzone",
            )
        client = cx_query_one(
            conn, "SELECT * FROM clients WHERE id=%s", (dto.client_id,)
        )
        if not client:
            raise HTTPException(404, "Klient nie znaleziony")

        total_kg = sum(l.qty * l.kg_per_unit for l in dto.lines)
        total_units = sum(l.qty for l in dto.lines)

        cx_execute(
            conn,
            """
            UPDATE client_orders
            SET client_id=%s, client_name=%s, order_date=%s, delivery_date=%s,
                total_kg=%s, total_units=%s, notes=%s
            WHERE id=%s
            """,
            (
                dto.client_id,
                client["name"],
                dto.order_date,
                dto.delivery_date or None,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                order_id,
            ),
        )

        cx_execute(
            conn, "DELETE FROM client_order_lines WHERE order_id=%s", (order_id,)
        )
        for line in dto.lines:
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order_id,
                    line.qty,
                    line.kg_per_unit,
                    round(line.qty * line.kg_per_unit, 3),
                    line.product_type_id or None,
                    ptn or None,
                    line.recipe_id,
                    rn or None,
                    line.packaging_id or None,
                    pkgn or None,
                ),
            )

        updated = cx_query_one(
            conn, "SELECT * FROM client_orders WHERE id=%s", (order_id,)
        )
        assert updated is not None
        updated["lines"] = cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s", (order_id,)
        )
    logger.info("order.updated", extra={"order_id": order_id})
    return updated
