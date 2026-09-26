"""Wyjęcie błędnie spakowanej sztuki, wyłącznie dopóki karton jest na pakowaniu."""
from fastapi import HTTPException
from app.db import transaction, cx_query_one, cx_query_all, cx_execute
from app.utils.unit_codes import parse_unit_qr
from app.utils.ids import cuid
from app.services.stock_cartons_service import pick_line_for_unit


def undo_pack(code, container_id, operator):
    uid = parse_unit_qr(code)
    if not uid or not container_id or not operator:
        raise HTTPException(400, "Brak sztuki, kartonu lub zalogowanego operatora")
    with transaction() as conn:
        stock = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (container_id,))
        pallet = None if stock else cx_query_one(conn, "SELECT * FROM order_pallets WHERE id=%s FOR UPDATE", (container_id,))
        container = stock or pallet
        if not container:
            raise HTTPException(404, "Karton nie istnieje")
        if (container.get("cold_storage_at") or container.get("loaded_vehicle_id") or container.get("shipped_at")
                or container.get("status") not in ("open", "created", "packing", "packed")):
            raise HTTPException(409, "Karton opuścił pakowanie — korektę musi wyjaśnić biuro")
        unit = cx_query_one(conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (uid,))
        if (not unit or unit.get("status") != "packed" or unit.get("dispatch_id")
                or (unit.get("carton_id") if stock else unit.get("pallet_id")) != container_id):
            raise HTTPException(409, "Sztuka nie jest już spakowana w tym kartonie — odśwież stan")
        if stock:
            lines = cx_query_all(conn, "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY id", (container_id,))
            # Dopasowanie według tej samej specyfikacji co zapis; szukamy pozycji z zawartością.
            eligible = [{**l, "target_qty": 1, "packed_qty": 0} for l in lines if int(l["packed_qty"]) > 0]
            line = pick_line_for_unit(unit, eligible)
            if not line:
                raise HTTPException(409, "Licznik kartonu jest niespójny — zawołaj biuro")
            cx_execute(conn, "UPDATE stock_carton_lines SET packed_qty=packed_qty-1 WHERE id=%s", (line["id"],))
            cx_execute(conn, "UPDATE stock_cartons SET packed_qty=packed_qty-1,status='open',closed_at=NULL WHERE id=%s", (container_id,))
        else:
            count = cx_query_one(conn, "SELECT COUNT(*) AS n FROM finished_units WHERE pallet_id=%s", (container_id,))["n"]
            cx_execute(conn, "UPDATE order_pallets SET status=%s WHERE id=%s", ("packing" if count > 1 else "created", container_id))
        cx_execute(conn,
            """UPDATE finished_units SET status='produced',carton_id=NULL,pallet_id=NULL,
               order_id=CASE WHEN packing_previous IS NOT NULL THEN packing_previous->>'order_id' ELSE order_id END,
               client_name=CASE WHEN packing_previous IS NOT NULL THEN packing_previous->>'client_name' ELSE client_name END,
               packing_previous=NULL WHERE id=%s""", (uid,))
        cx_execute(conn, "INSERT INTO warehouse_events (id,container_id,unit_id,action,operator) VALUES (%s,%s,%s,'unpack',%s)",
                   (cuid(), container_id, uid, operator))
    return {"ok": True}
