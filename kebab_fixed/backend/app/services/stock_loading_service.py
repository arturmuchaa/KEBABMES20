"""Załadunek kartonu magazynowego jego oryginalną etykietą SCARTON."""
from fastapi import HTTPException

from app.db import transaction, cx_query_one, cx_query_all, cx_execute
from app.utils.ids import cuid, format_carton_no


def scan_carton(carton_id, action, vehicle_id, operator=""):
    if action not in ("loaded", "undo") or not vehicle_id:
        raise HTTPException(400, "Wybierz auto i skanuj karton na ekranie wydania")
    with transaction() as conn:
        # Taką samą blokadę bierze zamknięcie kursu. Skan nie dopisze towaru
        # w środku zatwierdzania listy zawartości samochodu.
        vehicle = cx_query_one(conn, "SELECT * FROM vehicles WHERE id=%s FOR UPDATE", (vehicle_id,))
        if not vehicle or not vehicle.get("active"):
            raise HTTPException(409, "Samochód nie istnieje albo jest nieaktywny")
        carton = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,))
        if not carton:
            raise HTTPException(404, "Nieznany karton")
        units = cx_query_all(conn, "SELECT * FROM finished_units WHERE carton_id=%s FOR UPDATE", (carton_id,))
        if carton.get("shipped_at") or any(u.get("status") == "shipped" or u.get("dispatch_id") for u in units):
            raise HTTPException(409, "Karton został już wydany albo jest na innym wydaniu")
        order = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s", (carton.get("linked_order_id"),))
        if not order:
            raise HTTPException(409, "Biuro musi najpierw przypisać karton do zamówienia")
        if order.get("status") in ("done", "cancelled"):
            raise HTTPException(409, "Zamówienie jest zakończone lub anulowane")
        if carton.get("loaded_vehicle_id") and carton["loaded_vehicle_id"] != vehicle_id:
            raise HTTPException(409, "Karton jest na innym aucie — cofnij go na tamtym stanowisku")
        result = "SUCCESS"
        if action == "undo":
            if carton.get("loaded_vehicle_id") != vehicle_id:
                raise HTTPException(409, "Tego kartonu nie ma na wybranym aucie")
            cx_execute(conn, "UPDATE stock_cartons SET loaded_vehicle_id=NULL, loaded_at=NULL WHERE id=%s", (carton_id,))
        else:
            if not cx_query_one(conn, "SELECT 1 FROM vehicle_loading_orders WHERE vehicle_id=%s AND order_id=%s",
                                (vehicle_id, order["id"])):
                raise HTTPException(409, "Najpierw dołóż zamówienie tego kartonu do auta")
            lines = cx_query_all(conn, "SELECT * FROM stock_carton_lines WHERE carton_id=%s", (carton_id,))
            if (carton.get("status") != "packed" or not units or not lines
                    or len(units) != sum(int(l["target_qty"]) for l in lines)
                    or any(int(l["packed_qty"]) != int(l["target_qty"]) for l in lines)
                    or any(u.get("status") != "packed" or u.get("pallet_id") for u in units)):
                raise HTTPException(409, "Karton nie jest spakowany do końca albo ma niespójny skład")
            if carton.get("loaded_vehicle_id") == vehicle_id:
                result = "ALREADY_SCANNED"
            else:
                cx_execute(conn, "UPDATE stock_cartons SET loaded_vehicle_id=%s, loaded_at=now() WHERE id=%s",
                           (vehicle_id, carton_id))
        if result == "SUCCESS":
            cx_execute(conn, "INSERT INTO warehouse_events (id,container_id,action,operator) VALUES (%s,%s,%s,%s)",
                       (cuid(), carton_id, action, operator))
    return {"result": result, "id": carton_id, "pallet_no": 0,
            "carton_no": carton["carton_no"], "carton_label": format_carton_no(carton["carton_no"]),
            "order": order, "total_qty": len(units),
            "total_kg": sum(float(u.get("weight_kg") or 0) for u in units), "items": []}
