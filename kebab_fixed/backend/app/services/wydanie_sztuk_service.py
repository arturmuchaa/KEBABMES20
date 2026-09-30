"""Wydanie POJEDYNCZYCH sztuk z kiosku magazynu (właściciel 30.09.2026).

Przypadek z hali: klient odbiera sam albo nasze auto zabiera „tylko 3 × 50 kg".
Magazynier wybiera klienta, skanuje sztuki — każda od razu WYCHODZI ze swojego
kartonu (także z mroźni i z palety innego zamówienia; decyzja właściciela:
„z każdego kartonu"), więc stan mroźni jest prawdziwy po skanie. Karton robi się
niepełny, a jego ważenie traci ważność („do zważenia") — stara etykieta wagi
już do niego nie pasuje.

Kiosk NICZEGO nie wystawia. „Przekaż do biura" oznacza wydanie jako gotowe
(`status='ready'`), a biuro wystawia WZ (`dispatches_service.close_dispatch`,
tam też rozchód magazynu wyrobów), potem HDI z WZ i ewentualnie CMR.
Faktura zostaje w Subiekcie.

Sztuka na wydaniu: `status='produced'`, bez kartonu, z `dispatch_id` — tak samo
jak sztuka wydawana luzem z telefonu. `dispatch_from` pamięta karton, z którego
wyszła: „Cofnij" odkłada ją tam z powrotem, póki wydanie nie poszło do biura.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.stock_cartons_service import pick_line_for_unit
from app.utils.ids import cuid, format_carton_no, now_iso
from app.utils.unit_codes import SHIPPED, parse_unit_qr

logger = get_logger(__name__)

ZRODLO = "kiosk"
ODBIORY = {"klient": "odbiór przez klienta", "nasze": "nasze auto"}


# ── Odczyty ────────────────────────────────────────────────────────────────

def klienci() -> List[Dict[str, Any]]:
    """Kartoteka odbiorców do wyboru na kiosku (dotykowo, z wyszukiwarką)."""
    rows = query_all(
        "SELECT id, name, display_name FROM clients ORDER BY COALESCE(NULLIF(display_name,''), name)")
    return [{"id": r["id"], "name": r.get("name") or "",
             "displayName": r.get("display_name") or r.get("name") or ""} for r in rows]


def _sztuki(dispatch_id: str) -> List[Dict[str, Any]]:
    rows = query_all(
        """SELECT fu.id, fu.weight_kg, fu.batch_no, fu.dispatch_from,
                  r.name AS recipe_name, pt.name AS product_type_name
           FROM finished_units fu
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           LEFT JOIN product_types pt ON pt.id = fu.product_type_id
           WHERE fu.dispatch_id = %s
           ORDER BY fu.weight_kg DESC, r.name, fu.id""",
        (dispatch_id,),
    )
    out = []
    for r in rows:
        z = r.get("dispatch_from") or {}
        if isinstance(z, str):
            z = json.loads(z or "{}")
        out.append({
            "id": r["id"], "kg": round(float(r.get("weight_kg") or 0), 3),
            "batchNo": r.get("batch_no") or "",
            "recipeName": r.get("recipe_name") or "", "productTypeName": r.get("product_type_name") or "",
            "fromCartonNo": z.get("cartonNo") or "", "fromClient": z.get("clientName") or "",
        })
    return out


def _publiczne(d: Dict[str, Any]) -> Dict[str, Any]:
    sztuki = _sztuki(d["id"])
    return {
        "id": d["id"], "status": d.get("status") or "open",
        "clientId": d.get("client_id") or "", "clientName": d.get("client_name") or "",
        "pickup": d.get("pickup") or "", "vehicleId": d.get("vehicle_id") or "",
        "operator": d.get("operator") or "", "notes": d.get("notes") or "",
        "createdAt": str(d.get("created_at") or ""), "handedAt": str(d.get("handed_at") or ""),
        "qty": len(sztuki), "kg": round(sum(s["kg"] for s in sztuki), 3), "units": sztuki,
    }


def szczegoly(dispatch_id: str) -> Dict[str, Any]:
    d = query_one("SELECT * FROM dispatches WHERE id=%s", (dispatch_id,))
    if not d:
        raise HTTPException(404, "Wydanie nie znalezione")
    return _publiczne(d)


def otwarte() -> List[Dict[str, Any]]:
    """Wydania z kiosku jeszcze nie przekazane do biura — do wznowienia."""
    rows = query_all(
        "SELECT * FROM dispatches WHERE source=%s AND status='open' ORDER BY created_at", (ZRODLO,))
    return [_publiczne(d) for d in rows]


def do_wystawienia() -> List[Dict[str, Any]]:
    """Dla biura: przekazane z kiosku, czekają na WZ."""
    rows = query_all(
        "SELECT * FROM dispatches WHERE source=%s AND status='ready' ORDER BY handed_at", (ZRODLO,))
    return [_publiczne(d) for d in rows]


# ── Zapis ──────────────────────────────────────────────────────────────────

def zaloz(client_id: str, pickup: str, vehicle_id: Optional[str], operator: str) -> Dict[str, Any]:
    cli = query_one("SELECT id, name, display_name FROM clients WHERE id=%s", (client_id or "",))
    if not cli:
        raise HTTPException(400, "Wybierz klienta")
    if pickup not in ODBIORY:
        raise HTTPException(400, "Wybierz: odbiór przez klienta albo nasze auto")
    did = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """INSERT INTO dispatches (id, client_id, client_name, vehicle_id, cmr_requested,
                                       status, operator, created_at, source, pickup, notes)
               VALUES (%s,%s,%s,%s,false,'open',%s,%s,%s,%s,%s)""",
            (did, cli["id"], cli.get("display_name") or cli.get("name") or "",
             (vehicle_id or None) if pickup == "nasze" else None, operator or "", now_iso(),
             ZRODLO, pickup, ODBIORY[pickup]),
        )
    logger.info("wydanie_sztuk.zalozone", extra={"dispatch_id": did, "client_id": cli["id"]})
    return szczegoly(did)


def _otwarte_wydanie(conn, dispatch_id: str) -> Dict[str, Any]:
    d = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
    if not d:
        raise HTTPException(404, "Wydanie nie znalezione")
    if d.get("status") != "open":
        raise HTTPException(409, "Wydanie przekazane do biura — zmian nie ma")
    return d


def _uniewaznij_wazenie(conn, container_id: str) -> None:
    cx_execute(conn, "UPDATE cold_storage_weighings SET invalid_at=now() "
                     "WHERE container_id=%s AND invalid_at IS NULL", (container_id,))


def _wyjmij_z_kartonu(conn, unit: Dict[str, Any]) -> Dict[str, Any]:
    """Zdejmij sztukę z kartonu magazynowego albo palety zamówienia.
    Zwraca opis kartonu źródłowego (do `dispatch_from` i komunikatu)."""
    if unit.get("carton_id"):
        cid = unit["carton_id"]
        c = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (cid,))
        if c and (c.get("loaded_vehicle_id") or c.get("shipped_at")):
            raise HTTPException(409, "Karton tej sztuki jest już na aucie albo wydany")
        if c:
            lines = cx_query_all(conn, "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY id", (cid,))
            pelne = [{**l, "target_qty": 1, "packed_qty": 0} for l in lines if int(l["packed_qty"] or 0) > 0]
            line = pick_line_for_unit(unit, pelne)
            if line:
                cx_execute(conn, "UPDATE stock_carton_lines SET packed_qty=packed_qty-1 WHERE id=%s", (line["id"],))
            cx_execute(conn, "UPDATE stock_cartons SET packed_qty=GREATEST(packed_qty-1,0), status='open', "
                             "closed_at=NULL WHERE id=%s", (cid,))
            _uniewaznij_wazenie(conn, cid)
        return {"kind": "stock", "id": cid,
                "cartonNo": format_carton_no(c["carton_no"]) if c and c.get("carton_no") else "",
                "clientName": (c or {}).get("client_name") or "", "orderId": unit.get("order_id") or ""}
    if unit.get("pallet_id"):
        pid = unit["pallet_id"]
        p = cx_query_one(
            conn, """SELECT p.*, o.order_no, o.client_name FROM order_pallets p
                     LEFT JOIN client_orders o ON o.id = p.order_id WHERE p.id=%s FOR UPDATE OF p""", (pid,))
        if p and p.get("status") in ("loaded", "shipped"):
            raise HTTPException(409, "Karton tej sztuki jest już na aucie albo wydany")
        if p and p.get("status") == "packed":
            # Pełna paleta przestaje być pełna. W mroźni zostaje w mroźni.
            cx_execute(conn, "UPDATE order_pallets SET status='packing' WHERE id=%s", (pid,))
        if p:
            _uniewaznij_wazenie(conn, pid)
        return {"kind": "order", "id": pid, "palletNo": int((p or {}).get("pallet_no") or 0),
                "cartonNo": format_carton_no(p["carton_no"]) if p and p.get("carton_no") else "",
                "clientName": (p or {}).get("client_name") or "", "orderId": (p or {}).get("order_id") or "",
                "orderNo": (p or {}).get("order_no") or ""}
    return {"kind": "loose"}


def skanuj(dispatch_id: str, code: str, operator: str = "") -> Dict[str, Any]:
    """Skan sztuki na wydanie. Odmowy to zwykła odpowiedź (`result`), nie błąd:
    OK / ALREADY (już na tym wydaniu) / OTHER_DISPATCH / SHIPPED / NOT_PRODUCED / INVALID."""
    uid = parse_unit_qr(code or "")
    if not uid:
        return {"result": "INVALID", "code": code}
    with transaction() as conn:
        _otwarte_wydanie(conn, dispatch_id)
        unit = cx_query_one(conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (uid,))
        if not unit:
            return {"result": "INVALID", "code": code}
        juz = unit.get("dispatch_id") == dispatch_id
        if not juz:
            if unit.get("dispatch_id"):
                return {"result": "OTHER_DISPATCH"}
            if unit.get("status") == SHIPPED:
                return {"result": "SHIPPED"}
            if unit.get("status") not in ("produced", "packed"):
                return {"result": "NOT_PRODUCED", "status": unit.get("status") or ""}
            skad = _wyjmij_z_kartonu(conn, unit)
            _zapisz_na_wydanie(conn, dispatch_id, unit, skad, operator)
    if juz:
        return {"result": "ALREADY", **szczegoly(dispatch_id)}
    logger.info("wydanie_sztuk.skan", extra={"dispatch_id": dispatch_id, "unit_id": uid,
                                             "zrodlo": skad.get("kind")})
    return {"result": "OK", "from": skad, **szczegoly(dispatch_id)}


def _zapisz_na_wydanie(conn, dispatch_id: str, unit: Dict[str, Any], skad: Dict[str, Any],
                       operator: str = "") -> None:
    cx_execute(
        conn,
        """UPDATE finished_units SET status='produced', carton_id=NULL, pallet_id=NULL,
               order_id=NULL, packing_previous=NULL, dispatch_id=%s, dispatch_from=%s::jsonb
           WHERE id=%s""",
        (dispatch_id, json.dumps({**skad, "orderIdBefore": unit.get("order_id") or "",
                                  "clientNameBefore": unit.get("client_name") or "",
                                  "statusBefore": unit.get("status") or ""}), unit["id"]),
    )
    cx_execute(conn, "INSERT INTO warehouse_events (id,container_id,unit_id,action,operator) "
                     "VALUES (%s,%s,%s,'dispatch_pick',%s)",
               (cuid(), skad.get("id") or dispatch_id, unit["id"], operator or ""))


def cofnij(dispatch_id: str, unit_id: str) -> Dict[str, Any]:
    """Zdejmij sztukę z wydania i odłóż do kartonu, z którego wyszła — jeśli
    ten karton nadal może ją przyjąć. Inaczej zostaje luzem do spakowania."""
    with transaction() as conn:
        _otwarte_wydanie(conn, dispatch_id)
        unit = cx_query_one(conn, "SELECT * FROM finished_units WHERE id=%s AND dispatch_id=%s FOR UPDATE",
                            (unit_id, dispatch_id))
        if not unit:
            raise HTTPException(404, "Tej sztuki nie ma na wydaniu")
        z = unit.get("dispatch_from") or {}
        if isinstance(z, str):
            z = json.loads(z or "{}")
        wrocila = False
        if z.get("kind") == "stock":
            c = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (z.get("id"),))
            if c and not c.get("loaded_vehicle_id") and not c.get("shipped_at"):
                lines = cx_query_all(conn, "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY id", (c["id"],))
                line = pick_line_for_unit(unit, lines)
                if line:
                    cx_execute(conn, "UPDATE stock_carton_lines SET packed_qty=packed_qty+1 WHERE id=%s", (line["id"],))
                    agg = cx_query_one(conn, "SELECT COALESCE(SUM(packed_qty),0) AS p, COALESCE(SUM(target_qty),0) AS t "
                                             "FROM stock_carton_lines WHERE carton_id=%s", (c["id"],))
                    pelny = int(agg["p"]) >= int(agg["t"])
                    cx_execute(conn, "UPDATE stock_cartons SET packed_qty=%s, status=%s, closed_at=%s WHERE id=%s",
                               (int(agg["p"]), "packed" if pelny else "open", now_iso() if pelny else None, c["id"]))
                    cx_execute(conn, "UPDATE finished_units SET status='packed', carton_id=%s, order_id=%s "
                                     "WHERE id=%s", (c["id"], z.get("orderIdBefore") or None, unit_id))
                    wrocila = True
        elif z.get("kind") == "order":
            p = cx_query_one(conn, "SELECT * FROM order_pallets WHERE id=%s FOR UPDATE", (z.get("id"),))
            if p and p.get("status") not in ("loaded", "shipped"):
                cx_execute(conn, "UPDATE finished_units SET status='packed', pallet_id=%s, order_id=%s, "
                                 "client_name=%s WHERE id=%s",
                           (p["id"], z.get("orderIdBefore") or p.get("order_id"),
                            z.get("clientNameBefore") or unit.get("client_name"), unit_id))
                if p.get("status") == "packing":
                    n = cx_query_one(conn, "SELECT COUNT(*) AS n FROM finished_units WHERE pallet_id=%s", (p["id"],))["n"]
                    t = cx_query_one(conn, "SELECT COALESCE(SUM(qty),0) AS t FROM order_pallet_items WHERE pallet_id=%s",
                                     (p["id"],))["t"]
                    if int(n) >= int(t):
                        cx_execute(conn, "UPDATE order_pallets SET status='packed' WHERE id=%s", (p["id"],))
                wrocila = True
        cx_execute(conn, "UPDATE finished_units SET dispatch_id=NULL, dispatch_from=NULL WHERE id=%s", (unit_id,))
        if not wrocila:
            # Luzem, do spakowania — przywróć klienta i zamówienie sprzed wydania.
            cx_execute(conn, "UPDATE finished_units SET status='produced', order_id=%s, client_name=%s WHERE id=%s",
                       (z.get("orderIdBefore") or None, z.get("clientNameBefore") or unit.get("client_name"), unit_id))
    logger.info("wydanie_sztuk.cofniete", extra={"dispatch_id": dispatch_id, "unit_id": unit_id, "wrocila": wrocila})
    return {"backToCarton": wrocila, "cartonNo": z.get("cartonNo") or "", **szczegoly(dispatch_id)}


def przekaz_do_biura(dispatch_id: str, operator: str = "") -> Dict[str, Any]:
    with transaction() as conn:
        _otwarte_wydanie(conn, dispatch_id)
        n = cx_query_one(conn, "SELECT COUNT(*) AS n FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))["n"]
        if not int(n):
            raise HTTPException(400, "Wydanie jest puste — zeskanuj sztuki")
        cx_execute(conn, "UPDATE dispatches SET status='ready', handed_at=now(), "
                         "operator=COALESCE(NULLIF(%s,''), operator) WHERE id=%s", (operator, dispatch_id))
    logger.info("wydanie_sztuk.przekazane", extra={"dispatch_id": dispatch_id})
    return szczegoly(dispatch_id)


def porzuc(dispatch_id: str) -> Dict[str, Any]:
    """Puste wydanie założone przez pomyłkę — usuń. Z sztukami: najpierw Cofnij."""
    with transaction() as conn:
        _otwarte_wydanie(conn, dispatch_id)
        n = cx_query_one(conn, "SELECT COUNT(*) AS n FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))["n"]
        if int(n):
            raise HTTPException(409, "Na wydaniu są sztuki — cofnij je najpierw")
        cx_execute(conn, "DELETE FROM dispatches WHERE id=%s AND status='open'", (dispatch_id,))
    return {"ok": True}
