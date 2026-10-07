"""Powiązanie spakowanego kartonu magazynowego z późniejszym zamówieniem.

Proces (właściciel, 10.2026: „spakowane kartony w magazynie bez zamówień
z późniejszym zamówieniem"): realna produkcja → karton magazynowy (także bez
klienta) → biuro JAWNIE przypisuje CAŁY spakowany karton do zgodnego
zamówienia → auto skanuje STARĄ etykietę → kurs/dokument jak dla każdego
kartonu powiązanego z zamówieniem.

Przypisanie zmienia WYŁĄCZNIE `stock_cartons.linked_order_id/no` oraz
`finished_units.order_id`. Nie powstaje nowa produkcja, nie ma kopiowania
sztuk, wymiany QR, zmiany partii, `source_finished_goods_id` ani ruchów
magazynowych — stan wyrobu gotowego schodzi dopiero przy zamknięciu kursu.

Reguły:
  * klient: ten sam `client_id` albo karton NICZYJ (bez id, nazwa pusta lub
    umowna „na magazyn"/„magazyn"/„stan"). Sama nazwa obcego klienta bez id
    NIE jest wildcardem.
  * zgodność STRICT każdej pozycji: receptura + rodzaj + tuleja (packaging_id)
    + waga sztuki (3 miejsca). Bez wildcardów i bez dobierania podobnych.
  * tylko kompletny karton: status packed, każda pozycja target=packed>0,
    realne sztuki w tej samej liczbie i składzie, bez palety/wydania/auta.
  * limit per specyfikacja: ilość zamówienia minus rozpis palet minus
    WSZYSTKIE kartony już powiązane (także wydane) — z `target_qty`, nie
    z „wykonano" (to obejmuje wolny wyrób gotowy i nie jest rezerwacją).

TRYB BEZ SKANERA (tymczasowy, właściciel 07.10.2026: „nie skanujemy sztuk —
dopóki nie uruchomimy skanera na produkcji"): karton, do którego nie
zeskanowano ŻADNEJ sztuki, liczy się jako spakowany, gdy towar tej
specyfikacji jest już wyprodukowany i leży na magazynie wyrobu gotowego
(pula zamówienia albo niczyj), po odjęciu innych takich kartonów przypisanych
do otwartych zamówień tej puli. Przypisanie nie rusza stanu.
Załadunek etykietą działa: kurs liczy taki karton jak paletę bez sztuk QR
(zawartość z pozycji kartonu, partie z magazynu). Gdy hala zacznie skanować, karton ze sztukami wraca na zwykłe
reguły i ten tryb przestaje mieć zastosowanie.
"""
from collections import Counter
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, format_carton_no

logger = get_logger(__name__)

Spec = Tuple[str, str, str, float]

# Nazwy „klienta" oznaczające karton niczyj (produkcja na magazyn).
GENERIC_CLIENT_NAMES = frozenset({"", "na magazyn", "magazyn", "stan"})
CLOSED_ORDER_STATUSES = ("done", "cancelled")

MSG_ROZPIS = ("Część zamówienia jest już rozpisana na palety/kartony — zweryfikuj rozpis, "
              "nie twórz duplikatu.")


# ── Czysta logika ─────────────────────────────────────────────────────────

def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


def spec_key(row: Dict[str, Any]) -> Spec:
    """Ścisła specyfikacja pozycji (zamówienia albo kartonu)."""
    return (row.get("recipe_id") or "", row.get("product_type_id") or "",
            row.get("packaging_id") or "", _kg(row.get("kg_per_unit")))


def spec_label(row: Dict[str, Any]) -> str:
    nazwa = row.get("product_type_name") or row.get("recipe_name") or row.get("recipe_id") or "?"
    tul = row.get("packaging_name") or "bez tulei"
    return f"{nazwa} · {tul} · {_kg(row.get('kg_per_unit')):g} kg"


