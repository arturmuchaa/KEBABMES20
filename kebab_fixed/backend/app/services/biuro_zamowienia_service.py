"""Zamówienia z biura (PROTRIMA): kurs, wyjazd kartonem, przeniesienie sztuk, usunięcie kartonu.

Zgłoszenia właściciela z 26.11.2026:

* „muszę mieć możliwość wyjazdu kartonem bezpośrednio z biura": biuro samo
  kładzie kartony zamówienia na auto i zamyka kurs, bez skanera HMI;
* „nie mogę zakończyć zamówienia, wisi w załadunku, ktoś na HMI nie potwierdził":
  GOLD-KEBAB/Z/5/11/26 i KEVN-GMBH/Z/1/11/26 stały załadowane od 24.11, bo nikt
  nie nacisnął „Zakończ załadunek". Biuro widzi takie kursy i kończy je samo;
* „czy mogę z biura ręcznie przypisać sztuki z wyrobu gotowego do zamówienia
  innego klienta i automatycznie wycofać karton": KEVN potrzebował 5×15, 3×18
  i 10×10 kg z gotowego kartonu ALI GOLD w mroźni. Przy każdym przeniesieniu
  biuro decyduje, czy zamówienie źródłowe się zmniejsza, czy czeka na dorobienie;
* „daj możliwość usunięcia kartonów magazynowych z biura": także kartonu ze
  sztukami — sztuki wracają na wolny stan (nie znikają z produkcji).

Kurs zamyka wyłącznie istniejące `loading_service.finalize_loading` — te same
dokumenty, HDI i kontrole co przy skanerze. Ten moduł niczego tam nie omija.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, format_carton_no, next_seq

logger = get_logger(__name__)

ZAMKNIETE = ("done", "cancelled")


# ── Kursy niezakończone ───────────────────────────────────────────────────

def _zawartosc_aut(vehicle_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Kartony stojące na autach, które jeszcze nie wyjechały (bez `shipped`)."""
    filtr = "AND p.loaded_vehicle_id = %(v)s" if vehicle_id else ""
    filtr_sc = "AND sc.loaded_vehicle_id = %(v)s" if vehicle_id else ""
    return query_all(
        f"""SELECT p.loaded_vehicle_id AS vehicle_id, p.order_id, p.id AS container_id,
                   p.carton_no, p.loaded_at,
                   COALESCE((SELECT SUM(pi.qty) FROM order_pallet_items pi WHERE pi.pallet_id = p.id), 0)::int AS szt,
                   COALESCE((SELECT SUM(pi.qty * l.kg_per_unit) FROM order_pallet_items pi
                              JOIN client_order_lines l ON l.id = pi.order_line_id
                             WHERE pi.pallet_id = p.id), 0)::float AS kg
              FROM order_pallets p
             WHERE p.status = 'loaded' AND p.loaded_vehicle_id IS NOT NULL {filtr}
            UNION ALL
            SELECT sc.loaded_vehicle_id, sc.linked_order_id, sc.id, sc.carton_no, sc.loaded_at,
                   COALESCE((SELECT SUM(l.target_qty) FROM stock_carton_lines l WHERE l.carton_id = sc.id), 0)::int,
                   COALESCE((SELECT SUM(l.target_qty * l.kg_per_unit) FROM stock_carton_lines l
                             WHERE l.carton_id = sc.id), 0)::float
              FROM stock_cartons sc
             WHERE sc.loaded_vehicle_id IS NOT NULL AND sc.shipped_at IS NULL
               AND sc.linked_order_id IS NOT NULL {filtr_sc}""",
        {"v": vehicle_id})


