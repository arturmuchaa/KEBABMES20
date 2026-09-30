"""Ważenie pełnego kartonu przy wjeździe do mroźni składowej.

Spec: docs/superpowers/specs/2026-09-29-mroznia-wazenie-design.md.

Kolejność na hali: pełny karton → skan kartki → wybór palety → wjazd na wagę
→ zatwierdzenie → etykieta z wagą na karton → mroźnia. Niepełny karton się
nie waży (czeka na dokończenie), a paleta zamówienia rozpisana bez skanu sztuk
wjeżdża po staremu — nie ma z czym porównać wagi.

Niezgodna waga NIE blokuje wjazdu (decyzja właściciela 29.09.2026) — tylko
etykieta i zapis mówią „NIEZGODNA". Werdykt liczy serwer.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.services import pallets_service, settings_service
from app.utils.ids import cuid, format_carton_no
from app.utils.wazenie_mrozni import werdykt

logger = get_logger(__name__)

MAX_GROSS_KG = 3000.0


def _sklad(kolumna: str, container_id: str) -> List[Dict[str, Any]]:
    """Skład kartonu ze SZTUK, które w nim leżą — „15 × 50 kg ZAGROS"."""
    rows = query_all(
        f"""SELECT fu.weight_kg, MAX(r.name) AS recipe_name, MAX(pt.name) AS product_type_name,
                   COUNT(*) AS n
            FROM finished_units fu
            LEFT JOIN recipes r ON r.id = fu.recipe_id
            LEFT JOIN product_types pt ON pt.id = fu.product_type_id
            WHERE fu.{kolumna} = %s
            GROUP BY fu.weight_kg, fu.recipe_id, fu.product_type_id
            ORDER BY fu.weight_kg DESC, MAX(r.name)""",
        (container_id,),
    )
    return [{
        "qty": int(r["n"]),
        "kgPerUnit": round(float(r.get("weight_kg") or 0), 3),
        "recipeName": r.get("recipe_name") or "",
        "productTypeName": r.get("product_type_name") or "",
    } for r in rows]


def pelny_numer_partii(batch_no: Any, produced_date: Any, fg_batch_no: Any = None) -> str:
    """„290926 591" — pełny numer partii wyrobu.

    Na PRODUKCJI (29.09.2026) sztuka ma w `batch_no` sam numer („598"), a pełny
    numer z datą („290926 598") trzyma wyrób gotowy. Karta i etykieta pokazywały
    więc „598". Kolejność: numer z wyrobu gotowego → numer, który już ma datę
    → data produkcji sztuki (ddmmrr) + numer."""
    fg = str(fg_batch_no or "").strip()
    if fg:
        return fg
    nr = str(batch_no or "").strip()
    if not nr:
        return "—"
    if " " in nr:
        return nr
    d = str(produced_date or "")[:10]
    if len(d) == 10 and d[4] == "-" and d[7] == "-":
        return f"{d[8:10]}{d[5:7]}{d[2:4]} {nr}"
    return nr


def _partie(kolumna: str, container_id: str) -> List[Dict[str, Any]]:
    """Ile sztuk z której partii leży w kartonie — „3 szt · 290926 591".

    Właściciel 29.09.2026: wykaz partii na etykiecie ważenia i na karcie
    kartonu, w słupku, PEŁNYM numerem. Najstarsza partia pierwsza."""
    rows = query_all(
        f"""SELECT fu.batch_no, fu.produced_date::text AS produced_date,
                   fg.batch_no AS fg_batch_no, COUNT(*) AS n
            FROM finished_units fu
            LEFT JOIN finished_goods fg ON fg.id = fu.source_finished_goods_id
            WHERE fu.{kolumna} = %s
            GROUP BY fu.batch_no, fu.produced_date, fg.batch_no""",
        (container_id,),
    )
    suma: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        nr = pelny_numer_partii(r.get("batch_no"), r.get("produced_date"), r.get("fg_batch_no"))
        x = suma.setdefault(nr, {"batchNo": nr, "qty": 0, "_d": str(r.get("produced_date") or "9999")})
        x["qty"] += int(r["n"])
        x["_d"] = min(x["_d"], str(r.get("produced_date") or "9999"))
    out = sorted(suma.values(), key=lambda x: (x["_d"], x["batchNo"]))
    return [{"batchNo": x["batchNo"], "qty": x["qty"]} for x in out]