def is_generic_carton(carton: Dict[str, Any]) -> bool:
    return (not (carton.get("client_id") or "").strip()
            and (carton.get("client_name") or "").strip().lower() in GENERIC_CLIENT_NAMES)


def client_reason(carton: Dict[str, Any], order_client_id: str) -> Optional[str]:
    """None, gdy karton wolno przypisać zamówieniu tego klienta."""
    cid = (carton.get("client_id") or "").strip()
    if cid:
        if cid == (order_client_id or "").strip():
            return None
        return "Karton należy do innego klienta niż zamówienie"
    if is_generic_carton(carton):
        return None
    return (f"Karton opisany klientem „{(carton.get('client_name') or '').strip()}” bez karty "
            "klienta — nie można go przejąć")


def qty_by_spec(rows: List[Dict[str, Any]], field: str) -> Dict[Spec, int]:
    out: Dict[Spec, int] = {}
    for r in rows:
        q = int(r.get(field) or 0)
        if q:
            k = spec_key(r)
            out[k] = out.get(k, 0) + q
    return out


_SPEC_FIELDS = (("receptura", 0), ("rodzaj", 1), ("tuleja", 2), ("waga", 3))


def mismatch_reason(carton_lines: List[Dict[str, Any]],
                    order_lines: List[Dict[str, Any]]) -> Optional[str]:
    """Pierwsza pozycja kartonu bez ścisłego odpowiednika w zamówieniu."""
    order_keys = {spec_key(l) for l in order_lines}
    for cl in carton_lines:
        k = spec_key(cl)
        if k in order_keys:
            continue
        # Najbliższa pozycja zamówienia — tylko do nazwania różnicy w komunikacie.
        best: List[str] = ["receptura", "rodzaj", "tuleja", "waga"]
        for ok in order_keys:
            diff = [n for n, i in _SPEC_FIELDS if ok[i] != k[i]]
            if len(diff) < len(best):
                best = diff
        return f"Niezgodna {'/'.join(best)} pozycji {spec_label(cl)} — nie ma jej w zamówieniu"
    return None


def capacity_reason(carton_need: Dict[Spec, int], order_qty: Dict[Spec, int],
                    pallet_res: Dict[Spec, int], carton_res: Dict[Spec, int],
                    labels: Dict[Spec, str]) -> Optional[str]:
    """Cały karton musi się zmieścić w wolnej ilości każdej specyfikacji."""
    for k, need in carton_need.items():
        q, p, c = order_qty.get(k, 0), pallet_res.get(k, 0), carton_res.get(k, 0)
        free = q - p - c
        if need > free:
            msg = (f"Brak wolnej ilości dla {labels.get(k) or k}: zamówiono {q} szt., "
                   f"rozpisano na palety {p}, przypisane kartony {c}, wolne {max(free, 0)}, "
                   f"karton ma {need} szt.")
            if p or c:
                msg += " " + MSG_ROZPIS
            return msg
    return None


def is_scannerless(carton: Dict[str, Any], lines: List[Dict[str, Any]],
                   units: List[Dict[str, Any]]) -> bool:
    """Karton, do którego nikt nie zeskanował żadnej sztuki (tryb bez skanera)."""
    return (bool(lines) and not units and int(carton.get("packed_qty") or 0) == 0
            and all(int(l.get("packed_qty") or 0) == 0 for l in lines))


def scannerless_stock_reason(carton_need: Dict[Spec, int], on_stock: Dict[Spec, int],
                             claimed: Dict[Spec, int], labels: Dict[Spec, str]) -> Optional[str]:
    """Karton bez sztuk musi mieć pokrycie w wyprodukowanym towarze na stanie."""
    for k, need in carton_need.items():
        s, c = on_stock.get(k, 0), claimed.get(k, 0)
        if need > s - c:
            return (f"Brak wyprodukowanego towaru na stanie dla {labels.get(k) or '/'.join(map(str, k))}: "
                    f"na magazynie {s} szt., inne kartony bez skanowania {c} szt., karton ma {need} szt. "
                    "— karton liczy się jako spakowany, gdy towar jest już wyprodukowany")
    return None


