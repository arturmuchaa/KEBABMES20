"""Ważenie kartonu przy wjeździe do mroźni — czysta reguła werdyktu.

Spec: docs/superpowers/specs/2026-09-29-mroznia-wazenie-design.md.

Karton stoi na palecie, której waga nie jest znana co do kilograma — właściciel
podał WIDEŁKI (jednorazowa 20–30 kg, EURO 35 kg ±5%, plastikowa 24 kg ±10%).
Zgodność = netto ze sztuk mieści się w tym, co wychodzi z brutto po odjęciu
DOWOLNEJ tary z widełek, plus zapas netto (tuleje, folia, działka wagi), który
biuro ustawia osobno dla każdej palety.

Ta sama reguła żyje we froncie (`features/magazyn/wazenieMrozni.ts`) — tylko do
podglądu na ekranie; zapisuje się werdykt policzony TUTAJ.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List

MAX_TARE_KG = 200.0
MAX_MARGIN_PCT = 20.0

DEFAULT_PALLET_TYPES: List[Dict[str, Any]] = [
    {"id": "jednorazowa", "name": "Jednorazowa", "tareMinKg": 20, "tareMaxKg": 30, "marginPct": 1},
    {"id": "euro", "name": "EURO", "tareMinKg": 33.25, "tareMaxKg": 36.75, "marginPct": 1},
    {"id": "plastikowa", "name": "Plastikowa jednorazowa", "tareMinKg": 21.6, "tareMaxKg": 26.4, "marginPct": 1},
]


def _r(v: float, q: str = "0.01") -> float:
    # half-up na zapisie dziesiętnym — round() na floatach bywa bankierski
    return float(Decimal(str(v)).quantize(Decimal(q), ROUND_HALF_UP))


def _num(v: Any, pole: str, nazwa: str) -> float:
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        raise ValueError(f"{nazwa}: '{v}' w polu {pole} nie jest liczbą")


def _slug(name: str) -> str:
    s = re.sub(r"[^0-9a-z]+", "-", name.lower()).strip("-")
    return s or "paleta"


def normalize_pallet_types(values: Any) -> List[Dict[str, Any]]:
    """Walidacja listy palet z biura. ValueError z komunikatem po polsku."""
    if not values or not isinstance(values, list):
        raise ValueError("Lista palet nie może być pusta")
    out: List[Dict[str, Any]] = []
    widziane = set()
    for v in values:
        if not isinstance(v, dict):
            raise ValueError("Nieprawidłowa pozycja listy palet")
        name = str(v.get("name") or "").strip()
        if not name:
            raise ValueError("Każda paleta musi mieć nazwę")
        tmin = _num(v.get("tareMinKg"), "tara od", name)
        tmax = _num(v.get("tareMaxKg"), "tara do", name)
        margin = _num(v.get("marginPct", 0) or 0, "zapas %", name)
        if not (0 <= tmin <= tmax <= MAX_TARE_KG):
            raise ValueError(f"{name}: tara musi spełniać 0 ≤ od ≤ do ≤ {MAX_TARE_KG:g} kg")
        if not (0 <= margin <= MAX_MARGIN_PCT):
            raise ValueError(f"{name}: zapas musi być w zakresie 0–{MAX_MARGIN_PCT:g}%")
        pid = str(v.get("id") or "").strip() or _slug(name)
        if pid in widziane or name.lower() in widziane:
            raise ValueError(f"Paleta „{name}” jest na liście dwa razy")
        widziane.update({pid, name.lower()})
        out.append({"id": pid, "name": name, "tareMinKg": _r(tmin), "tareMaxKg": _r(tmax),
                    "marginPct": _r(margin)})
    return out


def werdykt(net_kg: float, gross_kg: float, paleta: Dict[str, Any]) -> Dict[str, Any]:
    """Czy brutto z wagi zgadza się z netto ze sztuk na danej palecie."""
    net = float(net_kg or 0)
    gross = float(gross_kg or 0)
    tmin = float(paleta["tareMinKg"])
    tmax = float(paleta["tareMaxKg"])
    zapas = net * float(paleta.get("marginPct") or 0) / 100
    lo = gross - tmax - zapas
    hi = gross - tmin + zapas
    tara = (tmin + tmax) / 2
    # Porównanie na setnych — float nie może przewrócić wyniku na samej granicy.
    ok = _r(lo) <= _r(net) <= _r(hi)
    return {
        "ok": ok,
        "netKg": _r(net),
        "grossKg": _r(gross),
        "tareKg": _r(tara),
        "tareMinKg": _r(tmin),
        "tareMaxKg": _r(tmax),
        "marginPct": float(paleta.get("marginPct") or 0),
        "marginKg": _r(zapas),
        "diffKg": _r(gross - tara - net, "0.1"),
    }
