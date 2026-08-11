"""Odczyt HDI dostawcy z tekstu — czysta logika, bez OCR i bez I/O.

HDI przyjeżdża papierem i biuro przepisuje z niego osiem pozycji ręcznie.
Skan idzie przez tesseract (patrz `hdi_ocr_service`), a TU zamieniamy jego
wyjście na pozycje formularza przyjęcia.

Wydzielone od OCR celowo: rozpoznawanie obrazu jest niedeterministyczne
i wolne, a rozbiór tekstu musi być testowalny na prawdziwych, brudnych
wynikach (patrz `tests/fixtures/hdi_koko_33656.txt`).

ZASADA: nie opieramy się na numerze pozycji ani na nazwie towaru — OCR gubi
je najczęściej (ostatni wiersz skanu 33656 przeczytał jako „(  „WIARTKA…").
Wiersz rozpoznajemy po tym, co niesie treść i czego nie da się pomylić
z niczym innym na stronie: WAGA + NUMER PARTII + DWIE DATY.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

#: Waga: „600,00", „1 800,00", „1800.00", „9 000,00" (spacja zwykła i twarda).
_KG = r"\d[\d\s ]*[.,]\d{2}"
#: Numer partii dostawcy — u KOKO sześciocyfrowy; dopuszczamy 4-8 cyfr.
_LOT = r"\d{4,8}"
_DATE = r"\d{4}-\d{2}-\d{2}"

#: Separator kolumn. OCR wsadza między nie kreski tabeli i śmieci
#: („112823 _ 2026-08-10", „| | 435,00"), więc zwykłe `\s+` gubiło wiersze.
#: Klasa BEZ cyfr i bez końca linii: nie ma jak połknąć sąsiedniej wartości
#: ani skleić dwóch wierszy w jeden.
_SEP = r"[^\d\n]*"

#: Wiersz tabeli towaru. Kotwicą są DWIE daty pod rząd — na stronie nie ma
#: drugiego takiego układu, więc nie złapiemy numeru weterynaryjnego ani NIP-u.
_ROW_RE = re.compile(
    rf"({_KG}){_SEP}({_LOT}){_SEP}({_DATE}){_SEP}({_DATE})")

_HDI_NO_RE = re.compile(r"Nr\.?\s*:?\s*(\d{3,})\s*do\s+dokument", re.IGNORECASE)
_DOC_NO_RE = re.compile(r"do\s+dokumentu\s*:?\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
_SHIPPED_RE = re.compile(rf"Data\s+wysy[łl]ki.*?({_DATE})", re.IGNORECASE | re.DOTALL)

#: Stopka. Szukamy RDZENIA słowa, bo OCR myli wielkie I z małym l
#: („llość palet" zamiast „Ilość palet") — „palet"/„pojemnik" przeżywa zawsze.
_NIP_RE = re.compile(r"NIP\s*:?\s*([\d\s-]{10,17})", re.IGNORECASE)
_VET_RE = re.compile(r"(PL\s*\d{6,10}\s*[A-Z]{2})", re.IGNORECASE)
_CONTAINERS_RE = re.compile(r"pojemnik[óoc]?w?\s*:?\s*(\d+)", re.IGNORECASE)
_PALLETS_RE = re.compile(r"palet\s*:?\s*(\d+)", re.IGNORECASE)
_TOTAL_KG_RE = re.compile(rf"Masa\s+netto\s*:?\s*({_KG})", re.IGNORECASE)


def parse_kg(raw: str) -> float:
    """„1 800,00" → 1800.0. Spacje tysięcy (także twarde) i przecinek albo
    kropka dziesiętna — OCR zwraca raz tak, raz tak, nawet w jednym skanie."""
    s = re.sub(r"[\s ]", "", str(raw or "")).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _first(pattern: re.Pattern, text: str, group: int = 1) -> str:
    m = pattern.search(text)
    return m.group(group).strip() if m else ""


#: Formy prawne obcinane przy porównywaniu nazw (OCR i tak je kaleczy).
_LEGAL_FORMS = [
    re.compile(r"\s+SP[ÓO]ŁKA\s+Z\s+OGRANICZON[ĄA]\s+ODPOWIEDZIALNO[ŚS]CI[ĄA].*$", re.I),
    re.compile(r"\s+SP[ÓO]ŁKA\s+(AKCYJNA|JAWNA|KOMANDYTOWA).*$", re.I),
    re.compile(r"\s+SP\.?\s*Z\s*O\.?\s*O\.?.*$", re.I),
    re.compile(r"\s+S\.?A\.?$", re.I),
]
#: Krótszy rdzeń nazwy trafiłby się w dowolnym tekście przez przypadek.
MIN_NAME_CORE = 3


def nip_checksum_ok(nip: str) -> bool:
    """Czy NIP przechodzi sumę kontrolną.

    Kluczowe przy OCR: na skanie 33656 pieczątkę przecina podpis i tesseract
    czyta „5180279931" zamiast „5130279931". Suma kontrolna wyłapuje taką
    pojedynczą pomyłkę, więc nie przypiszemy dostawy do obcego kontrahenta.
    """
    digits = re.sub(r"\D", "", nip or "")
    if len(digits) != 10:
        return False
    wagi = (6, 5, 7, 2, 3, 4, 5, 6, 7)
    suma = sum(int(d) * w for d, w in zip(digits[:9], wagi))
    return suma % 11 == int(digits[9])


def core_name(name: str) -> str:
    """Rdzeń nazwy do porównań: bez formy prawnej, cudzysłowów i ogonków
    interpunkcyjnych. „KOKO SPÓŁKA Z OGRANICZONĄ…" → „KOKO"."""
    out = (name or "").strip().strip('"„”')
    for re_form in _LEGAL_FORMS:
        out = re_form.sub("", out)
    return re.sub(r"[\"„”.,]", "", out).strip().upper()


def match_supplier(text: str, parsed: Dict[str, Any],
                   suppliers: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Który kontrahent wystawił ten dokument.

    Kolejność od najpewniejszego: NIP (po sumie kontrolnej) → numer
    weterynaryjny → nazwa. Gdy po nazwie pasuje więcej niż jeden, NIE
    zgadujemy — lepiej, żeby operator wybrał sam, niż żeby dostawa cicho
    trafiła pod obcego dostawcę.
    """
    nip = re.sub(r"\D", "", parsed.get("nip") or "")
    if nip and nip_checksum_ok(nip):
        for s in suppliers:
            if re.sub(r"\D", "", s.get("nip") or "") == nip:
                return {**s, "matched_by": "NIP"}

    vet = re.sub(r"\s+", "", (parsed.get("vet_no") or "")).upper()
    if vet:
        for s in suppliers:
            if re.sub(r"\s+", "", (s.get("vet_number") or "")).upper() == vet:
                return {**s, "matched_by": "numerze weterynaryjnym"}

    haystack = (text or "").upper()
    trafienia = []
    for s in suppliers:
        for kandydat in (s.get("display_name"), s.get("name")):
            rdzen = core_name(kandydat or "")
            if len(rdzen) < MIN_NAME_CORE:
                continue
            if re.search(rf"\b{re.escape(rdzen)}\b", haystack):
                trafienia.append(s)
                break
    unikalne = {s["id"]: s for s in trafienia}
    if len(unikalne) == 1:
        return {**next(iter(unikalne.values())), "matched_by": "nazwie"}
    return None


