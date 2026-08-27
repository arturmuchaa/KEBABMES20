"""Tożsamość wyrobu gotowego: receptura + waga sztuki + RODZAJ + TULEJA.

Jedno miejsce, bo dopasowywanie „czy to ten sam produkt" robią dwa moduły:
pokrycie zamówienia (`orders_service`) i pokrycie zapasem pod dokumenty
(`order_stock_service`). Rozjazd między nimi kończy się WZ-ką na inny towar,
niż pokazało zamówienie.

Historia dwóch pomyłek, które dopisały kolejne wymiary do klucza:
* bez RODZAJU KIRMIZI 25 kg jako KEBAB MIX 95/5 i jako KEBAB UDO 100 % to
  jeden produkt — TRUVA dostała 30 wysłanych sztuk 95/5 na pozycję UDO;
* bez TULEI cały KIRMIZI leżący na METAL 65 pokrywał pozycje zamówione
  na 80 cm (biuro, 27.08.2026).

Wymiary opcjonalne (rodzaj, tuleja) są TOLERANCYJNE: puste z którejkolwiek
strony pasuje do wszystkiego. Inaczej wyroby sprzed dodania pola do
formularza przestałyby się liczyć z dnia na dzień.
"""
from typing import Any, Iterable, List, Tuple

Klucz = Tuple[str, float, str, str]


def klucz_wyrobu(
    recipe_id: Any,
    kg_per_unit: Any,
    product_type_id: Any = "",
    packaging_id: Any = "",
) -> Klucz:
    return (
        str(recipe_id or ""),
        round(float(kg_per_unit or 0), 3),
        str(product_type_id or ""),
        str(packaging_id or ""),
    )


def _zgodne(a: str, b: str) -> bool:
    """Wymiar opcjonalny: równy albo nieznany po którejkolwiek stronie."""
    return a == b or not a or not b


def kandydaci(polka: Iterable[Klucz], klucz: Klucz) -> List[Klucz]:
    """Z których półek wolno brać na ten wyrób — od najdokładniej pasującej.

    Receptura i waga sztuki muszą się zgadzać ZAWSZE. Rodzaj i tuleja mogą
    być nieznane (stare dane) — wtedy pasują, ale idą na koniec kolejki, żeby
    najpierw wyczerpać towar opisany dokładnie.
    """
    receptura, kg, rodzaj, tuleja = klucz
    pasujace = [
        k for k in set(polka)
        if k[0] == receptura and k[1] == kg
        and _zgodne(k[2], rodzaj) and _zgodne(k[3], tuleja)
    ]
    return sorted(
        pasujace,
        key=lambda k: (0 if k[2] == rodzaj else 1, 0 if k[3] == tuleja else 1, k[2], k[3]),
    )
