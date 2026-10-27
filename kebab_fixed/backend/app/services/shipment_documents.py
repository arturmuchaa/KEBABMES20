"""One recorded/scanned shipment supplies ALL document quantities.

Explicit, request-local scope shared by the existing WM/WZ/HDI/CMR builders.
It is never a replacement for the order: unshipped quantities stay ordered.
The enclosing atomic operation keeps snapshot, documents and ledger together.
"""
import json
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps

from fastapi import HTTPException

from app.db import atomic_operation, cx_execute, cx_query_all, cx_query_one, transaction
from app.services.dispatch_completeness import _key, compare_contents, order_lines_cx
from app.utils.product_key import kandydaci

_current = ContextVar("shipment_documents", default=None)


def current(order_id=None):
    value = _current.get()
    return value if value and (order_id is None or value["order_id"] == order_id) else None


def scope_id():
    return (current() or {}).get("scope_id")


def require_current(order_id):
    value = current(order_id)
    if not value or not value["portions"]:
        raise HTTPException(409, "Brak potwierdzonego załadunku — dokumenty można wystawić tylko na zeskanowany towar.")
    return value


def lines_for(order_id, fallback):
    value = current(order_id)
    return value["lines"] if value else fallback


def invoice_data(value):
    """Quantities for external invoicing, NOT a fiscal invoice/Subiekt export."""
    if not value or any(l.get("qty_invoice") is None for l in value["lines"]):
        return None
    rows = []
    for line in value["lines"]:
        qty, invoice = int(line["qty"]), int(line["qty_invoice"])
        if invoice < 0 or invoice > qty:
            raise HTTPException(409, "Ilość na fakturę przekracza potwierdzony załadunek")
        if qty:
            kg = float(line["kg_per_unit"])
            rows.append({"order_line_id": line["id"], "name": line.get("recipe_name") or line.get("product_type_name") or "Pozycja",
                         "kg_per_unit": kg, "shipped_qty": qty, "invoice_qty": invoice,
                         "invoice_kg": round(invoice * kg, 3), "wz_qty": qty - invoice,
                         "wz_kg": round((qty - invoice) * kg, 3)})
    return {"source": "confirmed_loading", "loading_id": value.get("loading_id"), "lines": rows,
            "invoice_kg": round(sum(r["invoice_kg"] for r in rows), 3),
            "wz_kg": round(sum(r["wz_kg"] for r in rows), 3)}


def bind_wm(conn, wid):
    value = current()
    cx_execute(conn, "UPDATE wz_documents SET loading_id=%s WHERE id=%s", (scope_id(), wid))
    if value and value.get("loading_id"):
        cx_execute(conn, """UPDATE wz_documents SET loaded_at=l.finished_at,vehicle_plate=l.plate,
            loading_status='potwierdzony' FROM loadings l WHERE wz_documents.id=%s AND l.id=%s""", (wid, value["loading_id"]))
        cx_execute(conn, "UPDATE loading_orders SET wz_id=%s WHERE loading_id=%s AND order_id=%s", (wid, value["loading_id"], value["order_id"]))


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _allocate(lines, portions):
    available = defaultdict(int)
    for p in portions:
        available[_key(p["fg"])] += p["take"]
    result = []
    for line in sorted(lines, key=lambda l: (-bool(l.get("product_type_id")), -bool(l.get("packaging_id")), str(l["id"]))):
        qty = 0
        for k in kandydaci(available, _key(line)):
            take = min(max(0, available[k]), int(line["qty"]) - qty)
            qty += take
            available[k] -= take
        result.append({**line, "ordered_qty": int(line["qty"]), "qty": qty,
                       "qty_invoice": None if line.get("qty_invoice") is None else min(qty, int(line["qty_invoice"])),
                       "total_kg": round(qty * float(line.get("kg_per_unit") or 0), 3)})
    if any(n > 0 for n in available.values()):
        raise HTTPException(409, "Załadunek zawiera nadmiar lub produkt spoza zamówienia — wyjaśnij rozpis przed wystawieniem dokumentów.")
    return result


