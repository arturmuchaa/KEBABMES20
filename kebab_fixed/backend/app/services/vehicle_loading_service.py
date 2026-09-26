"""Załadunek pojazdu — wspólny stan dla WSZYSTKICH skanerów.

Właściciel (20.09.2026): „urządzenie A realizuje zamówienie, urządzenie B nadal
widzi je jako rozpoczęte — w produkcji to niedopuszczalne".

Co było nie tak: lista zamówień pojazdu i ich kolejność żyły w `localStorage`
telefonu, a serwer był dociągany wyłącznie jako SUMA — dodawał brakujące,
nigdy nic nie odejmował. Zamówienie zamknięte na urządzeniu A nie miało
ŻADNEJ drogi, żeby zniknąć z ekranu urządzenia B.

Ten moduł jest odpowiedzią: wybór zamówień na auto mieszka w tabeli
`vehicle_loading_orders`, a `vehicle_state()` oddaje CAŁĄ prawdę o aucie
w jednym odczycie.

JEDEN ODCZYT, nie N+1 — to nie jest optymalizacja, tylko poprawność. Front
składał dotąd stan z osobnego zapytania na każde zamówienie (`refreshAll`
w pętli), więc migawka potrafiła pochodzić z różnych chwil: nagłówek mówił
„8/10", a lista palet pod spodem już „10/10".
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (cx_execute, cx_query_all, cx_query_one, query_all,
                    query_one, transaction)
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def _vehicle_or_404(vehicle_id: str) -> Dict[str, Any]:
    if not (vehicle_id or "").strip():
        raise HTTPException(400, "Brak identyfikatora pojazdu")
    veh = query_one(
        "SELECT id, name, plate, kind, active FROM vehicles WHERE id=%s", (vehicle_id,))
    if not veh:
        raise HTTPException(404, "Pojazd nie istnieje")
    return veh


# ── Wybór zamówień na auto ────────────────────────────────────────────────
def add_order(vehicle_id: str, order_id: str, operator: str = "") -> Dict[str, Any]:
    """Dopisz zamówienie na auto — widoczne natychmiast na każdym skanerze.

    Idempotentne przez `UNIQUE (vehicle_id, order_id)`: dwa urządzenia, które
    dopiszą to samo w tej samej chwili, nie zrobią duplikatu — rozstrzyga
    constraint, nie kolejność requestów.
    """
    _vehicle_or_404(vehicle_id)
    order = query_one(
        "SELECT id, order_no, status FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie istnieje")
    # Zamknięte i anulowane na auto nie wchodzą. `done` oznacza, że wszystkie
    # pozycje są już wydane (`orders_service` zamyka je dopiero wtedy), więc
    # nie ma czego ładować — a widok „Historia" pokazuje takie zamówienia
    # do wglądu i bez tej bramki dałoby się je stamtąd wciągnąć na samochód.
    stan_zam = (order.get("status") or "")
    if stan_zam in ("cancelled", "done"):
        slowo = "anulowane" if stan_zam == "cancelled" else "już zrealizowane"
        raise HTTPException(
            409, f"Zamówienie {order['order_no']} jest {slowo} — nie wchodzi na auto")

    with transaction() as conn:
        # Pozycja na końcu kolejki. Blokadę bierzemy na wierszu POJAZDU, nie na
        # `vehicle_loading_orders`: Postgres nie pozwala łączyć `FOR UPDATE`
        # z agregatem (`MAX`), a przy pustej liście nie byłoby czego blokować.
        # Wiersz pojazdu istnieje zawsze i serializuje równoczesne dopisania
        # do TEGO auta, więc dwa skanery nie dostaną tej samej pozycji.
        cx_query_one(conn, "SELECT id FROM vehicles WHERE id=%s FOR UPDATE", (vehicle_id,))
        nast = cx_query_one(
            conn,
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM vehicle_loading_orders "
            "WHERE vehicle_id=%s",
            (vehicle_id,)) or {"p": 0}
        cx_execute(
            conn,
            "INSERT INTO vehicle_loading_orders (id, vehicle_id, order_id, position, created_by) "
            "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (vehicle_id, order_id) DO NOTHING",
            (cuid(), vehicle_id, order_id, nast["p"], operator or ""))

    logger.info("vehicle_loading.add", extra={
        "vehicle_id": vehicle_id, "order_id": order_id, "operator": operator or "-"})
    return vehicle_state(vehicle_id)


def remove_order(vehicle_id: str, order_id: str, operator: str = "") -> Dict[str, Any]:
    """Zdejmij zamówienie z auta.

    Palet już zeskanowanych NIE ruszamy — to osobna decyzja (przycisk cofnięcia
    przy palecie). Zdjęcie zamówienia z listy przy załadowanych paletach
    zostawiłoby je w powietrzu, więc odmawiamy i mówimy wprost dlaczego.
    """
    _vehicle_or_404(vehicle_id)
    zaladowane = query_one(
        "SELECT COUNT(*) AS c FROM order_pallets "
        "WHERE order_id=%s AND status='loaded' AND loaded_vehicle_id=%s",
        (order_id, vehicle_id)) or {"c": 0}
    if int(zaladowane["c"] or 0) > 0:
        raise HTTPException(
            409,
            f"Na aucie stoi {zaladowane['c']} palet tego zamówienia — "
            "najpierw zdejmij je przyciskiem cofnięcia przy palecie")

    with transaction() as conn:
        cx_query_one(conn, "SELECT id FROM vehicles WHERE id=%s FOR UPDATE", (vehicle_id,))
        if cx_query_one(conn,
            """SELECT id FROM order_pallets WHERE order_id=%s AND status='loaded' AND loaded_vehicle_id=%s
               UNION ALL SELECT id FROM stock_cartons WHERE linked_order_id=%s AND loaded_vehicle_id=%s AND shipped_at IS NULL LIMIT 1""",
            (order_id, vehicle_id, order_id, vehicle_id)):
            raise HTTPException(409, "Na aucie jest towar tego zamówienia — najpierw cofnij załadunek")
        cx_execute(
            conn,
            "DELETE FROM vehicle_loading_orders WHERE vehicle_id=%s AND order_id=%s",
            (vehicle_id, order_id))

    logger.info("vehicle_loading.remove", extra={
        "vehicle_id": vehicle_id, "order_id": order_id, "operator": operator or "-"})
    return vehicle_state(vehicle_id)


def reorder(vehicle_id: str, order_ids: List[str], operator: str = "") -> Dict[str, Any]:
    """Ustaw kolejność załadunku — też wspólna, nie per telefon."""
    _vehicle_or_404(vehicle_id)
    with transaction() as conn:
        for poz, oid in enumerate(order_ids or []):
            cx_execute(
                conn,
                "UPDATE vehicle_loading_orders SET position=%s "
                "WHERE vehicle_id=%s AND order_id=%s", (poz, vehicle_id, oid))
    return vehicle_state(vehicle_id)


def clear_vehicle(vehicle_id: str, operator: str = "") -> Dict[str, Any]:
    """Wyczyść auto. Z załadowanymi paletami odmawiamy — patrz `remove_order`."""
    _vehicle_or_404(vehicle_id)
    zaladowane = query_one(
        "SELECT COUNT(*) AS c FROM order_pallets "
        "WHERE status='loaded' AND loaded_vehicle_id=%s", (vehicle_id,)) or {"c": 0}
    if int(zaladowane["c"] or 0) > 0:
        raise HTTPException(
            409,
            f"Na aucie stoi {zaladowane['c']} załadowanych palet — "
            "zdejmij je albo zakończ załadunek")
    with transaction() as conn:
        cx_query_one(conn, "SELECT id FROM vehicles WHERE id=%s FOR UPDATE", (vehicle_id,))
        if cx_query_one(conn,
            """SELECT id FROM order_pallets WHERE status='loaded' AND loaded_vehicle_id=%s
               UNION ALL SELECT id FROM stock_cartons WHERE loaded_vehicle_id=%s AND shipped_at IS NULL LIMIT 1""",
            (vehicle_id, vehicle_id)):
            raise HTTPException(409, "Na aucie jest towar — cofnij go albo zakończ załadunek")
        cx_execute(conn, "DELETE FROM vehicle_loading_orders WHERE vehicle_id=%s", (vehicle_id,))
    logger.info("vehicle_loading.clear", extra={
        "vehicle_id": vehicle_id, "operator": operator or "-"})
    return vehicle_state(vehicle_id)


def order_ids_on_vehicle(vehicle_id: str) -> List[str]:
    """Same identyfikatory, w kolejności załadunku — dla `finalize_loading`."""
    if not (vehicle_id or "").strip():
        return []
    return [r["order_id"] for r in query_all(
        "SELECT order_id FROM vehicle_loading_orders WHERE vehicle_id=%s "
        "ORDER BY position, created_at", (vehicle_id,))]


def release_orders(conn, vehicle_id: str, order_ids: List[str]) -> None:
    """Zdejmij zamówienia z auta PO zamknięciu załadunku — w JEGO transakcji.

    Wywoływane z `finalize_loading`: dopiero to sprawia, że zamówienie znika
    ze WSZYSTKICH skanerów naraz. Wcześniej urządzenie, które nie kliknęło
    „Zakończ", trzymało je u siebie w nieskończoność.
    """
    if not order_ids:
        return
    cx_execute(
        conn,
        "DELETE FROM vehicle_loading_orders WHERE vehicle_id=%s AND order_id = ANY(%s)",
        (vehicle_id, list(order_ids)))


# ── Migawka stanu auta ────────────────────────────────────────────────────
def vehicle_state(vehicle_id: str) -> Dict[str, Any]:
    """CAŁA prawda o aucie w JEDNYM spójnym odczycie.

    Zwraca pojazd, zamówienia w kolejności załadunku, palety każdego z nich
    i sumy — wszystko z jednej transakcji, więc nagłówek i lista pod nim nie
    mogą pokazywać dwóch różnych chwil.
    """
    veh = _vehicle_or_404(vehicle_id)

    with transaction() as conn:
        zamowienia = cx_query_all(
            conn,
            """SELECT vlo.order_id AS id, vlo.position,
                      o.order_no, o.client_name, o.delivery_date,
                      o.status AS order_status
                 FROM vehicle_loading_orders vlo
                 JOIN client_orders o ON o.id = vlo.order_id
                WHERE vlo.vehicle_id = %s
                ORDER BY vlo.position, vlo.created_at""",
            (vehicle_id,))
        ids = [z["id"] for z in zamowienia]

        palety: List[Dict[str, Any]] = []
        if ids:
            palety = cx_query_all(
                conn,
                """SELECT p.id, p.order_id, p.pallet_no, p.carton_no, p.status, p.notes,
                          p.loaded_vehicle_id, p.cold_storage_at, p.loaded_at,
                          COALESCE(SUM(pi.qty), 0)::int AS total_qty,
                          COALESCE(SUM(pi.qty * COALESCE(l.kg_per_unit, 0)), 0)::float AS total_kg
                     FROM order_pallets p
                     LEFT JOIN order_pallet_items pi ON pi.pallet_id = p.id
                     LEFT JOIN client_order_lines l  ON l.id = pi.order_line_id
                    WHERE p.order_id = ANY(%s)
                    GROUP BY p.id
                    ORDER BY p.order_id, p.pallet_no""",
                (ids,))
            # Zamówienie bez ani jednej palety jest normalne (biuro jeszcze go
            # nie rozpisało), a `ANY(ARRAY[])` bez rzutowania typu wywraca
            # psycopg2 — pytamy tylko gdy jest o co.
            id_palet = [p["id"] for p in palety]
            pozycje = cx_query_all(
                conn,
                """SELECT pi.pallet_id,
                          COALESCE(l.kg_per_unit, 0)::float AS kg_per_unit,
                          SUM(pi.qty)::int AS qty
                     FROM order_pallet_items pi
                     LEFT JOIN client_order_lines l ON l.id = pi.order_line_id
                    WHERE pi.pallet_id = ANY(%s)
                    GROUP BY pi.pallet_id, l.kg_per_unit
                    ORDER BY pi.pallet_id, l.kg_per_unit DESC""",
                (id_palet,)) if id_palet else []
        else:
            pozycje = []

        if ids:
            cartons = cx_query_all(conn,
                """SELECT sc.id, sc.linked_order_id AS order_id, 0 AS pallet_no,
                          sc.carton_no, sc.loaded_vehicle_id, sc.cold_storage_at,
                          'SCARTON|' || sc.id AS scan_code,
                          CASE WHEN sc.shipped_at IS NOT NULL THEN 'shipped'
                               WHEN sc.loaded_vehicle_id IS NOT NULL THEN 'loaded'
                               WHEN sc.cold_storage_at IS NOT NULL THEN 'cold_storage'
                               ELSE sc.status END AS status,
                          COALESCE(SUM(l.target_qty),0)::int AS total_qty,
                          COALESCE(SUM(l.target_qty*l.kg_per_unit),0)::float AS total_kg
                   FROM stock_cartons sc LEFT JOIN stock_carton_lines l ON l.carton_id=sc.id
                   WHERE sc.linked_order_id=ANY(%s)
                   GROUP BY sc.id ORDER BY sc.carton_no""", (ids,))
            palety.extend(cartons)

    wg_palety: Dict[str, List[Dict[str, Any]]] = {}
    for poz in pozycje:
        wg_palety.setdefault(poz["pallet_id"], []).append(
            {"qty": poz["qty"], "kg_per_unit": poz["kg_per_unit"]})

    wg_zamowienia: Dict[str, List[Dict[str, Any]]] = {}
    for p in palety:
        p["items"] = wg_palety.get(p["id"], [])
        # `loaded` liczy się TYLKO na TYM aucie. Paleta tego samego zamówienia
        # stojąca na innym samochodzie nie jest postępem tego załadunku.
        p["on_this_vehicle"] = (
            p.get("status") == "loaded" and p.get("loaded_vehicle_id") == vehicle_id)
        wg_zamowienia.setdefault(p["order_id"], []).append(p)

    suma = {"total_pallets": 0, "loaded_pallets": 0, "shipped_pallets": 0,
            "total_kg": 0.0, "loaded_kg": 0.0}
    wynik: List[Dict[str, Any]] = []
    for z in zamowienia:
        moje = wg_zamowienia.get(z["id"], [])
        # Palety WYSŁANE już pojechały — nie są ani celem, ani postępem.
        zywe = [p for p in moje if p.get("status") != "shipped"]
        t = {
            "total_pallets":   len(zywe),
            "loaded_pallets":  sum(1 for p in zywe if p["on_this_vehicle"]),
            "cold_pallets":    sum(1 for p in zywe if p.get("status") == "cold_storage"),
            "created_pallets": sum(1 for p in zywe if (p.get("status") or "created") == "created"),
            "shipped_pallets": sum(1 for p in moje if p.get("status") == "shipped"),
            "total_kg":        sum(float(p["total_kg"] or 0) for p in zywe),
            "loaded_kg":       sum(float(p["total_kg"] or 0) for p in zywe if p["on_this_vehicle"]),
        }
        wynik.append({**z, "pallets": zywe, "totals": t})
        for k in ("total_pallets", "loaded_pallets", "shipped_pallets", "total_kg", "loaded_kg"):
            suma[k] += t[k]

    return {
        "vehicle": veh,
        "orders": wynik,
        "totals": suma,
        # Znacznik serwera — front pokazuje po nim „dane sprzed N s" i wie,
        # że stoi na świeżej migawce, a nie na czymś, co sam sobie zapamiętał.
        "server_time": (query_one("SELECT now() AS t") or {}).get("t"),
    }
