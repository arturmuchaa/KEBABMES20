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
from app.utils.ids import cuid, now_iso, slugify_for_number
from datetime import datetime

logger = get_logger(__name__)


def _order_period(order_date_raw: str | None) -> str:
    if order_date_raw:
        try:
            return datetime.fromisoformat(order_date_raw).strftime("%m/%y")
        except ValueError:
            pass
    return datetime.now().strftime("%m/%y")


def _next_client_order_no(
    conn, client_display_name: str, order_date_raw: str | None
) -> str:
    # Format numeru: {nazwa_wyświetlana_klienta}/Z/{kolejny_w_msc}/MM/RR
    # (np. ZAGROS/Z/1/05/26). Sekwencja jest liczona PER KLIENT i miesiąc.
    period = _order_period(order_date_raw)
    month_part, year_part = period.split("/")
    client_slug = slugify_for_number(client_display_name)
    seq_key = f"client_order_seq:{client_slug}:{period}"

    # Lock one row per client+month so parallel creates cannot allocate the same number.
    cx_execute(
        conn,
        """
        INSERT INTO sequences (key, value)
        VALUES (%s, 0)
        ON CONFLICT (key) DO NOTHING
        """,
        (seq_key,),
    )
    cx_query_one(
        conn,
        """
        SELECT value
        FROM sequences
        WHERE key = %s
        FOR UPDATE
        """,
        (seq_key,),
    )

    rows = cx_query_all(
        conn,
        """
        SELECT split_part(order_no, '/', 3)::INTEGER AS seq
        FROM client_orders
        WHERE split_part(order_no, '/', 1) = %s
          AND split_part(order_no, '/', 2) = 'Z'
          AND split_part(order_no, '/', 4) = %s
          AND split_part(order_no, '/', 5) = %s
          AND split_part(order_no, '/', 3) ~ '^[0-9]+$'
        ORDER BY seq
        """,
        (client_slug, month_part, year_part),
    )
    used = {int(row["seq"]) for row in rows}
    seq = 1
    while seq in used:
        seq += 1

    cx_execute(
        conn,
        "UPDATE sequences SET value = GREATEST(value, %s) WHERE key = %s",
        (seq, seq_key),
    )
    return f"{client_slug}/Z/{seq}/{period}"


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


def _hydrate_order(order: Dict[str, Any]) -> Dict[str, Any]:
    lines = query_all(
        "SELECT * FROM client_order_lines WHERE order_id = %s", (order["id"],)
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
        (order["order_no"],),
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

    order["lines"] = lines
    return order


def list_orders(status: str | None) -> List[Dict]:
    sql = "SELECT * FROM client_orders"
    params: list = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    orders = query_all(sql, params or None)
    return [_hydrate_order(order) for order in orders]


def get_order(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id = %s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    return _hydrate_order(order)


def create_order(dto: ClientOrderCreate) -> Dict:
    total_kg = sum(l.qty * l.kg_per_unit for l in dto.lines)
    total_units = sum(l.qty for l in dto.lines)

    with transaction() as conn:
        client = cx_query_one(
            conn, "SELECT * FROM clients WHERE id = %s", (dto.client_id,)
        )
        if not client:
            raise HTTPException(404, "Klient nie znaleziony")
        client_display = client.get("display_name") or client["name"]
        order_no = _next_client_order_no(conn, client_display, dto.order_date)

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
                order_no,
                dto.client_id,
                client.get("display_name") or client["name"],
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
                client.get("display_name") or client["name"],
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


def production_progress(order_id: str) -> Dict[str, Any]:
    """Dla każdej linii zamówienia zwraca:
      qty_done    — sumarycznie szt z planów ze statusem 'done'
      qty_pending — sumarycznie szt z planów 'draft' i 'active' (zarezerwowane)
      qty_total   — ilość zamówiona
      qty_remaining — qty_total - qty_done - qty_pending (jeśli > 0)
    """
    order = query_one("SELECT id, order_no FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    lines = query_all(
        "SELECT id, qty FROM client_order_lines WHERE order_id=%s", (order_id,)
    )
    rows = query_all(
        """
        SELECT pl.client_order_line_id AS line_id,
               COALESCE(SUM(CASE WHEN pp.status = 'done'                   THEN pl.qty ELSE 0 END), 0) AS qty_done,
               COALESCE(SUM(CASE WHEN pp.status IN ('draft','active')      THEN pl.qty ELSE 0 END), 0) AS qty_pending
        FROM production_plan_lines pl
        JOIN production_plans pp ON pp.id = pl.plan_id
        WHERE pl.client_order_line_id IN (SELECT id FROM client_order_lines WHERE order_id=%s)
        GROUP BY pl.client_order_line_id
        """,
        (order_id,),
    )
    by_line = {r["line_id"]: r for r in rows}
    result_lines = []
    for line in lines:
        agg = by_line.get(line["id"], {})
        qty_total = int(line["qty"] or 0)
        qty_done = int(agg.get("qty_done") or 0)
        qty_pending = int(agg.get("qty_pending") or 0)
        qty_remaining = max(0, qty_total - qty_done - qty_pending)
        result_lines.append(
            {
                "line_id": line["id"],
                "qty_total": qty_total,
                "qty_done": qty_done,
                "qty_pending": qty_pending,
                "qty_remaining": qty_remaining,
            }
        )
    return {"order_id": order_id, "order_no": order["order_no"], "lines": result_lines}
