"""Pallets — palety wydania dla zamówień klientów.

Numeracja: per zamówienie, 1..N (zawsze przeliczana przy zapisie).
Zapis działa jako pełen replace zestawu palet zamówienia — żeby uniknąć
edge case'ów częściowej synchronizacji UI/DB.
"""
import re
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.orders import PalletDto
from app.utils.ids import cuid

logger = get_logger(__name__)

# Token QR: PAL|<order_id>|<pallet_no>
_PAL_TOKEN_RE = re.compile(r"^PAL\|([^|]+)\|(\d+)$")
_PAL_URL_RE   = re.compile(r"/m/p/([^/]+)/(\d+)\b")

# Definicje transition status → status. `from` = stany dopuszczalne, `field` = kolumna timestampa.
_TRANSITIONS = {
    "cold_storage": {"from": ("created",),       "field": "cold_storage_at"},
    "loaded":       {"from": ("cold_storage",),  "field": "loaded_at"},
}


def parse_code(code: str) -> tuple[str, int]:
    """Wyciągnij (order_id, pallet_no) z tokenu lub URL-a QR."""
    s = (code or "").strip()
    if not s:
        raise HTTPException(400, "Pusty kod palety")
    m = _PAL_TOKEN_RE.match(s)
    if not m:
        m = _PAL_URL_RE.search(s)
    if not m:
        raise HTTPException(400, f"Nieprawidłowy kod palety: {code!r}")
    return m.group(1), int(m.group(2))


def list_pallets(order_id: str) -> List[Dict]:
    pallets = query_all(
        "SELECT * FROM order_pallets WHERE order_id = %s ORDER BY pallet_no",
        (order_id,),
    )
    if not pallets:
        return []
    ids = [p["id"] for p in pallets]
    items = query_all(
        """
        SELECT pi.id, pi.pallet_id, pi.order_line_id, pi.qty,
               l.qty AS line_qty, l.kg_per_unit, l.total_kg,
               l.product_type_name, l.recipe_name, l.packaging_name
        FROM order_pallet_items pi
        LEFT JOIN client_order_lines l ON l.id = pi.order_line_id
        WHERE pi.pallet_id = ANY(%s)
        """,
        (ids,),
    )
    by_pallet: Dict[str, List[Dict]] = {}
    for it in items:
        by_pallet.setdefault(it["pallet_id"], []).append(it)
    for p in pallets:
        p["items"] = by_pallet.get(p["id"], [])
    return pallets


