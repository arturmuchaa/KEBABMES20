"""Komplet dokumentów wydania przy podziale wysyłki na fakturę i WZ.

Klient bierze część dostawy na fakturę (wystawianą w Subiekcie, POZA tym
systemem), resztę na WZ. Tu wystawiamy DWA dokumenty na tę samą wysyłkę:

* WZ WEWNĘTRZNY (seria WM) — na CAŁOŚĆ dostawy, zostaje w biurze. TO ON
  jest jedynym dokumentem, który zdejmuje stan magazynu — wzorzec rozchodu
  skopiowany z `loading_service.finalize_loading` (gałąź bez istniejącego
  WZ), przetestowanej ścieżki działającej na produkcji.
* WZ dla klienta (seria WZ) — na część NIEFAKTUROWANĄ (qty - qty_invoice
  z każdej pozycji zamówienia). Jedzie z towarem, ale sam towar już zeszedł
  ze stanu przez WM — ten dokument NIE ROBI ŻADNEGO ruchu magazynowego.

NAJWAŻNIEJSZA REGUŁA: dwa dokumenty na tę samą wysyłkę kuszą, żeby oba
zdejmowały stan — wtedy magazyn schodzi PODWÓJNIE i wychodzi na minus.
`test_TYLKO_wz_wewnetrzny_rusza_magazyn` pilnuje tego wprost.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.document_naming import tuleja_suffix
from app.services.hdi_service import hdi_product_base
from app.services.loading_service import _order_buyer
from app.services.order_stock_service import picks_for_order
from app.services.settings_service import get_company
from app.services.wz_service import (_fmt_kg, _insert_wz, _seller_block,
                                     build_goods_wz_lines, build_wz_lines,
                                     naming_context)
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)

#: Notatka na dokumencie wewnętrznym — nie ma jechać z towarem do klienta.
_NOTATKA_WM = "DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI"

#: Znacznik dokumentu POCHODZĄCEGO Z PODZIAŁU wysyłki (`wz_documents.split_scope`).
#: `doc_series` + `source_id` same NIE wystarczają do odróżnienia od zwykłego
#: WZ — `create_wz_from_order` (stara ścieżka) zapisuje DOKŁADNIE tę samą
#: parę (doc_series='WZ', source_type='order', source_id=order_id). Bez tego
#: `wystaw_wz_klienta` uznawał stary, niezwiązany z podziałem dokument za
#: "już wystawiony" i oddawał całe zamówienie zamiast części niefakturowanej
#: (review Task 4, fix round 1, 2026-09-10).
_SCOPE_CALOSC = "calosc"
_SCOPE_WZ_KLIENTA = "wz_klienta"


def _zamowienie(order_id: str) -> Dict[str, Any]:
    order = query_one(
        "SELECT id, order_no, client_id, client_name FROM client_orders WHERE id=%s",
        (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    return order


def _dokument_koliduje(order_id: str) -> Optional[Dict[str, Any]]:
    """Zwykły dokument wydania SPOZA podziału (`split_scope IS NULL`) —
    stan magazynu mógł już zejść INNĄ ścieżką (`create_wz_from_order`,
    `finalize_loading`). Podział nie może z takim dokumentem współistnieć:
    `picks_for_order` liczyłby braki zamówienia OD ZERA, nie wiedząc nic o
    starym rozchodzie — `wystaw_wz_wewnetrzny` zdjąłby stan DRUGI RAZ
    (review Task 4, fix round 2, 2026-09-10).

    ANULOWANY stary dokument nie koliduje — anulowanie oddało towar na
    magazyn (`cancel_wz`/edycja zamówienia), więc podział jest bezpieczny."""
    return query_one(
        "SELECT id, number FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "AND split_scope IS NULL AND COALESCE(status,'')<>'anulowany' "
        "ORDER BY created_at LIMIT 1", (order_id,))


def _odmow_jesli_koliduje(order_id: str) -> None:
    """Twardy guard na starcie OBU funkcji wystawiających: zamówienie z już
    istniejącym zwykłym dokumentem wydania nie dostaje podziału. Odmowa, nie
    ostrzeżenie z przepuszczeniem — drugi rozchód jest nieodwracalny bez
    ręcznej korekty stanów, odmowa jest w pełni odwracalna (biuro anuluje
    stary dokument i wystawia podział ponownie)."""
    kolizja = _dokument_koliduje(order_id)
    if kolizja:
        raise HTTPException(
            400,
            f"Zamówienie ma już dokument wydania {kolizja['number']} — nie można na nim "
            "wystawić podziału. Najpierw anuluj ten dokument (anulowanie zwraca towar na "
            "stan), potem wystaw podział ponownie.")


def _istniejacy(series: str, order_id: str, split_scope: str) -> Any:
    """Dokument danej serii DLA PODZIAŁU — idempotencja per (seria, źródło,
    zakres podziału). `split_scope` w WHERE jest tu obowiązkowe: zwykły WZ
    (stara ścieżka, `split_scope IS NULL`) ma tę samą parę (doc_series,
    source_id) co dokument klienta z podziału — bez tego warunku ten
    zapytanie znajdowałoby stary dokument i błędnie uznawałoby go za
    "już wystawiony" (patrz komentarz przy `_SCOPE_CALOSC` wyżej).

    ANULOWANY dokument kandydatem nie jest, tak jak przy zwykłym WZ
    (`should_reuse` w `wz_service`) — wydał numer z powrotem do puli i nic
    już nie wydaje."""
    return query_one(
        "SELECT id, number, lines FROM wz_documents WHERE doc_series=%s AND source_id=%s "
        "AND split_scope=%s AND COALESCE(status,'')<>'anulowany' ORDER BY created_at LIMIT 1",
        (series, order_id, split_scope))


def _linie_z_dokumentu(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """`lines` z `wz_documents` — psycopg2 zwykle rozpakowuje JSONB samo, ale
    niektóre ścieżki bazy oddają go jako surowy string (tak samo zabezpiecza
    się `loading_service.finalize_loading`)."""
    lines = (doc or {}).get("lines") or []
    if isinstance(lines, str):
        lines = json.loads(lines or "[]")
    return lines


def _kg_z_linii(lines: List[Dict[str, Any]]) -> float:
    total = 0.0
    for l in lines or []:
        if l.get("total_kg") is not None:
            total += float(l["total_kg"])
        else:
            total += float(l.get("qty") or 0) * float(l.get("kg_per_unit") or 0)
    return round(total, 3)


def wystaw_wz_wewnetrzny(order_id: str) -> Dict[str, Any]:
    """WZ wewnętrzny (seria WM) na CAŁOŚĆ zamówienia — jedyny dokument tej
    wysyłki, który rusza magazyn. Idempotentny: powtórne wywołanie zwraca
    już istniejący dokument bez drugiego rozchodu."""
    already = _istniejacy("WM", order_id, _SCOPE_CALOSC)
    if already:
        return {"id": already["id"], "number": already["number"],
                "kg": _kg_z_linii(_linie_z_dokumentu(already))}

    order = _zamowienie(order_id)
    _odmow_jesli_koliduje(order_id)
    picks = picks_for_order(order_id)
    groups = {p["fg"]["id"]: int(p.get("take") or 0)
             for p in picks if p.get("fg") and int(p.get("take") or 0) > 0}
    if not groups:
        raise HTTPException(400, "Zamówienie nie ma pokrycia w magazynie wyrobów gotowych")

    issued = date.today().isoformat()
    with transaction() as conn:
        # Powtórna kontrola WEWNĄTRZ transakcji — dwa równoległe wywołania
        # nie mają wyścigu o to, kto tworzy dokument.
        raced = cx_query_one(
            conn, "SELECT id, number, lines FROM wz_documents WHERE doc_series='WM' "
                  "AND source_id=%s AND split_scope=%s AND COALESCE(status,'')<>'anulowany' "
                  "ORDER BY created_at LIMIT 1", (order_id, _SCOPE_CALOSC))
        if raced:
            return {"id": raced["id"], "number": raced["number"],
                    "kg": _kg_z_linii(_linie_z_dokumentu(raced))}

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
            need = groups[gid]
            avail = int(fg.get("qty_available") or 0)
            if avail < need:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów (partia {fg.get('batch_no')}): "
                         f"jest {avail} szt, potrzeba {need}")
            goods_with_counts.append({"goods": fg, "count": need})

        lines = build_goods_wz_lines(
            goods_with_counts,
            *naming_context(str(order.get("client_id") or ""), order.get("client_name") or ""))
        wid = _insert_wz(
            conn, source_type="order", source_id=order_id, seller=_seller_block(),
            buyer=_order_buyer(conn, order), valued=False, lines=lines, total=0.0,
            place=get_company().get("city") or "", issued=issued, released=issued,
            notes=_NOTATKA_WM, series="WM", split_scope=_SCOPE_CALOSC)

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
                movement_type="OUT", source_type="wz", source_id=wid)

        number = cx_query_one(
            conn, "SELECT number FROM wz_documents WHERE id=%s", (wid,))["number"]

    kg = _kg_z_linii(lines)
    logger.info("wz.wewnetrzny.wystawiony",
               extra={"wz_id": wid, "order_id": order_id, "wz_kg": kg})
    return {"id": wid, "number": number, "kg": kg}


def _pozycje_niefakturowane(order: Dict[str, Any],
                            linie: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pozycje WZ klienta: `qty - qty_invoice` z każdej linii zamówienia.
    Nazewnictwo jak w pozostałych ścieżkach WZ (`naming_context` +
    `hdi_product_base` + `tuleja_suffix`) — inaczej ten sam wyrób nazywałby
    się różnie na dokumencie wewnętrznym i na WZ dla klienta."""
    mode, recipe_names, doc_names = naming_context(
        str(order.get("client_id") or ""), order.get("client_name") or "")
    items: List[Dict[str, Any]] = []
    for l in linie:
        qty = int(l.get("qty") or 0) - int(l.get("qty_invoice") or 0)
        if qty <= 0:
            continue
        name = hdi_product_base(
            (doc_names or {}).get(l.get("product_type_id") or "")
            or l.get("product_type_name") or "",
            (recipe_names or {}).get(l.get("recipe_id") or "")
            or l.get("recipe_name") or "", mode) or "Kebab"
        kgpu = float(l.get("kg_per_unit") or 0)
        items.append({
            "name": (f"{name} {_fmt_kg(kgpu)}kg" if kgpu > 0 else name)
                    + tuleja_suffix(l.get("packaging_name")),
            "qty": qty, "unit": "szt", "kg_per_unit": kgpu,
        })
    return items


