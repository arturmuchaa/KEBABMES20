"""Kurs EUR z NBP (tabela A) — do raportu zarządczego.

Część odbiorców rozlicza się w euro, więc koszt 1 kg mięsa ma sens w obu
walutach. Warunek: kurs pochodzi z KONKRETNEJ tabeli NBP i ta tabela jest
wydrukowana na raporcie. Bez tego dwie osoby liczące „to samo" dostają
różne kwoty i nikt nie wie, która ma rację.

NBP nie publikuje w weekendy i święta, więc pytamy o okno kilku dni
wstecz i bierzemy ostatnią tabelę NIE PÓŹNIEJSZĄ niż zadany dzień.

Gdy NBP nie odpowiada — None, a raport drukuje same złotówki. Zmyślony
albo zaszyty w kodzie kurs byłby gorszy niż jego brak: cicho zafałszowałby
dokument, na podstawie którego zapadają decyzje.
"""
import json
import logging
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_URL = "https://api.nbp.pl/api/exchangerates/rates/a/eur/{start}/{end}/?format=json"
_TIMEOUT_S = 6
#: Ile dni wstecz szukać tabeli — długi weekend świąteczny potrafi mieć 4 dni.
_LOOKBACK_DAYS = 10
#: Kurs dnia się nie zmienia, a raport bywa drukowany wielokrotnie.
_TTL_S = 6 * 3600
_CACHE: Dict[str, tuple] = {}


def _fetch(url: str) -> bytes:
    """Wydzielone, żeby test mógł podmienić sieć."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
        return resp.read()


def _today() -> date:
    """Wydzielone, żeby test mógł zamrozić „dziś"."""
    return date.today()


def nbp_eur_rate(on: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Kurs średni EUR obowiązujący w dniu `on` (RRRR-MM-DD, domyślnie dziś).

    Zwraca {'rate': float, 'date': 'RRRR-MM-DD', 'table': 'A'} albo None.
    """
    day = on or date.today().isoformat()
    hit = _CACHE.get(day)
    if hit and time.time() - hit[0] < _TTL_S:
        return hit[1]

    try:
        end = date.fromisoformat(day)
    except (ValueError, TypeError):
        return None
    # Raport za lipiec drukowany 28.07 ma `to`=31.07, a NBP odpowiada 400 na
    # zakres sięgający w przyszłość — bez przycięcia kurs cicho znikał
    # z gotowego dokumentu (prod 2026-07-28). Obowiązuje ostatnia tabela.
    end = min(end, _today())
    start = end - timedelta(days=_LOOKBACK_DAYS)

    result: Optional[Dict[str, Any]] = None
    try:
        raw = _fetch(_URL.format(start=start.isoformat(), end=end.isoformat()))
        rates = json.loads(raw).get("rates") or []
        # Tabele przychodzą rosnąco; ostatnia = obowiązująca w dniu `on`.
        last = rates[-1] if rates else None
        if last and last.get("mid") is not None:
            result = {"rate": round(float(last["mid"]), 4),
                      "date": str(last.get("effectiveDate") or "")[:10],
                      "table": "A"}
    except (urllib.error.URLError, OSError, ValueError, TypeError, KeyError, IndexError) as exc:
        # Brak kursu nie może wywalić raportu — dokument wyjdzie w PLN.
        logger.warning("fx.nbp.error", extra={"day": day, "error": str(exc)})
        result = None

    _CACHE[day] = (time.time(), result)
    return result