def save_pallets(order_id: str, pallets: List[PalletDto]) -> List[Dict]:
    """Zapisz palety zamówienia.

    Palety które są już w obiegu skanowania (status != 'created') pozostają
    nietknięte. Można dodawać nowe palety i edytować/usuwać palety jeszcze nie
    zeskanowane (status = 'created'). Próba zmiany zawartości / usunięcia
    zeskanowanej palety kończy się błędem 409.
    """
    # 1) Stan w DB — które palety są zamrożone (status != created)
    existing = query_all(
        "SELECT id, pallet_no, status FROM order_pallets WHERE order_id=%s ORDER BY pallet_no",
        (order_id,),
    )
    scanned = [r for r in existing if (r.get("status") or "created") != "created"]
    scanned_nos = {int(r["pallet_no"]) for r in scanned}
    scanned_ids = [r["id"] for r in scanned]

    # 2) Aktualne pozycje zeskanowanych palet — do weryfikacji "nic się nie zmieniło"
    scanned_items: Dict[int, List[tuple]] = {}
    if scanned_ids:
        no_by_id = {r["id"]: int(r["pallet_no"]) for r in scanned}
        item_rows = query_all(
            "SELECT pallet_id, order_line_id, qty FROM order_pallet_items WHERE pallet_id = ANY(%s)",
            (scanned_ids,),
        )
        for it in item_rows:
            no = no_by_id[it["pallet_id"]]
            scanned_items.setdefault(no, []).append((it["order_line_id"], int(it["qty"])))

    # 3) Podział incoming na: dotyczące zeskanowanych vs nowe/edytowalne
    incoming_for_scanned: Dict[int, PalletDto] = {}
    other_incoming: List[PalletDto] = []
    for p in pallets:
        pn = int(p.pallet_no) if p.pallet_no else 0
        if pn > 0 and pn in scanned_nos:
            incoming_for_scanned[pn] = p
        else:
            other_incoming.append(p)

    # 4) Wszystkie zeskanowane palety muszą być nadal obecne w liście
    missing = scanned_nos - set(incoming_for_scanned.keys())
    if missing:
        nums = ", ".join(f"P{n}" for n in sorted(missing))
        raise HTTPException(
            409,
            f"Palety {nums} są w obiegu skanowania — nie można ich usunąć. "
            f"Cofnij skan, aby umożliwić usunięcie.",
        )

    # 5) Zawartość zeskanowanych palet musi być identyczna z tym co jest w DB
    for pn, p in incoming_for_scanned.items():
        db_items = sorted(scanned_items.get(pn, []))
        in_items = sorted((it.order_line_id, int(it.qty)) for it in p.items)
        if db_items != in_items:
            raise HTTPException(
                409,
                f"Paleta P{pn} jest w obiegu skanowania — nie można zmienić jej zawartości.",
            )

    # 6) Walidacja: linie tylko z nowych/edytowalnych palet muszą należeć do tego zamówienia
    line_ids = {it.order_line_id for p in other_incoming for it in p.items}
    if line_ids:
        rows = query_all(
            "SELECT id FROM client_order_lines WHERE order_id = %s AND id = ANY(%s)",
            (order_id, list(line_ids)),
        )
        valid_ids = {r["id"] for r in rows}
        invalid = line_ids - valid_ids
        if invalid:
            raise HTTPException(400, f"Pozycje nie należą do zamówienia: {sorted(invalid)}")

    # 7) Usuń tylko palety nie-zeskanowane, potem dopisz palety z incoming z numeracją
    with transaction() as conn:
        if scanned_ids:
            cx_execute(
                conn,
                "DELETE FROM order_pallets WHERE order_id=%s AND id NOT IN %s",
                (order_id, tuple(scanned_ids)),
            )
        else:
            cx_execute(conn, "DELETE FROM order_pallets WHERE order_id=%s", (order_id,))

        used = set(scanned_nos)
        next_no = 1
        inserted = 0
        for p in other_incoming:
            if not p.items:
                continue
            while next_no in used:
                next_no += 1
            pallet_id = cuid()
            cx_execute(
                conn,
                "INSERT INTO order_pallets (id, order_id, pallet_no, notes) VALUES (%s,%s,%s,%s)",
                (pallet_id, order_id, next_no, p.notes or ""),
            )
            for it in p.items:
                if it.qty <= 0:
                    continue
                cx_execute(
                    conn,
                    "INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) VALUES (%s,%s,%s,%s)",
                    (cuid(), pallet_id, it.order_line_id, it.qty),
                )
            used.add(next_no)
            next_no += 1
            inserted += 1

    logger.info(
        "pallets.saved",
        extra={"order_id": order_id, "kept_scanned": len(scanned), "inserted": inserted},
    )
    return list_pallets(order_id)


# ── Skanowanie palet (mroźnia / załadunek) ────────────────────────

def _pallet_with_items(order_id: str, pallet_no: int) -> Dict:
    """Zwróć rekord palety wzbogacony o pozycje + nagłówek zamówienia."""
    pallet = query_one(
        "SELECT * FROM order_pallets WHERE order_id=%s AND pallet_no=%s",
        (order_id, pallet_no),
    )
    if not pallet:
        raise HTTPException(404, f"Paleta P{pallet_no} nie istnieje dla tego zamówienia")
    items = query_all(
        """SELECT pi.qty, l.kg_per_unit, l.recipe_name, l.product_type_name, l.packaging_name
           FROM order_pallet_items pi
           LEFT JOIN client_order_lines l ON l.id = pi.order_line_id
           WHERE pi.pallet_id = %s""",
        (pallet["id"],),
    )
    order = query_one(
        "SELECT id, order_no, client_name, delivery_date, status FROM client_orders WHERE id=%s",
        (order_id,),
    )
    total_qty = sum((it.get("qty") or 0) for it in items)
    total_kg  = sum(float(it.get("kg_per_unit") or 0) * (it.get("qty") or 0) for it in items)
    pallet["items"] = items
    pallet["order"] = order
    pallet["total_qty"] = total_qty
    pallet["total_kg"]  = total_kg
    return pallet


