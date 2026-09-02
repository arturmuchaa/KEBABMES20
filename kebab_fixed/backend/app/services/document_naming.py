"""Nazwa pozycji na dokumentach handlowych — część wspólna WZ i HDI.

Oba dokumenty muszą pokazywać odbiorcy TO SAMO: WZ jest podstawą wydania,
HDI jedzie z towarem. Gdy nazwy albo podział pozycji się rozjadą, odbiorca
dostaje dwa papiery, których nie da się zestawić.

Tuleja niestandardowa: zakład bierze na co dzień 45-65 cm. Cokolwiek spoza
tego zakresu (METAL 80CM, METAL 75CM) to zamówienie szczególne i ma na
papierze własną pozycję z rozmiarem w nawiasie — inaczej „KIRMIZI 30kg"
scala 65 cm z 80 cm w jedną liczbę i odbiorca nie wie, co dostał.
Rozmiar mieszka w NAZWIE tulei, bo kartoteka opakowań nie ma pola liczbowego.
"""
import re
from typing import Optional

#: Zakres tulei uznawanych za standardowe (centymetry, granice włącznie).
TULEJA_STD_MIN = 45
TULEJA_STD_MAX = 65

_ROZMIAR = re.compile(r"(\d+)\s*CM", re.IGNORECASE)


def rozmiar_tulei(nazwa: Optional[str]) -> Optional[int]:
    """Rozmiar z nazwy tulei: „METAL 80CM" → 80. Brak rozmiaru → None."""
    m = _ROZMIAR.search(nazwa or "")
    return int(m.group(1)) if m else None


def tuleja_niestandardowa(nazwa: Optional[str]) -> bool:
    """Czy tuleja wymaga oznaczenia na dokumencie.

    Brak rozmiaru (folia, karton klapowy) NIE jest tuleją niestandardową —
    to w ogóle nie tuleja i nie ma czego oznaczać.
    """
    cm = rozmiar_tulei(nazwa)
    return cm is not None and not (TULEJA_STD_MIN <= cm <= TULEJA_STD_MAX)


def tuleja_suffix(nazwa: Optional[str]) -> str:
    """Dopisek do nazwy pozycji: „ (80cm)" albo pusty.

    Pusty dla tulei standardowej — dopisek „(65cm)" przy każdej pozycji
    byłby szumem u odbiorców, którzy biorą wyłącznie 65 cm.
    """
    cm = rozmiar_tulei(nazwa)
    if cm is None or TULEJA_STD_MIN <= cm <= TULEJA_STD_MAX:
        return ""
    return f" ({cm}cm)"