def kursy_otwarte() -> List[Dict[str, Any]]:
    """Auta z załadowanym towarem, którego kurs nikt nie zamknął."""
    wiersze = _zawartosc_aut()
    if not wiersze:
        return []
    auta = {r["id"]: r for r in query_all(
        "SELECT id, name, plate FROM vehicles WHERE id = ANY(%s)",
        (sorted({w["vehicle_id"] for w in wiersze}),))}
    zam = {r["id"]: r for r in query_all(
        "SELECT id, order_no, client_name, status FROM client_orders WHERE id = ANY(%s)",
        (sorted({w["order_id"] for w in wiersze}),))}
    out: Dict[str, Dict[str, Any]] = {}
    for w in wiersze:
        a = auta.get(w["vehicle_id"]) or {"name": "?", "plate": ""}
        kurs = out.setdefault(w["vehicle_id"], {
            "vehicleId": w["vehicle_id"], "name": a.get("name") or "", "plate": a.get("plate") or "",
            "loadedSince": None, "orders": {}})
        if w.get("loaded_at") and (kurs["loadedSince"] is None or w["loaded_at"] < kurs["loadedSince"]):
            kurs["loadedSince"] = w["loaded_at"]
        z = zam.get(w["order_id"]) or {}
        o = kurs["orders"].setdefault(w["order_id"], {
            "orderId": w["order_id"], "orderNo": z.get("order_no") or "",
            "clientName": z.get("client_name") or "", "orderStatus": z.get("status") or "",
            "cartons": [], "szt": 0, "kg": 0.0})
        o["cartons"].append(format_carton_no(w.get("carton_no")))
        o["szt"] += int(w["szt"] or 0)
        o["kg"] = round(o["kg"] + float(w["kg"] or 0), 3)
    wynik = []
    for kurs in sorted(out.values(), key=lambda k: str(k["loadedSince"] or "")):
        kurs["orders"] = sorted(kurs["orders"].values(), key=lambda o: o["orderNo"])
        wynik.append(kurs)
    return wynik


def zakoncz_kurs(vehicle_id: str, operator: str = "",
                 partial_confirmation: Optional[str] = None) -> Dict[str, Any]:
    """Zamknij kurs auta z biura — wszystkie zamówienia, których towar na nim stoi.

    Wydanie częściowe wraca jako 409 PARTIAL_LOADING_CONFIRMATION_REQUIRED
    z tokenem — biuro potwierdza braki tak samo jak magazynier na HMI."""
    from app.services.loading_service import finalize_loading
    zamowienia = sorted({w["order_id"] for w in _zawartosc_aut(vehicle_id)})
    if not zamowienia:
        raise HTTPException(409, "Na tym aucie nie ma niezakończonego załadunku")
    wynik = finalize_loading(vehicle_id=vehicle_id, order_ids=zamowienia,
                             operator=operator or "biuro",
                             partial_confirmation=partial_confirmation)
    logger.info("biuro.kurs.zakonczony", extra={"vehicle_id": vehicle_id, "orders": zamowienia,
                                                "operator": operator or "-"})
    return wynik


# ── Wyjazd kartonem z biura ───────────────────────────────────────────────

def _kod(order_id: str, kontener: Dict[str, Any]) -> str:
    if kontener["kind"] == "stock":
        return f"SCARTON|{kontener['id']}"
    return f"PAL|{order_id}|{kontener['palletNo']}"


def kartony_do_wyjazdu(order_id: str) -> List[Dict[str, Any]]:
    """Kartony zamówienia, które biuro może położyć na auto (nie wysłane)."""
    palety = query_all(
        """SELECT p.id, p.pallet_no, p.carton_no, p.status, p.loaded_vehicle_id,
                  COALESCE(SUM(pi.qty), 0)::int AS szt,
                  COALESCE(SUM(pi.qty * l.kg_per_unit), 0)::float AS kg
             FROM order_pallets p
             LEFT JOIN order_pallet_items pi ON pi.pallet_id = p.id
             LEFT JOIN client_order_lines l ON l.id = pi.order_line_id
            WHERE p.order_id = %s AND p.status <> 'shipped'
            GROUP BY p.id ORDER BY p.pallet_no""", (order_id,))
    kartony = query_all(
        """SELECT sc.id, sc.carton_no, sc.loaded_vehicle_id, sc.cold_storage_at,
                  COALESCE(SUM(l.target_qty), 0)::int AS szt,
                  COALESCE(SUM(l.target_qty * l.kg_per_unit), 0)::float AS kg
             FROM stock_cartons sc LEFT JOIN stock_carton_lines l ON l.carton_id = sc.id
            WHERE sc.linked_order_id = %s AND sc.shipped_at IS NULL
            GROUP BY sc.id ORDER BY sc.carton_no""", (order_id,))
    out = [{"id": p["id"], "kind": "order", "palletNo": p["pallet_no"],
            "cartonNo": format_carton_no(p.get("carton_no")), "status": p["status"],
            "vehicleId": p.get("loaded_vehicle_id"), "szt": p["szt"], "kg": p["kg"]}
           for p in palety if p["szt"] > 0]
    out += [{"id": c["id"], "kind": "stock", "palletNo": None,
             "cartonNo": format_carton_no(c.get("carton_no")),
             "status": "loaded" if c.get("loaded_vehicle_id") else
                       ("cold_storage" if c.get("cold_storage_at") else "packed"),
             "vehicleId": c.get("loaded_vehicle_id"), "szt": c["szt"], "kg": c["kg"]}
            for c in kartony]
    return out


