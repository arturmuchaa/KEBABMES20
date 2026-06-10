"""Zamknięcie załadunku pojazdu (B2) — rozchód, dokumenty, weryfikacja rozjazdu.

Dwa tryby pracy biura:
* „przygotuj wcześniej": WZ z zamówienia istnieje (kierowca dostał wydruki) —
  zamknięcie załadunku NIE robi drugiego rozchodu (zrobił go WZ), tylko
  WERYFIKUJE dokument vs faktycznie załadowane sztuki: zgodne →
  loading_status='potwierdzony'; różnice → 'rozjazd' + loading_diff
  (biuro musi skorygować dokument przed fakturą).
* dokumenty przy załadunku: WZ nie istnieje → powstaje z faktycznej
  zawartości auta (twardy link sztuka→wyrób) + rozchód + 'potwierdzony'.

HDI: istniejący dostaje nr rejestracyjny pojazdu; brakujący jest
dogenerowany (best-effort — błąd HDI nie blokuje rozchodu).
"""
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.settings_service import get_company
from app.services.wz_service import _insert_wz, _seller_block, build_goods_wz_lines
from app.utils.stock import create_stock_movement
from app.utils.unit_codes import SHIPPED, group_units_by_goods

logger = get_logger(__name__)


def _line_key(recipe_id: Any, kg_per_unit: Any, batch_no: Any) -> Tuple[str, float, str]:
    return (str(recipe_id or ""), round(float(kg_per_unit or 0), 3), str(batch_no or "").strip())


def aggregate_loaded_units(units: List[Dict[str, Any]]) -> Dict[Tuple, Dict[str, Any]]:
    """Agregat załadowanych sztuk per (receptura, waga, partia MIĘSA) → qty.
    Klucz zgodny z liniami WZ z zamówienia (też nosi partię mięsa)."""
    agg: Dict[Tuple, Dict[str, Any]] = {}
    for u in units:
        k = _line_key(u.get("recipe_id"), u.get("weight_kg"), u.get("batch_no"))
        g = agg.setdefault(k, {"qty": 0, "kg": 0.0})
        g["qty"] += 1
        g["kg"] += float(u.get("weight_kg") or 0)
    return agg


def verify_wz_against_loaded(
    wz_lines: List[Dict[str, Any]], loaded: Dict[Tuple, Dict[str, Any]]
) -> Tuple[str, List[Dict[str, Any]]]:
    """Porównaj pozycje dokumentu WZ z faktycznym załadunkiem.

    Zwraca (status, diff): status 'potwierdzony' gdy wszystkie ilości
    się zgadzają, inaczej 'rozjazd'; diff = pełna lista pozycji
    {name, batch_no, doc_qty, loaded_qty, diff} (diff = loaded - doc).
    """
    doc: Dict[Tuple, Dict[str, Any]] = {}
    for ln in wz_lines or []:
        k = _line_key(ln.get("recipe_id"), ln.get("kg_per_unit"), ln.get("batch_no"))
        d = doc.setdefault(k, {"qty": 0, "name": ln.get("name") or ""})
        d["qty"] += int(ln.get("qty") or 0)

    diff: List[Dict[str, Any]] = []
    ok = True
    for k in sorted(set(doc) | set(loaded)):
        doc_qty = int(doc.get(k, {}).get("qty") or 0)
        loaded_qty = int(loaded.get(k, {}).get("qty") or 0)
        name = doc.get(k, {}).get("name") or f"receptura {k[0]} {k[1]}kg".strip()
        delta = loaded_qty - doc_qty
        if delta != 0:
            ok = False
        diff.append({"name": name, "batch_no": k[2] or None,
                     "doc_qty": doc_qty, "loaded_qty": loaded_qty, "diff": delta})
    return ("potwierdzony" if ok else "rozjazd"), diff


def _loaded_pallets(conn, vehicle_id: str, order_id: str) -> List[Dict[str, Any]]:
    return cx_query_all(
        conn,
        """SELECT id, pallet_no FROM order_pallets
           WHERE order_id=%s AND status='loaded' AND loaded_vehicle_id=%s
           ORDER BY pallet_no""",
        (order_id, vehicle_id))


def _units_on_pallets(conn, pallet_ids: List[str]) -> List[Dict[str, Any]]:
    if not pallet_ids:
        return []
    return cx_query_all(
        conn,
        """SELECT fu.id, fu.recipe_id, fu.weight_kg, fu.batch_no, fu.status,
                  fu.source_finished_goods_id, r.name AS recipe_name
           FROM finished_units fu
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           WHERE fu.pallet_id = ANY(%s)""",
        (pallet_ids,))


def _order_buyer(conn, order: Dict[str, Any]) -> Dict[str, Any]:
    client = None
    if order.get("client_id"):
        client = cx_query_one(conn, "SELECT name, address, city, nip FROM clients WHERE id=%s",
                              (order.get("client_id"),))
    if not client:
        client = cx_query_one(conn, "SELECT name, address, city, nip FROM clients WHERE name=%s",
                              (order.get("client_name"),))
    client = client or {}
    return {"name": client.get("name") or order.get("client_name") or "",
            "address": f"{client.get('address') or ''} {client.get('city') or ''}".strip(),
            "nip": client.get("nip") or ""}


