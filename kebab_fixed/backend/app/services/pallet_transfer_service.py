"""Palety zamówienia przeżywają usunięcie, anulowanie i zmianę zamówienia.

Właściciel (07.10.2026): „jeżeli są gotowe i spakowane, a zamówienie się
kasuje lub zmienia, to palety muszą zostać automatycznie przypisane do nowego
zamówienia bez przeklejania". Do tej pory usunięcie zamówienia kasowało
kaskadowo palety i ich rozpis (ZAGROS/Z/2/10/26 → Z/3: sześć wydrukowanych
kartek przestało działać na skanerze).

Jak to działa:
  * ODŁOŻENIE — zamiast skasować, paleta (z rozpisem zapisanym jako
    specyfikacja: receptura + rodzaj + tuleja + waga + ilość) trafia do
    `orphan_pallets`. Dzieje się to przy usunięciu i anulowaniu zamówienia
    oraz przy edycji, która zabrała palecie pozycję.
  * PRZYPIĘCIE — paleta wraca do OTWARTEGO zamówienia tego samego odbiorcy
    (ta sama pula: grupa klienta albo sam klient), gdy CAŁA jej zawartość
    ściśle pasuje do pozycji zamówienia i mieści się w wolnej ilości (minus
    rozpis innych palet i przypisane kartony). Wyzwalacze: założenie i edycja
    zamówienia oraz usunięcie/anulowanie innego zamówienia tej puli.
    Paleta zachowuje swoje id, numer kartonu, status i mroźnię.
  * STARA KARTKA — `PAL|<stare zamówienie>|<nr>` wskazuje przez
    `pallet_label_aliases` nowy adres palety (zamówienie + nr), więc
    magazyn skanuje dotychczasową etykietę.

Paleta na aucie albo wydana nie jest odkładana — usunięcie/zmiana jest wtedy
odrzucana (najpierw cofnij skan).
"""
import json
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)

Spec = Tuple[str, str, str, float]
CLOSED = ("done", "cancelled")


def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


def item_spec(it: Dict[str, Any]) -> Spec:
    return (it.get("recipe_id") or "", it.get("product_type_id") or "",
            it.get("packaging_id") or "", _kg(it.get("kg_per_unit")))


# ── Czysta logika ─────────────────────────────────────────────────────────

def plan_attach(items: List[Dict[str, Any]], lines: List[Dict[str, Any]],
                line_used: Dict[str, int], spec_free: Dict[Spec, int]) -> Optional[List[Tuple[str, int]]]:
    """Rozpis palety na pozycje zamówienia albo None, gdy paleta nie pasuje.

    Każda pozycja palety musi mieć ścisły odpowiednik w zamówieniu, a cała
    ilość danej specyfikacji mieścić się w `spec_free`. Ilość rozkładamy na
    pozycje zamówienia tej specyfikacji po kolei (wolne miejsce pozycji),
    nadwyżkę — na ostatnią z nich (wolne liczone per specyfikacja i tak się
    zgadza)."""
    need: Dict[Spec, int] = {}
    for it in items:
        q = int(it.get("qty") or 0)
        if q > 0:
            need[item_spec(it)] = need.get(item_spec(it), 0) + q
    if not need:
        return None
    by_spec: Dict[Spec, List[Dict[str, Any]]] = {}
    for l in lines:
        by_spec.setdefault(item_spec(l), []).append(l)
    out: List[Tuple[str, int]] = []
    for spec, q in need.items():
        cands = by_spec.get(spec)
        if not cands or q > spec_free.get(spec, 0):
            return None
        left = q
        for i, l in enumerate(cands):
            room = int(l.get("qty") or 0) - line_used.get(l["id"], 0)
            take = left if i == len(cands) - 1 else max(0, min(left, room))
            if take > 0:
                out.append((l["id"], take))
                left -= take
            if left == 0:
                break
    return out


# ── Pula odbiorcy ─────────────────────────────────────────────────────────

def _pool_of_client(conn, client_id: str) -> str:
    if not client_id:
        return ""
    row = cx_query_one(conn, "SELECT COALESCE(NULLIF(group_id, ''), id) AS pula FROM clients WHERE id=%s",
                       (client_id,))
    return (row or {}).get("pula") or client_id