def lookup(code: str) -> Dict:
    order_id, pallet_no = parse_code(code)
    return _pallet_with_items(order_id, pallet_no)


def scan(code: str, action: str, operator: str = "", vehicle_id: str | None = None) -> Dict:
    if action not in _TRANSITIONS:
        raise HTTPException(400, f"Nieznana akcja skanu: {action}")

    order_id, pallet_no = parse_code(code)
    rule = _TRANSITIONS[action]

    pallet = query_one(
        "SELECT id, status FROM order_pallets WHERE order_id=%s AND pallet_no=%s",
        (order_id, pallet_no),
    )
    if not pallet:
        raise HTTPException(404, f"Paleta P{pallet_no} nie istnieje dla tego zamówienia")

    current = pallet.get("status") or "created"

    # Idempotencja — drugi skan tej samej akcji nie jest błędem
    if current == action:
        logger.info(
            "pallet.scan.idempotent",
            extra={"order_id": order_id, "pallet_no": pallet_no, "action": action},
        )
        return _pallet_with_items(order_id, pallet_no)

    if current not in rule["from"]:
        allowed = " / ".join(rule["from"])
        raise HTTPException(
            409,
            f"Paleta P{pallet_no} ma status '{current}' — akcja '{action}' wymaga stanu '{allowed}'",
        )

    veh_id = (vehicle_id or "").strip() or None
    if action == "loaded" and veh_id:
        existing = query_one("SELECT id FROM vehicles WHERE id=%s AND active=true", (veh_id,))
        if not existing:
            raise HTTPException(400, "Wybrany samochód nie istnieje lub jest nieaktywny")

    with transaction() as conn:
        if action == "loaded":
            cx_execute(
                conn,
                f"UPDATE order_pallets SET status=%s, {rule['field']}=now(), loaded_vehicle_id=%s WHERE id=%s",
                (action, veh_id, pallet["id"]),
            )
        else:
            cx_execute(
                conn,
                f"UPDATE order_pallets SET status=%s, {rule['field']}=now() WHERE id=%s",
                (action, pallet["id"]),
            )
        cx_execute(
            conn,
            "INSERT INTO pallet_scans (id, pallet_id, action, operator, vehicle_id) VALUES (%s,%s,%s,%s,%s)",
            (cuid(), pallet["id"], action, operator or "", veh_id),
        )

    logger.info(
        "pallet.scan",
        extra={
            "order_id": order_id,
            "pallet_no": pallet_no,
            "action": action,
            "operator": operator or "-",
            "vehicle_id": veh_id or "-",
        },
    )
    return _pallet_with_items(order_id, pallet_no)


def loading_status(order_id: str) -> Dict:
    """Status załadunku dla danego zamówienia — palety z flagami + agregaty."""
    order = query_one(
        "SELECT id, order_no, client_name, delivery_date, status FROM client_orders WHERE id=%s",
        (order_id,),
    )
    if not order:
        raise HTTPException(404, "Zamówienie nie istnieje")
    pallets = list_pallets(order_id)

    total_pallets   = len(pallets)
    loaded_pallets  = sum(1 for p in pallets if p.get("status") == "loaded")
    cold_pallets    = sum(1 for p in pallets if p.get("status") == "cold_storage")
    created_pallets = sum(1 for p in pallets if (p.get("status") or "created") == "created")
    total_kg  = 0.0
    loaded_kg = 0.0
    for p in pallets:
        kg  = sum(float(it.get("kg_per_unit") or 0) * (it.get("qty") or 0) for it in p.get("items", []))
        qty = sum((it.get("qty") or 0) for it in p.get("items", []))
        p["total_kg"]  = kg
        p["total_qty"] = qty
        total_kg += kg
        if p.get("status") == "loaded":
            loaded_kg += kg

    return {
        "order": order,
        "pallets": pallets,
        "totals": {
            "total_pallets":   total_pallets,
            "loaded_pallets":  loaded_pallets,
            "cold_pallets":    cold_pallets,
            "created_pallets": created_pallets,
            "total_kg":  total_kg,
            "loaded_kg": loaded_kg,
        },
    }


