"""Czysta logika numeracji partii (bez I/O, bez DB).

TRZY POZIOMY NUMERACJI — nie mylić ich ze sobą:

  1. NUMER PRZYJĘCIA — dokument całej dostawy, "12/08/2026"
     (kolejny w miesiącu / miesiąc / rok). Jedna dostawa = jeden numer,
     niezależnie od tego, na ile numerów porządkowych ją rozbijemy.
     Pod nim wiszą partie DOSTAWCY (jego numery, np. A001) i dokumenty:
     WZ, faktura, HDI, temperatura, ocena przyjęcia (karta 1.1.1).
  2. NUMER PORZĄDKOWY — nasz wewnętrzny numer, np. "471". To on jedzie
     przez halę: rozbiór, uboczne, masowanie. Na tym etapie NIE jest
     jeszcze numerem partii.
  3. NUMER PARTII — powstaje dopiero z tego, co się z surowcem stanie:
     * uboczne / mięso sprzedane bez produkcji → numer partii = numer
       porządkowy ("471"),
     * wyrób gotowy → "ddmmrr <numer porządkowy>" ("110826 471").

Poniższe funkcje są jedynym źródłem prawdy dla tych formatów:

  * numer przyjęcia (dokument dostawy)      → "12/08/2026"
  * numer porządkowy (przyjęcie / rozbiór / mieszanie pojedyncze)
                                            → goły numer, np. "344"
  * przyjęcie NA USŁUGĘ (mięso z/s klienta)   → "{n}U", np. "48U"
    (osobna seria: towar jest cudzy, choć leży w tym samym magazynie
     i normalnie się go masuje)
  * łączenie partii w masownicy               → "PP{n}", np. "PP1"
  * mieszanie przyprawionego mięsa NA PRODUKCJI → "PM{n}", np. "PM1"
    (resztka jednej partii dołożona do sztuki z innej partii;
     historycznie używano prefiksu "PPP{n}" — nadal rozpoznawany)
  * pula ścinków z dnia produkcji         → "SC{n}", np. "SC1"
    (fizyczna nadwyżka/domknięcie dnia, gdy żadna partia przyprawionego
     z tego dnia nie jest już żywa — patrz reconcile_production_day)
  * kebab                                     → "ddmmrr <numer wsadu>",
                                                np. "020626 344" / "020626 PM1"
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional, Union

_BARE_NO_RE = re.compile(r"^\d+$")
_SERVICE_NO_RE = re.compile(r"^(\d+)[Uu]$")
_COMBINED_NO_RE = re.compile(r"^PP\d+$")
_PROD_COMBINED_NO_RE = re.compile(r"^PPP\d+$")
_PROD_MIXED_NO_RE = re.compile(r"^PM\d+$")


_DELIVERY_NO_RE = re.compile(r"^(\d+)\s*/\s*(\d{1,2})(?:\s*/\s*\d{2,4})?$")


def _as_date(when: Union[str, date, datetime]) -> date:
    """Data z ISO stringa / date / datetime — wspólne wejście numeratorów."""
    if isinstance(when, str):
        return datetime.strptime(when[:10], "%Y-%m-%d").date()
    if isinstance(when, datetime):
        return when.date()
    return when


def format_delivery_no(seq: int, when: Union[str, date, datetime]) -> str:
    """Numer PRZYJĘCIA (dokument całej dostawy): ``12/08``.

    Numer kolejnej dostawy w miesiącu + miesiąc dwucyfrowy. Dokładnie tak
    zakład zapisuje go na kartach HACCP — 1.1.1 („1/08" ręcznie w kolumnie
    „Numer przyjęcia") i 2.5.1 („01/06 BERG", „05/04 BDF" przy składnikach).

    ROKU W NUMERZE NIE MA i nie należy go dokładać: kartę zakłada się na
    miesiąc, więc rok wynika z samego dokumentu. Do 2026-08-12 MES dopisywał
    rok („12/08/2026") i rozjeżdżał się z papierem.

    Konsekwencja: sam numer NIE jest unikalny w skali lat (``1/08`` wróci
    w sierpniu przyszłego roku). Unikalności pilnuje para
    (``reception_period``, ``reception_seq``) — patrz `_allocate_no_cx`.
    """
    if int(seq) < 1:
        raise ValueError("Numer przyjęcia musi być >= 1")
    d = _as_date(when)
    return f"{int(seq)}/{d.month:02d}"


def parse_delivery_no(raw: Optional[str]) -> Optional[tuple[int, int, int]]:
    """``"12/08"`` → ``(12, 8)``. Puste = ``None`` (numer nada sekwencja).

    Rok dopisany na końcu („12/08/2026") jest PRZYJMOWANY i pomijany — numery
    sprzed zmiany formatu wciąż dają się wpisać ręcznie, a rok i tak wynika
    z daty dostawy.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = _DELIVERY_NO_RE.match(s)
    if not m:
        raise ValueError("Numer przyjęcia ma postać 12/08 (numer/miesiąc)")
    seq, month = int(m.group(1)), int(m.group(2))
    if seq < 1:
        raise ValueError("Numer przyjęcia musi być >= 1")
    if not 1 <= month <= 12:
        raise ValueError("Miesiąc w numerze przyjęcia musi być z zakresu 1-12")
    return (seq, month)


def delivery_period(when: Union[str, date, datetime]) -> str:
    """Okres numeracji przyjęć: ``"2026-08"``. Numeracja resetuje się co miesiąc."""
    d = _as_date(when)
    return f"{d.year:04d}-{d.month:02d}"


def parse_reception_no(raw: Optional[str]) -> Optional[int]:
    """Waliduje ręcznie wpisany NUMER PORZĄDKOWY na przyjęciu.

    Zwraca int gdy podano poprawny goły numer (>= 1), ``None`` gdy puste
    (auto-numerowanie), albo rzuca ``ValueError`` gdy format zły.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if not _BARE_NO_RE.match(s):
        raise ValueError("Numer partii musi być liczbą, np. 344")
    val = int(s)
    if val < 1:
        raise ValueError("Numer partii musi być >= 1")
    return val


def format_reception_no(seq: int) -> str:
    """Numer partii przyjęcia = goły numer sekwencji."""
    return str(seq)


def format_service_reception_no(seq: int) -> str:
    """Numer partii przyjętej NA USŁUGĘ — osobna seria z sufiksem U."""
    return f"{seq}U"


def is_service_no(batch_no: Optional[str]) -> bool:
    """Czy numer należy do serii usługowej (np. „48U")."""
    return bool(batch_no) and bool(_SERVICE_NO_RE.match(str(batch_no).strip()))


def parse_any_reception_no(raw: Optional[str]) -> tuple[Optional[int], bool]:
    """Numer przyjęcia z DOWOLNEJ serii → (numer, czy_usługa).

    Puste = auto-numerowanie: (None, False). Zły format → ValueError.
    Rozpoznaje też małe „u", bo operator wpisze „48u" równie chętnie.
    """
    if raw is None:
        return (None, False)
    s = str(raw).strip()
    if not s:
        return (None, False)
    m = _SERVICE_NO_RE.match(s)
    if m:
        val = int(m.group(1))
        if val < 1:
            raise ValueError("Numer partii musi być >= 1")
        return (val, True)
    if not _BARE_NO_RE.match(s):
        raise ValueError("Numer partii musi być liczbą (np. 344) lub numerem usługi (np. 48U)")
    val = int(s)
    if val < 1:
        raise ValueError("Numer partii musi być >= 1")
    return (val, False)


def combined_batch_no(n: int) -> str:
    """Numer partii łączonej (kilka partii zmieszanych fizycznie)."""
    return f"PP{n}"


def is_combined(batch_no: Optional[str]) -> bool:
    """Czy dany numer to partia łączona (prefiks PP + cyfry, np. PP1)."""
    return bool(batch_no) and bool(_COMBINED_NO_RE.match(batch_no))


def production_combined_batch_no(n: int) -> str:
    """LEGACY: stary numer partii łączonej na produkcji (PPP{n}).
    Nowe numery nadaje production_mixed_batch_no (PM{n}); PPP zostaje
    tylko do rozpoznawania historycznych danych."""
    return f"PPP{n}"


def is_production_combined(batch_no: Optional[str]) -> bool:
    """Czy numer to legacy partia łączona na produkcji (prefiks PPP, np. PPP1)."""
    return bool(batch_no) and bool(_PROD_COMBINED_NO_RE.match(batch_no))


def production_mixed_batch_no(n: int) -> str:
    """Numer partii mieszanej NA PRODUKCJI (przyprawione mięso z >1 partii
    w tej samej sztuce), w odróżnieniu od PP łączonej w masownicy."""
    return f"PM{n}"


def is_production_mixed(batch_no: Optional[str]) -> bool:
    """Czy numer to partia mieszana na produkcji (prefiks PM + cyfry, np. PM1)."""
    return bool(batch_no) and bool(_PROD_MIXED_NO_RE.match(batch_no))


def scrap_pool_batch_no(n: int) -> str:
    """Numer puli ścinków z dnia produkcji (fizyczna nadwyżka bez żywej
    partii do skorygowania — patrz reconcile_production_day)."""
    return f"SC{n}"


def classify_batch_type(batch_no: Optional[str]) -> str:
    """Typ partii na podstawie numeru (akceptuje 'ddmmrr <wsad>' lub goły wsad):
    'production' (PM, legacy PPP), 'mixer' (PP), 'single' (pozostałe/goły numer)."""
    if not batch_no:
        return "single"
    token = batch_no.strip().split(" ")[-1]  # 'ddmmrr PM1' -> 'PM1'
    if is_production_mixed(token) or is_production_combined(token):
        return "production"
    if is_combined(token):
        return "mixer"
    return "single"


def _ddmmrr(produced_date: Union[str, date, datetime]) -> str:
    if isinstance(produced_date, str):
        d = datetime.strptime(produced_date[:10], "%Y-%m-%d").date()
    elif isinstance(produced_date, datetime):
        d = produced_date.date()
    else:
        d = produced_date
    return d.strftime("%d%m%y")


def kebab_batch_no(produced_date: Union[str, date, datetime], batch_no: str) -> str:
    """Numer kebaba = 'ddmmrr <numer wsadu>' (np. '020626 344')."""
    return f"{_ddmmrr(produced_date)} {batch_no}"


_KEBAB_FULL_RE = re.compile(r"^\d{6}\s+(\S.*)$")


def kebab_batch_wsad(batch_no: Optional[str]) -> str:
    """Goły numer wsadu z numeru kebaba: '020626 344' → '344'.
    Numer bez prefiksu daty zwracany bez zmian (idempotentne)."""
    s = (batch_no or "").strip()
    m = _KEBAB_FULL_RE.match(s)
    return m.group(1) if m else s