def _unit_key(u: Dict[str, Any]) -> tuple:
    return (u.get("recipe_id") or "", u.get("product_type_id") or "",
            u.get("tuleja") or "", _kg(u.get("weight_kg")))


def completeness_reason(carton: Dict[str, Any], lines: List[Dict[str, Any]],
                        units: List[Dict[str, Any]], order_id: str = "") -> Optional[str]:
    """None, gdy karton jest kompletnie spakowany i fizycznie wolny."""
    if carton.get("shipped_at") or any(u.get("status") == "shipped" for u in units):
        return "Karton został już wydany"
    if carton.get("loaded_vehicle_id"):
        return "Karton stoi już na aucie"
    if any(u.get("dispatch_id") for u in units):
        return "Karton jest na wydaniu — najpierw cofnij go z wydania"
    if not lines:
        return "Karton nie ma pozycji (stary zapis) — nie można go przypisać"
    if is_scannerless(carton, lines, units):
        # Ilość potwierdza stan magazynu (`scannerless_stock_reason`), nie sztuki.
        if carton.get("status") != "open" or any(int(l.get("target_qty") or 0) <= 0 for l in lines):
            return "Karton bez sztuk ma niespójne liczniki — wyjaśnij z magazynem"
        return None
    target = sum(int(l.get("target_qty") or 0) for l in lines)
    packed = sum(int(l.get("packed_qty") or 0) for l in lines)
    if packed <= 0 and not units:
        return "Karton jest pusty — najpierw spakuj sztuki"
    if (carton.get("status") != "packed"
            or any(int(l.get("target_qty") or 0) <= 0
                   or int(l.get("packed_qty") or 0) != int(l.get("target_qty") or 0) for l in lines)):
        return f"Karton spakowany częściowo ({packed}/{target} szt.) — dopakuj go do końca"
    expected = Counter()
    for l in lines:
        expected[(l.get("recipe_id") or "", l.get("product_type_id") or "",
                  l.get("packaging_name") or "", _kg(l.get("kg_per_unit")))] += int(l["target_qty"])
    if (len(units) != target
            or any(u.get("status") != "packed" or u.get("pallet_id") for u in units)
            or Counter(_unit_key(u) for u in units) != expected):
        return ("Niespójny skład kartonu (liczniki nie zgadzają się ze sztukami) — "
                "wyjaśnij z magazynem")
    if any((u.get("order_id") or "") not in ("", order_id) for u in units):
        return "Sztuki kartonu są przypisane do innego zamówienia"
    return None


def match_reason(carton: Dict[str, Any], carton_lines: List[Dict[str, Any]],
                 order_client_id: str, order_lines: List[Dict[str, Any]],
                 pallet_res: Optional[Dict[Spec, int]] = None,
                 carton_res: Optional[Dict[Spec, int]] = None,
                 qty_field: str = "target_qty") -> Optional[str]:
    """Klient + ścisła zgodność składu + wolna ilość (bez stanu fizycznego)."""
    r = client_reason(carton, order_client_id)
    if r:
        return r
    r = mismatch_reason([l for l in carton_lines if int(l.get(qty_field) or 0) > 0], order_lines)
    if r:
        return r
    labels = {spec_key(l): spec_label(l) for l in order_lines}
    return capacity_reason(qty_by_spec(carton_lines, qty_field), qty_by_spec(order_lines, "qty"),
                           pallet_res or {}, carton_res or {}, labels)


def overflow_by_spec(order_qty: Dict[Spec, int], pallet_res: Dict[Spec, int],
                     carton_res: Dict[Spec, int]) -> Dict[Spec, int]:
    """Nadmiar rezerwacji ponad zamówienie — tylko specyfikacje z kartonami."""
    return {k: pallet_res.get(k, 0) + c - order_qty.get(k, 0)
            for k, c in carton_res.items() if c > 0}


# ── Odczyty (w transakcji albo bez) ───────────────────────────────────────