def _ensure_hdi(order_id: str, plate: str) -> Dict[str, Any]:
    """HDI dla zamówienia: dogeneruj gdy brak, wpisz nr rejestracyjny.
    Best-effort — błąd nie blokuje zamknięcia załadunku."""
    from app.services.hdi_service import generate_hdi
    try:
        doc = generate_hdi(order_id)
        if plate:
            with transaction() as conn:
                cx_execute(
                    conn,
                    """UPDATE hdi_documents
                       SET header = jsonb_set(COALESCE(header,'{}'::jsonb),
                                              '{reg_number}', to_jsonb(%s::text))
                       WHERE id=%s""",
                    (plate, doc["id"]))
        return {"hdi_number": doc.get("number"), "hdi_id": doc.get("id"), "hdi_error": None}
    except Exception as exc:  # noqa: BLE001 — dokument pomocniczy, raportujemy zamiast blokować
        logger.warning("loading.hdi_failed", extra={"order_id": order_id, "error": str(exc)})
        return {"hdi_number": None, "hdi_id": None, "hdi_error": str(exc)}


def finalize_loading(
    vehicle_id: str,
    order_ids: List[str],
    operator: str = "",
    plate: str = "",
) -> Dict[str, Any]:
    """Zamknij załadunek pojazdu dla wskazanych zamówień (atomowo per całość):
    sztuki z załadowanych palet → shipped; WZ: weryfikacja istniejącego
    (bez drugiego rozchodu) albo utworzenie z zawartości auta + rozchód."""
    if not vehicle_id or not order_ids:
        raise HTTPException(400, "vehicle_id i order_ids wymagane")
    vehicle = query_one("SELECT id, name, plate FROM vehicles WHERE id=%s", (vehicle_id,))
    if not vehicle:
        raise HTTPException(404, "Pojazd nie znaleziony")
    effective_plate = (plate or "").strip().upper() or (vehicle.get("plate") or "")

    results: List[Dict[str, Any]] = []
    with transaction() as conn:
        for order_id in order_ids:
            order = cx_query_one(
                conn, "SELECT id, order_no, client_name, client_id FROM client_orders WHERE id=%s",
                (order_id,))
            if not order:
                raise HTTPException(404, f"Zamówienie {order_id} nie znalezione")

            pallets = _loaded_pallets(conn, vehicle_id, order_id)
            units_all = _units_on_pallets(conn, [p["id"] for p in pallets])
            units = [u for u in units_all if u.get("status") != SHIPPED]  # idempotencja
            if not units_all:
                results.append({"order_id": order_id, "order_no": order.get("order_no"),
                                "client_name": order.get("client_name"),
                                "pallets": len(pallets), "skipped": "brak załadowanych sztuk"})
                continue

            loaded_agg = aggregate_loaded_units(units_all)

            existing = cx_query_one(
                conn,
                "SELECT id, number, lines FROM wz_documents "
                "WHERE source_type='order' AND source_id=%s ORDER BY created_at LIMIT 1",
                (order_id,))

            if existing:
                # Tryb „przygotuj wcześniej": rozchód zrobił WZ przy wystawieniu —
                # tu tylko weryfikacja dokumentu z faktycznym załadunkiem.
                wz_lines = existing.get("lines")
                if isinstance(wz_lines, str):
                    wz_lines = json.loads(wz_lines or "[]")
                status, diff = verify_wz_against_loaded(wz_lines or [], loaded_agg)
                cx_execute(
                    conn,
                    """UPDATE wz_documents
                       SET loading_status=%s, loading_diff=%s::jsonb,
                           loaded_at=now(), vehicle_plate=%s
                       WHERE id=%s""",
                    (status, json.dumps(diff), effective_plate, existing["id"]))
                wz_number, wz_id = existing["number"], existing["id"]
            else:
                # Dokumenty przy załadunku: WZ z faktycznej zawartości + rozchód.
                groups, unlinked = group_units_by_goods(units)
                if unlinked:
                    raise HTTPException(
                        400,
                        f"{order.get('order_no')}: {len(unlinked)} szt na paletach nie ma "
                        "powiązania z wyrobem gotowym (dzień produkcji niezamknięty?). "
                        "Zatwierdź produkcję w biurze i spróbuj ponownie.")
                goods_with_counts = []
                for gid in sorted(groups):
                    fg = cx_query_one(
                        conn,
                        """SELECT id, batch_no, recipe_id, recipe_name, product_type_name,
                                  qty_available, kg_per_unit
                           FROM finished_goods WHERE id=%s FOR UPDATE""",
                        (gid,))
                    if not fg:
                        raise HTTPException(400, f"Wyrób gotowy {gid} nie istnieje")
                    need = int(groups[gid]["count"])
                    avail = int(fg.get("qty_available") or 0)
                    if avail < need:
                        raise HTTPException(
                            400,
                            f"{order.get('order_no')}: za mało na stanie (partia "
                            f"{fg.get('batch_no')}): jest {avail} szt, załadowano {need}")
                    goods_with_counts.append({"goods": fg, "count": need})

                issued = date.today().isoformat()
                wz_id = _insert_wz(
                    conn, source_type="order", source_id=order_id, seller=_seller_block(),
                    buyer=_order_buyer(conn, order), valued=False,
                    lines=build_goods_wz_lines(goods_with_counts), total=0.0,
                    place=get_company().get("city") or "", issued=issued, released=issued,
                    notes="Wystawiony przy załadunku.")
                for g in goods_with_counts:
                    fg, take = g["goods"], g["count"]
                    cx_execute(
                        conn,
                        "UPDATE finished_goods SET qty_available=qty_available-%s, "
                        "qty_shipped=qty_shipped+%s WHERE id=%s",
                        (take, take, fg["id"]))
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=fg["id"],
                        qty=take * float(fg.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="wz", source_id=wz_id)
                status, diff = "potwierdzony", []
                cx_execute(
                    conn,
                    """UPDATE wz_documents
                       SET loading_status=%s, loading_diff='[]'::jsonb,
                           loaded_at=now(), vehicle_plate=%s
                       WHERE id=%s""",
                    (status, effective_plate, wz_id))
                wz_number = cx_query_one(
                    conn, "SELECT number FROM wz_documents WHERE id=%s", (wz_id,))["number"]

            if units:
                cx_execute(
                    conn,
                    "UPDATE finished_units SET status=%s WHERE id = ANY(%s)",
                    (SHIPPED, [u["id"] for u in units]))
            if pallets:
                cx_execute(
                    conn,
                    "UPDATE order_pallets SET status='shipped' WHERE id = ANY(%s)",
                    ([p["id"] for p in pallets],))

            results.append({
                "order_id": order_id,
                "order_no": order.get("order_no"),
                "client_name": order.get("client_name"),
                "pallets": len(pallets),
                "units": len(units_all),
                "wz_id": wz_id,
                "wz_number": wz_number,
                "wz_status": status,
                "diff": [d for d in diff if d.get("diff")],
            })

    # HDI poza transakcją rozchodu (best-effort, własne transakcje).
    for r in results:
        if r.get("skipped"):
            continue
        r.update(_ensure_hdi(r["order_id"], effective_plate))

    logger.info("loading.finalized", extra={
        "vehicle_id": vehicle_id, "orders": len(results),
        "rozjazd": sum(1 for r in results if r.get("wz_status") == "rozjazd")})
    return {"ok": True, "vehicle_id": vehicle_id, "plate": effective_plate, "orders": results}