def _live_portions(conn, order_id):
    # Keep the existing QR-per-container precedence and stock selection rules.
    from app.services.loading_service import _units_on_pallets
    from app.services.order_stock_service import picks_for_pallets
    containers = cx_query_all(conn, """
        SELECT id,loaded_vehicle_id FROM order_pallets WHERE order_id=%s AND status='loaded' AND loaded_vehicle_id IS NOT NULL
        UNION ALL SELECT id,loaded_vehicle_id FROM stock_cartons WHERE linked_order_id=%s
            AND loaded_vehicle_id IS NOT NULL AND shipped_at IS NULL
        """, (order_id, order_id))
    ids = [p["id"] for p in containers]
    if not ids:
        return []
    if len({p["loaded_vehicle_id"] for p in containers}) != 1:
        raise HTTPException(409, "Zamówienie jest na kilku autach — zakończ załadunki i wystaw dokumenty osobno z każdego kursu.")
    if cx_query_one(conn, "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s AND split_scope IS NULL AND COALESCE(status,'')<>'anulowany' LIMIT 1", (order_id,)):
        return []  # Existing legacy document is read-only; service collision guard identifies it.
    # Lock content with the same canonical guard used to report shortages.
    from app.services.dispatch_completeness import dispatch_contents_cx
    contents, _ = dispatch_contents_cx(conn, order_id, vehicle_id=containers[0]["loaded_vehicle_id"])
    existing = cx_query_one(conn, """SELECT lines FROM wz_documents WHERE source_type='order' AND source_id=%s
        AND split_scope='calosc' AND loading_id IS NULL AND COALESCE(status,'')<>'anulowany'
        ORDER BY created_at LIMIT 1""", (order_id,))
    if existing:
        portions = []
        for line in _json(existing["lines"]) or []:
            fg = cx_query_one(conn, "SELECT * FROM finished_goods WHERE id=%s", (line.get("stock_id"),))
            if not fg:
                return []  # Read-only reuse remains possible; new issuance requires a source.
            portions.append({"fg": {**fg, "batch_no": line.get("batch_no"), "kg_per_unit": line.get("kg_per_unit")}, "take": int(line.get("qty") or 0)})
        expected = [{**p["fg"], "qty": p["take"]} for p in portions]
        if not compare_contents({}, expected, contents)["complete"]:
            return []  # Never use a mismatched legacy WM to create another document.
        return portions
    units = _units_on_pallets(conn, ids)
    counts = defaultdict(int)
    for u in units:
        if not u.get("source_finished_goods_id"):
            raise HTTPException(409, "Sztuka nie ma powiązania z wyrobem gotowym — nie można wystawić dokumentu.")
        if u.get("status") not in ("packed", "shipped"):
            raise HTTPException(409, "Nieprawidłowy status sztuki na załadunku")
        counts[u["source_finished_goods_id"]] += 1
    with_units = {u["container_id"] for u in units}
    without = [p for p in ids if p not in with_units]
    picks = picks_for_pallets(order_id, without)
    from app.services.loading_service import _sprawdz_pokrycie_rozpisu
    _sprawdz_pokrycie_rozpisu(conn, {"order_no": order_id}, without, picks)
    for p in picks:
        counts[p["fg"]["id"]] += int(p["take"])
    portions = []
    for gid, qty in sorted(counts.items()):
        fg = cx_query_one(conn, "SELECT * FROM finished_goods WHERE id=%s", (gid,))
        if not fg:
            raise HTTPException(409, "Brak partii zeskanowanego towaru")
        portions.append({"fg": fg, "take": qty})
    return portions