def wyjazd_z_biura(order_id: str, vehicle_id: str, container_ids: List[str],
                   operator: str = "", partial_confirmation: Optional[str] = None) -> Dict[str, Any]:
    """Biuro kładzie wskazane kartony zamówienia na auto i od razu zamyka kurs.

    Te same skany co na HMI (`pallets_service.scan`) i to samo zamknięcie
    (`finalize_loading`). Gdy zamknięcie odmówi (braki, niezgodny towar,
    potrzebne potwierdzenie częściowego wydania), kartony położone TYM
    wywołaniem schodzą z auta — nic nie zostaje w pół drogi."""
    from app.services import pallets_service
    from app.services import vehicle_loading_service as auta
    from app.services.loading_service import finalize_loading
    operator = operator or "biuro"
    zam = query_one("SELECT id, order_no, status FROM client_orders WHERE id=%s", (order_id,))
    if not zam:
        raise HTTPException(404, "Zamówienie nie istnieje")
    if (zam.get("status") or "") in ZAMKNIETE:
        raise HTTPException(409, "Zamówienie jest zakończone lub anulowane")
    if not vehicle_id:
        raise HTTPException(400, "Wybierz auto")
    wybrane = [c for c in kartony_do_wyjazdu(order_id) if c["id"] in set(container_ids or [])]
    if not wybrane or len(wybrane) != len(set(container_ids or [])):
        raise HTTPException(409, "Wybierz kartony tego zamówienia, które jeszcze nie wyjechały — odśwież listę")
    obce = [c["cartonNo"] for c in wybrane if c["vehicleId"] and c["vehicleId"] != vehicle_id]
    if obce:
        raise HTTPException(409, f"Kartony {', '.join(obce)} stoją już na innym aucie — "
                                 "zakończ tamten kurs albo zdejmij je z auta na HMI")

    bylo_na_aucie = bool(query_one(
        "SELECT 1 AS x FROM vehicle_loading_orders WHERE vehicle_id=%s AND order_id=%s",
        (vehicle_id, order_id)))
    auta.add_order(vehicle_id, order_id, operator)
    polozone: List[Dict[str, Any]] = []
    try:
        for c in wybrane:
            if c["vehicleId"] == vehicle_id:
                continue
            pallets_service.scan(_kod(order_id, c), "loaded", operator=operator, vehicle_id=vehicle_id)
            polozone.append(c)
        wynik = finalize_loading(vehicle_id=vehicle_id, order_ids=[order_id], operator=operator,
                                 partial_confirmation=partial_confirmation)
        # `finalize_loading` POMIJA zamówienie, gdy nie znalazł czego wydać (brak
        # wyrobu na stanie) i nie zgłasza błędu — kartony zostałyby na aucie.
        pominiete = [o for o in wynik.get("orders", []) if o.get("skipped")]
        if pominiete:
            raise HTTPException(409, f"{zam['order_no']}: nie ma czego wydać ({pominiete[0]['skipped']}) — "
                                     "sprawdź wyrób gotowy na stanie (produkcja zatwierdzona?)")
    except Exception:
        for c in reversed(polozone):
            try:
                pallets_service.scan(_kod(order_id, c), "undo", operator=operator, vehicle_id=vehicle_id)
            except Exception:  # noqa: BLE001 — zostaje widoczne w „Kursy niezakończone"
                logger.exception("biuro.wyjazd.cofniecie_nieudane",
                                 extra={"order_id": order_id, "container_id": c["id"]})
        if not bylo_na_aucie:
            try:
                auta.remove_order(vehicle_id, order_id, operator)
            except Exception:  # noqa: BLE001
                logger.exception("biuro.wyjazd.zdjecie_zamowienia_nieudane", extra={"order_id": order_id})
        raise
    logger.info("biuro.wyjazd", extra={"order_id": order_id, "vehicle_id": vehicle_id,
                                       "containers": [c["id"] for c in wybrane],
                                       "operator": operator})
    return wynik