def pallets_in_cold_storage() -> List[Dict]:
    """Wszystkie palety aktualnie w mroźni (status = cold_storage).

    Każda paleta dostaje też rozbicie `parts` — sumy szt pogrupowane po
    kg/sztuka, np. [{qty: 15, kg_per_unit: 50}].
    """
    rows = query_all(
        """
        SELECT
            o.id   AS order_id,
            o.order_no,
            o.client_name,
            o.delivery_date,
            p.id   AS pallet_id,
            p.pallet_no,
            p.cold_storage_at,
            p.notes,
            COALESCE(SUM(pi.qty * COALESCE(l.kg_per_unit,0)), 0)::float AS total_kg,
            COALESCE(SUM(pi.qty), 0)::int                                AS total_qty
        FROM order_pallets p
        JOIN client_orders o          ON o.id = p.order_id
        LEFT JOIN order_pallet_items pi ON pi.pallet_id = p.id
        LEFT JOIN client_order_lines l  ON l.id = pi.order_line_id
        WHERE p.status = 'cold_storage'
        GROUP BY o.id, o.order_no, o.client_name, o.delivery_date,
                 p.id, p.pallet_no, p.cold_storage_at, p.notes
        ORDER BY p.cold_storage_at DESC NULLS LAST, p.pallet_no
        """
    )
    if not rows:
        return []
    ids = [r["pallet_id"] for r in rows]
    parts_rows = query_all(
        """
        SELECT pi.pallet_id,
               COALESCE(l.kg_per_unit, 0)::float AS kg_per_unit,
               SUM(pi.qty)::int                  AS qty
        FROM order_pallet_items pi
        LEFT JOIN client_order_lines l ON l.id = pi.order_line_id
        WHERE pi.pallet_id = ANY(%s)
        GROUP BY pi.pallet_id, l.kg_per_unit
        ORDER BY pi.pallet_id, l.kg_per_unit DESC
        """,
        (ids,),
    )
    by_pallet: Dict[str, List[Dict]] = {}
    for pr in parts_rows:
        by_pallet.setdefault(pr["pallet_id"], []).append(
            {"qty": pr["qty"], "kg_per_unit": pr["kg_per_unit"]}
        )
    for r in rows:
        r["parts"] = by_pallet.get(r["pallet_id"], [])
    return rows


def active_orders_for_loading() -> List[Dict]:
    """Zamówienia, które mają jakiekolwiek palety jeszcze nie załadowane."""
    return query_all(
        """SELECT o.id, o.order_no, o.client_name, o.delivery_date, o.status AS order_status,
                  COUNT(p.id)::int AS total_pallets,
                  SUM(CASE WHEN p.status = 'loaded'       THEN 1 ELSE 0 END)::int AS loaded_pallets,
                  SUM(CASE WHEN p.status = 'cold_storage' THEN 1 ELSE 0 END)::int AS cold_pallets,
                  SUM(CASE WHEN p.status = 'created'      THEN 1 ELSE 0 END)::int AS created_pallets
           FROM client_orders o
           JOIN order_pallets p ON p.order_id = o.id
           GROUP BY o.id
           HAVING SUM(CASE WHEN p.status <> 'loaded' THEN 1 ELSE 0 END) > 0
           ORDER BY o.delivery_date NULLS LAST, o.order_no"""
    )


def reset_pallet(order_id: str, pallet_no: int) -> Dict:
    """Cofnij wszystkie skany palety (status → created, czyść timestampy)."""
    pallet = query_one(
        "SELECT id FROM order_pallets WHERE order_id=%s AND pallet_no=%s",
        (order_id, pallet_no),
    )
    if not pallet:
        raise HTTPException(404, f"Paleta P{pallet_no} nie istnieje")
    with transaction() as conn:
        cx_execute(
            conn,
            "UPDATE order_pallets SET status='created', cold_storage_at=NULL, loaded_at=NULL WHERE id=%s",
            (pallet["id"],),
        )
        cx_execute(
            conn,
            "INSERT INTO pallet_scans (id, pallet_id, action, operator) VALUES (%s,%s,'reset','')",
            (cuid(), pallet["id"]),
        )
    logger.info("pallet.reset", extra={"order_id": order_id, "pallet_no": pallet_no})
    return _pallet_with_items(order_id, pallet_no)