@contextmanager
def shipment_context(order_id, loading_id=None):
    active = current(order_id)
    if active:
        if loading_id and loading_id != active.get("loading_id"):
            raise HTTPException(409, "Nie można mieszać dokumentów różnych kursów")
        yield active
        return
    with transaction() as conn:
        order, lines = order_lines_cx(conn, order_id, require_lines=False)
        if loading_id:
            row = cx_query_one(conn, "SELECT * FROM loading_orders WHERE order_id=%s AND loading_id=%s FOR UPDATE", (order_id, loading_id))
            if not row:
                raise HTTPException(404, "Zamówienie nie należy do tego kursu")
        else:
            rows = cx_query_all(conn, """SELECT lo.* FROM loading_orders lo JOIN loadings l ON l.id=lo.loading_id
                WHERE lo.order_id=%s ORDER BY l.finished_at DESC,lo.loading_id DESC LIMIT 2 FOR UPDATE OF lo""", (order_id,))
            if len(rows) > 1:
                raise HTTPException(409, "Zamówienie ma kilka kursów — wybierz dokumenty konkretnego kursu, nie całego zamówienia.")
            row = rows[0] if rows else None
            if row and cx_query_one(conn, """SELECT id FROM order_pallets WHERE order_id=%s AND status='loaded'
                UNION ALL SELECT id FROM stock_cartons WHERE linked_order_id=%s
                  AND loaded_vehicle_id IS NOT NULL AND shipped_at IS NULL LIMIT 1""", (order_id, order_id)):
                raise HTTPException(409, "Trwa kolejny załadunek — wybierz konkretny zakończony kurs. Nowy kurs ma osobne dokumenty.")
        value = None
        if row:
            doc = cx_query_one(conn, "SELECT loading_id FROM wz_documents WHERE id=%s", (row.get("wz_id"),)) if row.get("wz_id") else None
            if doc and doc.get("loading_id") is None and cx_query_one(conn, """SELECT lo.loading_id
                FROM loading_orders lo JOIN wz_documents w ON w.id=lo.wz_id
                WHERE lo.order_id=%s AND lo.loading_id<>%s AND w.loading_id IS NULL LIMIT 1""",
                (order_id, row["loading_id"])):
                # There is no reliable association for the old NULL-scoped
                # HDI/CMR/split papers. Never reuse the first course's WM for a
                # different course. Explicit reads by document ID stay intact.
                raise HTTPException(409, "Historycznych dokumentów nie można jednoznacznie przypisać do kursu. Otwórz istniejący dokument po numerze — nie wystawiaj go ponownie z kursu.")
            snapshot = _json(row.get("document_snapshot"))
            if snapshot:
                value = snapshot
            else:
                portions = []
                for p in _json(row.get("pozycje")) or []:
                    qty = int(p.get("szt") or 0)
                    fg = p.get("goods") or cx_query_one(conn, "SELECT * FROM finished_goods WHERE id=%s", (p.get("stock_id"),))
                    if not fg or qty <= 0:
                        raise HTTPException(409, "Niepełny zapis załadunku — brak identyfikacji partii. Dokumenty zablokowane.")
                    # Preserve the recorded batch/weight, not today's stock values.
                    fg = {**fg, "batch_no": p.get("batch_no"), "kg_per_unit": p.get("kg_per_unit")}
                    portions.append({"fg": fg, "take": qty})
                if not portions:
                    # A legacy pre-issued WM can provide its own immutable rows;
                    # never reconstruct a short shipment from the whole order.
                    if row.get("wz_id"):
                        # Existing artifacts can be returned unchanged. With no
                        # quantity source require_current still forbids NEW ones.
                        token = _current.set(None)
                        try:
                            yield None
                        finally:
                            _current.reset(token)
                        return
                    raise HTTPException(409, "Kurs nie ma potwierdzonych ilości do dokumentów")
                value = {"order_id": order_id, "loading_id": row["loading_id"],
                         "scope_id": doc["loading_id"] if doc else row["loading_id"],
                         "portions": portions, "lines": _allocate(lines, portions)}
        else:
            portions = _live_portions(conn, order_id) if lines else []
            if portions:
                value = {"order_id": order_id, "loading_id": None, "scope_id": None,
                         "portions": portions, "lines": _allocate(lines, portions)}
        if value:
            contents = [{**p["fg"], "qty": p["take"]} for p in value["portions"]]
            coverage = compare_contents(order, lines, contents)
            if row:
                course = cx_query_one(conn, "SELECT response FROM loadings WHERE id=%s", (row["loading_id"],))
                response = _json((course or {}).get("response")) or {}
                # Finalization counts prior departed courses too. Comparing only
                # this course with the whole order would claim 120 still missing
                # when the second POLAT course delivers the remaining 40 pieces.
                coverage = next((r["coverage"] for r in response.get("orders", [])
                                 if r.get("order_id") == order_id and r.get("coverage") is not None),
                                value.get("coverage") or coverage)
            value["coverage"] = coverage
        token = _current.set(value)
        try:
            yield value
            if value and row:
                cx_execute(conn, "UPDATE loading_orders SET document_snapshot=%s::jsonb WHERE loading_id=%s AND order_id=%s",
                           (json.dumps(value, default=str), row["loading_id"], order_id))
        finally:
            _current.reset(token)


def shipment_operation(function):
    @wraps(function)
    @atomic_operation
    def wrapped(order_id, *args, **kwargs):
        loading_id = kwargs.pop("loading_id", None)
        with shipment_context(order_id, loading_id):
            return function(order_id, *args, **kwargs)
    return wrapped
