"""Compare scanned contents with the order, never with available stock alone.

ZAGROS/POLAT 2026-10-20: all EXISTING pallets were scanned but an entire
order position/pallet was absent. Documents from the order hid the shortage.
Partial dispatch is allowed with a durable warning. Documents must use the
recorded shipment, not fill its missing quantities from a production plan.
"""
from collections import defaultdict

from fastapi import HTTPException

from app.db import cx_query_all, cx_query_one
from app.utils.product_key import kandydaci, klucz_wyrobu


def _key(row):
    return klucz_wyrobu(row.get("recipe_id"), row.get("kg_per_unit"),
                        row.get("product_type_id"), row.get("packaging_id"))


def order_lines_cx(conn, order_id, *, require_lines=True):
    order = cx_query_one(conn, "SELECT id, order_no FROM client_orders WHERE id=%s FOR UPDATE", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    lines = cx_query_all(conn, "SELECT * FROM client_order_lines WHERE order_id=%s ORDER BY id FOR UPDATE", (order_id,))
    if require_lines and (not lines or not any(int(l.get("qty") or 0) > 0 for l in lines)):
        raise HTTPException(409, f"{order['order_no']}: brak pozycji do wydania")
    return order, lines


def compare_contents(order, lines, contents):
    """Consume each piece once; equal totals cannot hide another product/weight.

    The existing legacy compatibility for absent optional type/tube IDs is
    retained. Known different IDs never match. Exact identities go first.
    """
    available = defaultdict(int)
    for row in contents:
        available[_key(row)] += int(row.get("qty") or 0)
    missing = []
    for line in sorted(lines, key=lambda l: (-bool(l.get("product_type_id")), -bool(l.get("packaging_id")), str(l.get("id", "")))):
        need = int(line.get("qty") or 0)
        for key in kandydaci(available, _key(line)):
            take = min(need, max(0, available[key]))
            available[key] -= take
            need -= take
        if need:
            missing.append((line, need))
    extra = sum(max(0, n) for n in available.values())
    return {"complete": not missing and not extra, "extra_qty": extra,
            "missing": [{"order_line_id": l["id"],
                         "name": l.get("recipe_name") or l.get("product_type_name") or "Pozycja",
                         "kg_per_unit": float(l.get("kg_per_unit") or 0),
                         "ordered_qty": int(l["qty"]), "missing_qty": qty,
                         "missing_kg": round(qty * float(l.get("kg_per_unit") or 0), 3)}
                        for l, qty in missing]}


def require_rows_cx(conn, order_id, contents, source="pokrycie dokumentu"):
    order, lines = order_lines_cx(conn, order_id)
    result = compare_contents(order, lines, contents)
    if not result["complete"]:
        raise HTTPException(409, f"{order['order_no']}: {source} nie jest kompletne")


def dispatch_contents_cx(conn, order_id, *, vehicle_id=None, shipped_only=False, include_shipped=False):
    """Lock authoritative contents through commit; QR overrides plan PER box.

    Finalizing a vehicle checks only that vehicle's loaded containers. Document
    issuance accepts loaded/shipped containers; auto-closing an order accepts
    only shipped ones. Uncreated, unscanned and other-vehicle pallets cannot
    disappear from the expected quantities, which always come from the order.
    """
    order, lines = order_lines_cx(conn, order_id)
    pallets = cx_query_all(conn, "SELECT * FROM order_pallets WHERE order_id=%s ORDER BY pallet_no FOR UPDATE", (order_id,))
    cartons = cx_query_all(conn, "SELECT * FROM stock_cartons WHERE linked_order_id=%s ORDER BY id FOR UPDATE", (order_id,))
    selected = []
    for p in pallets:
        if vehicle_id is not None:
            eligible = (p["status"] == "loaded" and p.get("loaded_vehicle_id") == vehicle_id) or (include_shipped and p["status"] == "shipped")
        elif shipped_only:
            eligible = p["status"] == "shipped"
        else:
            eligible = p["status"] == "shipped" or (p["status"] == "loaded" and bool(p.get("loaded_vehicle_id")))
        if eligible:
            selected.append(p["id"])
    for c in cartons:
        if vehicle_id is not None:
            eligible = (not c.get("shipped_at") and c.get("loaded_vehicle_id") == vehicle_id) or (include_shipped and bool(c.get("shipped_at")))
        elif shipped_only:
            eligible = bool(c.get("shipped_at"))
        else:
            eligible = bool(c.get("shipped_at") or c.get("loaded_vehicle_id"))
        if eligible:
            selected.append(c["id"])
    units = cx_query_all(conn, """
        SELECT fu.*, COALESCE(fu.pallet_id,fu.carton_id) AS container_id,
               fu.weight_kg AS kg_per_unit, fg.packaging_id,
               fg.recipe_id AS stock_recipe_id, fg.kg_per_unit AS stock_kg_per_unit
        FROM finished_units fu LEFT JOIN finished_goods fg ON fg.id=fu.source_finished_goods_id
        WHERE fu.pallet_id=ANY(%s) OR fu.carton_id=ANY(%s) ORDER BY fu.id FOR UPDATE OF fu
        """, (selected, selected)) if selected else []
    with_qr = {u["container_id"] for u in units}
    if any(u.get("status") not in ("packed", "shipped") or not u.get("recipe_id")
           or float(u.get("weight_kg") or 0) <= 0 for u in units):
        raise HTTPException(409, "Sztuka na załadunku ma niewyjaśnioną tożsamość lub status. Wyjaśnij przed wyjazdem.")
    if any(not u.get("source_finished_goods_id") for u in units):
        raise HTTPException(400, "Sztuka nie ma powiązania z wyrobem gotowym — wyjaśnij przed wyjazdem.")
    if any(u.get("stock_recipe_id") != u.get("recipe_id")
           or float(u.get("stock_kg_per_unit") or 0) != float(u.get("weight_kg") or 0) for u in units):
        raise HTTPException(409, "Sztuka i jej partia magazynowa nie mają zgodnej tożsamości — wyjaśnij powiązanie przed wyjazdem.")
    contents = [{**u, "qty": 1} for u in units if u.get("status") in ("packed", "shipped")]
    without_qr = [pid for pid in selected if pid not in with_qr]
    if without_qr:
        planned = cx_query_all(conn, """
            SELECT l.recipe_id,l.kg_per_unit,l.product_type_id,l.packaging_id,i.qty,l.order_id AS source_order_id
            FROM order_pallet_items i JOIN client_order_lines l ON l.id=i.order_line_id
            WHERE i.pallet_id=ANY(%s)
            UNION ALL
            SELECT l.recipe_id,l.kg_per_unit,l.product_type_id,l.packaging_id,l.target_qty AS qty,%s AS source_order_id
            FROM stock_carton_lines l WHERE l.carton_id=ANY(%s)
            """, (without_qr, order_id, without_qr))
        if any(r.get("source_order_id") != order_id or not r.get("recipe_id")
               or float(r.get("kg_per_unit") or 0) <= 0 or int(r.get("qty") or 0) <= 0 for r in planned):
            raise HTTPException(409, "Rozpis zawiera obcą pozycję lub niewyjaśnioną tożsamość towaru — wyjaśnij przed wyjazdem.")
        contents += planned
    return contents, compare_contents(order, lines, contents)
