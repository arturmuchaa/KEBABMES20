"""Podział zamówienia na część fakturowaną i część wydawaną na WZ.

Właściciel (2026-09-09): „system równomiernie odejmuje sztuki, chcę aby
wszystkie pozycje były, ale mniej" ORAZ „jeżeli chcę 8000 kg i 5005 kg, to
musi się dać tak dzielić, wtedy trzeba usunąć jakąś sztukę, tak aby trafić
w ten podział".

Stąd dwa wymagania naraz: rozkład ma być równomierny, a suma ma trafiać
DOKŁADNIE. Realizujemy to w trzech krokach:

  1. równomiernie — każda pozycja oddaje ten sam procent sztuk,
  2. dobicie do celu NAJMNIEJSZYM ruchem (1 sztuka, potem wymiana dwóch,
     potem trzech) — żeby nie zepsuć równomierności z kroku 1,
  3. gdy cel jest nieosiągalny z całych sztuk — najbliższa osiągalna suma
     i `trafiono=False`, żeby biuro o tym wiedziało.

Wagi sztuk w zakładzie są wielokrotnościami 5 kg, więc osiągalna jest każda
wielokrotność 5 kg. Nieosiągalne są tylko cele spoza tej siatki, na przykład
połowa nieparzystej sumy (13 005 / 2 = 6502,5).
"""
from __future__ import annotations

from typing import Any, Dict, List

#: Poniżej tej różnicy uznajemy kilogramy za równe (błąd zmiennoprzecinkowy).
EPS = 1e-9


def _suma_fv(stan: List[Dict[str, Any]]) -> float:
    return sum(x["qty_invoice"] * x["kg_per_unit"] for x in stan)


def _rownomiernie(linie: List[Dict[str, Any]], cel: float, calosc: float) -> List[Dict[str, Any]]:
    """Krok 1: każda pozycja oddaje ten sam procent sztuk."""
    udzial = min(1.0, cel / calosc) if calosc > 0 else 0.0
    stan = []
    for l in linie:
        qty = int(l.get("qty") or 0)
        dokladnie = qty * udzial
        baza = int(dokladnie)
        stan.append({"id": l.get("id"), "qty": qty,
                     "kg_per_unit": float(l.get("kg_per_unit") or 0),
                     "qty_invoice": baza, "_reszta": dokladnie - baza})
    for w in sorted(stan, key=lambda w: -w["_reszta"]):
        if w["qty_invoice"] >= w["qty"]:
            continue
        if abs(_suma_fv(stan) + w["kg_per_unit"] - cel) < abs(_suma_fv(stan) - cel):
            w["qty_invoice"] += 1
    return stan


def _dobij(stan: List[Dict[str, Any]], cel: float) -> bool:
    """Krok 2: najmniejszy ruch trafiający DOKŁADNIE w cel. True = trafiono."""
    d = cel - _suma_fv(stan)
    if abs(d) < EPS:
        return True

    # Jedna sztuka w górę albo w dół.
    for w in stan:
        if d > 0 and w["qty_invoice"] < w["qty"] and abs(w["kg_per_unit"] - d) < EPS:
            w["qty_invoice"] += 1
            return True
        if d < 0 and w["qty_invoice"] > 0 and abs(w["kg_per_unit"] + d) < EPS:
            w["qty_invoice"] -= 1
            return True

    # Wymiana dwóch: dołóż sztukę A, zabierz sztukę B (różnica wag = d).
    for a in stan:
        if a["qty_invoice"] >= a["qty"]:
            continue
        for b in stan:
            if b is a or b["qty_invoice"] <= 0:
                continue
            if abs((a["kg_per_unit"] - b["kg_per_unit"]) - d) < EPS:
                a["qty_invoice"] += 1
                b["qty_invoice"] -= 1
                return True

    # Dwie sztuki w tę samą stronę.
    for a in stan:
        for b in stan:
            if d > 0 and a["qty_invoice"] < a["qty"] and b["qty_invoice"] < b["qty"]:
                if a is b and a["qty"] - a["qty_invoice"] < 2:
                    continue
                if abs(a["kg_per_unit"] + b["kg_per_unit"] - d) < EPS:
                    a["qty_invoice"] += 1
                    b["qty_invoice"] += 1
                    return True
            if d < 0 and a["qty_invoice"] > 0 and b["qty_invoice"] > 0:
                if a is b and a["qty_invoice"] < 2:
                    continue
                if abs(a["kg_per_unit"] + b["kg_per_unit"] + d) < EPS:
                    a["qty_invoice"] -= 1
                    b["qty_invoice"] -= 1
                    return True
    return False


def _osiagalne_sumy(linie: List[Dict[str, Any]], limit: float) -> List[float]:
    """Krok 3: wszystkie sumy kilogramów, jakie da się złożyć z całych sztuk."""
    mozliwe = {0.0}
    for l in linie:
        kg = float(l.get("kg_per_unit") or 0)
        qty = int(l.get("qty") or 0)
        if kg <= 0 or qty <= 0:
            continue
        nowe = set()
        for baza in mozliwe:
            for n in range(qty + 1):
                s = baza + n * kg
                if s <= limit + EPS:
                    nowe.add(round(s, 3))
        mozliwe = nowe
    return sorted(mozliwe)


def podziel_pozycje(linie: List[Dict[str, Any]], cel_kg: float) -> Dict[str, Any]:
    """Rozdziela sztuki na część fakturowaną i resztę.

    Zwraca `{"lines": [...], "kg_fv": float, "kg_calosc": float,
    "trafiono": bool}`. `trafiono=False` znaczy, że celu nie da się złożyć
    z całych sztuk — `kg_fv` jest wtedy najbliższą osiągalną sumą.
    """
    if not linie:
        return {"lines": [], "kg_fv": 0.0, "kg_calosc": 0.0, "trafiono": True}

    calosc = sum(float(l.get("kg_per_unit") or 0) * int(l.get("qty") or 0) for l in linie)
    cel = max(0.0, min(float(cel_kg or 0), calosc))

    stan = _rownomiernie(linie, cel, calosc)
    trafiono = _dobij(stan, cel)

    if not trafiono:
        # Cel spoza siatki wag — celujemy w najbliższą osiągalną sumę.
        osiagalne = _osiagalne_sumy(linie, calosc)
        blisko = min(osiagalne, key=lambda s: (abs(s - cel), s))
        stan = _rownomiernie(linie, blisko, calosc)
        _dobij(stan, blisko)

    for w in stan:
        w.pop("_reszta", None)
    return {"lines": stan, "kg_fv": round(_suma_fv(stan), 3),
            "kg_calosc": round(calosc, 3), "trafiono": trafiono}
