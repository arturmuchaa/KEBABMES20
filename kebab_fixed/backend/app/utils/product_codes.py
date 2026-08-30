"""Kody katalogu wyrobów.

Rodzaj i receptura mają w bazie identyfikatory typu `7e3090df935f4f509658` —
czytelne dla maszyny, bezużyteczne w cenniku, na dokumencie i w wymianie
z księgowością. Kod katalogowy jest ich krótką, STAŁĄ nazwą.

Pozycja katalogu to nie sam rodzaj, tylko to, co faktycznie się sprzedaje:
**rodzaj × receptura × tuleja × gramatura**. Ta czwórka jest już kluczem
pokrycia zamówień, więc katalog nie wprowadza nowej tożsamości — tylko
nadaje jej numer.
"""
import re
import unicodedata
from typing import Optional

from app.utils.stock_codes import kod_tulei

#: Nazwy rodzajów zaczynają się od „KEBAB", które nic nie odróżnia.
_PREFIKSY_DO_POMINIECIA = ("KEBAB",)

_MAX_SKROT = 12


def skrot_nazwy(name: str, maks: int = _MAX_SKROT) -> str:
    """Skrót nazwy na kod: „KEBAB MIX 95/5" → `MIX955`.

    Bez ogonków (kod ma się dać wpisać z każdej klawiatury i wysłać do
    księgowości), bez znaków innych niż litery i cyfry, bez wiodącego
    „KEBAB". Pusty wynik oznacza, że z nazwy nic nie zostało — wtedy
    wołający sięga po licznik.
    """
    bez_ogonkow = unicodedata.normalize("NFKD", name or "")
    bez_ogonkow = "".join(c for c in bez_ogonkow if not unicodedata.combining(c))
    slowa = [w for w in re.split(r"[^A-Za-z0-9]+", bez_ogonkow.upper()) if w]
    while slowa and slowa[0] in _PREFIKSY_DO_POMINIECIA:
        slowa.pop(0)

    # Słowo, które nie mieści się W CAŁOŚCI, wchodzi samą pierwszą literą.
    # Ucinanie w połowie dawało nieczytelne kikuty („BEYAZ AFIYET" →
    # „BEYAZAFIYE") i gubiło różnicę wobec „BEYAZ HALAL".
    out = ""
    for slowo in slowa:
        if len(out) + len(slowo) <= maks:
            out += slowo
        elif len(out) + 1 <= maks:
            out += slowo[0]
        else:
            break
    return out


def skrot_tulei(packaging_code: str, packaging_name: str = "") -> str:
    """`TUL-M60` → `M60`. Kod tulei już niesie materiał i rozmiar.

    Gdy pozycja nie ma jeszcze kodu, liczymy go z NAZWY tą samą regułą co
    magazyn opakowań. Skracanie nazwy na sztywno („KARTON 60CM" → `KARTON`)
    sklejało 60 z 65 w jeden człon i dwa różne wyroby dostawały ten sam kod.
    """
    kod = (packaging_code or "").upper()
    if kod.startswith("TUL-"):
        return kod[4:]
    if kod:
        return kod

    z_nazwy = kod_tulei(packaging_name or "")
    if z_nazwy:
        return z_nazwy[4:]
    return skrot_nazwy(packaging_name, 6)


def formatuj_kg(kg: float) -> str:
    """Gramatura w kodzie: 20.000 → `20`, 12.500 → `12_5`.

    Ułamek dostaje podkreślnik, a nie sklejenie („125"), bo `125` znaczyłoby
    także 125 kg. Dziś wszystkie tuleje są całkowite (7…80 kg), ale kod ma
    przeżyć pierwszą gramaturę z przecinkiem.
    """
    if kg is None:
        return "0"
    if float(kg).is_integer():
        return str(int(kg))
    return f"{kg:.3f}".rstrip("0").rstrip(".").replace(".", "_")


def kod_katalogowy(rodzaj: str, receptura: str, tuleja: str, kg: float) -> str:
    """Składa kod pozycji katalogu: `UDO100-KIRMIZI-M60-20`.

    Puste człony pomijamy zamiast zostawiać dziurę („--"), żeby kod dało się
    przeczytać także dla pozycji, która nie ma jeszcze receptury.
    """
    czlony = [c for c in (rodzaj, receptura, tuleja, formatuj_kg(kg)) if c]
    return "-".join(czlony)


def normalizuj_kod(code: str) -> str:
    """Kod bez spacji, wielkimi literami — „udo-kir" i „UDO-KIR" to jedno."""
    return re.sub(r"\s+", "", (code or "")).upper()


def kolejny_wolny(kod: str, zajete: set, maks_prob: int = 99) -> Optional[str]:
    """Pierwszy wolny wariant kodu: `MIX`, `MIX-2`, `MIX-3`…

    Dwa rodzaje potrafią dać ten sam skrót („KEBAB MIX 70/30" i „MIX 70/30"
    obie dają `MIX7030`), a kod ma być jednoznaczny.
    """
    if kod and kod not in zajete:
        return kod
    for i in range(2, maks_prob + 1):
        kandydat = f"{kod}-{i}"
        if kandydat not in zajete:
            return kandydat
    return None
