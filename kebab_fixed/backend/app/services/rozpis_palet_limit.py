"""Rozpis palet nie może przekroczyć ilości pozycji zamówienia.

Incydent ISSA-DISTRIB/Z/3/10/26 (30.10.2026): edycja zamówienia zmniejszyła
pozycję 15 kg z 240 do 180, a cztery palety po 60 szt. zostały. Skaner
załadunku liczy towar z rozpisu palet, więc magazynier zobaczył 240 i tyle
zeskanował. Limit „Pozostało" istniał tylko na ekranie biura, a serwer
pilnował sumy wyłącznie pod kartonami magazynowymi
(`stock_carton_link_service.overflow_by_spec`).

Reguła jest ta sama co przy kartonach: zmiana, która ZWIĘKSZA nadmiar na
którejś pozycji, jest odrzucana. Nadmiar zastany (sprzed tej bramki) nie
zamraża zamówienia — można go zmniejszać i robić inne edycje.

Wołać w transakcji, po zablokowaniu wiersza zamówienia: `nadmiar_cx` przed
zmianą, `pilnuj_cx` po niej. Odmowa wycofuje całą transakcję.
"""
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_query_all


def _stan_cx(conn, order_id: str) -> List[Dict]:
    return cx_query_all(
        conn,
        """SELECT l.id, l.qty, l.kg_per_unit, l.recipe_name, l.packaging_name,
                  COALESCE(SUM(pi.qty), 0)::int AS na_paletach,
                  COALESCE(string_agg('P' || p.pallet_no::text, ', ' ORDER BY p.pallet_no), '') AS palety
             FROM client_order_lines l
             LEFT JOIN order_pallet_items pi ON pi.order_line_id = l.id AND pi.qty > 0
             LEFT JOIN order_pallets p ON p.id = pi.pallet_id
            WHERE l.order_id = %s
            GROUP BY l.id, l.qty, l.kg_per_unit, l.recipe_name, l.packaging_name, l.position
            ORDER BY l.position, l.id""",
        (order_id,))


def nadmiar_cx(conn, order_id: str) -> Dict[str, int]:
    """Ile sztuk ponad pozycję leży na paletach — tylko pozycje z nadmiarem."""
    out: Dict[str, int] = {}
    for r in _stan_cx(conn, order_id):
        n = int(r["na_paletach"] or 0) - int(r["qty"] or 0)
        if n > 0:
            out[r["id"]] = n
    return out


def _etykieta(r: Dict) -> str:
    kg = float(r.get("kg_per_unit") or 0)
    czlony = [f"{kg:g} kg", (r.get("recipe_name") or "").strip(), (r.get("packaging_name") or "").strip()]
    return " ".join(c for c in czlony if c)


def pilnuj_cx(conn, order_id: str, przed: Dict[str, int], powod: str) -> None:
    """Odmów, gdy zmiana zwiększyła nadmiar palet na którejkolwiek pozycji."""
    zle = []
    for r in _stan_cx(conn, order_id):
        n = int(r["na_paletach"] or 0) - int(r["qty"] or 0)
        if n > 0 and n > przed.get(r["id"], 0):
            zle.append(f"{_etykieta(r)}: na paletach {r['na_paletach']} szt. ({r['palety']}), "
                       f"w zamówieniu {r['qty']} szt")
    if zle:
        raise HTTPException(
            409,
            f"{powod} — rozpis palet przekracza ilość zamówienia. " + "; ".join(zle)
            + ". Najpierw zmniejsz albo usuń palety w rozpisie, żeby magazyn nie załadował nadmiaru.")
