"""Rozbijanie i formatowanie adresów pobieranych z rejestrów.

Wykaz VAT MF zwraca adres jednym napisem WIELKIMI literami
(„JANA KILIŃSKIEGO 17, 40-001 KATOWICE”), VIES — od jednej do trzech
linii w układzie zależnym od kraju. Kartoteka i dokumenty (WZ, CMR, HDI)
potrzebują osobno: ulicy z numerem, kodu pocztowego i miasta.

Zasady (spec 2026-11-27-protrima-kontrahenci):
- nazwa firmy NIE przechodzi tędy — zostaje jak w rejestrze;
- ulica bez przedrostka „ul./al./pl./os.”, tytuły („ks.”, „gen.”) zostają;
- „ładne litery” tylko gdy źródło pisze WIELKIMI; mieszane zostają bez zmian;
- czego nie rozumiemy, zostawiamy puste — surowy napis zawsze wraca w `surowy`.
"""
from __future__ import annotations

import re

# 27 państw UE + XI (Irlandia Płn. w VIES). Grecja w VIES ma prefiks EL,
# w kartotece trzymamy ISO-2 „GR” (kraj_z_vat mapuje).
KRAJE_UE = frozenset({
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
    "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI",
    "SK", "XI",
})

_PUSTY = {"ulica": "", "kod_pocztowy": "", "miasto": "", "surowy": ""}

# Słowa łączące w środku nazwy — małymi („Av de la Gare”, „Madonna dei Prati”).
_MALE = {"de", "dei", "di", "del", "della", "la", "le", "du", "des", "da", "van", "der",
         "den", "bei", "am", "an", "im", "und", "nad", "pod"}
_RZYMSKIE = re.compile(r"^(?=[IVX]+$)X{0,3}(IX|IV|V?I{0,3})$")

# Tytuły na początku nazwy ulicy — małymi z kropką: „ks. Kardynała …”.
_TYTULY = re.compile(
    r"^(KS|GEN|ŚW|BP|ABP|KARD|MJR|PŁK|DR|PROF|MARSZ|HM|PPŁK|KPT|POR|INŻ)\.\s*", re.I)
_PRZEDROSTEK = re.compile(r"^(?:(?:UL|AL|PL|OS)(?:\.\s*|\s+)|ULICA\s+)", re.I)
# Lokal tylko po numerze domu i tylko z cyfrą: „208 LOK. 5”, „12 M. 3” — nie „Staré Mesto”.
_LOKAL = re.compile(r"(\d\w*)\s+(?:LOK\.?|M\.?)\s*(\d\w*)$", re.I)
_NUMER_LITERA = re.compile(r"(\d)\s+([A-Za-z])$")

# Wzorce kodu pocztowego per kraj (VIES). Domyślnie 4–5 cyfr.
_KOD_WZORZEC = {
    "PL": r"\d{2}\s?-\s?\d{3}",
    "CZ": r"\d{3}\s?\d{2}", "SK": r"\d{3}\s?\d{2}", "SE": r"\d{3}\s?\d{2}", "GR": r"\d{3}\s?\d{2}",
    "NL": r"\d{4}\s?[A-Z]{2}",
    "PT": r"\d{4}-\d{3}",
    "AT": r"\d{4}", "BE": r"\d{4}", "SI": r"\d{4}", "DK": r"\d{4}", "HU": r"\d{4}",
    "LU": r"\d{4}", "BG": r"\d{4}", "CY": r"\d{4}", "LV": r"\d{4}",
    "DE": r"\d{5}", "ES": r"\d{5}", "FR": r"\d{5}", "IT": r"\d{5}", "FI": r"\d{5}",
    "EE": r"\d{5}", "HR": r"\d{5}", "LT": r"\d{5}", "RO": r"\d{6}",
}
_KRAJE_NAZWY = {
    "polska", "poland", "slovensko", "slovakia", "slovenská republika", "deutschland", "germany",
    "österreich", "austria", "česká republika", "česko", "czech republic", "czechia",
    "slovenija", "slovenia", "españa", "espana", "spain", "france", "belgique", "belgië",
    "belgie", "belgium", "italia", "italy", "nederland", "netherlands", "magyarország",
    "hungary", "danmark", "sverige", "portugal", "românia", "romania", "hrvatska",
}