def _q(conn) -> Callable[[str, tuple], List[Dict[str, Any]]]:
    if conn is None:
        return lambda sql, p: query_all(sql, p)
    return lambda sql, p: cx_query_all(conn, sql, p)


def _order_lines(conn, order_id: str) -> List[Dict[str, Any]]:
    return _q(conn)(
        "SELECT id, recipe_id, recipe_name, product_type_id, product_type_name, packaging_id, "
        "       packaging_name, kg_per_unit, qty FROM client_order_lines "
        "WHERE order_id=%s ORDER BY position, id", (order_id,))


def reservations(conn, order_id: str, exclude_carton_id: str = "") -> Tuple[Dict[Spec, int], Dict[Spec, int]]:
    """(palety, kartony) per ścisła specyfikacja. Kartony — wszystkie powiązane,
    także wydane, z `target_qty` (karton bez pozycji: nagłówek)."""
    q = _q(conn)
    pallet_rows = q(
        """SELECT l.recipe_id, l.product_type_id, l.packaging_id, l.kg_per_unit, pi.qty
             FROM order_pallet_items pi
             JOIN order_pallets p ON p.id = pi.pallet_id
             JOIN client_order_lines l ON l.id = pi.order_line_id
            WHERE p.order_id = %s""", (order_id,))
    carton_rows = q(
        """SELECT l.recipe_id, l.product_type_id, l.packaging_id, l.kg_per_unit, l.target_qty
             FROM stock_carton_lines l JOIN stock_cartons sc ON sc.id = l.carton_id
            WHERE sc.linked_order_id = %s AND sc.id <> %s
           UNION ALL
           SELECT sc.recipe_id, sc.product_type_id, sc.packaging_id, sc.kg_per_unit, sc.target_qty
             FROM stock_cartons sc
            WHERE sc.linked_order_id = %s AND sc.id <> %s
              AND NOT EXISTS (SELECT 1 FROM stock_carton_lines l WHERE l.carton_id = sc.id)""",
        (order_id, exclude_carton_id, order_id, exclude_carton_id))
    return qty_by_spec(pallet_rows, "qty"), qty_by_spec(carton_rows, "target_qty")


def scannerless_stock(conn, order: Dict[str, Any],
                      exclude_carton_id: str = "") -> Tuple[Dict[Spec, int], Dict[Spec, int]]:
    """(na stanie, zajęte) per ścisła specyfikacja — dla kartonów bez sztuk.

    Na stanie: wyrób gotowy ostemplowany tym zamówieniem albo wolny z puli
    zamówienia lub niczyj (ta sama reguła puli co pokrycie zamówienia).
    Zajęte: inne kartony bez sztuk, przypisane do otwartych zamówień tej puli
    jeszcze bez dokumentu WZ/WM."""
    from app.services.order_stock_service import _PULA_ZAPASU, _pula_zamowienia
    q = _q(conn)
    order_no = order.get("order_no") or ""
    pula = _pula_zamowienia(order["id"])
    stock_rows = q(
        f"""SELECT fg.recipe_id, fg.product_type_id, fg.packaging_id, fg.kg_per_unit, fg.qty_available
             FROM finished_goods fg
            WHERE COALESCE(fg.qty_available, 0) > 0
              AND (fg.client_order_no = %s
                   OR ((COALESCE(fg.client_order_no, '') = ''
                        OR NOT EXISTS (SELECT 1 FROM client_orders o2
                                       WHERE o2.order_no = fg.client_order_no
                                         AND o2.status NOT IN ('done', 'cancelled')))
                       AND {_PULA_ZAPASU} IN ('', %s)))""", (order_no, pula))
    claimed_rows = q(
        """SELECT l.recipe_id, l.product_type_id, l.packaging_id, l.kg_per_unit, l.target_qty
             FROM stock_cartons sc
             JOIN stock_carton_lines l ON l.carton_id = sc.id
             JOIN client_orders o ON o.id = sc.linked_order_id
             LEFT JOIN clients c ON c.id = NULLIF(o.client_id, '')
            WHERE sc.id <> %s
              AND o.status NOT IN ('done', 'cancelled')
              AND COALESCE(NULLIF(c.group_id, ''), c.id, NULLIF(o.client_id, ''), '') = %s
              AND COALESCE(sc.packed_qty, 0) = 0
              AND NOT EXISTS (SELECT 1 FROM finished_units fu WHERE fu.carton_id = sc.id)
              -- Kurs nie zdejmuje stanu (robi to WZ biura), więc wydany karton dalej
              -- zajmuje towar; po WZ towar już zszedł ze stanu i liczony drugi raz
              -- zablokowałby inne kartony.
              AND NOT EXISTS (SELECT 1 FROM wz_documents w
                              WHERE w.source_type = 'order' AND w.source_id = o.id
                                AND COALESCE(w.status, '') <> 'anulowany')""",
        (exclude_carton_id, pula))
    return qty_by_spec(stock_rows, "qty_available"), qty_by_spec(claimed_rows, "target_qty")