def parse_hdi_text(text: str) -> Dict[str, Any]:
    """Tekst po OCR → pozycje i sumy kontrolne HDI.

    Zwraca zawsze komplet kluczy; brak danych to pusty string / None / [],
    nigdy wyjątek — operator ma zobaczyć, czego nie udało się odczytać,
    i dopisać to ręcznie, a nie dostać błąd zamiast formularza.
    """
    text = text or ""

    lines: List[Dict[str, Any]] = []
    for m in _ROW_RE.finditer(text):
        kg = parse_kg(m.group(1))
        if kg <= 0:
            continue
        lines.append({
            "kg": kg,
            "supplier_batch_no": m.group(2),
            "slaughter_date": m.group(3),
            "expiry_date": m.group(4),
        })

    doc_no = _first(_DOC_NO_RE, text)
    # „WZ 388/MDU/08/2026 jakieś śmieci OCR" — ucinamy do samego numeru,
    # bo trafia na kartę 1.1.1 w kolumnie dokumentu przywozowego.
    doc_no = re.sub(r"\s{2,}.*$", "", doc_no).strip()

    total = _first(_TOTAL_KG_RE, text)
    containers = _first(_CONTAINERS_RE, text)
    pallets = _first(_PALLETS_RE, text)

    return {
        "hdi_no": _first(_HDI_NO_RE, text),
        "nip": re.sub(r"\D", "", _first(_NIP_RE, text)),
        "vet_no": re.sub(r"\s+", " ", _first(_VET_RE, text)).upper(),
        "document_no": doc_no,
        "shipped_date": _first(_SHIPPED_RE, text),
        "lines": lines,
        "total_kg": parse_kg(total) if total else None,
        "containers": int(containers) if containers else None,
        "pallets": int(pallets) if pallets else None,
    }


def sum_matches_footer(parsed: Dict[str, Any], tolerance: float = 0.01) -> Optional[bool]:
    """Czy suma odczytanych pozycji zgadza się z masą netto ze stopki.

    To JEDYNA automatyczna kontrola poprawności odczytu: pominięty albo
    zdublowany wiersz od razu rozjeżdża sumę. ``None`` = stopki nie udało się
    odczytać, więc nie ma czego porównać (a nie „jest dobrze").
    """
    if parsed.get("total_kg") is None:
        return None
    return abs(sum(l["kg"] for l in parsed["lines"]) - parsed["total_kg"]) <= tolerance