def _spacje(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def kraj_z_vat(nip: str) -> str:
    """Kraj z prefiksu numeru VAT; same cyfry lub pusty = Polska. EL → GR."""
    s = "".join(ch for ch in (nip or "").upper() if ch.isalnum())
    if len(s) >= 2 and s[:2].isalpha():
        return "GR" if s[:2] == "EL" else s[:2]
    return "PL"


def _slowo(tok: str, i: int, ostatni: bool) -> str:
    if any(ch.isdigit() for ch in tok):
        return tok.upper()
    if _RZYMSKIE.match(tok):
        return tok
    low = tok.lower()
    if i > 0 and low in _MALE:
        return low
    if i > 0 and ostatni and len(tok) == 2 and tok.isalpha():
        return tok  # skrót prowincji: „Cuneo CN”
    out, poprzedni_litera = [], False
    for ch in low:
        out.append(ch if poprzedni_litera else ch.upper())
        poprzedni_litera = ch.isalpha()
    return "".join(out)


def ladne_litery(napis: str) -> str:
    """WIELKIE → „Zwykłe Litery” po polsku; napis z małymi literami bez zmian."""
    s = _spacje(napis)
    if not s or any(ch.islower() for ch in s):
        return s
    toks = s.split(" ")
    return " ".join(_slowo(t, i, i == len(toks) - 1) for i, t in enumerate(toks))


def normalizuj_kod(kod: str, kraj: str) -> str:
    """Kod pocztowy w formacie kraju: PL NN-NNN, CZ/SK/SE/GR NNN NN, NL NNNN AA."""
    s = _spacje(kod)
    surowy = re.sub(r"[\s-]", "", s).upper()
    k = (kraj or "").upper()
    if k == "PL" and re.fullmatch(r"\d{5}", surowy):
        return f"{surowy[:2]}-{surowy[2:]}"
    if k in ("CZ", "SK", "SE", "GR") and re.fullmatch(r"\d{5}", surowy):
        return f"{surowy[:3]} {surowy[3:]}"
    if k == "NL" and re.fullmatch(r"\d{4}[A-Z]{2}", surowy):
        return f"{surowy[:4]} {surowy[4:]}"
    if k == "PT":
        return s
    if surowy.isdigit():
        return surowy
    return s


def _ulica(napis: str, kraj: str = "PL") -> str:
    s = _spacje(napis)
    if not s:
        return ""
    if (kraj or "PL").upper() == "PL":
        s = _PRZEDROSTEK.sub("", s)
    tytul = ""
    m = _TYTULY.match(s)
    if m:
        tytul = m.group(1).lower() + ". "
        s = s[m.end():]
    s = _LOKAL.sub(r"\1/\2", s)
    s = _NUMER_LITERA.sub(r"\1\2", s)
    return tytul + ladne_litery(s)


def formatuj_ulice(napis: str, kraj: str = "PL") -> str:
    """Ulica z numerem do kartoteki: bez „ul.” (tylko PL), tytuł małymi, „LOK. 5” → „/5”."""
    return _ulica(napis, kraj)


def _miasto(napis: str) -> str:
    return ladne_litery(napis)


def rozbij_adres_pl(napis: str) -> dict:
    """„ULICA NR, KOD MIASTO” (wykaz MF) → ulica / kod / miasto.
    Bez kodu pocztowego nie zgadujemy: pola puste, `surowy` zawsze zwrócony."""
    surowy = napis or ""
    if not surowy.strip():
        return dict(_PUSTY)
    parts = [p.strip() for p in surowy.split(",") if p.strip()]
    for idx in range(len(parts) - 1, -1, -1):
        m = re.search(r"(\d{2})\s*-\s*(\d{3})\s+(.+)$", parts[idx])
        if not m:
            continue
        przed = parts[idx][:m.start()].strip()
        ulica = ", ".join(p for p in parts[:idx] + ([przed] if przed else []))
        return {
            "ulica": _ulica(ulica),
            "kod_pocztowy": f"{m.group(1)}-{m.group(2)}",
            "miasto": _miasto(m.group(3)),
            "surowy": surowy,
        }
    return {**_PUSTY, "surowy": surowy}


def rozbij_adres_vies(napis: str, kraj: str) -> dict:
    """Adres z VIES (1–3 linie, układ zależny od kraju) → ulica / kod / miasto."""
    surowy = napis or ""
    k = (kraj or "").upper()
    if k == "EL":
        k = "GR"
    tekst = surowy.replace("---", " ")
    segs = [_spacje(l) for l in re.split(r"[\r\n]+", tekst)]
    segs = [s for s in segs if s]
    if len(segs) == 1:
        segs = [s.strip() for s in segs[0].split(",") if s.strip()]
    segs = [s for s in segs if s.casefold() not in _KRAJE_NAZWY and s.upper() != k]
    if not segs:
        return {**_PUSTY, "surowy": surowy}

    wzorzec = _KOD_WZORZEC.get(k, r"\d{4,5}")
    rx = re.compile(r"(?:(?<![\w])[A-Z]{1,2}\s*-\s*|(?<![\w-]))(" + wzorzec + r")(?![\w])")
    for idx in range(len(segs) - 1, -1, -1):
        seg = segs[idx]
        trafienia = [m for m in rx.finditer(seg) if seg[m.end():].strip()]
        if not trafienia:
            continue
        m = trafienia[-1]
        miasto_surowe = seg[m.end():].strip(" ,")
        przed = seg[:m.start()].strip(" ,")
        reszta = [s for s in segs[:idx] if s.casefold() != miasto_surowe.casefold()]
        ulica = ", ".join(reszta + ([przed] if przed else []))
        return {
            "ulica": _ulica(ulica, k),
            "kod_pocztowy": normalizuj_kod(m.group(1), k),
            "miasto": _miasto(miasto_surowe),
            "surowy": surowy,
        }
    return {**_PUSTY, "ulica": _ulica(", ".join(segs), k), "surowy": surowy}