def active_documents(conn, order_id: str) -> List[str]:
    rows = _q(conn)(
        "SELECT number FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at", (order_id,))
    return [r["number"] for r in rows]


def _docs_message(numbers: List[str], what: str) -> str:
    return (f"Do zamówienia wystawiono dokumenty WZ/WM: {', '.join(numbers)}. {what} "
            "Zwykła kolejność: najpierw przypisz kartony, potem wystaw dokumenty "
            "(albo anuluj dokument w Wydaniach).")


def _lines_and_units(conn, carton_ids: List[str]):
    if not carton_ids:
        return {}, {}
    q = _q(conn)
    lines: Dict[str, List[Dict[str, Any]]] = {}
    for l in q("SELECT * FROM stock_carton_lines WHERE carton_id = ANY(%s) ORDER BY kg_per_unit, id",
               (carton_ids,)):
        lines.setdefault(l["carton_id"], []).append(l)
    units: Dict[str, List[Dict[str, Any]]] = {}
    for u in q("SELECT id, carton_id, status, recipe_id, product_type_id, tuleja, weight_kg, "
               "       pallet_id, dispatch_id, order_id, batch_no FROM finished_units "
               "WHERE carton_id = ANY(%s) ORDER BY id", (carton_ids,)):
        units.setdefault(u["carton_id"], []).append(u)
    return lines, units


def check_order_reservations_cx(conn, order_id: str,
                                before: Optional[Dict[Spec, int]] = None) -> Dict[Spec, int]:
    """Kontrola wewnątrz transakcji (po blokadzie zamówienia): palety + powiązane
    kartony nie mogą przekroczyć ilości zamówienia. Bez `before` zwraca bieżący
    nadmiar (stan wyjściowy). Z `before` odmawia, gdy zmiana ZWIĘKSZYŁA
    nadmiar — zmniejszanie dawnego nadmiaru zawsze przechodzi."""
    order_lines = _order_lines(conn, order_id)
    pallet_res, carton_res = reservations(conn, order_id)
    over = overflow_by_spec(qty_by_spec(order_lines, "qty"), pallet_res, carton_res)
    if before is None:
        return over
    bad = [k for k, v in over.items() if v > 0 and v > before.get(k, 0)]
    if bad:
        labels = {spec_key(l): spec_label(l) for l in order_lines}
        opis = "; ".join(
            f"{labels.get(k) or '/'.join(map(str, k))}: przypisane kartony {carton_res.get(k, 0)} szt., "
            f"palety {pallet_res.get(k, 0)} szt., zamówienie "
            f"{qty_by_spec(order_lines, 'qty').get(k, 0)} szt." for k in bad)
        raise HTTPException(
            409, "Zmiana przekracza ilość zamówienia po uwzględnieniu przypisanych kartonów "
                 f"magazynowych ({opis}). Najpierw odłącz karton albo popraw rozpis. " + MSG_ROZPIS)
    return over