# ── Odłożenie ─────────────────────────────────────────────────────────────

def _snapshot(conn, order_id: str, pallet_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Palety zamówienia z rozpisem zapisanym jako specyfikacja (niezależnie od pozycji)."""
    pallets = cx_query_all(
        conn,
        "SELECT * FROM order_pallets WHERE order_id=%s" + (" AND id = ANY(%s)" if pallet_ids is not None else "")
        + " ORDER BY pallet_no FOR UPDATE",
        (order_id, pallet_ids) if pallet_ids is not None else (order_id,))
    if not pallets:
        return []
    items = cx_query_all(
        conn,
        """SELECT i.pallet_id, i.order_line_id, i.qty, l.recipe_id, l.recipe_name, l.product_type_id,
                  l.product_type_name, l.packaging_id, l.packaging_name, l.kg_per_unit
             FROM order_pallet_items i JOIN client_order_lines l ON l.id = i.order_line_id
            WHERE i.pallet_id = ANY(%s) ORDER BY i.id""", ([p["id"] for p in pallets],))
    by: Dict[str, List[Dict[str, Any]]] = {}
    for it in items:
        by.setdefault(it["pallet_id"], []).append(it)
    for p in pallets:
        p["items"] = by.get(p["id"], [])
    return pallets


def snapshot_items(conn, order_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """Rozpis palet przed edycją pozycji — do wykrycia palet, którym edycja coś zabrała."""
    return {p["id"]: p["items"] for p in _snapshot(conn, order_id)}


def _refuse_moving(pallets: List[Dict[str, Any]], what: str) -> None:
    ruch = [p for p in pallets if p.get("status") in ("loaded", "shipped") or p.get("loaded_vehicle_id")]
    if ruch:
        nry = ", ".join(f"P{p['pallet_no']}" for p in ruch)
        raise HTTPException(409, f"{what}: palety {nry} są na aucie albo wydane — najpierw cofnij ich skan.")


def _park(conn, order: Dict[str, Any], pallets: List[Dict[str, Any]], reason: str) -> int:
    n = 0
    for p in pallets:
        items = [{k: (float(it[k]) if k == "kg_per_unit" else it.get(k))
                  for k in ("recipe_id", "recipe_name", "product_type_id", "product_type_name",
                            "packaging_id", "packaging_name", "kg_per_unit", "qty")}
                 for it in p["items"]]
        if not items:
            continue  # pusta paleta nie ma czego przenosić
        cx_execute(
            conn,
            """INSERT INTO orphan_pallets
                 (id, source_order_id, source_order_no, client_id, client_name, pallet_no, carton_no,
                  notes, status, cold_storage_at, created_at, items, reason)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
               ON CONFLICT (id) DO NOTHING""",
            (p["id"], order["id"], order.get("order_no") or "", order.get("client_id") or "",
             order.get("client_name") or "", p["pallet_no"], p.get("carton_no"), p.get("notes") or "",
             p.get("status") or "created", p.get("cold_storage_at"), p.get("created_at"),
             json.dumps(items), reason))
        n += 1
    if pallets:
        cx_execute(conn, "DELETE FROM order_pallets WHERE id = ANY(%s)", ([p["id"] for p in pallets],))
    if n:
        logger.info("pallets.parked", extra={"order_id": order["id"], "count": n, "reason": reason})
    return n


def park_order_pallets_cx(conn, order: Dict[str, Any], reason: str, what: str,
                          keep_shipped: bool = False) -> int:
    """Odłóż palety zamówienia (usunięcie / anulowanie). Przy anulowaniu
    palety WYDANE zostają przy zamówieniu jako historia (`keep_shipped`)."""
    pallets = _snapshot(conn, order["id"])
    if keep_shipped:
        pallets = [p for p in pallets if p.get("status") != "shipped"]
    _refuse_moving(pallets, what)
    return _park(conn, order, pallets, reason)


def park_changed_pallets_cx(conn, order: Dict[str, Any], before: Dict[str, List[Dict[str, Any]]]) -> int:
    """Po edycji pozycji: palety, którym edycja zabrała rozpis, wracają do
    poczekalni z PEŁNYM rozpisem sprzed edycji (zamiast zostać okrojone)."""
    now = {p["id"]: p for p in _snapshot(conn, order["id"])}
    def key(its):
        return sorted((it["order_line_id"], int(it["qty"])) for it in its)

    changed = []
    for pid, old_items in before.items():
        cur = now.get(pid)
        if cur is not None and key(cur["items"]) != key(old_items):
            changed.append({**cur, "items": old_items})
    if not changed:
        return 0
    _refuse_moving(changed, "Nie można zmienić pozycji")
    return _park(conn, order, changed, "zmiana pozycji zamówienia")


# ── Przypięcie ────────────────────────────────────────────────────────────

def attach_orphans_cx(conn, order_id: str) -> List[Dict[str, Any]]:
    """Przypnij pasujące palety z poczekalni do zamówienia (całe palety)."""
    from app.services.stock_carton_link_service import (
        _order_lines, active_documents, qty_by_spec, reservations)
    order = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,))
    if not order or (order.get("status") or "") in CLOSED or active_documents(conn, order_id):
        return []
    pool = _pool_of_client(conn, order.get("client_id") or "")
    if not pool:
        return []
    orphans = [o for o in cx_query_all(
        conn, "SELECT * FROM orphan_pallets ORDER BY detached_at, source_order_no, pallet_no FOR UPDATE")
        if _pool_of_client(conn, o.get("client_id") or "") == pool]
    if not orphans:
        return []
    lines = _order_lines(conn, order_id)
    pallet_res, carton_res = reservations(conn, order_id)
    order_qty = qty_by_spec(lines, "qty")
    spec_free = {k: q - pallet_res.get(k, 0) - carton_res.get(k, 0) for k, q in order_qty.items()}
    line_used = {r["order_line_id"]: int(r["n"]) for r in cx_query_all(
        conn, """SELECT i.order_line_id, SUM(i.qty) AS n FROM order_pallet_items i
                   JOIN order_pallets p ON p.id = i.pallet_id WHERE p.order_id=%s
                  GROUP BY i.order_line_id""", (order_id,))}
    moved = []
    for o in orphans:
        items = o["items"] if isinstance(o["items"], list) else json.loads(o["items"] or "[]")
        plan = plan_attach(items, lines, line_used, spec_free)
        if not plan:
            continue
        nxt = cx_query_one(conn, "SELECT COALESCE(MAX(pallet_no), 0) + 1 AS n FROM order_pallets WHERE order_id=%s",
                           (order_id,))["n"]
        skad = f"z {o['source_order_no'] or 'usuniętego zamówienia'} P{o['pallet_no']}"
        notes = f"{o['notes']} · {skad}" if o.get("notes") else skad
        cx_execute(
            conn,
            """INSERT INTO order_pallets (id, order_id, pallet_no, notes, created_at, status,
                                          cold_storage_at, carton_no)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (o["id"], order_id, nxt, notes, o.get("created_at"), o.get("status") or "created",
             o.get("cold_storage_at"), o.get("carton_no")))
        for line_id, q in plan:
            cx_execute(conn, "INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) VALUES (%s,%s,%s,%s)",
                       (cuid(), o["id"], line_id, q))
            line_used[line_id] = line_used.get(line_id, 0) + q
        for it in items:
            spec_free[item_spec(it)] = spec_free.get(item_spec(it), 0) - int(it.get("qty") or 0)
        # Stara kartka wskazuje nowy adres palety (zamówienie + nr — jak kartka
        # natywna; nr palety przeżywa edycję rozpisu). Starsze kartki tej palety
        # dochodzą tu łańcuchem aliasów.
        cx_execute(
            conn,
            """INSERT INTO pallet_label_aliases (order_id, pallet_no, target_order_id, target_pallet_no)
               VALUES (%s,%s,%s,%s)
               ON CONFLICT (order_id, pallet_no) DO UPDATE
                 SET target_order_id = EXCLUDED.target_order_id,
                     target_pallet_no = EXCLUDED.target_pallet_no, created_at = now()""",
            (o["source_order_id"], o["pallet_no"], order_id, nxt))
        cx_execute(conn, "UPDATE finished_units SET order_id=%s WHERE pallet_id=%s", (order_id, o["id"]))
        cx_execute(conn, "DELETE FROM orphan_pallets WHERE id=%s", (o["id"],))
        moved.append({"palletId": o["id"], "palletNo": nxt, "from": o["source_order_no"],
                      "fromPalletNo": o["pallet_no"], "cartonNo": o.get("carton_no")})
    if moved:
        logger.info("pallets.attached", extra={"order_id": order_id, "count": len(moved)})
    return moved


