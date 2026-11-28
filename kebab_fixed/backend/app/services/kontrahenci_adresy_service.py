"""„Popraw adresy” w kartotece (27.11.2026).

Propozycje liczone WYŁĄCZNIE z zapisanych pól (bez pytania rejestrów):
ulica i miasto zwykłymi literami, bez spacji brzegowych, kod pocztowy
w formacie kraju. Nic nie zmienia się samo — biuro zatwierdza ptaszkami,
a dopiero `zastosuj` zapisuje wskazane wiersze.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, query_all, transaction
from app.services.adresy import formatuj_ulice, kraj_z_vat, ladne_litery, normalizuj_kod

_TABELE = {"odbiorca": "clients", "dostawca": "suppliers"}
_POLA = ("address", "postal_code", "city", "country")


def _propozycja(row: Dict[str, Any]) -> Dict[str, str]:
    kraj = (row.get("country") or "").strip().upper() or kraj_z_vat(row.get("nip") or "")
    return {
        "address": formatuj_ulice(row.get("address") or "", kraj),
        "postal_code": normalizuj_kod(row.get("postal_code") or "", kraj),
        "city": ladne_litery((row.get("city") or "").strip()),
        "country": kraj,
    }


def propozycje() -> List[Dict[str, Any]]:
    """Aktywni odbiorcy i dostawcy, których zapisany adres różni się od poprawionego."""
    out = []
    for rodzaj, tabela in _TABELE.items():
        for r in query_all(
                f"SELECT id, name, display_name, nip, address, postal_code, city, country FROM {tabela} "
                "WHERE active IS NOT FALSE ORDER BY COALESCE(NULLIF(display_name,''), name)"):
            obecne = {k: r.get(k) or "" for k in _POLA}
            nowe = _propozycja(r)
            if any(obecne[k] != nowe[k] for k in _POLA):
                out.append({"rodzaj": rodzaj, "id": r["id"], "nazwa": r.get("display_name") or r["name"],
                            "pelna": r["name"], "obecne": obecne, "proponowane": nowe})
    return out


def zastosuj(zmiany: List[Dict[str, Any]]) -> Dict[str, int]:
    """Zapisz zatwierdzone adresy — jedna transakcja, tylko wskazane wiersze."""
    n = 0
    with transaction() as conn:
        for z in zmiany or []:
            tabela = _TABELE.get(z.get("rodzaj") or "")
            if not tabela or not z.get("id"):
                raise HTTPException(400, "Zmiana bez rodzaju albo id kontrahenta")
            cx_execute(conn, f"UPDATE {tabela} SET address=%s, postal_code=%s, city=%s, country=%s WHERE id=%s",
                       (str(z.get("address") or "").strip(), str(z.get("postal_code") or "").strip(),
                        str(z.get("city") or "").strip(), str(z.get("country") or "").strip().upper(), z["id"]))
            n += 1
    return {"zmieniono": n}
