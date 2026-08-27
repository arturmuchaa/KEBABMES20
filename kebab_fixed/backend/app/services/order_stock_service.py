"""Pokrycie zamówienia zapasem magazynowym wyrobów gotowych.

Dokumenty z zamówienia (WZ/HDI/CMR) liczą produkcję z linii planu
(`production_plan_lines.client_order_id`). Produkcja "na magazyn" robiona
PRZED zamówieniem nie ma tego linku, mimo że fizycznie pokrywa zamówienie
(widok zamówień liczy ją do qty_done). Ten moduł domyka tę asymetrię:
brakującą część zamówienia uzupełnia porcjami z `finished_goods`
(dopasowanie po recepturze + wadze sztuki), żeby dokumenty dało się
wystawić także dla towaru zrobionego na magazyn.

Kolejność czerpania:
    1. wiersze już ostemplowane TYM zamówieniem (`client_order_no`) —
       liczą się pełnym qty (rozchód mógł już wyzerować qty_available),
    2. wiersze bez zamówienia — tylko qty_available, FIFO po dacie produkcji.

Wiersze powstałe z planów podpiętych pod to zamówienie są wykluczone —
te sztuki są już policzone w qty_done linii planu (anty-dublowanie).
"""
from typing import Any, Dict, List

from app.db import query_all
from app.utils.product_key import Klucz as Key
from app.utils.product_key import kandydaci, klucz_wyrobu

_key = klucz_wyrobu


def produced_by_key_from_plan_lines(plan_lines: List[Dict[str, Any]]) -> Dict[Key, int]:
    """Suma qty_done linii planu per (receptura, waga sztuki)."""
    out: Dict[Key, int] = {}
    for pl in plan_lines or []:
        k = _key(pl.get("recipe_id"), pl.get("kg_per_unit"), pl.get("product_type_id"))
        out[k] = out.get(k, 0) + int(pl.get("qty_done") or 0)
    return out


def compute_shortfalls(
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
    cartoned_by_key: Dict[Key, int] = None,
) -> Dict[Key, int]:
    """Ile sztuk per (receptura, waga) brakuje do pokrycia zamówienia po odjęciu
    produkcji zaraportowanej na planach tego zamówienia ORAZ sztuk już spakowanych
    do kartonów powiązanych z tym zamówieniem (anty-dublowanie z FIFO finished_goods)."""
    short: Dict[Key, int] = {}
    for ln in order_lines or []:
        k = _key(ln.get("recipe_id"), ln.get("kg_per_unit"), ln.get("product_type_id"))
        short[k] = short.get(k, 0) + int(ln.get("qty") or 0)
    # Odejmowanie idzie po RODZAJU: produkcja UDO 100 % nie zamyka pozycji
    # 95/5. Wpis bez rodzaju (starsze dane) pasuje do każdej — patrz
    # `kandydaci`.
    for mapa in (produced_by_key, cartoned_by_key):
        for k, zrobione in (mapa or {}).items():
            zostalo = int(zrobione or 0)
            for cel in kandydaci(short, k):
                if zostalo <= 0:
                    break
                odejmij = min(zostalo, short.get(cel, 0))
                if odejmij <= 0:
                    continue
                short[cel] -= odejmij
                zostalo -= odejmij
    return {k: v for k, v in short.items() if v > 0}


def portion_stock_rows(
    shortfalls: Dict[Key, int],
    fg_rows: List[Dict[str, Any]],
    order_no: str,
) -> List[Dict[str, Any]]:
    """Rozbij braki na porcje z wierszy finished_goods (w podanej kolejności).

    Wiersz ostemplowany tym zamówieniem wnosi swoje pełne ``qty`` (już
    rozdysponowane pod to zamówienie), pozostałe tylko ``qty_available``.
    Zwraca ``[{"fg": wiersz, "take": szt}]``.
    """
    remaining = dict(shortfalls or {})
    portions: List[Dict[str, Any]] = []
    for row in fg_rows or []:
        k = _key(row.get("recipe_id"), row.get("kg_per_unit"), row.get("product_type_id"))
        # Jeden wiersz → jedna porcja (rozchód idzie potem dokładnie z niego),
        # więc bierzemy pierwszy pasujący brak, nie rozbijamy po kilku.
        cel = next((c for c in kandydaci(remaining, k) if int(remaining.get(c) or 0) > 0), None)
        if cel is None:
            continue
        need = int(remaining.get(cel) or 0)
        if order_no and (row.get("client_order_no") or "").strip() == order_no:
            pool = int(row.get("qty") or 0)
        else:
            pool = int(row.get("qty_available") or 0)
        take = min(need, pool)
        if take <= 0:
            continue
        portions.append({"fg": row, "take": take})
        remaining[cel] = need - take
    return portions


def stock_portions_for_order(
    order_id: str,
    order_no: str,
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
) -> List[Dict[str, Any]]:
    """Porcje magazynowe pokrywające braki zamówienia (patrz moduł)."""
    # Sztuki spakowane do kartonów powiązanych z tym zamówieniem już je pokrywają —
    # wyklucz je z FIFO finished_goods, żeby nie liczyć ich drugi raz.
    cartoned_rows = query_all(
        """
        SELECT fu.recipe_id, fu.weight_kg, fu.product_type_id, COUNT(*) AS qty
        FROM finished_units fu
        JOIN stock_cartons sc ON sc.id = fu.carton_id
        WHERE sc.linked_order_id = %s AND fu.status IN ('packed', 'shipped')
        GROUP BY fu.recipe_id, fu.weight_kg, fu.product_type_id
        """,
        (order_id,),
    )
    cartoned_by_key = {
        _key(r["recipe_id"], r["weight_kg"], r.get("product_type_id")): int(r["qty"])
        for r in cartoned_rows
    }
    shortfalls = compute_shortfalls(order_lines, produced_by_key, cartoned_by_key)
    if not shortfalls:
        return []
    # Kolejność: stempel tego zamówienia → zapas własny albo niczyj → dopiero
    # na końcu towar podpisany INNYM klientem. Samo FEFO wystawiało dokument
    # z najstarszego wiersza na magazynie, choć leżał tam pod czyjąś nazwą.
    fg_rows = query_all(
        """
        SELECT id, batch_no, recipe_id, recipe_name, product_type_id, product_type_name,
               kg_per_unit, qty, qty_available, qty_shipped,
               client_order_no, client_name, produced_date, created_at
        FROM finished_goods fg
        WHERE COALESCE(fg.qty, 0) > 0
          AND (fg.client_order_no = %s OR COALESCE(fg.client_order_no, '') = '')
          AND COALESCE(fg.source_production_id, '') NOT IN (
              SELECT DISTINCT pl.plan_id FROM production_plan_lines pl
              WHERE pl.client_order_id = %s)
        ORDER BY (fg.client_order_no = %s) DESC,
                 (COALESCE(NULLIF(fg.client_id, ''), (
                      SELECT c.id FROM clients c
                      WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                      ORDER BY (c.name = fg.client_name) DESC
                      LIMIT 1
                  ), '') IN ('', COALESCE((
                      SELECT o.client_id FROM client_orders o WHERE o.id = %s), ''))) DESC,
                 produced_date ASC NULLS LAST, created_at ASC
        """,
        (order_no, order_id, order_no, order_id),
    )
    return portion_stock_rows(shortfalls, fg_rows, order_no)