def loading_document(vehicle_id: str, order_ids: List[str]) -> Dict[str, Any]:
    """Dokument wydania dla kierowcy (render po stronie mobile):
    pojazd + per zamówienie palety i pozycje (produkt, szt, kg)."""
    vehicle = query_one("SELECT id, name, plate FROM vehicles WHERE id=%s", (vehicle_id,))
    if not vehicle:
        raise HTTPException(404, "Pojazd nie znaleziony")

    orders_out: List[Dict[str, Any]] = []
    for order_id in order_ids or []:
        order = query_one(
            "SELECT id, order_no, client_name, delivery_date FROM client_orders WHERE id=%s",
            (order_id,))
        if not order:
            continue
        pallets = query_all(
            """SELECT id, pallet_no FROM order_pallets
               WHERE order_id=%s AND status IN ('loaded','shipped') AND loaded_vehicle_id=%s
               ORDER BY pallet_no""",
            (order_id, vehicle_id))
        units = query_all(
            """SELECT fu.recipe_id, fu.weight_kg, r.name AS recipe_name
               FROM finished_units fu LEFT JOIN recipes r ON r.id=fu.recipe_id
               WHERE fu.pallet_id = ANY(%s)""",
            ([p["id"] for p in pallets],)) if pallets else []
        items_agg: Dict[Tuple, Dict[str, Any]] = {}
        for u in units:
            kg = round(float(u.get("weight_kg") or 0), 3)
            k = (u.get("recipe_id") or "", kg)
            it = items_agg.setdefault(k, {
                "recipe_name": f"{u.get('recipe_name') or 'Kebab'} {int(kg) if kg.is_integer() else kg}kg",
                "qty": 0, "total_kg": 0.0})
            it["qty"] += 1
            it["total_kg"] = round(it["total_kg"] + kg, 3)
        items = sorted(items_agg.values(), key=lambda x: x["recipe_name"])
        orders_out.append({
            "order_no": order.get("order_no"),
            "client_name": order.get("client_name"),
            "delivery_date": str(order.get("delivery_date") or ""),
            "pallets": [{"pallet_no": p["pallet_no"]} for p in pallets],
            "items": items,
            "total_units": sum(i["qty"] for i in items),
            "total_kg": round(sum(i["total_kg"] for i in items), 3),
        })

    return {"vehicle": {"name": vehicle.get("name") or "", "plate": vehicle.get("plate") or ""},
            "orders": orders_out}