def _uzupelnij_numery(batches: List[Dict[str, Any]], kind: str, container_id: str) -> List[Dict[str, Any]]:
    """Ważenia sprzed 29.09.2026 13:00 zapisały sam numer („598") — przy
    odczycie (dodruk etykiety) dopełniamy go pełnym numerem z sztuk kartonu."""
    if all(" " in str(b.get("batchNo") or "") for b in batches):
        return batches
    zywe = [b["batchNo"] for b in _partie("carton_id" if kind == "stock" else "pallet_id", container_id)]
    out = []
    for b in batches:
        nr = str(b.get("batchNo") or "")
        pelny = next((z for z in zywe if " " not in nr and z.endswith(" " + nr)), nr)
        out.append({**b, "batchNo": pelny})
    return out


def _publiczne(w: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not w:
        return None
    lines = w.get("lines")
    if isinstance(lines, str):
        lines = json.loads(lines)
    batches = w.get("batches")
    if isinstance(batches, str):
        batches = json.loads(batches)
    batches = _uzupelnij_numery(batches or [], w["container_kind"], w["container_id"])
    at = w.get("weighed_at")
    if w["container_kind"] == "stock":
        kod = f"SCARTON|{w['container_id']}"
    else:
        p = query_one("SELECT order_id, pallet_no FROM order_pallets WHERE id=%s",
                      (w["container_id"],)) or {}
        kod = f"PAL|{p['order_id']}|{p['pallet_no']}" if p else ""
    return {
        "code": kod,
        "id": w["id"],
        "containerKind": w["container_kind"],
        "containerId": w["container_id"],
        "cartonNo": w.get("carton_no") or "",
        "clientName": w.get("client_name") or "",
        "orderNo": w.get("order_no") or "",
        "lines": lines or [],
        "batches": batches or [],
        "palletTypeId": w.get("pallet_type_id") or "",
        "palletTypeName": w.get("pallet_type_name") or "",
        "tareMinKg": float(w.get("tare_min_kg") or 0),
        "tareMaxKg": float(w.get("tare_max_kg") or 0),
        "tareKg": round((float(w.get("tare_min_kg") or 0) + float(w.get("tare_max_kg") or 0)) / 2, 2),
        "marginPct": float(w.get("margin_pct") or 0),
        "grossKg": float(w.get("gross_kg") or 0),
        "netKg": float(w.get("net_kg") or 0),
        "diffKg": float(w.get("diff_kg") or 0),
        "ok": bool(w.get("ok")),
        "weighMode": w.get("weigh_mode") or "auto",
        "operator": w.get("operator") or "",
        "weighedAt": at.isoformat() if hasattr(at, "isoformat") else str(at or ""),
    }


def ostatnie_wazenie(container_id: str) -> Optional[Dict[str, Any]]:
    return _publiczne(query_one(
        "SELECT * FROM cold_storage_weighings WHERE container_id=%s AND invalid_at IS NULL "
        "ORDER BY weighed_at DESC LIMIT 1", (container_id,)))


def sprawdz(code: str) -> Dict[str, Any]:
    """Co to za karton i czy trzeba go ważyć.

    `full` = pełny karton ze zeskanowanymi sztukami → ważenie obowiązkowe.
    Już stojący w mroźni pełny karton też można zważyć ponownie (dodruk
    z nową wagą), ale nie trzeba.
    """
    from app.services.dispatches_service import _parse_stock_carton
    cid = _parse_stock_carton(code)
    if cid:
        c = query_one("SELECT * FROM stock_cartons WHERE id=%s", (cid,))
        if not c:
            return {"result": "INVALID"}
        lines = _sklad("carton_id", cid)
        if c.get("shipped_at"):
            stan = "shipped"
        elif c.get("loaded_vehicle_id"):
            stan = "loaded"
        elif c.get("cold_storage_at"):
            stan = "cold_storage"
        elif c.get("status") == "packed":
            stan = "full"
        else:
            stan = "packing"
        return {
            # Karton na aucie / wydany: szczegóły idą dalej — karta kartonu je
            # pokazuje — ale do mroźni już nie wjedzie.
            "result": "GONE" if stan in ("loaded", "shipped") else "OK", "status": stan,
            "kind": "stock", "id": cid, "code": f"SCARTON|{cid}",
            "cartonNo": format_carton_no(c["carton_no"]) if c.get("carton_no") else "",
            "clientName": c.get("client_name") or "", "orderNo": c.get("linked_order_no") or "",
            "palletNo": 0,
            "full": c.get("status") == "packed" and bool(lines),
            # Karton w trakcie pakowania — kiosk otwiera go do pakowania.
            "open": c.get("status") == "open",
            "inColdStorage": bool(c.get("cold_storage_at")),
            "netKg": round(sum(x["qty"] * x["kgPerUnit"] for x in lines), 3),
            "qty": sum(x["qty"] for x in lines), "lines": lines,
            "batches": _partie("carton_id", cid),
            "lastWeighing": ostatnie_wazenie(cid),
        }

    try:
        order_id, pallet_no = pallets_service.parse_code(code)
    except HTTPException:
        return {"result": "INVALID"}
    p = query_one(
        """SELECT p.*, o.order_no, o.client_name FROM order_pallets p
           JOIN client_orders o ON o.id = p.order_id
           WHERE p.order_id=%s AND p.pallet_no=%s""", (order_id, pallet_no))
    if not p:
        return {"result": "INVALID"}
    status = p.get("status") or "created"
    lines = _sklad("pallet_id", p["id"])
    stan = {"loaded": "loaded", "shipped": "shipped", "cold_storage": "cold_storage",
            "packed": "full"}.get(status, "packing" if lines else "planned")
    return {
        "result": "GONE" if stan in ("loaded", "shipped") else "OK", "status": stan,
        "kind": "order", "id": p["id"], "code": f"PAL|{order_id}|{pallet_no}",
        "cartonNo": format_carton_no(p["carton_no"]) if p.get("carton_no") else "",
        "clientName": p.get("client_name") or "", "orderNo": p.get("order_no") or "",
        "palletNo": int(pallet_no),
        # Rozpisana paleta bez skanu sztuk (`created`) nie ma z czym porównać wagi.
        "full": status in ("packed", "cold_storage") and bool(lines),
        # Zaczęta skanem sztuk, niepełna — kiosk otwiera ją do pakowania.
        # Rozpisana bez sztuk (`created`, 0 szt.) wjeżdża po staremu (09.09).
        "open": status == "packing" or (status == "created" and bool(lines)),
        "inColdStorage": status == "cold_storage",
        "netKg": round(sum(x["qty"] * x["kgPerUnit"] for x in lines), 3),
        "qty": sum(x["qty"] for x in lines), "lines": lines,
        "batches": _partie("pallet_id", p["id"]),
        "lastWeighing": ostatnie_wazenie(p["id"]),
    }


def zwaz_i_wstaw(code: str, pallet_type_id: str, gross_kg: float, mode: str,
                 operator: str = "") -> Dict[str, Any]:
    """Zapisz ważenie i wstaw karton do mroźni (jeśli jeszcze nie stoi)."""
    info = sprawdz(code)
    if info["result"] == "GONE":
        raise HTTPException(409, {"code": "GONE", "message": "Karton jest już na aucie albo wydany"})
    if info["result"] != "OK":
        raise HTTPException(404, {"code": "INVALID", "message": "Nieznany karton"})
    if not info["full"]:
        raise HTTPException(409, {"code": "NOT_FULL",
                                  "message": "Ważymy tylko pełny karton — dopakuj go najpierw"})
    try:
        gross = float(gross_kg)
    except (TypeError, ValueError):
        raise HTTPException(400, {"code": "BAD_WEIGHT", "message": "Nieprawidłowa waga"})
    if not (0 < gross <= MAX_GROSS_KG):
        raise HTTPException(400, {"code": "BAD_WEIGHT",
                                  "message": f"Waga brutto poza zakresem (0–{MAX_GROSS_KG:g} kg)"})
    paleta = next((p for p in settings_service.get_pallet_types() if p["id"] == pallet_type_id), None)
    if not paleta:
        raise HTTPException(400, {"code": "BAD_PALLET", "message": "Wybierz rodzaj palety"})
    tryb = "manual" if mode == "manual" else "auto"
    w = werdykt(info["netKg"], gross, paleta)

    if not info["inColdStorage"]:
        if info["kind"] == "stock":
            from app.services.magazyn_pakowanie_service import wstaw_karton_do_mrozni
            wstaw_karton_do_mrozni(info["code"])
        else:
            pallets_service.scan(info["code"], "cold_storage", operator=operator)

    wid = cuid()
    execute(
        """INSERT INTO cold_storage_weighings
             (id, container_kind, container_id, carton_no, client_name, order_no, lines, batches,
              pallet_type_id, pallet_type_name, tare_min_kg, tare_max_kg, margin_pct,
              gross_kg, net_kg, diff_kg, ok, weigh_mode, operator)
           VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (wid, info["kind"], info["id"], info["cartonNo"], info["clientName"], info["orderNo"],
         json.dumps(info["lines"]), json.dumps(info["batches"]), paleta["id"], paleta["name"], paleta["tareMinKg"],
         paleta["tareMaxKg"], paleta["marginPct"], w["grossKg"], w["netKg"], w["diffKg"],
         w["ok"], tryb, operator or ""),
    )
    logger.info("magazyn.mroznia.wazenie", extra={
        "container_id": info["id"], "carton_no": info["cartonNo"], "gross_kg": w["grossKg"],
        "net_kg": w["netKg"], "diff_kg": w["diffKg"], "zgodna": w["ok"], "tryb": tryb})
    return ostatnie_wazenie(info["id"])  # type: ignore[return-value]


def wyjedz_z_mrozni(code: str, operator: str = "") -> Dict[str, Any]:
    """Wyjazd kartonu z mroźni z powrotem do pakowania — na poprawki.

    Właściciel 29.09.2026: „możliwość wyjechania kartonem z mroźni, jeżeli
    jakieś poprawki". Karton wraca tam, skąd przyszedł: pełny do „spakowane"
    (ponowny wjazd = ponowne ważenie), niepełny do otwartych. Historia ważeń
    zostaje. Karton na aucie / wydany — odmowa (to robota załadunku).
    """
    from app.services.dispatches_service import _parse_stock_carton
    from app.db import cx_execute, cx_query_one, transaction
    info = sprawdz(code)
    if info["result"] == "GONE":
        return {"result": "GONE"}
    if info["result"] != "OK":
        return {"result": "INVALID"}
    opis = {"cartonNo": info["cartonNo"], "clientName": info["clientName"]}
    if not info["inColdStorage"]:
        return {"result": "NOT_IN_COLD", **opis}
    with transaction() as conn:
        if info["kind"] == "stock":
            c = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (info["id"],))
            if not c or c.get("loaded_vehicle_id") or c.get("shipped_at"):
                return {"result": "GONE", **opis}
            cx_execute(conn, "UPDATE stock_cartons SET cold_storage_at=NULL WHERE id=%s", (info["id"],))
        else:
            p = cx_query_one(conn, "SELECT id, status FROM order_pallets WHERE id=%s FOR UPDATE", (info["id"],))
            if not p or p.get("status") != "cold_storage":
                return {"result": "GONE", **opis}
            # Pełna (sztuki do końca) wraca jako spakowana, reszta jako rozpisana.
            docelowy = "packed" if info["full"] and _paleta_pelna(info["id"]) else "created"
            cx_execute(conn, "UPDATE order_pallets SET status=%s, cold_storage_at=NULL WHERE id=%s",
                       (docelowy, info["id"]))
            cx_execute(conn, "INSERT INTO pallet_scans (id, pallet_id, action, operator, vehicle_id) "
                             "VALUES (%s,%s,'undo',%s,NULL)", (cuid(), info["id"], operator or ""))
    logger.info("magazyn.mroznia.wyjazd", extra={"container_id": info["id"], "carton_no": info["cartonNo"]})
    return {"result": "SUCCESS", **opis}


def _paleta_pelna(pallet_id: str) -> bool:
    from app.services.magazyn_pakowanie_service import _linie_palet
    ln = _linie_palet([pallet_id]).get(pallet_id, [])
    return bool(ln) and all(int(x.get("packed_qty") or 0) >= int(x.get("target_qty") or 0) for x in ln)


def wazenia_w_mrozni() -> Dict[str, Dict[str, Any]]:
    """Ostatnie ważenie każdego kontenera stojącego w mroźni. Brak klucza =
    wjechał bez ważenia („zważ później") — lista mroźni pokazuje „do zważenia"."""
    rows = query_all(
        """SELECT DISTINCT ON (w.container_id) w.container_id, w.ok, w.gross_kg, w.diff_kg,
                  w.weighed_at, w.operator, w.weigh_mode
           FROM cold_storage_weighings w
           WHERE w.invalid_at IS NULL AND w.container_id IN (
               SELECT id FROM stock_cartons WHERE cold_storage_at IS NOT NULL
                  AND loaded_vehicle_id IS NULL AND shipped_at IS NULL
               UNION SELECT id FROM order_pallets WHERE status = 'cold_storage')
           ORDER BY w.container_id, w.weighed_at DESC""")
    # Kiedy i kto — lista mroźni pokazuje to przy każdym kartonie (30.09.2026).
    return {r["container_id"]: {"ok": bool(r["ok"]), "grossKg": float(r["gross_kg"] or 0),
                                "diffKg": float(r["diff_kg"] or 0),
                                "weighedAt": r["weighed_at"].isoformat() if r.get("weighed_at") else "",
                                "operator": r.get("operator") or "",
                                "weighMode": r.get("weigh_mode") or "auto"} for r in rows}