def wystaw_wz_klienta(order_id: str) -> Dict[str, Any]:
    """WZ dla klienta (seria WZ) na część NIEFAKTUROWANĄ dostawy. Wymaga
    zapisanego podziału (`order_split_service.zapisz_podzial`) — bez niego
    nie wiadomo, ile z każdej pozycji poszło na fakturę. ŻADNEGO ruchu
    magazynowego: towar zdjął ze stanu WZ wewnętrzny."""
    already = _istniejacy("WZ", order_id, _SCOPE_WZ_KLIENTA)
    if already:
        return {"id": already["id"], "number": already["number"],
                "kg": _kg_z_linii(_linie_z_dokumentu(already))}

    order = _zamowienie(order_id)
    _odmow_jesli_koliduje(order_id)
    linie = query_all(
        "SELECT qty, qty_invoice, kg_per_unit, product_type_id, product_type_name, "
        "recipe_id, recipe_name, packaging_name, position "
        "FROM client_order_lines WHERE order_id=%s ORDER BY position", (order_id,))
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    if any(l.get("qty_invoice") is None for l in linie):
        raise HTTPException(400, "Zamówienie nie ma podziału na fakturę i WZ")

    items = _pozycje_niefakturowane(order, linie)
    if not items:
        raise HTTPException(400, "Cały towar poszedł na fakturę — nie ma nic do WZ dla klienta")

    lines, total = build_wz_lines(items, valued=False)
    issued = date.today().isoformat()
    with transaction() as conn:
        raced = cx_query_one(
            conn, "SELECT id, number, lines FROM wz_documents WHERE doc_series='WZ' "
                  "AND source_id=%s AND split_scope=%s AND COALESCE(status,'')<>'anulowany' "
                  "ORDER BY created_at LIMIT 1", (order_id, _SCOPE_WZ_KLIENTA))
        if raced:
            return {"id": raced["id"], "number": raced["number"],
                    "kg": _kg_z_linii(_linie_z_dokumentu(raced))}

        wid = _insert_wz(
            conn, source_type="order", source_id=order_id, seller=_seller_block(),
            buyer=_order_buyer(conn, order), valued=False, lines=lines, total=total,
            place=get_company().get("city") or "", issued=issued, released=issued,
            notes="Część niefakturowana — dokument dla odbiorcy.", series="WZ",
            split_scope=_SCOPE_WZ_KLIENTA)
        number = cx_query_one(
            conn, "SELECT number FROM wz_documents WHERE id=%s", (wid,))["number"]

    kg = _kg_z_linii(lines)
    logger.info("wz.klienta.wystawiony",
               extra={"wz_id": wid, "order_id": order_id, "wz_kg": kg})
    return {"id": wid, "number": number, "kg": kg}
