"""Przeniesienie CAŁYCH palet zamówienia do innego zamówienia (właściciel 27.11.2026).

„YALCIN Z/7/11/26 — zamówione 21 palet, klient chce 16 na niedzielę, 5 zostaje
na poniedziałek. Bez usuwania zamówienia i rozpisywania palet na nowo, bo
magazyn będzie skanował, a system wyrzuci, że palety nie ma."

Paleta przechodzi w całości: to samo id, karton, status (mroźnia, spakowana),
miejsce w mroźni i WAŻNE ważenie — zawartość się nie zmienia, więc ważenie
nie traci sensu. Stara kartka `PAL|<źródło>|<nr>` wskazuje nowy adres przez
`pallet_label_aliases` (jak przy palecie z poczekalni, `pallet_transfer_service`);
numer palety zostaje, jeśli w celu jest wolny.

Ilości: pozycje źródła maleją o to, co wyjechało na paletach. W celu paleta
najpierw zajmuje wolną (nierozpisaną) ilość pozycji tej samej specyfikacji,
nadwyżka dolicza się do pozycji albo tworzy nową. Nowe zamówienie dostaje
dokładnie zawartość palet, ten sam status i datę wyjazdu wskazaną przez biuro.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, cx_query_all, cx_query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

ZAMKNIETE = ("done", "cancelled")


def _spec(l: Dict[str, Any]) -> tuple:
    return (l.get("recipe_id") or "", l.get("product_type_id") or "", l.get("packaging_id") or "",
            round(float(l.get("kg_per_unit") or 0), 3))


def _dokumenty(conn, order_id: str) -> List[str]:
    return [r["number"] for r in cx_query_all(
        conn, "SELECT number FROM wz_documents WHERE source_type='order' AND source_id=%s "
              "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at", (order_id,))]


def _uzyte_numery(conn, order_id: str) -> set:
    return {int(r["n"]) for r in cx_query_all(conn, """
        SELECT pallet_no AS n FROM order_pallets WHERE order_id=%s
        UNION SELECT pallet_no FROM orphan_pallets WHERE source_order_id=%s
        UNION SELECT pallet_no FROM pallet_label_aliases WHERE order_id=%s
        UNION SELECT target_pallet_no FROM pallet_label_aliases WHERE target_order_id=%s""", (order_id,) * 4)}


def _nowe_zamowienie_cx(conn, src: Dict[str, Any], delivery_date: str) -> Dict[str, Any]:
    from app.services.orders_service import _next_client_order_no
    client = cx_query_one(conn, "SELECT * FROM clients WHERE id=%s", (src.get("client_id"),)) or {}
    nazwa = client.get("display_name") or client.get("name") or src.get("client_name") or ""
    dzis = datetime.now(ZoneInfo("Europe/Warsaw")).date().isoformat()
    numer = _next_client_order_no(conn, nazwa, dzis)
    zam = cx_execute_returning(
        conn,
        """INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, delivery_date,
                                      total_kg, total_units, status, notes, created_at)
           VALUES (%s,%s,%s,%s,%s,%s,0,0,%s,%s,%s) RETURNING *""",
        (cuid(), numer, src.get("client_id"), src.get("client_name"), dzis, delivery_date,
         src.get("status") or "confirmed", f"Palety przeniesione z {src['order_no']}", now_iso()))
    assert zam is not None
    return zam


def przenies_palety(order_id: str, pallet_ids: List[str], target_order_id: str = "",
                    new_delivery_date: str = "", operator: str = "") -> Dict[str, Any]:
    """Przenieś wybrane palety zamówienia `order_id` do `target_order_id`
    (zamówienie tego samego klienta) albo do NOWEGO zamówienia z datą
    wyjazdu `new_delivery_date`."""
    from app.services import rozpis_palet_limit
    from app.services.biuro_zamowienia_service import _przelicz_sumy, przestempluj_wyrob_cx
    from app.services.stock_carton_link_service import check_order_reservations_cx
    from app.utils.pallet_numbers import reserve_pallet_numbers_cx

    ids = list(dict.fromkeys(pallet_ids or []))
    if not ids:
        raise HTTPException(400, "Zaznacz palety do przeniesienia")
    if not target_order_id and not new_delivery_date:
        raise HTTPException(400, "Wybierz zamówienie docelowe albo podaj datę wyjazdu nowego zamówienia")
    operator = operator or "biuro"

    with transaction() as conn:
        src = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,))
        if not src:
            raise HTTPException(404, "Zamówienie nie istnieje")
        if target_order_id == order_id:
            raise HTTPException(400, "Wybierz inne zamówienie niż to, z którego bierzesz palety")
        if (src.get("status") or "") in ZAMKNIETE:
            raise HTTPException(409, f"Zamówienie {src['order_no']} jest zakończone lub anulowane")

        palety = cx_query_all(
            conn, "SELECT * FROM order_pallets WHERE id = ANY(%s) ORDER BY pallet_no FOR UPDATE", (ids,))
        if len(palety) != len(ids) or any(p["order_id"] != order_id for p in palety):
            raise HTTPException(400, "Palety nie należą do tego zamówienia — odśwież okno")
        ruch = [p for p in palety if (p.get("status") or "") in ("loaded", "shipped") or p.get("loaded_vehicle_id")]
        if ruch:
            nry = ", ".join(f"P{p['pallet_no']}" for p in ruch)
            raise HTTPException(409, f"Palety {nry} są na aucie albo wydane — najpierw cofnij ich skan")
        wszystkie = cx_query_one(conn, "SELECT count(*) AS n FROM order_pallets WHERE order_id=%s", (order_id,))["n"]
        if not target_order_id and len(palety) == int(wszystkie):
            raise HTTPException(409, "To wszystkie palety zamówienia — zamiast przenosić, zmień datę wyjazdu zamówienia")
        if any(r.get("qty_invoice") is not None for r in cx_query_all(
                conn, "SELECT qty_invoice FROM client_order_lines WHERE order_id=%s", (order_id,))):
            raise HTTPException(409, f"Zamówienie {src['order_no']} ma zapisany podział WZ/faktura — "
                                     "usuń podział, przenieś palety i podziel zamówienia ponownie")

        if target_order_id:
            dst = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (target_order_id,))
            if not dst:
                raise HTTPException(404, "Zamówienie docelowe nie istnieje")
            if (dst.get("status") or "") in ZAMKNIETE:
                raise HTTPException(409, f"Zamówienie {dst['order_no']} jest zakończone lub anulowane")
            if (dst.get("client_id") or "") != (src.get("client_id") or ""):
                raise HTTPException(409, f"Zamówienie {dst['order_no']} jest innego klienta — "
                                         "palety mają na kartkach tego odbiorcę")
        else:
            dst = _nowe_zamowienie_cx(conn, src, new_delivery_date)
        for o in (src, dst):
            docs = _dokumenty(conn, o["id"])
            if docs:
                raise HTTPException(409, f"Zamówienie {o['order_no']} ma wystawione dokumenty "
                                         f"({', '.join(docs)}) — najpierw je anuluj")

        przed = {oid: (rozpis_palet_limit.nadmiar_cx(conn, oid), check_order_reservations_cx(conn, oid))
                 for oid in (src["id"], dst["id"])}

        linie_src = {r["id"]: r for r in cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s FOR UPDATE", (src["id"],))}
        linie_dst = cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s ORDER BY position FOR UPDATE", (dst["id"],))
        rozpisane_dst = {r["order_line_id"]: int(r["n"]) for r in cx_query_all(
            conn, """SELECT i.order_line_id, SUM(i.qty) AS n FROM order_pallet_items i
                       JOIN order_pallets p ON p.id=i.pallet_id WHERE p.order_id=%s
                      GROUP BY i.order_line_id""", (dst["id"],))}
        pozycje = cx_query_all(
            conn, "SELECT * FROM order_pallet_items WHERE pallet_id = ANY(%s) ORDER BY id", (ids,))

        # Ile wyjeżdża z każdej pozycji źródła (kolejność pozycji źródła).
        wyjezdza: Dict[str, int] = {}
        for it in pozycje:
            wyjezdza[it["order_line_id"]] = wyjezdza.get(it["order_line_id"], 0) + int(it["qty"] or 0)
        kolejnosc = sorted(wyjezdza, key=lambda lid: (int(linie_src[lid].get("position") or 0), lid))

        # Pozycja docelowa dla każdej pozycji źródła: wolna ilość najpierw, nadwyżka dolicza się.
        cel_linii: Dict[str, str] = {}
        poz_max = max([int(l.get("position") or 0) for l in linie_dst] or [-1])
        for lid in kolejnosc:
            l, ile = linie_src[lid], wyjezdza[lid]
            t = next((x for x in linie_dst if _spec(x) == _spec(l)), None)
            if t:
                wolne = max(0, int(t["qty"] or 0) - rozpisane_dst.get(t["id"], 0))
                if ile > wolne:
                    t["qty"] = int(t["qty"] or 0) + (ile - wolne)
                    cx_execute(conn, "UPDATE client_order_lines SET qty=%s, total_kg=%s WHERE id=%s",
                               (t["qty"], round(t["qty"] * float(t["kg_per_unit"] or 0), 3), t["id"]))
                rozpisane_dst[t["id"]] = rozpisane_dst.get(t["id"], 0) + ile
                cel_linii[lid] = t["id"]
            else:
                poz_max += 1
                nowa = cuid()
                cx_execute(conn,
                    """INSERT INTO client_order_lines (id, order_id, position, qty, kg_per_unit, total_kg,
                           product_type_id, product_type_name, recipe_id, recipe_name,
                           packaging_id, packaging_name, notes, usluga)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false)""",
                    (nowa, dst["id"], poz_max, ile, l["kg_per_unit"], round(ile * float(l["kg_per_unit"] or 0), 3),
                     l.get("product_type_id"), l.get("product_type_name"), l.get("recipe_id"), l.get("recipe_name"),
                     l.get("packaging_id"), l.get("packaging_name"), l.get("notes") or ""))
                linie_dst.append({**l, "id": nowa, "order_id": dst["id"], "qty": ile, "position": poz_max})
                rozpisane_dst[nowa] = ile
                cel_linii[lid] = nowa
            przestempluj_wyrob_cx(conn, src["order_no"], dst["order_no"], l, ile)

        # Palety: ten sam wiersz, nowe zamówienie i adres; stara kartka przez alias.
        reserve_pallet_numbers_cx(conn, src["id"])
        zajete = _uzyte_numery(conn, dst["id"])
        przeniesione = []
        for p in palety:
            nr = int(p["pallet_no"])
            if nr in zajete:
                nr = max(zajete | {reserve_pallet_numbers_cx(conn, dst["id"])}) + 1
            zajete.add(nr)
            skad = f"z {src['order_no']} P{p['pallet_no']}"
            cx_execute(conn, "UPDATE order_pallets SET order_id=%s, pallet_no=%s, notes=%s WHERE id=%s",
                       (dst["id"], nr, f"{p['notes']} · {skad}" if p.get("notes") else skad, p["id"]))
            cx_execute(conn,
                """INSERT INTO pallet_label_aliases (order_id, pallet_no, target_order_id, target_pallet_no)
                   VALUES (%s,%s,%s,%s)
                   ON CONFLICT (order_id, pallet_no) DO UPDATE
                     SET target_order_id=EXCLUDED.target_order_id,
                         target_pallet_no=EXCLUDED.target_pallet_no, created_at=now()""",
                (src["id"], p["pallet_no"], dst["id"], nr))
            przeniesione.append({"palletId": p["id"], "fromPalletNo": p["pallet_no"], "palletNo": nr,
                                 "cartonNo": p.get("carton_no")})
        reserve_pallet_numbers_cx(conn, dst["id"])
        for it in pozycje:
            cx_execute(conn, "UPDATE order_pallet_items SET order_line_id=%s WHERE id=%s",
                       (cel_linii[it["order_line_id"]], it["id"]))
        cx_execute(conn, "UPDATE finished_units SET order_id=%s WHERE pallet_id = ANY(%s)", (dst["id"], ids))
        cx_execute(conn, "UPDATE cold_storage_weighings SET order_no=%s "
                         "WHERE container_id = ANY(%s) AND invalid_at IS NULL", (dst["order_no"], ids))

        # Źródło maleje o to, co wyjechało; pusta pozycja znika, chyba że trzyma ją plan produkcji.
        for lid, ile in wyjezdza.items():
            l = linie_src[lid]
            q = max(0, int(l["qty"] or 0) - ile)
            w_planie = cx_query_one(conn, "SELECT 1 AS x FROM production_plan_lines WHERE client_order_line_id=%s LIMIT 1", (lid,))
            if q == 0 and not w_planie:
                cx_execute(conn, "DELETE FROM client_order_lines WHERE id=%s", (lid,))
            else:
                cx_execute(conn, "UPDATE client_order_lines SET qty=%s, total_kg=%s WHERE id=%s",
                           (q, round(q * float(l["kg_per_unit"] or 0), 3), lid))

        for oid in (src["id"], dst["id"]):
            _przelicz_sumy(conn, oid)
            rozpis_palet_limit.pilnuj_cx(conn, oid, przed[oid][0], "Nie można przenieść palet")
            check_order_reservations_cx(conn, oid, przed[oid][1])

    szt = sum(wyjezdza.values())
    logger.info("zamowienie.przeniesienie_palet", extra={
        "z_zamowienia": src["order_no"], "do_zamowienia": dst["order_no"], "palety": len(przeniesione),
        "sztuki": szt, "nowe": not target_order_id, "operator": operator})
    return {"ok": True, "targetOrderId": dst["id"], "targetOrderNo": dst["order_no"],
            "created": not target_order_id, "pallets": przeniesione, "units": szt}