def linked_cartons_cx(conn, order_id: str) -> List[Dict[str, Any]]:
    return cx_query_all(conn, "SELECT id, carton_no FROM stock_cartons WHERE linked_order_id=%s "
                              "ORDER BY carton_no", (order_id,))


def refuse_if_linked_cartons_cx(conn, order_id: str, what: str) -> None:
    rows = linked_cartons_cx(conn, order_id)
    if rows:
        nry = ", ".join(format_carton_no(r.get("carton_no")) or "?" for r in rows)
        raise HTTPException(
            409, f"{what}: do zamówienia są przypisane kartony magazynowe ({nry}). "
                 "Najpierw odłącz je w sekcji „Kartony z magazynu” — towar i kartony zostają nietknięte.")


# ── Zapis ─────────────────────────────────────────────────────────────────

def _event(conn, carton_id: str, action: str, operator: str) -> None:
    cx_execute(conn, "INSERT INTO warehouse_events (id,container_id,action,operator) VALUES (%s,%s,%s,%s)",
               (cuid(), carton_id, action, operator or ""))


def assign(carton_id: str, order_id: str, operator: str = "") -> Dict[str, Any]:
    """Przypisz CAŁY spakowany karton do zamówienia (blokady: zamówienie →
    karton → sztuki; walidacja pod blokadą). Retry tej samej pary = OK."""
    if not carton_id:
        raise HTTPException(400, "Nie wskazano kartonu")
    with transaction() as conn:
        order = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,))
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        carton = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,))
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        label = format_carton_no(carton.get("carton_no"))
        if carton.get("linked_order_id") == order_id:
            return {"ok": True, "already": True, "cartonId": carton_id, "cartonNo": label,
                    "orderNo": order.get("order_no")}
        if carton.get("linked_order_id"):
            raise HTTPException(409, f"Karton {label} jest już przypisany do zamówienia "
                                     f"{carton.get('linked_order_no') or carton['linked_order_id']}")
        if (order.get("status") or "") in CLOSED_ORDER_STATUSES:
            raise HTTPException(409, "Zamówienie jest zakończone lub anulowane — nie można przypisać kartonu")
        docs = active_documents(conn, order_id)
        if docs:
            raise HTTPException(409, _docs_message(docs, "Nowego kartonu nie można już przypisać."))
        reason = client_reason(carton, order.get("client_id") or "")
        if reason:
            raise HTTPException(409, reason)
        lines = cx_query_all(conn, "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY id",
                             (carton_id,))
        units = cx_query_all(conn, "SELECT * FROM finished_units WHERE carton_id=%s ORDER BY id FOR UPDATE",
                             (carton_id,))
        reason = completeness_reason(carton, lines, units, order_id)
        if not reason and is_scannerless(carton, lines, units):
            on_stock, claimed = scannerless_stock(conn, order, carton_id)
            reason = scannerless_stock_reason(qty_by_spec(lines, "target_qty"), on_stock, claimed,
                                              {spec_key(l): spec_label(l) for l in lines})
        if reason:
            raise HTTPException(409, f"Karton {label}: {reason}")
        pallet_res, carton_res = reservations(conn, order_id, carton_id)
        reason = match_reason(carton, lines, order.get("client_id") or "",
                              _order_lines(conn, order_id), pallet_res, carton_res)
        if reason:
            raise HTTPException(409, f"Karton {label}: {reason}")
        cx_execute(conn, "UPDATE stock_cartons SET linked_order_id=%s, linked_order_no=%s WHERE id=%s",
                   (order_id, order.get("order_no"), carton_id))
        cx_execute(conn, "UPDATE finished_units SET order_id=%s WHERE carton_id=%s",
                   (order_id, carton_id))
        _event(conn, carton_id, f"order_link:{order_id}", operator)
    logger.info("stock_cartons.assigned",
                extra={"carton_id": carton_id, "order_id": order_id, "units": len(units)})
    return {"ok": True, "already": False, "cartonId": carton_id, "cartonNo": label,
            "orderNo": order.get("order_no"), "units": len(units)}