# ── Przeniesienie sztuk do innego zamówienia ──────────────────────────────

def _dokumenty(conn, order_id: str) -> List[str]:
    return [r["number"] for r in cx_query_all(
        conn, "SELECT number FROM wz_documents WHERE source_type='order' AND source_id=%s "
              "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at", (order_id,))]


def _przelicz_sumy(conn, order_id: str) -> None:
    cx_execute(conn, """UPDATE client_orders o SET
                          total_kg = COALESCE((SELECT ROUND(SUM(qty * kg_per_unit)::numeric, 3)
                                                 FROM client_order_lines WHERE order_id = o.id), 0),
                          total_units = COALESCE((SELECT SUM(qty) FROM client_order_lines
                                                   WHERE order_id = o.id), 0)
                        WHERE o.id = %s""", (order_id,))


def _ta_sama_specyfikacja(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return ((a.get("recipe_id") or "") == (b.get("recipe_id") or "")
            and (a.get("product_type_id") or "") == (b.get("product_type_id") or "")
            and round(float(a.get("kg_per_unit") or 0), 3) == round(float(b.get("kg_per_unit") or 0), 3))


def cele_przeniesienia(pallet_id: str) -> Dict[str, Any]:
    """Dla okna biura: zawartość kartonu i otwarte zamówienia z pozycjami do wyboru."""
    p = query_one("SELECT id, order_id, pallet_no, carton_no, status FROM order_pallets WHERE id=%s",
                  (pallet_id,))
    if not p:
        raise HTTPException(404, "Karton nie istnieje")
    pozycje = query_all(
        """SELECT l.id AS line_id, l.recipe_id, l.recipe_name, l.product_type_id, l.product_type_name,
                  l.packaging_id, l.packaging_name, l.kg_per_unit::float AS kg_per_unit, pi.qty
             FROM order_pallet_items pi JOIN client_order_lines l ON l.id = pi.order_line_id
            WHERE pi.pallet_id = %s AND pi.qty > 0
            ORDER BY l.kg_per_unit DESC, l.recipe_name""", (pallet_id,))
    zamowienia = query_all(
        """SELECT o.id, o.order_no, o.client_name, o.delivery_date, o.status
             FROM client_orders o
            WHERE o.status NOT IN ('done','cancelled') AND o.id <> %s
              AND NOT EXISTS (SELECT 1 FROM wz_documents w WHERE w.source_type='order'
                              AND w.source_id=o.id AND COALESCE(w.status,'')<>'anulowany')
            ORDER BY o.delivery_date NULLS LAST, o.order_no""", (p["order_id"],))
    linie = query_all(
        """SELECT l.id, l.order_id, l.recipe_id, l.recipe_name, l.product_type_id, l.product_type_name,
                  l.packaging_id, l.packaging_name, l.kg_per_unit::float AS kg_per_unit, l.qty,
                  COALESCE((SELECT SUM(pi.qty) FROM order_pallet_items pi WHERE pi.order_line_id = l.id), 0)::int
                      AS na_paletach
             FROM client_order_lines l WHERE l.order_id = ANY(%s)
            ORDER BY l.position, l.id""", ([z["id"] for z in zamowienia] or [""],))
    wg = {}
    for l in linie:
        wg.setdefault(l["order_id"], []).append({
            "lineId": l["id"], "recipeId": l["recipe_id"], "recipeName": l["recipe_name"] or "",
            "productTypeId": l["product_type_id"], "productTypeName": l["product_type_name"] or "",
            "packagingId": l["packaging_id"] or "", "packagingName": l["packaging_name"] or "",
            "kgPerUnit": l["kg_per_unit"], "qty": int(l["qty"] or 0),
            "free": max(0, int(l["qty"] or 0) - int(l["na_paletach"] or 0))})
    zrodlo = query_one("SELECT order_no, client_name FROM client_orders WHERE id=%s", (p["order_id"],)) or {}
    return {
        "palletId": p["id"], "palletNo": p["pallet_no"], "cartonNo": format_carton_no(p.get("carton_no")),
        "status": p["status"], "orderId": p["order_id"], "orderNo": zrodlo.get("order_no") or "",
        "clientName": zrodlo.get("client_name") or "",
        "items": [{"lineId": r["line_id"], "recipeId": r["recipe_id"], "recipeName": r["recipe_name"] or "",
                   "productTypeId": r["product_type_id"], "productTypeName": r["product_type_name"] or "",
                   "packagingId": r["packaging_id"] or "", "packagingName": r["packaging_name"] or "",
                   "kgPerUnit": r["kg_per_unit"], "qty": int(r["qty"])} for r in pozycje],
        "orders": [{"orderId": z["id"], "orderNo": z["order_no"], "clientName": z["client_name"] or "",
                    "delivery": z.get("delivery_date"), "lines": wg.get(z["id"], [])} for z in zamowienia],
    }


def przestempluj_wyrob_cx(conn, src_order_no: str, dst_order_no: str, line: Dict[str, Any], ile: int) -> None:
    """Wyrób gotowy ostemplowany zamówieniem źródłowym → stempel docelowego,
    `ile` sztuk tej specyfikacji, od najstarszej produkcji, tylko nieruszony
    (bez nowej produkcji i ruchów magazynu — jak `przepnij_do_pilniejszego_cx`)."""
    from app.services.finished_goods_service import _odetnij_czesc_wiersza_cx
    potrzeba = ile
    for w in cx_query_all(conn,
            """SELECT * FROM finished_goods
                WHERE client_order_no=%s AND recipe_id=%s AND kg_per_unit=%s
                  AND (%s='' OR COALESCE(product_type_id,'')='' OR product_type_id=%s)
                  AND (%s='' OR COALESCE(packaging_id,'')='' OR packaging_id=%s)
                  AND COALESCE(qty_shipped,0)=0 AND qty_available=qty AND qty>0
                ORDER BY produced_date ASC NULLS LAST, created_at ASC FOR UPDATE""",
            (src_order_no, line.get("recipe_id"), line["kg_per_unit"],
             line.get("product_type_id") or "", line.get("product_type_id") or "",
             line.get("packaging_id") or "", line.get("packaging_id") or "")):
        if potrzeba <= 0:
            break
        bierz = min(potrzeba, int(w["qty"]))
        if bierz == int(w["qty"]):
            cx_execute(conn, "UPDATE finished_goods SET client_order_no=%s WHERE id=%s",
                       (dst_order_no, w["id"]))
        else:
            _odetnij_czesc_wiersza_cx(conn, w, bierz, dst_order_no)
        potrzeba -= bierz


def przenies_sztuki(pallet_id: str, target_order_id: str, items: List[Dict[str, Any]],
                    zrodlo: str, operator: str = "") -> Dict[str, Any]:
    """Przenieś sztuki z kartonu zamówienia do (nowego) kartonu innego zamówienia.

    `items`: [{line_id, qty, target_line_id ('' = nowa pozycja w zamówieniu
    docelowym), change_packaging (pozycja docelowa dostaje tuleję źródła)}].
    `zrodlo`: 'zmniejsz' — pozycje zamówienia źródłowego maleją o przeniesione
    sztuki; 'dorob' — zostają (braki pokaże plan produkcji).

    Karton w mroźni najpierw z niej wyjeżdża (ważenie traci ważność — zawartość
    się zmienia). Karton na aucie, wydany albo ze sztukami QR — odmowa.
    Wyrób gotowy ostemplowany zamówieniem źródłowym dostaje stempel
    docelowego (bez nowej produkcji i bez ruchów magazynu), jak przy
    `przepnij_do_pilniejszego_cx`.
    """
    from app.services import rozpis_palet_limit
    from app.services.stock_carton_link_service import check_order_reservations_cx
    from app.utils.pallet_numbers import reserve_pallet_numbers_cx

    if zrodlo not in ("zmniejsz", "dorob"):
        raise HTTPException(400, "Wybierz, co z zamówieniem źródłowym: zmniejszyć czy dorobić")
    pozycje = [i for i in (items or []) if int(i.get("qty") or 0) > 0]
    if not pozycje:
        raise HTTPException(400, "Wpisz, ile sztuk przenieść")
    operator = operator or "biuro"

    with transaction() as conn:
        paleta = cx_query_one(conn, "SELECT * FROM order_pallets WHERE id=%s FOR UPDATE", (pallet_id,))
        if not paleta:
            raise HTTPException(404, "Karton nie istnieje")
        src_id = paleta["order_id"]
        if src_id == target_order_id:
            raise HTTPException(400, "Wybierz inne zamówienie niż to, z którego bierzesz sztuki")
        # Blokady w stałej kolejności (po id) — dwa przeniesienia na krzyż nie zakleszczą się.
        zam = {}
        for oid in sorted({src_id, target_order_id}):
            zam[oid] = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (oid,))
        src, dst = zam[src_id], zam[target_order_id]
        if not dst:
            raise HTTPException(404, "Zamówienie docelowe nie istnieje")
        if (dst.get("status") or "") in ZAMKNIETE:
            raise HTTPException(409, f"Zamówienie {dst['order_no']} jest zakończone lub anulowane")
        for o in (src, dst):
            docs = _dokumenty(conn, o["id"])
            if docs:
                raise HTTPException(409, f"Zamówienie {o['order_no']} ma wystawione dokumenty "
                                         f"({', '.join(docs)}) — najpierw je anuluj")
        stan = paleta.get("status") or "created"
        nr = format_carton_no(paleta.get("carton_no"))
        if stan in ("loaded", "shipped") or paleta.get("loaded_vehicle_id"):
            raise HTTPException(409, f"Karton {nr} jest na aucie albo wydany — zdejmij go z auta przed przeniesieniem")
        if cx_query_one(conn, "SELECT 1 AS x FROM finished_units WHERE pallet_id=%s LIMIT 1", (pallet_id,)):
            raise HTTPException(409, f"Karton {nr} ma zeskanowane sztuki QR — przenieś je na pakowaniu w magazynie")

        przed_src = (rozpis_palet_limit.nadmiar_cx(conn, src_id), check_order_reservations_cx(conn, src_id))
        przed_dst = (rozpis_palet_limit.nadmiar_cx(conn, target_order_id),
                     check_order_reservations_cx(conn, target_order_id))

        na_palecie = {r["order_line_id"]: int(r["qty"]) for r in cx_query_all(
            conn, "SELECT order_line_id, qty FROM order_pallet_items WHERE pallet_id=%s", (pallet_id,))}
        linie_src = {r["id"]: r for r in cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s FOR UPDATE", (src_id,))}
        linie_dst = {r["id"]: r for r in cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s FOR UPDATE", (target_order_id,))}

        if stan == "cold_storage" or paleta.get("cold_storage_at"):
            cx_execute(conn, "UPDATE order_pallets SET status='created', cold_storage_at=NULL WHERE id=%s",
                       (pallet_id,))
            cx_execute(conn, "INSERT INTO pallet_scans (id, pallet_id, action, operator, vehicle_id) "
                             "VALUES (%s,%s,'undo',%s,NULL)", (cuid(), pallet_id, operator))
        elif stan == "packed":
            cx_execute(conn, "UPDATE order_pallets SET status='created' WHERE id=%s", (pallet_id,))
        cx_execute(conn, "UPDATE cold_storage_weighings SET invalid_at=now() "
                         "WHERE container_id=%s AND invalid_at IS NULL", (pallet_id,))

        nowe_pozycje: List[tuple] = []
        pozycja_max = max([int(l.get("position") or 0) for l in linie_dst.values()] or [-1])
        opis = []
        for it in pozycje:
            lid, ile = it.get("line_id") or "", int(it["qty"])
            if lid not in linie_src:
                raise HTTPException(400, "Pozycja nie należy do zamówienia źródłowego — odśwież okno")
            if ile > na_palecie.get(lid, 0):
                raise HTTPException(409, f"W kartonie {nr} jest tylko {na_palecie.get(lid, 0)} szt. tej pozycji")
            l = linie_src[lid]
            reszta = na_palecie[lid] - ile
            na_palecie[lid] = reszta
            if reszta > 0:
                cx_execute(conn, "UPDATE order_pallet_items SET qty=%s WHERE pallet_id=%s AND order_line_id=%s",
                           (reszta, pallet_id, lid))
            else:
                cx_execute(conn, "DELETE FROM order_pallet_items WHERE pallet_id=%s AND order_line_id=%s",
                           (pallet_id, lid))
            if zrodlo == "zmniejsz":
                q = max(0, int(l["qty"]) - ile)
                l["qty"] = q
                cx_execute(conn, "UPDATE client_order_lines SET qty=%s, total_kg=%s WHERE id=%s",
                           (q, round(q * float(l["kg_per_unit"] or 0), 3), lid))

            cel = it.get("target_line_id") or ""
            if cel:
                t = linie_dst.get(cel)
                if not t:
                    raise HTTPException(400, "Pozycja docelowa nie należy do wybranego zamówienia — odśwież okno")
                if not _ta_sama_specyfikacja(l, t):
                    raise HTTPException(409, "Pozycja docelowa to inny wyrób (receptura, rodzaj albo waga sztuki)")
                if (t.get("packaging_id") or "") != (l.get("packaging_id") or ""):
                    if not it.get("change_packaging"):
                        raise HTTPException(409, f"Inna tuleja: w kartonie {l.get('packaging_name') or '—'}, "
                                                 f"w zamówieniu {t.get('packaging_name') or '—'}. "
                                                 "Zaznacz zmianę tulei w pozycji albo dodaj nową pozycję")
                    cx_execute(conn, "UPDATE client_order_lines SET packaging_id=%s, packaging_name=%s WHERE id=%s",
                               (l.get("packaging_id"), l.get("packaging_name"), cel))
                    t["packaging_id"], t["packaging_name"] = l.get("packaging_id"), l.get("packaging_name")
            else:
                cel = cuid()
                pozycja_max += 1
                cx_execute(conn,
                    """INSERT INTO client_order_lines (id, order_id, position, qty, kg_per_unit, total_kg,
                           product_type_id, product_type_name, recipe_id, recipe_name,
                           packaging_id, packaging_name, notes, usluga)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'',false)""",
                    (cel, target_order_id, pozycja_max, ile, l["kg_per_unit"],
                     round(ile * float(l["kg_per_unit"] or 0), 3), l.get("product_type_id"),
                     l.get("product_type_name"), l.get("recipe_id"), l.get("recipe_name"),
                     l.get("packaging_id"), l.get("packaging_name")))
                linie_dst[cel] = {**l, "id": cel, "order_id": target_order_id, "qty": ile}
            nowe_pozycje.append((cel, ile))
            opis.append(f"{ile}×{float(l['kg_per_unit'] or 0):g} kg")

            # Wyrób gotowy: stempel źródła → cel, od najstarszej produkcji, tylko nieruszony.
            przestempluj_wyrob_cx(conn, src["order_no"], dst["order_no"], l, ile)

        # Nowy karton w zamówieniu docelowym — nowy numer i nowa kartka.
        nowy_id = cuid()
        nowy_nr_palety = reserve_pallet_numbers_cx(conn, target_order_id, allocate=True)
        nowy_karton = next_seq("carton_seq")
        cx_execute(conn, "INSERT INTO order_pallets (id, order_id, pallet_no, notes, carton_no) "
                         "VALUES (%s,%s,%s,%s,%s)",
                   (nowy_id, target_order_id, nowy_nr_palety, f"z kartonu {nr} ({src['order_no']})", nowy_karton))
        for cel, ile in nowe_pozycje:
            cx_execute(conn, "INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
                             "VALUES (%s,%s,%s,%s)", (cuid(), nowy_id, cel, ile))

        for oid in {src_id, target_order_id}:
            _przelicz_sumy(conn, oid)
        rozpis_palet_limit.pilnuj_cx(conn, src_id, przed_src[0], "Nie można przenieść sztuk")
        check_order_reservations_cx(conn, src_id, przed_src[1])
        rozpis_palet_limit.pilnuj_cx(conn, target_order_id, przed_dst[0], "Nie można przenieść sztuk")
        check_order_reservations_cx(conn, target_order_id, przed_dst[1])

    logger.info("biuro.przeniesienie_sztuk", extra={
        "z_kartonu": nr, "z_zamowienia": src["order_no"], "do_zamowienia": dst["order_no"],
        "nowy_karton": format_carton_no(nowy_karton), "sztuki": ", ".join(opis),
        "zrodlo": zrodlo, "operator": operator})
    return {"ok": True, "targetOrderNo": dst["order_no"], "palletNo": nowy_nr_palety,
            "cartonNo": format_carton_no(nowy_karton), "sourceCartonNo": nr,
            "sourceWithdrawnFromColdStorage": stan == "cold_storage"}


# ── Usunięcie kartonu magazynowego z biura ────────────────────────────────

def usun_karton_magazynowy(carton_id: str, operator: str = "") -> Dict[str, Any]:
    """Usuń karton magazynowy — także ze sztukami (wracają na wolny stan).

    Właściciel 26.11.2026: „usuń ten karton, wprowadzę sztuki od nowa; daj
    możliwość usuwania kartonów magazynowych z biura". Karton na aucie albo
    wydany — odmowa (to robota kursu/dokumentu). Przypięty do zamówienia
    z wystawionym dokumentem — odmowa. Wyrób gotowy (stan) się nie zmienia:
    karton nigdy go nie zdejmował."""
    operator = operator or "biuro"
    with transaction() as conn:
        c = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,))
        if not c:
            raise HTTPException(404, "Karton nie znaleziony")
        nr = format_carton_no(c.get("carton_no"))
        sztuki = cx_query_all(conn, "SELECT * FROM finished_units WHERE carton_id=%s FOR UPDATE", (carton_id,))
        if c.get("shipped_at") or any(u.get("status") == "shipped" for u in sztuki):
            raise HTTPException(409, f"Karton {nr} został już wydany — usunąć można tylko przez korektę dokumentu")
        if c.get("loaded_vehicle_id"):
            raise HTTPException(409, f"Karton {nr} stoi na aucie — najpierw zdejmij go z auta")
        if any(u.get("dispatch_id") for u in sztuki):
            raise HTTPException(409, f"Karton {nr} jest na wydaniu sztuk — najpierw cofnij je z wydania")
        if c.get("linked_order_id"):
            docs = _dokumenty(conn, c["linked_order_id"])
            if docs:
                raise HTTPException(409, f"Karton {nr} jest w zamówieniu {c.get('linked_order_no') or ''} "
                                         f"z wystawionymi dokumentami ({', '.join(docs)})")
        for u in sztuki:
            cx_execute(conn,
                """UPDATE finished_units SET status='produced', carton_id=NULL, pallet_id=NULL,
                       order_id=CASE WHEN packing_previous IS NOT NULL THEN packing_previous->>'order_id' ELSE NULL END,
                       client_name=CASE WHEN packing_previous IS NOT NULL THEN packing_previous->>'client_name'
                                        ELSE client_name END,
                       packing_previous=NULL WHERE id=%s""", (u["id"],))
            cx_execute(conn, "INSERT INTO warehouse_events (id, container_id, unit_id, action, operator) "
                             "VALUES (%s,%s,%s,'unpack',%s)", (cuid(), carton_id, u["id"], operator))
        cx_execute(conn, "INSERT INTO warehouse_events (id, container_id, unit_id, action, operator) "
                         "VALUES (%s,%s,NULL,'carton_deleted',%s)", (cuid(), carton_id, operator))
        cx_execute(conn, "DELETE FROM stock_carton_lines WHERE carton_id=%s", (carton_id,))
        cx_execute(conn, "DELETE FROM stock_cartons WHERE id=%s", (carton_id,))
    logger.info("biuro.karton_magazynowy.usuniety", extra={
        "carton_id": carton_id, "carton_no": nr, "sztuki": len(sztuki),
        "zamowienie": c.get("linked_order_no") or "", "operator": operator})
    return {"ok": True, "cartonNo": nr, "unitsReleased": len(sztuki)}
