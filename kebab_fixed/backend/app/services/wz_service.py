"""Dokument WZ (Wydanie Zewnętrzne) — numeracja, budowa pozycji, generowanie.

Wzorzec jak HDI: numer WZ/NN/MM/RR z MAX(seq) per year_month, idempotencja
per (source_type, source_id), druk przez headless Chrome.
"""
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.services.order_stock_service import (
    produced_by_key_from_plan_lines,
    stock_portions_for_order,
)
from app.services.settings_service import get_company
from app.utils.ids import cuid, now_iso
from app.utils.pallets import pallet_containers
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def format_wz_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2606"); numer = WZ/NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"WZ/{seq}/{mm}/{yy}"


def build_wz_lines(items: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Zbuduj pozycje WZ. valued=True → cena + wartość.

    Pozycje z kg_per_unit (wyroby gotowe) są wyceniane ZA KG:
    total_kg = qty * kg_per_unit, value = total_kg * price.
    Pozycje bez kg_per_unit liczą się po staremu: value = qty * price.
    """
    lines: List[Dict[str, Any]] = []
    total = 0.0
    for it in items or []:
        qty = float(it.get("qty") or 0)
        kg_per_unit = float(it.get("kg_per_unit") or 0)
        line: Dict[str, Any] = {
            "name": it.get("name") or "",
            "qty": round(qty, 3),
            "unit": it.get("unit") or "kg",
            "batch_no": it.get("batch_no"),
            "price": None,
            "value": None,
        }
        if kg_per_unit > 0:
            line["kg_per_unit"] = round(kg_per_unit, 3)
            line["total_kg"] = round(qty * kg_per_unit, 3)
        if valued:
            price = float(it.get("price") or 0)
            base = line.get("total_kg") if kg_per_unit > 0 else qty
            value = round(float(base) * price, 2)
            line["price"] = round(price, 2)
            line["value"] = value
            total += value
        lines.append(line)
    return lines, round(total, 2)


def build_manual_wz_lines(selections: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Mapuje wybór magazynu na pozycje WZ (reużywa build_wz_lines) i dokleja
    ślad magazynowy (stock_type/stock_id) do każdej pozycji."""
    items = [
        {"name": s.get("name"), "qty": s.get("qty"), "unit": s.get("unit"),
         "price": s.get("price"), "batch_no": s.get("batch_no"),
         "kg_per_unit": s.get("kg_per_unit")}
        for s in (selections or [])
    ]
    lines, total = build_wz_lines(items, valued)
    for line, s in zip(lines, selections or []):
        line["stock_type"] = s.get("stock_type")
        line["stock_id"] = s.get("stock_id")
        # Pojemniki (E2) — informacyjnie na dokumencie i do HDI surowca.
        try:
            cont = int(s.get("containers") or 0)
        except (TypeError, ValueError):
            cont = 0
        if cont > 0:
            line["containers"] = cont
        if s.get("production_date"):
            line["production_date"] = str(s["production_date"])[:10]
    return lines, total


def build_goods_wz_lines(goods_with_counts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pozycje WZ z wydania po twardym linku sztuka→wyrób: jedna linia per
    finished_goods. batch_no = pełna partia WYROBU (format "ddmmrr partia",
    jak na etykiecie i HDI). kg_per_unit/total_kg dołączone, żeby późniejsze
    uzupełnienie cen liczyło ZA KG (apply_wz_prices). Bez cen (WZ wstępny).

    goods_with_counts: [{"goods": wiersz finished_goods, "count": szt}]
    """
    lines: List[Dict[str, Any]] = []
    for g in goods_with_counts or []:
        fg = g.get("goods") or {}
        count = int(g.get("count") or 0)
        kgpu = float(fg.get("kg_per_unit") or 0)
        line: Dict[str, Any] = {
            "name": fg.get("recipe_name") or fg.get("product_type_name") or "Kebab",
            "qty": count,
            "unit": "szt",
            "batch_no": fg.get("batch_no"),
            "price": None,
            "value": None,
            "stock_type": "fg",
            "stock_id": fg.get("id"),
        }
        if kgpu > 0:
            line["kg_per_unit"] = round(kgpu, 3)
            line["total_kg"] = round(count * kgpu, 3)
        lines.append(line)
    lines.sort(key=lambda l: (l["name"], l["batch_no"] or ""))
    return lines


def is_foreign_nip(nip: Optional[str]) -> bool:
    """Klient zagraniczny, gdy NIP zaczyna się od dwóch liter różnych od 'PL'
    (np. DE, SK, AT). Czyste cyfry lub 'PL…' = krajowy. Puste = krajowy."""
    s = (nip or "").strip().upper()
    if len(s) < 2:
        return False
    prefix = s[:2]
    return prefix.isalpha() and prefix != "PL"


def should_reuse(existing: Optional[Dict], source_id: Optional[str]) -> bool:
    """WZ jest idempotentny per źródło: istniejący dokument dla danego
    (source_type, source_id) zwracamy ponownie. WZ ręczny (brak source_id)
    zawsze tworzy nowy dokument."""
    return bool(existing) and bool((source_id or "").strip())


def _seller_block() -> Dict[str, Any]:
    co = get_company()
    addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    return {
        "name": co.get("name", ""),
        "address": addr,
        "nip": co.get("nip", ""),
        "email": co.get("email", ""),
    }


def _insert_wz(conn, *, source_type, source_id, seller, buyer, valued, lines,
               total, place, issued, released, notes,
               currency: str = "PLN", eur_rate: Optional[float] = None) -> str:
    """Wstaw dokument WZ w trwającej transakcji, nadaj numer WZ/NN/MM/RR. Zwraca id."""
    today = date.today()
    ym = today.strftime("%y%m")  # RRMM
    seq_row = cx_query_one(
        conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM wz_documents WHERE year_month=%s", (ym,))
    seq = int(seq_row["n"])
    number = format_wz_number(seq, ym)
    wid = cuid()
    cx_execute_returning(
        conn,
        """INSERT INTO wz_documents
           (id, number, seq, year_month, source_type, source_id, seller,
            buyer_name, buyer_address, buyer_nip, valued, lines, total_value,
            place, issued_date, release_date, status, notes, currency, eur_rate,
            created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s,%s,%s)
           RETURNING id""",
        (wid, number, seq, ym, source_type, source_id, json.dumps(seller),
         buyer.get("name"), buyer.get("address"), buyer.get("nip"), valued,
         json.dumps(lines), total, place, issued, released, notes,
         (currency or "PLN").upper(), eur_rate, now_iso()),
    )
    logger.info("wz.generated", extra={"wz_id": wid, "number": number})
    return wid


def generate_wz(
    source_type: Optional[str],
    source_id: Optional[str],
    buyer: Dict[str, Any],
    items: List[Dict[str, Any]],
    valued: bool = True,
    place: Optional[str] = None,
    issued_date: Optional[str] = None,
    release_date: Optional[str] = None,
    notes: str = "",
) -> Dict[str, Any]:
    if not items:
        raise HTTPException(400, "WZ wymaga co najmniej jednej pozycji")

    lines, total = build_wz_lines(items, valued)
    co = get_company()
    today = date.today()
    issued = issued_date or today.isoformat()
    released = release_date or issued
    place_val = place or co.get("city") or ""
    seller = _seller_block()

    with transaction() as conn:
        existing = None
        if (source_id or "").strip():
            existing = cx_query_one(
                conn,
                "SELECT * FROM wz_documents WHERE source_type=%s AND source_id=%s "
                "ORDER BY created_at LIMIT 1",
                (source_type, source_id),
            )
        if should_reuse(existing, source_id):
            if existing["status"] == "wstepny":
                cx_execute_returning(
                    conn,
                    """UPDATE wz_documents SET buyer_name=%s, buyer_address=%s,
                       buyer_nip=%s, valued=%s, lines=%s, total_value=%s, place=%s,
                       issued_date=%s, release_date=%s, notes=%s WHERE id=%s RETURNING id""",
                    (buyer.get("name"), buyer.get("address"), buyer.get("nip"),
                     valued, json.dumps(lines), total, place_val, issued, released,
                     notes, existing["id"]),
                )
            logger.info("wz.reused", extra={"wz_id": existing["id"], "number": existing["number"]})
            return get_wz(existing["id"])

        wid = _insert_wz(
            conn, source_type=source_type, source_id=source_id, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes)
    return get_wz(wid)


def create_manual_wz(
    buyer: Dict[str, Any],
    selections: List[Dict[str, Any]],
    valued: bool = True,
    place: Optional[str] = None,
    issued_date: Optional[str] = None,
    release_date: Optional[str] = None,
    notes: str = "",
    currency: str = "PLN",
    eur_rate: Optional[float] = None,
) -> Dict[str, Any]:
    """Ręczny WZ ze sprzedaży z magazynu. Atomowo: dokument WZ + rozchód
    (FG: szt, surowiec: kg). Brak stanu → 400 + rollback całości.

    currency: 'PLN' lub 'EUR'; przy EUR eur_rate = kurs średni NBP użyty
    do wyceny (zapisywany na dokumencie dla rozliczeń)."""
    if not selections:
        raise HTTPException(400, "WZ wymaga co najmniej jednej pozycji")

    lines, total = build_manual_wz_lines(selections, valued)
    # Tabela HDI na dokumencie (tylko surowiec): daty uboju/ważności partii
    # stemplowane na liniach W CHWILI wystawienia — dokument to snapshot.
    nos = sorted({str(l.get("batch_no") or "") for l in lines
                  if l.get("batch_no") and l.get("stock_type") in ("raw", "meat", "byproduct")})
    if nos:
        dates = {r["internal_batch_no"]: r for r in query_all(
            "SELECT internal_batch_no, slaughter_date, expiry_date FROM raw_batches "
            "WHERE internal_batch_no = ANY(%s)", (nos,))}
        for l in lines:
            d = dates.get(str(l.get("batch_no") or ""))
            if d and l.get("stock_type") in ("raw", "meat", "byproduct"):
                l["slaughter_date"] = str(d.get("slaughter_date") or "")[:10] or None
                l["expiry_date"] = str(d.get("expiry_date") or "")[:10] or None
    co = get_company()
    today = date.today()
    issued = issued_date or today.isoformat()
    released = release_date or issued
    place_val = place or co.get("city") or ""
    seller = _seller_block()

    with transaction() as conn:
        wid = _insert_wz(
            conn, source_type="manual", source_id=None, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes,
            currency=currency, eur_rate=eur_rate)

        for sel in selections:
            stype = sel.get("stock_type")
            sid = sel.get("stock_id")
            qty = float(sel.get("qty") or 0)
            if qty <= 0:
                raise HTTPException(400, "Ilość pozycji musi być > 0")

            if stype == "fg":
                row = cx_query_one(
                    conn,
                    "SELECT id, batch_no, qty_available, kg_per_unit FROM finished_goods WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                need = int(qty)
                avail = int(row.get("qty_available") or 0)
                if avail < need:
                    raise HTTPException(
                        400, f"Za mało wyrobu (partia {row.get('batch_no')}): jest {avail} szt, potrzeba {need}")
                cx_execute(
                    conn,
                    "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                    (need, need, sid))
                create_stock_movement(
                    conn, product_type="finished_goods", batch_id=sid,
                    qty=need * float(row.get("kg_per_unit") or 0),
                    movement_type="OUT", source_type="wz", source_id=wid)

            elif stype == "raw":
                row = cx_query_one(
                    conn,
                    "SELECT id, internal_batch_no, kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                avail = float(row.get("kg_available") or 0)
                if avail + 1e-6 < qty:
                    raise HTTPException(
                        400, f"Za mało surowca (partia {row.get('internal_batch_no')}): jest {avail} kg, potrzeba {qty}")
                cx_execute(
                    conn,
                    "UPDATE raw_batches SET kg_available=GREATEST(0, kg_available-%s) WHERE id=%s",
                    (qty, sid))
                create_stock_movement(
                    conn, product_type="raw", batch_id=sid, qty=qty,
                    movement_type="OUT", source_type="wz", source_id=wid)
            elif stype == "meat":
                row = cx_query_one(
                    conn,
                    "SELECT id, lot_no, kg_available FROM meat_stock WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                avail = float(row.get("kg_available") or 0)
                if avail + 1e-6 < qty:
                    raise HTTPException(
                        400, f"Za mało mięsa (partia {row.get('lot_no')}): jest {avail} kg, potrzeba {qty}")
                # Ruch PRZED zdjęciem stanu — walidacja OUT w create_stock_movement
                # czyta kg_available z bazy; po dekremencie widziałaby stan już
                # pomniejszony i odrzucała wydania > połowy lotu ("przekracza 0.0").
                create_stock_movement(
                    conn, product_type="meat", batch_id=sid, qty=qty,
                    movement_type="OUT", source_type="wz", source_id=wid)
                cx_execute(
                    conn,
                    "UPDATE meat_stock SET kg_available=GREATEST(0, kg_available-%s) WHERE id=%s",
                    (qty, sid))

            elif stype == "byproduct":
                row = cx_query_one(
                    conn,
                    "SELECT id, raw_batch_no, kind, kg, containers_available "
                    "FROM byproduct_lots WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                avail = float(row.get("kg") or 0)
                what = "grzbietów" if row.get("kind") == "backs" else "kości"
                if avail + 1e-6 < qty:
                    raise HTTPException(
                        400, f"Za mało {what} (partia {row.get('raw_batch_no')}): jest {avail} kg, potrzeba {qty}")
                # Lot wydany w całości → status 'shipped' (nie trafi do utylizacji).
                cx_execute(
                    conn,
                    "UPDATE byproduct_lots SET kg=GREATEST(0, kg-%s), "
                    "status=CASE WHEN kg-%s <= 0.001 THEN 'shipped' ELSE status END "
                    "WHERE id=%s",
                    (qty, qty, sid))
                # Pojemniki fizycznie zabrane przez kierowcę — licznik na
                # magazynie schodzi RAZEM z kg (kierowca bierze 1 pojemnik
                # z partii 408 → 59 → 58), nie tylko kosmetycznie na WZ.
                try:
                    cont_taken = int(sel.get("containers") or 0)
                except (TypeError, ValueError):
                    cont_taken = 0
                if cont_taken > 0 and row.get("containers_available") is not None:
                    cx_execute(
                        conn,
                        "UPDATE byproduct_lots SET containers_available=GREATEST(0, containers_available-%s) "
                        "WHERE id=%s",
                        (cont_taken, sid))
                create_stock_movement(
                    conn, product_type="byproduct", batch_id=sid, qty=qty,
                    movement_type="OUT", source_type="wz", source_id=wid)

            else:
                raise HTTPException(400, f"Nieznany typ magazynu: {stype}")

    logger.info("wz.manual.created", extra={"wz_id": wid, "items": len(selections)})
    return get_wz(wid)


def apply_wz_prices(lines: List[Dict[str, Any]], prices: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    """Nałóż ceny [{index, price}] na kopię pozycji; przelicz wartość i sumę.
    Pozycje z total_kg wyceniane za kg (value=total_kg*price), pozostałe
    za jednostkę (value=qty*price). Indeksy spoza zakresu pomijane.
    Nie mutuje wejścia."""
    out = [dict(l) for l in (lines or [])]
    for p in prices or []:
        try:
            i = int(p.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(out):
            price = round(float(p.get("price") or 0), 2)
            total_kg = float(out[i].get("total_kg") or 0)
            base = total_kg if total_kg > 0 else float(out[i].get("qty") or 0)
            out[i]["price"] = price
            out[i]["value"] = round(base * price, 2)
    total = round(sum(float(l.get("value") or 0) for l in out), 2)
    return out, total


def update_wz_prices(wz_id: str, prices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Uzupełnij ceny na WZ wstępnym: nadpisuje wskazane pozycje, valued=True,
    przelicza total_value. WZ potwierdzony → 409."""
    if not prices:
        raise HTTPException(400, "Brak cen do uzupełnienia")
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id, status, lines FROM wz_documents WHERE id=%s FOR UPDATE", (wz_id,))
        if not row:
            raise HTTPException(404, "Dokument WZ nie istnieje")
        if row.get("status") != "wstepny":
            raise HTTPException(409, "Ceny można uzupełnić tylko na WZ wstępnym")
        lines = row.get("lines")
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")
        new_lines, total = apply_wz_prices(lines, prices)
        cx_execute(conn,
                   "UPDATE wz_documents SET lines=%s, total_value=%s, valued=TRUE WHERE id=%s",
                   (json.dumps(new_lines), total, wz_id))
    logger.info("wz.prices_updated", extra={"wz_id": wz_id, "total": total})
    return get_wz(wz_id)


def update_wz_lines(wz_id: str, edits: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Edycja pozycji ręcznego WZ: cena/pojemniki swobodnie, ILOŚĆ z korektą
    stanów magazynowych (różnica wraca/schodzi ze stanu + korekta ruchu OUT).

    UWAGA (świadoma decyzja produktowa): edycja ilości po wystawieniu może
    zaburzyć spójność z wydrukowanymi dokumentami/HDI — frontend ostrzega,
    ale nie blokuje. Tylko WZ ręczne (source_type='manual'); WZ z zamówień
    edytowałyby łańcuch zamówienie→produkcja→załadunek."""
    if not edits:
        raise HTTPException(400, "Brak zmian do zapisania")
    with transaction() as conn:
        row = cx_query_one(
            conn, "SELECT id, status, source_type, valued, lines FROM wz_documents WHERE id=%s FOR UPDATE",
            (wz_id,))
        if not row:
            raise HTTPException(404, "Dokument WZ nie istnieje")
        if (row.get("source_type") or "") != "manual":
            raise HTTPException(409, "Edytować można tylko ręczne WZ (sprzedaż z magazynu)")
        lines = row.get("lines")
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")
        valued = bool(row.get("valued"))

        for e in edits:
            try:
                i = int(e.get("index"))
            except (TypeError, ValueError):
                continue
            if not (0 <= i < len(lines)):
                continue
            line = lines[i]
            stype, sid = line.get("stock_type"), line.get("stock_id")

            # ── Cena ──
            if e.get("price") is not None:
                line["price"] = round(float(e["price"]), 2)
                valued = True

            # ── Pojemniki (dla grzbietów/kości: żywy licznik na magazynie,
            # nie tylko wartość kosmetyczna na dokumencie) ──
            if "containers" in e:
                try:
                    cont = int(e.get("containers") or 0)
                except (TypeError, ValueError):
                    cont = 0
                old_cont = int(line.get("containers") or 0)
                cont_diff = cont - old_cont  # dodatnie = bierzemy WIĘCEJ pojemników
                if stype == "byproduct" and sid and cont_diff != 0:
                    cx_execute(
                        conn,
                        "UPDATE byproduct_lots SET containers_available=GREATEST(0, containers_available-%s) "
                        "WHERE id=%s AND containers_available IS NOT NULL",
                        (cont_diff, sid))
                if cont > 0:
                    line["containers"] = cont
                else:
                    line.pop("containers", None)

            # ── Ilość (korekta stanu magazynowego o różnicę) ──
            if e.get("qty") is not None:
                new_qty = float(e["qty"])
                if new_qty <= 0:
                    raise HTTPException(400, "Ilość pozycji musi być > 0")
                old_qty = float(line.get("qty") or 0)
                diff = new_qty - old_qty  # dodatnia = wydajemy WIĘCEJ
                if abs(diff) > 1e-9:
                    if not stype or not sid:
                        raise HTTPException(
                            400, f"Pozycja „{line.get('name')}” nie ma śladu magazynowego — ilości nie można zmienić")
                    if stype == "fg":
                        need = int(round(diff))
                        fg = cx_query_one(conn, "SELECT qty_available, kg_per_unit, batch_no FROM finished_goods WHERE id=%s FOR UPDATE", (sid,))
                        if not fg:
                            raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                        if need > 0 and int(fg.get("qty_available") or 0) < need:
                            raise HTTPException(400, f"Za mało wyrobu (partia {fg.get('batch_no')}) na zwiększenie o {need} szt")
                        cx_execute(conn,
                            "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                            (need, need, sid))
                        kgpu = float(fg.get("kg_per_unit") or 0)
                        cx_execute(conn,
                            "UPDATE stock_movements SET qty=%s WHERE source_type='wz' AND source_id=%s AND batch_id=%s",
                            (-(new_qty * kgpu), wz_id, sid))
                        line["qty"] = int(round(new_qty))
                        if kgpu > 0:
                            line["total_kg"] = round(new_qty * kgpu, 3)
                    elif stype in ("raw", "meat", "byproduct"):
                        table, col = {
                            "raw": ("raw_batches", "kg_available"),
                            "meat": ("meat_stock", "kg_available"),
                            "byproduct": ("byproduct_lots", "kg"),
                        }[stype]
                        st = cx_query_one(conn, f"SELECT {col} AS avail FROM {table} WHERE id=%s FOR UPDATE", (sid,))
                        if not st:
                            raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                        if diff > 0 and float(st.get("avail") or 0) + 1e-6 < diff:
                            raise HTTPException(
                                400, f"Za mało na stanie (partia {line.get('batch_no')}): jest {float(st.get('avail') or 0)} kg, potrzeba +{round(diff, 2)} kg")
                        cx_execute(conn, f"UPDATE {table} SET {col}=GREATEST(0, {col}-%s) WHERE id=%s", (diff, sid))
                        if stype == "byproduct":
                            # zwrot na lot > 0 → znowu otwarty; wyzerowany → shipped
                            cx_execute(conn,
                                "UPDATE byproduct_lots SET status=CASE WHEN kg <= 0.001 THEN 'shipped' ELSE 'open' END "
                                "WHERE id=%s AND status IN ('open','shipped')", (sid,))
                        cx_execute(conn,
                            "UPDATE stock_movements SET qty=%s WHERE source_type='wz' AND source_id=%s AND batch_id=%s",
                            (-new_qty, wz_id, sid))
                        line["qty"] = new_qty
                        if line.get("total_kg") is not None:
                            line["total_kg"] = round(new_qty, 3)
                    else:
                        raise HTTPException(400, f"Nieznany typ magazynu: {stype}")
                else:
                    line["qty"] = new_qty if line.get("unit") == "kg" else int(round(new_qty))

            # ── Przelicz wartość pozycji ──
            if valued and line.get("price") is not None:
                base = float(line.get("total_kg") or 0) or float(line.get("qty") or 0)
                line["value"] = round(base * float(line["price"]), 2)

        total = round(sum(float(l.get("value") or 0) for l in lines), 2) if valued else None
        cx_execute(conn,
                   "UPDATE wz_documents SET lines=%s, total_value=%s, valued=%s WHERE id=%s",
                   (json.dumps(lines), total, valued, wz_id))
    logger.info("wz.lines_updated", extra={"wz_id": wz_id, "edits": len(edits)})
    return get_wz(wz_id)


def cancel_wz(wz_id: str) -> Dict[str, Any]:
    """Anuluj WZ: zwraca WSZYSTKIE pozycje na magazyn w całości (kg/szt +
    pojemniki grzbietów/kości) i oznacza dokument jako 'anulowany' —
    dokument NIE jest usuwany, zostaje ślad w dokumentacji.

    Tylko ręczne WZ (jak w update_wz_lines) — WZ z zamówienia wiąże się
    z całym łańcuchem zamówienie→produkcja→HDI, którego cofnięcie stąd
    byłoby niebezpieczne (edytuj/anuluj przez samo zamówienie)."""
    with transaction() as conn:
        row = cx_query_one(
            conn, "SELECT id, status, source_type, lines FROM wz_documents WHERE id=%s FOR UPDATE",
            (wz_id,))
        if not row:
            raise HTTPException(404, "Dokument WZ nie istnieje")
        if (row.get("source_type") or "") != "manual":
            raise HTTPException(409, "Anulować można tylko ręczne WZ (sprzedaż z magazynu)")
        if row.get("status") == "anulowany":
            raise HTTPException(409, "WZ jest już anulowany")
        lines = row.get("lines")
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")

        for line in lines:
            stype, sid = line.get("stock_type"), line.get("stock_id")
            qty = float(line.get("qty") or 0)
            if not stype or not sid or qty <= 0:
                continue

            if stype == "fg":
                qty_i = int(round(qty))
                fg = cx_query_one(conn, "SELECT kg_per_unit FROM finished_goods WHERE id=%s FOR UPDATE", (sid,))
                if not fg:
                    continue
                cx_execute(
                    conn,
                    "UPDATE finished_goods SET qty_available=qty_available+%s, "
                    "qty_shipped=GREATEST(0, qty_shipped-%s) WHERE id=%s",
                    (qty_i, qty_i, sid))
                create_stock_movement(
                    conn, product_type="finished_goods", batch_id=sid,
                    qty=qty_i * float(fg.get("kg_per_unit") or 0),
                    movement_type="CANCEL", source_type="wz", source_id=wz_id)
            elif stype == "raw":
                cx_execute(conn, "UPDATE raw_batches SET kg_available=kg_available+%s WHERE id=%s", (qty, sid))
                create_stock_movement(
                    conn, product_type="raw", batch_id=sid, qty=qty,
                    movement_type="CANCEL", source_type="wz", source_id=wz_id)
            elif stype == "meat":
                cx_execute(conn, "UPDATE meat_stock SET kg_available=kg_available+%s WHERE id=%s", (qty, sid))
                create_stock_movement(
                    conn, product_type="meat", batch_id=sid, qty=qty,
                    movement_type="CANCEL", source_type="wz", source_id=wz_id)
            elif stype == "byproduct":
                cont = int(line.get("containers") or 0)
                cx_execute(
                    conn,
                    "UPDATE byproduct_lots SET kg=kg+%s, status='open', "
                    "containers_available=CASE WHEN containers_available IS NOT NULL "
                    "THEN containers_available+%s ELSE containers_available END "
                    "WHERE id=%s",
                    (qty, cont, sid))
                create_stock_movement(
                    conn, product_type="byproduct", batch_id=sid, qty=qty,
                    movement_type="CANCEL", source_type="wz", source_id=wz_id)

        cx_execute(conn, "UPDATE wz_documents SET status='anulowany' WHERE id=%s", (wz_id,))
    logger.info("wz.cancelled", extra={"wz_id": wz_id})
    return get_wz(wz_id)


def wz_order_incomplete(produced: int, ordered: int) -> bool:
    """Flaga „może brakować": zamówiono więcej, niż wyprodukowano."""
    return ordered > 0 and produced < ordered


def _fmt_kg(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def build_order_wz_lines(plan_lines: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Linie WZ z linii planu produkcji: pozycja per (receptura, waga, partia)
    wg batch_allocation (fallback: seasoned_batch_no, jak w HDI).
    Jak w WZ ręcznym: nazwa z wagą ("Gold2 40kg"), kg_per_unit/total_kg na
    linii (wycena ZA KG). Zwraca (linie, suma wyprodukowanych szt)."""
    agg: Dict[Tuple, int] = {}
    produced = 0
    for line in plan_lines or []:
        qty_done = int(line.get("qty_done") or 0)
        if qty_done <= 0:
            continue
        produced += qty_done
        name = (line.get("recipe_name") or line.get("product_type_name") or "Kebab").strip()
        rid = line.get("recipe_id")
        kgpu = float(line.get("kg_per_unit") or 0)
        ba = line.get("batch_allocation") or {}
        alloc = ({bno: int((info or {}).get("pieces") or 0) for bno, info in ba.items()}
                 if isinstance(ba, dict) else {})
        if alloc and sum(alloc.values()) == qty_done:
            buckets = list(alloc.items())
        else:
            sbn = line.get("seasoned_batch_no")
            if not sbn:
                lst = line.get("seasoned_batch_nos") or []
                sbn = lst[0] if lst else ""
            buckets = [(sbn or "", qty_done)]
        for bno, pieces in buckets:
            if int(pieces) <= 0:
                continue
            key = (rid, name, bno, kgpu)
            agg[key] = agg.get(key, 0) + int(pieces)
    lines: List[Dict[str, Any]] = []
    for (rid, name, bno, kgpu), qty in sorted(
        agg.items(), key=lambda kv: (kv[0][1], -kv[0][3], kv[0][2] or "")
    ):
        ln: Dict[str, Any] = {
            "name": f"{name} {_fmt_kg(kgpu)}kg" if kgpu > 0 else name,
            "qty": qty, "unit": "szt", "batch_no": bno,
            "price": None, "value": None, "stock_type": "fg", "recipe_id": rid,
        }
        if kgpu > 0:
            ln["kg_per_unit"] = round(kgpu, 3)
            ln["total_kg"] = round(qty * kgpu, 3)
        lines.append(ln)
    return lines, produced


def build_stock_wz_lines(portions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Linie WZ z porcji magazynowych (pokrycie zamówienia zapasem zrobionym
    "na magazyn"). batch_no = pełna partia WYROBU (jak w WZ ręcznym), stock_id
    wskazuje konkretny wiersz finished_goods do rozchodu."""
    lines: List[Dict[str, Any]] = []
    for p in portions or []:
        fg = p.get("fg") or {}
        take = int(p.get("take") or 0)
        if take <= 0:
            continue
        name = (fg.get("recipe_name") or fg.get("product_type_name") or "Kebab").strip()
        kgpu = float(fg.get("kg_per_unit") or 0)
        ln: Dict[str, Any] = {
            "name": f"{name} {_fmt_kg(kgpu)}kg" if kgpu > 0 else name,
            "qty": take, "unit": "szt", "batch_no": fg.get("batch_no"),
            "price": None, "value": None, "stock_type": "fg",
            "stock_id": fg.get("id"), "recipe_id": fg.get("recipe_id"),
        }
        if kgpu > 0:
            ln["kg_per_unit"] = round(kgpu, 3)
            ln["total_kg"] = round(take * kgpu, 3)
        lines.append(ln)
    return lines


def _consume_fg_for_order(conn, row: Dict[str, Any], take: int,
                          order: Dict[str, Any], wid: str) -> None:
    """Rozchód ``take`` szt z wiersza finished_goods pod zamówienie + TRWAŁA
    atrybucja (stempel client_order_no). Bez stempla postęp zamówienia
    (done_map w _hydrate_order) znikał po wyzerowaniu qty_available i kolejne
    zamówienia widziały fantomowe pokrycie z już wydanego zapasu.

    * wiersz już przypisany temu zamówieniu → zwykły rozchód,
    * cały nietknięty wiersz bez zamówienia → stempel na wierszu + rozchód,
    * częściowy rozchód → split: klon z ``take`` przypisany zamówieniu
      (qty_available=0, qty_shipped=take), oryginał pomniejszony o ``take``.

    Ruch magazynowy OUT zawsze na ORYGINALNYM wierszu (tam zaksięgowano IN).
    """
    order_no = (order.get("order_no") or "").strip()
    kgpu = float(row.get("kg_per_unit") or 0)
    row_order = (row.get("client_order_no") or "").strip()
    if order_no and row_order == order_no:
        cx_execute(
            conn,
            "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
            (take, take, row["id"]))
    elif (not row_order and take == int(row.get("qty") or 0)
          and int(row.get("qty_shipped") or 0) == 0):
        cx_execute(
            conn,
            """UPDATE finished_goods
               SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s,
                   client_order_no=%s,
                   client_name=COALESCE(NULLIF(client_name,''), %s)
               WHERE id=%s""",
            (take, take, order_no or None, order.get("client_name") or None, row["id"]))
    else:
        cx_execute(
            conn,
            """UPDATE finished_goods
               SET qty=qty-%s, qty_available=qty_available-%s,
                   total_kg=GREATEST(0, total_kg-%s)
               WHERE id=%s""",
            (take, take, round(take * kgpu, 3), row["id"]))
        cx_execute(
            conn,
            """INSERT INTO finished_goods
                 (id, batch_no, plan_no, product_type_id, product_type_name,
                  recipe_id, recipe_name, packaging_id, packaging_name,
                  client_name, client_order_no, qty, kg_per_unit, total_kg,
                  qty_available, qty_shipped, produced_date, produced_by,
                  seasoned_batch_nos, source_production_id, source_mixing_ids,
                  source_seasoned_ids, source_deboning_ids, created_at)
               SELECT %s, batch_no, plan_no, product_type_id, product_type_name,
                      recipe_id, recipe_name, packaging_id, packaging_name,
                      COALESCE(NULLIF(%s,''), client_name), %s, %s, kg_per_unit,
                      %s, 0, %s, produced_date, produced_by,
                      seasoned_batch_nos, source_production_id, source_mixing_ids,
                      source_seasoned_ids, source_deboning_ids, now()
               FROM finished_goods WHERE id=%s""",
            (cuid(), order.get("client_name") or "", order_no or None,
             take, round(take * kgpu, 3), take, row["id"]))
    create_stock_movement(
        conn, product_type="finished_goods", batch_id=row["id"],
        qty=take * kgpu, movement_type="OUT", source_type="wz", source_id=wid)


def _order_wz_payload(order_id: str) -> Dict[str, Any]:
    """Wspólne dane WZ z zamówienia: zamówienie, linie (z wagą), produkcja,
    flaga incomplete, dane odbiorcy. Używane przez podgląd i wystawienie."""
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    # Plany anulowane nie liczą się do wydania (qty_done mógł zostać
    # wpisany na tablecie przed anulowaniem).
    plan_lines = query_all(
        """SELECT pl.qty_done, pl.recipe_id, pl.recipe_name, pl.product_type_name,
                  pl.kg_per_unit, pl.batch_allocation, pl.seasoned_batch_no,
                  pl.seasoned_batch_nos
           FROM production_plan_lines pl
           JOIN production_plans pp ON pp.id = pl.plan_id
           WHERE pl.client_order_id=%s AND COALESCE(pl.qty_done,0) > 0
             AND pp.status <> 'cancelled'""",
        (order_id,))
    lines, produced = build_order_wz_lines(plan_lines)

    order_lines = query_all(
        "SELECT recipe_id, kg_per_unit, qty FROM client_order_lines WHERE order_id=%s",
        (order_id,))
    ordered_qty = sum(int(ln.get("qty") or 0) for ln in order_lines)

    # Braki względem zamówienia pokryj zapasem magazynowym (produkcja "na
    # magazyn" zrobiona przed zamówieniem nie ma linku w liniach planu).
    portions = stock_portions_for_order(
        order_id, order.get("order_no") or "", order_lines,
        produced_by_key_from_plan_lines(plan_lines))
    stock_lines = build_stock_wz_lines(portions)
    lines = lines + stock_lines
    produced += sum(int(ln.get("qty") or 0) for ln in stock_lines)

    incomplete = wz_order_incomplete(produced, ordered_qty)

    # Klient jak w HDI: najpierw client_id, potem nazwa.
    client = None
    if order.get("client_id"):
        client = query_one("SELECT name, address, city, nip FROM clients WHERE id=%s",
                           (order.get("client_id"),))
    if not client:
        client = query_one("SELECT name, address, city, nip FROM clients WHERE name=%s",
                           (order.get("client_name"),))
    client = client or {}
    buyer = {"name": client.get("name") or order.get("client_name") or "",
             "address": f"{client.get('address') or ''} {client.get('city') or ''}".strip(),
             "nip": client.get("nip") or ""}

    return {"order": order, "lines": lines, "produced": produced,
            "ordered": ordered_qty, "incomplete": incomplete, "buyer": buyer}


def preview_order_wz(order_id: str) -> Dict[str, Any]:
    """Podgląd pozycji WZ z zamówienia (do okna cen) — bez tworzenia dokumentu."""
    p = _order_wz_payload(order_id)
    existing = query_one(
        "SELECT id, number, valued FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "ORDER BY created_at LIMIT 1", (order_id,))
    return {
        "order_id": order_id,
        "order_no": p["order"].get("order_no"),
        "buyer_name": p["buyer"].get("name"),
        "buyer_nip": p["buyer"].get("nip"),
        "produced": p["produced"],
        "ordered": p["ordered"],
        "incomplete": p["incomplete"],
        "lines": p["lines"],
        "existing": ({"id": existing["id"], "number": existing["number"],
                      "valued": existing["valued"]} if existing else None),
    }


def create_wz_from_order(
    order_id: str,
    valued: bool = False,
    currency: str = "PLN",
    eur_rate: Optional[float] = None,
    prices: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """WZ z zamówienia: pozycje z qty_done linii planu, rozchód FG, flaga
    incomplete. Idempotentny per (source_type='order', source_id=order_id).

    valued + prices = [{index, price}] → wycena ZA KG (apply_wz_prices liczy
    po total_kg linii) w walucie currency (przy EUR eur_rate = kurs NBP)."""
    p = _order_wz_payload(order_id)
    order, buyer, incomplete = p["order"], p["buyer"], p["incomplete"]
    lines = p["lines"]
    if not lines:
        raise HTTPException(400, "Brak wyprodukowanych pozycji do WZ")

    total = 0.0
    if valued and prices:
        lines, total = apply_wz_prices(lines, prices)

    issued = date.today().isoformat()
    notes = "UWAGA: zamówienie zrealizowane częściowo — może brakować sztuk." if incomplete else ""

    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s "
                  "ORDER BY created_at LIMIT 1", (order_id,))
        if existing:
            doc = get_wz(existing["id"])
            doc["incomplete"] = incomplete
            logger.info("wz.order.reused", extra={"wz_id": existing["id"]})
            return doc

        wid = _insert_wz(
            conn, source_type="order", source_id=order_id, seller=_seller_block(),
            buyer=buyer, valued=valued, lines=lines, total=total,
            place=get_company().get("city") or "", issued=issued, released=issued,
            notes=notes, currency=currency, eur_rate=eur_rate)

        fg_cols = ("id, qty, qty_available, qty_shipped, kg_per_unit, "
                   "client_order_no, client_name")
        for ln in lines:
            need = int(ln["qty"])
            if need <= 0:
                continue
            # Linia magazynowa (pokrycie zapasem) wskazuje konkretny wiersz
            # finished_goods — rozchód dokładnie z niego.
            if ln.get("stock_id"):
                row = cx_query_one(
                    conn,
                    f"SELECT {fg_cols} FROM finished_goods WHERE id=%s FOR UPDATE",
                    (ln["stock_id"],))
                avail = int((row or {}).get("qty_available") or 0)
                if not row or avail < need:
                    raise HTTPException(
                        400, f"Za mało na stanie wyrobów (partia {ln.get('batch_no')}): "
                             f"jest {avail} szt, potrzeba {need}")
                _consume_fg_for_order(conn, row, need, order, wid)
                continue
            # Linia z planu nosi partię MIĘSA ("353"); finished_goods.batch_no to
            # partia WYROBU ("ddmmrr 353") — równość nigdy nie zachodzi. Dopasowanie
            # po seasoned_batch_nos (tablica partii mięsa wyrobu). Pierwszeństwo:
            # wyroby wyprodukowane pod TO zamówienie → magazynowe → pozostałe.
            line_batch = (ln.get("batch_no") or "").strip()
            sql = f"SELECT {fg_cols} FROM finished_goods WHERE COALESCE(qty_available,0) > 0"
            params: List[Any] = []
            if line_batch:
                sql += " AND %s = ANY(seasoned_batch_nos)"
                params.append(line_batch)
            if ln.get("recipe_id"):
                sql += " AND recipe_id=%s"
                params.append(ln["recipe_id"])
            if not params:
                raise HTTPException(400, "Pozycja WZ bez partii i receptury — nie można dopasować stanu")
            sql += (" ORDER BY (client_order_no=%s) DESC,"
                    " (COALESCE(client_name,'')='') DESC, qty_available DESC FOR UPDATE")
            params.append(order.get("order_no") or "")
            rows = cx_query_all(conn, sql, tuple(params))
            for row in rows:
                take = min(need, max(0, int(row.get("qty_available") or 0)))
                if take > 0:
                    _consume_fg_for_order(conn, row, take, order, wid)
                    need -= take
                if need == 0:
                    break
            if need > 0:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów dla partii {ln.get('batch_no')} (brakuje {need} szt)")

    logger.info("wz.order.created", extra={"wz_id": wid, "order_id": order_id, "wz_incomplete": incomplete})
    doc = get_wz(wid)
    doc["incomplete"] = incomplete
    return doc


def get_wz(wz_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM wz_documents WHERE id=%s", (wz_id,))
    if not row:
        raise HTTPException(404, "Dokument WZ nie istnieje")
    return row


def list_wz() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, buyer_name, total_value, valued, status, issued_date, "
        "currency, source_type, source_id, loading_status, loading_diff, "
        "vehicle_plate, loaded_at, created_at "
        "FROM wz_documents ORDER BY created_at DESC"
    )


def stock_finished_goods() -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, batch_no, recipe_name, product_type_name,
                  qty_available, kg_per_unit, client_name, client_order_no
           FROM finished_goods WHERE COALESCE(qty_available,0) > 0
           ORDER BY produced_date DESC NULLS LAST, batch_no""")


def stock_raw() -> List[Dict[str, Any]]:
    """Pozycje surowcowe do ręcznego WZ — wszystko wydawalne w kg:
    ćwiartka (raw_batches), mięso z/s (meat_stock), grzbiety/kości
    (byproduct_lots — loty otwarte). stock_type steruje rozchodem.

    containers = pojemniki ZAPAMIĘTANE z ważenia na HMI (palety kreatora
    dla ubocznych, e2_count wpisów dla mięsa; ćwiartka: kg/15). Trafiają
    jako podpowiedź do formularza WZ (operator może poprawić).
    Daty uboju/ważności partii — do tabeli HDI na dokumencie.

    Z tego samego endpointu czyta też Magazyn surowca (biuro) — stąd
    material_type_id (rozdział mięso z/s ≠ filet), supplier_name przy
    mięsie/ubocznych i kg_reserved/kg_initial przy mięsie."""
    out: List[Dict[str, Any]] = []
    for r in query_all(
        """SELECT id, internal_batch_no, supplier_name, kg_available, material_name,
                  material_type_id, slaughter_date, expiry_date, received_date
           FROM raw_batches WHERE COALESCE(kg_available,0) > 0
           ORDER BY received_date DESC NULLS LAST, internal_batch_no"""):
        kg = float(r["kg_available"] or 0)
        out.append({
            "id": r["id"], "stock_type": "raw",
            "internal_batch_no": r["internal_batch_no"],
            "supplier_name": r["supplier_name"],
            "name": r.get("material_name") or "Ćwiartka z kurczaka",
            "material_type_id": r.get("material_type_id") or "mat-cwiartka",
            "kg_available": r["kg_available"],
            "containers": int(-(-kg // 15)) if kg > 0 else None,  # 15 kg/poj.
            "slaughter_date": str(r.get("slaughter_date") or "")[:10] or None,
            "expiry_date": str(r.get("expiry_date") or "")[:10] or None,
            "production_date": str(r.get("received_date") or "")[:10] or None,
        })
    for m in query_all(
        """SELECT m.id, m.lot_no, m.raw_batch_no, m.kg_available, m.material_name,
                  m.material_type_id, m.kg_reserved, m.kg_initial,
                  m.production_date,
                  b.slaughter_date, b.expiry_date, b.supplier_name,
                  (SELECT COALESCE(SUM(de.e2_count), 0) FROM deboning_entries de
                   WHERE de.raw_batch_id = m.raw_batch_id
                     AND COALESCE(de.status,'complete')='complete') AS e2
           FROM meat_stock m
           LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
           WHERE m.status='AVAILABLE' AND COALESCE(m.kg_available,0) > 0
           ORDER BY m.created_at DESC"""):
        e2 = int(m.get("e2") or 0)
        out.append({
            "id": m["id"], "stock_type": "meat",
            "internal_batch_no": m.get("lot_no") or m.get("raw_batch_no"),
            "supplier_name": m.get("supplier_name"),
            "name": m.get("material_name") or "Mięso z/s",
            "material_type_id": m.get("material_type_id") or "mat-mieso-zs",
            "kg_available": m["kg_available"],
            "kg_reserved": m.get("kg_reserved") or 0,
            "kg_initial": m.get("kg_initial"),
            "containers": e2 or None,
            "slaughter_date": str(m.get("slaughter_date") or "")[:10] or None,
            "expiry_date": str(m.get("expiry_date") or "")[:10] or None,
            "production_date": str(m.get("production_date") or "")[:10] or None,
        })
    lots = query_all(
        """SELECT l.id, l.raw_batch_id, l.raw_batch_no, l.kind, l.kg, l.created_at,
                  l.containers_available,
                  b.slaughter_date, b.expiry_date, b.supplier_name,
                  bb.backs_pallets, bb.bones_pallets, bb.backs_at, bb.bones_at
           FROM byproduct_lots l
           LEFT JOIN raw_batches b ON b.id = l.raw_batch_id
           LEFT JOIN batch_byproducts bb ON bb.raw_batch_id = l.raw_batch_id
           WHERE l.status='open' AND COALESCE(l.kg,0) > 0 AND l.kind IN ('backs','bones')
           ORDER BY l.created_at DESC""")
    for b in lots:
        # containers_available = ŻYWY licznik (maleje przy WZ, rośnie przy
        # dodaniu kolejnych palet na wadze) — fallback na sumę z palet TYLKO
        # dla lotów sprzed tej kolumny (nie powinno się zdarzać po migracji).
        if b.get("containers_available") is not None:
            cont = int(b["containers_available"])
        else:
            pallets = b.get("backs_pallets") if b["kind"] == "backs" else b.get("bones_pallets")
            cont = pallet_containers(pallets)
        weighed_at = b.get("backs_at") if b["kind"] == "backs" else b.get("bones_at")
        prod_date = str(weighed_at or b.get("created_at") or "")[:10] or None
        out.append({
            "id": b["id"], "stock_type": "byproduct",
            "internal_batch_no": b.get("raw_batch_no"),
            "supplier_name": b.get("supplier_name"),
            # Krótka nazwa do HMI/MES; pełna (doc_name) idzie na WZ i HDI.
            "name": "Grzbiety" if b["kind"] == "backs" else "Kości",
            "doc_name": "Grzbiety z kurczaka" if b["kind"] == "backs" else "Kości z kurczaka",
            "kg_available": b["kg"],
            "containers": cont or None,
            "slaughter_date": str(b.get("slaughter_date") or "")[:10] or None,
            "expiry_date": str(b.get("expiry_date") or "")[:10] or None,
            "production_date": prod_date,
        })
    return out