def detach(carton_id: str, order_id: str, operator: str = "") -> Dict[str, Any]:
    """Odłącz omyłkowo przypisany karton — tylko przed autem/wydaniem/dokumentem.
    Usuwa wyłącznie powiązanie; karton, sztuki, partie i numery zostają."""
    with transaction() as conn:
        order = cx_query_one(conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,))
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        carton = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,))
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        label = format_carton_no(carton.get("carton_no"))
        if not carton.get("linked_order_id"):
            return {"ok": True, "already": True, "cartonId": carton_id, "cartonNo": label}
        if carton["linked_order_id"] != order_id:
            raise HTTPException(409, f"Karton {label} jest przypisany do innego zamówienia")
        units = cx_query_all(conn, "SELECT * FROM finished_units WHERE carton_id=%s ORDER BY id FOR UPDATE",
                             (carton_id,))
        reason = detach_block_reason(carton, units, order)
        if reason:
            raise HTTPException(409, f"Karton {label}: {reason}")
        docs = active_documents(conn, order_id)
        if docs:
            raise HTTPException(409, _docs_message(docs, "Kartonu nie można już odłączyć."))
        cx_execute(conn, "UPDATE stock_cartons SET linked_order_id=NULL, linked_order_no=NULL WHERE id=%s",
                   (carton_id,))
        cx_execute(conn, "UPDATE finished_units SET order_id=NULL WHERE carton_id=%s AND order_id=%s",
                   (carton_id, order_id))
        _event(conn, carton_id, f"order_unlink:{order_id}", operator)
    logger.info("stock_cartons.detached", extra={"carton_id": carton_id, "order_id": order_id})
    return {"ok": True, "already": False, "cartonId": carton_id, "cartonNo": label}


def detach_block_reason(carton: Dict[str, Any], units: List[Dict[str, Any]],
                        order: Dict[str, Any]) -> Optional[str]:
    if carton.get("shipped_at") or any(u.get("status") == "shipped" for u in units):
        return "karton został już wydany — nie można go odłączyć"
    if carton.get("loaded_vehicle_id"):
        return "karton stoi na aucie — najpierw cofnij skan załadunku"
    if any(u.get("dispatch_id") for u in units):
        return "karton jest na wydaniu — najpierw cofnij go z wydania"
    if (order.get("status") or "") in CLOSED_ORDER_STATUSES:
        return "zamówienie jest zakończone lub anulowane"
    return None


# ── Przegląd dla biura ────────────────────────────────────────────────────

def _carton_view(c: Dict[str, Any], lines: List[Dict[str, Any]], units: List[Dict[str, Any]]) -> Dict[str, Any]:
    scannerless = is_scannerless(c, lines, units)
    return {
        "cartonId": c["id"],
        "cartonNo": c.get("carton_no"),
        "cartonLabel": format_carton_no(c.get("carton_no")),
        "clientId": c.get("client_id") or "",
        "clientName": c.get("client_name") or "",
        "generic": is_generic_carton(c),
        "status": c.get("status") or "",
        "inColdStorage": bool(c.get("cold_storage_at")),
        "loaded": bool(c.get("loaded_vehicle_id")),
        "shipped": bool(c.get("shipped_at")) or any(u.get("status") == "shipped" for u in units),
        "packedQty": sum(int(l.get("packed_qty") or 0) for l in lines) if lines else int(c.get("packed_qty") or 0),
        "targetQty": sum(int(l.get("target_qty") or 0) for l in lines) if lines else int(c.get("target_qty") or 0),
        # Bez skanera sztuk fizycznie w kartonie jest tyle, ile zadeklarowano.
        "units": sum(int(l.get("target_qty") or 0) for l in lines) if scannerless else len(units),
        "scannerless": scannerless,
        "batches": sorted({u.get("batch_no") or "" for u in units} - {""}),
        "lines": [{
            "recipeName": l.get("recipe_name") or "",
            "productTypeName": l.get("product_type_name") or "",
            "packagingName": l.get("packaging_name") or "",
            "kgPerUnit": _kg(l.get("kg_per_unit")),
            "packedQty": int(l.get("packed_qty") or 0),
            "targetQty": int(l.get("target_qty") or 0),
        } for l in lines],
    }


