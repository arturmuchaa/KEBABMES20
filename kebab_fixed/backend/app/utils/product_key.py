"""Tożsamość wyrobu gotowego: receptura + waga sztuki + RODZAJ.

Jedno miejsce, bo dopasowywanie „czy to ten sam produkt" robią dwa moduły:
pokrycie zamówienia (`orders_service`) i pokrycie zapasem pod dokumenty
(`order_stock_service`). Rozjazd między nimi kończy się WZ-ką na inny towar,
niż pokazało zamówienie.

Bez rodzaju KIRMIZI 25 kg jako KEBAB MIX 95/5 i jako KEBAB UDO 100 % to dla
systemu jeden produkt — TRUVA dostała 30 wysłanych sztuk 95/5 na pozycję UDO
(biuro, 27.08.2026).
"""
from typing import Any, Iterable, List, Tuple

Klucz = Tuple[str, float, str]


def klucz_wyrobu(recipe_id: Any, kg_per_unit: Any, product_type_id: Any = "") -> Klucz:
    return (
        str(recipe_id or ""),
        round(float(kg_per_unit or 0), 3),
        str(product_type_id or ""),
    )


def kandydaci(polka: Iterable[Klucz], klucz: Klucz) -> List[Klucz]:
    """Z których półek wolno brać na ten wyrób — od najbardziej pasującej.

    Rodzaj musi się zgadzać. Wyjątek: wpis BEZ rodzaju (dane sprzed dodania
    pola do formularza) pasuje do wszystkiego — inaczej cała historia
    przestałaby się liczyć z dnia na dzień.
    """
    receptura, kg, rodzaj = klucz
    klucze = set(polka)
    out: List[Klucz] = []
    if klucz in klucze:
        out.append(klucz)
    if rodzaj and (receptura, kg, "") in klucze:
        out.append((receptura, kg, ""))
    if not rodzaj:
        out.extend(sorted(
            k for k in klucze
            if k[0] == receptura and k[1] == kg and k[2] and k not in out
        ))
    return out
