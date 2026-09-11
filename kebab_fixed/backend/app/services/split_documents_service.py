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
from app.services import cmr_service, hdi_service
from app.services.document_naming import tuleja_suffix
from app.services.hdi_service import hdi_product_base
from app.services.loading_service import _order_buyer
from app.services.order_stock_service import picks_for_order
from app.services.settings_service import get_company
from app.services.wz_service import (_fmt_kg, _insert_wz, _rebook_wz_containers,
                                     _seller_block, build_goods_wz_lines,
                                     build_wz_lines, naming_context,
                                     wyprowadz_wz_poza_serie_cx)
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

#: Odmowa anulowania kompletu, który jest już zamknięty załadunkiem.
_KOMUNIKAT_PO_ZALADUNKU = (
    "Dokument {numer} jest już zamknięty załadunkiem — towar pojechał. Anulowanie "
    "oddałoby na stan magazynu kilogramy, których w chłodni nie ma, i to bez żadnego "
    "śladu, że chodzi o towar z naczepy. Jeżeli wysyłka naprawdę nie doszła do skutku, "
    "zrób korektę stanu wyrobu gotowego (przyjęcie zwrotu) — papier zostaje, a magazyn "
    "opisuje to, co faktycznie leży.")


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
                # `product_type_id` i `packaging_name` są tu OBOWIĄZKOWE, choć
                # rozchód ich nie potrzebuje: `build_goods_wz_lines` bierze
                # z nich nazwę rodzaju Z KARTOTEKI ODBIORCY (`doc_names`)
                # i dopisek tulei. Bez nich WM nazywał ten sam wyrób inaczej
                # niż WZ dla klienta (`_pozycje_niefakturowane` czyta oba
                # pola) — jedna wysyłka, dwa papiery, dwie nazwy, a biuro je
                # zestawia (review końcowy, minor 1, 2026-09-11).
                """SELECT id, batch_no, recipe_id, recipe_name, product_type_id,
                          product_type_name, packaging_name, qty_available, kg_per_unit
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
    # KOLEJNOŚĆ JEST OBOWIĄZKOWA: najpierw WM (całość, rozchód), potem ten
    # dokument. Zamówienie mające SAM WZ klienta przechodzi obie bramki
    # `finalize_loading` (nie ma dokumentu `calosc`, nie ma zwykłego WZ) i wpada
    # w gałąź „wystaw nowy" — załadunek zrobiłby TRZECI dokument i zdjął stan
    # drugi raz, a `_odmow_jesli_koliduje` zablokowałaby już wystawienie WM
    # (re-review Task 4, fix round 4, 2026-09-10).
    if not _istniejacy("WM", order_id, _SCOPE_CALOSC):
        raise HTTPException(
            400,
            "Najpierw wystaw WZ wewnętrzny na całość (seria WM) — to on zdejmuje "
            "towar ze stanu. WZ dla klienta jest tylko dokumentem na część "
            "niefakturowaną i sam magazynu nie rusza.")

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


def anuluj_dokumenty_podzialu(order_id: str) -> Dict[str, Any]:
    """Wycofaj komplet dokumentów podziału z jednego zamówienia.

    Bez tej funkcji guard `_odmow_gdy_zamowienie_ma_podzial` (wz_service)
    zamienia jedno omyłkowe kliknięcie „Wystaw komplet dokumentów" w TRWAŁĄ
    blokadę: zwykłego WZ już nie wystawisz, a `cancel_wz` odrzuca wszystko
    z `source_type != 'manual'` (409) — czyli oba dokumenty podziału.
    Biuro musiałoby ruszać bazę ręcznie, co w tym systemie zdarzyło się raz
    (ANUL WZ/68/08/26) i nie ma się powtarzać.

    DLACZEGO NIE POLUZOWANIE `cancel_wz`: linie `build_order_wz_lines` mają
    `stock_type='fg'`, ale NIE MAJĄ `stock_id`, więc pętla zwrotu w
    `cancel_wz` je pomija — dokument dostałby status „anulowany" BEZ ZWROTU
    TOWARU, a `finalize_loading` (który od fix round 3 pomija anulowane)
    wystawiłby wtedy nowy dokument i zdjął stan drugi raz. Anulujemy więc
    SELEKTYWNIE, po `split_scope`, i tylko dla dokumentów, o których wiemy,
    jak wyglądają ich linie:

    * WM (`calosc`) — linie z `build_goods_wz_lines` MAJĄ `stock_id`, więc
      towar realnie wraca na stan (ruch `CANCEL`, symetrycznie do rozchodu).
    * WZ klienta (`wz_klienta`) — linie z `build_wz_lines` nie mają śladu
      magazynowego, bo ten dokument nigdy stanu nie ruszał. Nie ma czego
      zwracać i słusznie nic nie zwracamy.

    Numer wraca do puli swojej serii (`wyprowadz_wz_poza_serie_cx` czyta
    `doc_series` z tego samego wiersza), więc anulowanie nie zostawia dziury
    ani w serii WZ, ani w WM.

    PO ZAŁADUNKU ANULOWAĆ NIE WOLNO. Ta funkcja pisze ruchy `CANCEL`
    i podnosi `qty_available`, a po `finalize_loading` towar leży już na
    naczepie — zwrot opisywałby magazyn, którego nie ma. Do tej gałęzi taka
    droga w ogóle nie istniała (`cancel_wz` odrzuca wszystko z
    `source_type != 'manual'`), więc to ekspozycja przez nią WNIESIONA
    (review końcowy, I2, 2026-09-11). Sprawdzenie siedzi WEWNĄTRZ
    transakcji, na zablokowanym wierszu WM: załadunek zamykany równolegle
    zdąży inaczej wejść między odczyt a zwroty.
    """
    dokumenty = query_all(
        "SELECT id, number, doc_series, split_scope FROM wz_documents "
        "WHERE source_type='order' AND source_id=%s AND split_scope IS NOT NULL "
        "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at",
        (order_id,))
    if not dokumenty:
        raise HTTPException(404, "To zamówienie nie ma dokumentów z podziału do anulowania")

    anulowane: List[Dict[str, Any]] = []
    zwrocone_szt = 0
    with transaction() as conn:
        # `loaded_at`/`loading_status` stawia `finalize_loading` na dokumencie
        # `calosc` — oba osobno, bo starszy dokument mógł dostać sam status.
        wm = cx_query_one(
            conn,
            "SELECT number, loaded_at, loading_status FROM wz_documents "
            "WHERE source_type='order' AND source_id=%s AND split_scope=%s "
            "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at LIMIT 1 FOR UPDATE",
            (order_id, _SCOPE_CALOSC))
        if wm and (wm.get("loaded_at") or wm.get("loading_status")):
            raise HTTPException(400, _KOMUNIKAT_PO_ZALADUNKU.format(numer=wm["number"]))

        for d in dokumenty:
            row = cx_query_one(
                conn,
                "SELECT id, status, lines FROM wz_documents WHERE id=%s FOR UPDATE",
                (d["id"],))
            if not row or row.get("status") == "anulowany":
                continue
            for line in _linie_z_dokumentu(row):
                if line.get("stock_type") != "fg":
                    continue
                sid = line.get("stock_id")
                qty = int(round(float(line.get("qty") or 0)))
                if not sid or qty <= 0:
                    continue
                fg = cx_query_one(
                    conn, "SELECT kg_per_unit FROM finished_goods WHERE id=%s FOR UPDATE",
                    (sid,))
                if not fg:
                    continue
                cx_execute(
                    conn,
                    "UPDATE finished_goods SET qty_available=qty_available+%s, "
                    "qty_shipped=GREATEST(0, qty_shipped-%s) WHERE id=%s",
                    (qty, qty, sid))
                create_stock_movement(
                    conn, product_type="finished_goods", batch_id=sid,
                    qty=qty * float(fg.get("kg_per_unit") or 0),
                    movement_type="CANCEL", source_type="wz", source_id=d["id"])
                zwrocone_szt += qty
            cx_execute(
                conn, "UPDATE wz_documents SET status='anulowany' WHERE id=%s", (d["id"],))
            wyprowadz_wz_poza_serie_cx(conn, d["id"])
            _rebook_wz_containers(conn, d["id"], zero=True)
            anulowane.append({"id": d["id"], "number": d["number"],
                              "scope": d.get("split_scope")})

    logger.info("podzial.anulowany",
                extra={"order_id": order_id, "ile_dokumentow": len(anulowane),
                       "zwrocone_szt": zwrocone_szt})
    return {"order_id": order_id, "documents": anulowane, "returned_qty": zwrocone_szt}


def _sprawdz_gotowosc_do_kompletu(order_id: str) -> None:
    """Walidacja WSTĘPNA — przed jakimkolwiek zapisem.

    `wystaw_wz_wewnetrzny` nie zna pojęcia podziału: wystawia WM na CAŁOŚĆ
    i `qty_invoice` w ogóle nie czyta. Bez tej bramki komplet najpierw
    ZDEJMOWAŁ STAN MAGAZYNU, a dopiero potem odmawiał — biuro widziało błąd
    i słusznie zakładało, że nic się nie stało, podczas gdy towar już zszedł.
    Pogorszenie: zostawiony WM ma `split_scope='calosc'`, więc
    `wz_service._odmow_gdy_zamowienie_ma_podzial` blokował od tej chwili
    zwykłe „Wystaw WZ" na zamówieniu, które podziału nigdy nie miało.

    Trzy wejścia, każde realne (review Task 7, runda 1):

    * zamówienie BEZ podziału — `wystaw_wz_klienta` odmawiał dopiero po WM;
    * podział na 0 kg — komplet leciał aż na „Brak towaru do umieszczenia
      na CMR", czyli PO spaleniu numeru HDI;
    * cały towar na fakturę (`zapisz_podzial` na to pozwala) — „Cały towar
      poszedł na fakturę", znowu po WM.

    Odmowa musi być BEZKOSZTOWNA: żadnego dokumentu, żadnego ruchu.
    """
    linie = query_all(
        "SELECT qty, qty_invoice FROM client_order_lines WHERE order_id=%s", (order_id,))
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    if any(l.get("qty_invoice") is None for l in linie):
        raise HTTPException(
            400, "Zamówienie nie ma podziału na fakturę i WZ — najpierw zapisz podział.")
    na_fakture = sum(int(l.get("qty_invoice") or 0) for l in linie)
    na_wz = sum(int(l.get("qty") or 0) - int(l.get("qty_invoice") or 0) for l in linie)
    if na_fakture <= 0:
        raise HTTPException(
            400, "Podział nie przewiduje ani jednej sztuki na fakturę — popraw podział "
                 "albo wystaw zwykłe WZ na całość.")
    if na_wz <= 0:
        raise HTTPException(
            400, "Cały towar poszedł na fakturę — nie ma nic do WZ dla klienta. Popraw "
                 "podział albo wystaw zwykłe WZ na całość.")


def _kg_zamowienia(order_id: str) -> float:
    """Kilogramy CAŁEGO zamówienia — suma `qty * kg_per_unit` z pozycji.

    Ta sama definicja, co `kg_calosc` w `order_split_service` i co liczy okno
    podziału. Zdenormalizowane `client_orders.total_kg` byłoby drugim
    źródłem tej samej liczby, a dwa źródła jednej liczby prędzej czy później
    mówią co innego."""
    row = query_one(
        "SELECT COALESCE(SUM(qty * kg_per_unit), 0) AS kg FROM client_order_lines "
        "WHERE order_id=%s", (order_id,))
    return round(float((row or {}).get("kg") or 0), 3)


def _pokrycie_wysylki(order_id: str, kg_wm: float) -> Dict[str, Any]:
    """Czy papier opisuje dokładnie tyle, ile wyjechało z zakładu.

    WM powstaje z FAKTYCZNEGO pokrycia w magazynie (`picks_for_order` →
    `portion_stock_rows`, gdzie `take = min(need, pool)` przy niedoborze po
    cichu oddaje mniej), a WZ dla klienta i CMR do faktury liczą się
    z ZAMÓWIENIA (`qty - qty_invoice`, `qty_invoice`). Na krótkiej dostawie
    daje to kg(WZ) + kg(CMR fv) > kg(WM) — papieru na więcej, niż wyjechało,
    i dotąd nic tego nie pokazywało (review końcowy, I3).

    OSTRZEŻENIE, NIE ODMOWA (decyzja właściciela procesu): zakład wysyła to,
    co wyprodukował, a zablokowanie krótkiej dostawy byłoby gorsze niż
    poinformowanie o niej. To ostatni moment, w którym ktokolwiek może to
    powiedzieć, zanim auto odjedzie — dalej zostaje już tylko korekta
    faktury.

    Tolerancja 0,001 kg: kilogramy chodzą w gramach (round(..., 3)), więc
    równość bez tolerancji potrafiłaby zapalić alarm na zaokrągleniu
    ostatniej cyfry — a alarm odzywający się przy poprawnej wysyłce to
    alarm, którego biuro przestaje czytać.
    """
    kg_zam = _kg_zamowienia(order_id)
    brak = round(kg_zam - float(kg_wm or 0), 3)
    return {"pelne": brak <= 0.001,
            "kg_wydane": round(float(kg_wm or 0), 3),
            "kg_zamowienia": kg_zam,
            "kg_braku": brak if brak > 0.001 else 0.0}


def wystaw_komplet(order_id: str, forma_cmr: Dict[str, Any],
                   hdi_fv: bool = False) -> Dict[str, Any]:
    """Komplet papierów przed odjazdem auta: WM, WZ dla klienta, HDI (na
    całość zawsze, do faktury na życzenie) i dwa CMR-y.

    Każdy krok jest osobno idempotentny, więc powtórne kliknięcie oddaje TE
    SAME dokumenty zamiast wystawiać drugi komplet.

    KOLEJNOŚĆ WYNIKA Z DWÓCH ZALEŻNOŚCI, nie z upodobania:

    * WM przed WZ dla klienta — WM jako jedyny zdejmuje stan magazynu, a
      `wystaw_wz_klienta` tego pilnuje i bez niego odmawia. Zamówienie z samym
      WZ klienta przeszłoby obie bramki załadunku i stan zszedłby drugi raz.
    * HDI przed CMR — `build_cmr` wpisuje w pole „załączniki" numer HDI
      SWOJEGO wariantu. Odwrotna kolejność dawała listy przewozowe z PUSTYM
      załącznikiem, a gdy HDI odmawiał, zostawały nadane numery CMR na
      dokumentach, które nigdy nie były prawdziwe. `build_hdi` nie czyta
      `cmr_documents` w żadnym miejscu, więc odwrotnej zależności nie ma.

    Całość siedzi w serwisie, nie w trasie: w warstwie HTTP nie ma miejsca na
    walidację wstępną, a ta kolejność jest nośna dla poprawności stanu
    magazynu i treści papierów (review Task 7, runda 1, finding 2).

    W odpowiedzi wraca też `pokrycie` — jawny sygnał, gdy papier opisuje
    więcej, niż wyjechało z zakładu (patrz `_pokrycie_wysylki`). To jedyne
    miejsce, które zna OBIE liczby naraz: kilogramy WM (faktyczne pokrycie
    w magazynie) i kilogramy zamówienia, z których liczą się WZ dla klienta
    i CMR do faktury.
    """
    _sprawdz_gotowosc_do_kompletu(order_id)
    wm = wystaw_wz_wewnetrzny(order_id)
    wz = wystaw_wz_klienta(order_id)
    hdi_calosc = hdi_service.generate_hdi(order_id)
    hdi_do_faktury = hdi_service.generate_hdi(
        order_id, scope=hdi_service.ZAKRES_FV) if hdi_fv else None
    # Oba listy z JEDNEGO formularza: ten sam kierowca i to samo auto,
    # różni je wyłącznie zakres.
    cmr: List[Dict[str, Any]] = [
        cmr_service.generate_cmr(order_id, forma_cmr, scope=cmr_service.ZAKRES_CALOSC),
        cmr_service.generate_cmr(order_id, forma_cmr, scope=cmr_service.ZAKRES_FV),
    ]
    pokrycie = _pokrycie_wysylki(order_id, float(wm.get("kg") or 0))
    if not pokrycie["pelne"]:
        logger.warning("podzial.komplet.niepelne_pokrycie",
                       extra={"order_id": order_id, "kg_wydane": pokrycie["kg_wydane"],
                              "kg_zamowienia": pokrycie["kg_zamowienia"],
                              "kg_braku": pokrycie["kg_braku"]})
    logger.info("podzial.komplet.wystawiony",
                extra={"order_id": order_id, "z_hdi_fv": bool(hdi_fv)})
    return {"order_id": order_id, "wm": wm, "wz": wz, "cmr": cmr,
            "hdi_calosc": hdi_calosc, "hdi_fv": hdi_do_faktury,
            "pokrycie": pokrycie}