def options_for_order(order_id: str) -> Dict[str, Any]:
    """Kartony DOSTĘPNE do przypisania, JUŻ PRZYPISANE i istotne niedostępne
    (z powodem). Kilka zbiorczych SELECT-ów, nie zapytanie na karton."""
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    client_id = order.get("client_id") or ""
    status = order.get("status") or ""
    order_lines = _order_lines(None, order_id)
    pallet_res, carton_res = reservations(None, order_id)
    block = None
    if status in CLOSED_ORDER_STATUSES:
        block = "Zamówienie jest zakończone lub anulowane — przypisywanie niedostępne."
    else:
        docs = active_documents(None, order_id)
        if docs:
            block = _docs_message(docs, "Nowego kartonu nie można już przypisać.")

    assigned_rows = query_all("SELECT * FROM stock_cartons WHERE linked_order_id=%s ORDER BY carton_no",
                              (order_id,))
    candidate_rows = query_all(
        """SELECT * FROM stock_cartons
            WHERE linked_order_id IS NULL AND shipped_at IS NULL
              AND (client_id = %s OR COALESCE(client_id,'') = '')
            ORDER BY carton_no""", (client_id,))
    ids = [r["id"] for r in assigned_rows] + [r["id"] for r in candidate_rows]
    lines_by, units_by = _lines_and_units(None, ids)

    order_rt = {(l.get("recipe_id") or "", l.get("product_type_id") or "") for l in order_lines}
    stock = None  # (na stanie, zajęte) — liczone raz, tylko gdy jest karton bez sztuk
    available, unavailable = [], []
    for c in candidate_rows:
        lines, units = lines_by.get(c["id"], []), units_by.get(c["id"], [])
        same_client = bool(client_id) and (c.get("client_id") or "") == client_id
        if not same_client:
            # Karton niczyj: tylko gdy naprawdę niczyj i dotyczy produktów zamówienia.
            if not is_generic_carton(c):
                continue
            if not any(((l.get("recipe_id") or ""), (l.get("product_type_id") or "")) in order_rt
                       for l in lines):
                continue
        reason = (completeness_reason(c, lines, units, order_id)
                  or match_reason(c, lines, client_id, order_lines, pallet_res, carton_res))
        if not reason and is_scannerless(c, lines, units):
            if stock is None:
                stock = scannerless_stock(None, order)
            reason = scannerless_stock_reason(qty_by_spec(lines, "target_qty"), stock[0], stock[1],
                                              {spec_key(l): spec_label(l) for l in lines})
        view = _carton_view(c, lines, units)
        if reason:
            view["reason"] = reason
            unavailable.append(view)
        else:
            first = spec_key(lines[0])
            view["orderLineId"] = next(l["id"] for l in order_lines if spec_key(l) == first)
            available.append(view)

    assigned = []
    for c in assigned_rows:
        lines, units = lines_by.get(c["id"], []), units_by.get(c["id"], [])
        view = _carton_view(c, lines, units)
        why = detach_block_reason(c, units, order)
        if not why and block and status not in CLOSED_ORDER_STATUSES:
            why = "do zamówienia wystawiono dokument WZ/WM"
        view["canDetach"] = why is None
        view["detachBlockedReason"] = why
        assigned.append(view)

    return {
        "orderId": order_id,
        "orderNo": order.get("order_no") or "",
        "orderStatus": status,
        "assignBlockedReason": block,
        "available": available,
        "assigned": assigned,
        "unavailable": unavailable,
        "assignedTotals": {"cartons": len(assigned), "units": sum(a["units"] for a in assigned)},
    }