def attach_to_pool_cx(conn, client_id: str, exclude_order_id: str = "") -> List[Dict[str, Any]]:
    """Po odłożeniu palet: spróbuj otwartych zamówień tej puli (najpilniejsze najpierw)."""
    pool = _pool_of_client(conn, client_id)
    if not pool:
        return []
    orders = cx_query_all(
        conn,
        """SELECT o.id FROM client_orders o LEFT JOIN clients c ON c.id = o.client_id
            WHERE o.id <> %s AND o.status NOT IN ('done', 'cancelled')
              AND COALESCE(NULLIF(c.group_id, ''), c.id, o.client_id) = %s
            ORDER BY o.delivery_date NULLS LAST, o.created_at""", (exclude_order_id, pool))
    moved = []
    for r in orders:
        moved += attach_orphans_cx(conn, r["id"])
    return moved


# ── Stara kartka ──────────────────────────────────────────────────────────

def resolve_pallet_ref(order_id: str, pallet_no: int) -> Tuple[str, int]:
    """(zamówienie, nr) z kartki → aktualne położenie palety.

    Żywa paleta pod tym adresem wygrywa. Inaczej łańcuch aliasów (paleta
    przenoszona, także kilka razy). Paleta czekająca w poczekalni — czytelna
    odmowa zamiast „nieznana paleta"."""
    o, n = order_id, int(pallet_no)
    for _ in range(10):
        if query_one("SELECT 1 FROM order_pallets WHERE order_id=%s AND pallet_no=%s", (o, n)):
            return o, n
        alias = query_one("SELECT target_order_id, target_pallet_no FROM pallet_label_aliases "
                          "WHERE order_id=%s AND pallet_no=%s", (o, n))
        if not alias:
            break
        o, n = alias["target_order_id"], int(alias["target_pallet_no"])
    orphan = query_one(
        "SELECT source_order_no, pallet_no FROM orphan_pallets "
        "WHERE (source_order_id=%s AND pallet_no=%s) OR (source_order_id=%s AND pallet_no=%s) LIMIT 1",
        (o, n, order_id, int(pallet_no)))
    if orphan:
        raise HTTPException(
            409, {"code": "WAITING_FOR_ORDER",
                  "message": f"Paleta P{orphan['pallet_no']} z zamówienia {orphan['source_order_no'] or '(usuniętego)'} "
                             "czeka na nowe zamówienie klienta — biuro: dodaj zamówienie z tym towarem "
                             "albo popraw pozycje; kartka zacznie działać sama."})
    return order_id, int(pallet_no)


def list_orphans() -> List[Dict[str, Any]]:
    rows = query_all("SELECT * FROM orphan_pallets ORDER BY detached_at, source_order_no, pallet_no")
    return [{
        "id": r["id"], "sourceOrderId": r["source_order_id"], "sourceOrderNo": r["source_order_no"],
        "clientName": r.get("client_name") or "", "palletNo": r["pallet_no"], "cartonNo": r.get("carton_no"),
        "status": r.get("status") or "", "reason": r.get("reason") or "",
        "detachedAt": r["detached_at"].isoformat() if r.get("detached_at") else None,
        "items": [{"recipeName": it.get("recipe_name") or "", "productTypeName": it.get("product_type_name") or "",
                   "packagingName": it.get("packaging_name") or "", "kgPerUnit": _kg(it.get("kg_per_unit")),
                   "qty": int(it.get("qty") or 0)}
                  for it in (r["items"] if isinstance(r["items"], list) else json.loads(r["items"] or "[]"))],
    } for r in rows]
