"""Szablony etykiet kebabów z projektora PROTRIMA (27.11.2026).

Szablon A4 (tło PDF, 1–2 etykiety na arkusz) albo Zebra (tło ^GFA z PRN/PDF).
Zawsze należy do klienta; rodzaj i receptura '' = każdy. Dla pozycji planu
dobierany jest najbardziej szczegółowy aktywny szablon klienta. Każdy zapis
dopisuje rewizję (bez teł — tło rozpoznaje hash). Spec:
docs/superpowers/specs/2026-11-27-projektor-etykiet-design.md
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

import psycopg2
from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)

TRYBY = ("a4", "zebra")
_KOLUMNY_LISTY = ("id, name, client_id, product_type_id, recipe_id, print_mode, active, width_mm, height_mm, "
                  "labels_per_sheet, source_name, updated_at, updated_by")


def _bez_nul(s: Any) -> str:
    return (str(s) if s is not None else "").replace("\x00", "")


def _nazwy() -> Dict[str, Dict[str, str]]:
    return {
        "c": {r["id"]: r.get("display_name") or r.get("name") or "" for r in query_all("SELECT id, name, display_name FROM clients")},
        "p": {r["id"]: r["name"] or "" for r in query_all("SELECT id, name FROM product_types")},
        "r": {r["id"]: r["name"] or "" for r in query_all("SELECT id, name FROM recipes")},
    }


def _out(r: Dict[str, Any], nazwy: Dict[str, Dict[str, str]] | None = None, pelny: bool = True) -> Dict[str, Any]:
    n = nazwy or {"c": {}, "p": {}, "r": {}}
    d = {
        "id": r["id"], "name": r.get("name") or "", "clientId": r["client_id"],
        "productTypeId": r.get("product_type_id") or "", "recipeId": r.get("recipe_id") or "",
        "clientName": n["c"].get(r["client_id"], ""), "productTypeName": n["p"].get(r.get("product_type_id") or "", ""),
        "recipeName": n["r"].get(r.get("recipe_id") or "", ""),
        "printMode": r.get("print_mode") or "a4", "active": bool(r.get("active")),
        "widthMm": float(r.get("width_mm") or 0), "heightMm": float(r.get("height_mm") or 0),
        "labelsPerSheet": int(r.get("labels_per_sheet") or 1), "sourceName": r.get("source_name") or "",
        "updatedAt": r["updated_at"].isoformat() if r.get("updated_at") else None,
        "updatedBy": r.get("updated_by") or "",
    }
    if pelny:
        d.update({
            "backgroundPdf": r.get("background_pdf") or "", "backgroundPng": r.get("background_png") or "",
            "backgroundZpl": r.get("background_zpl") or "", "dpi": int(r.get("dpi") or 203),
            "slotOffset": r.get("slot_offset") or {}, "calibration": r.get("calibration") or {},
            "fields": r.get("fields") or [], "slot2Fields": r.get("slot2_fields") or {},
        })
    return d


def list_designs() -> List[Dict[str, Any]]:
    """Aktywne szablony bez teł (lista w projektorze)."""
    nazwy = _nazwy()
    rows = query_all(f"SELECT {_KOLUMNY_LISTY} FROM label_designs WHERE active ORDER BY name")
    return sorted((_out(r, nazwy, pelny=False) for r in rows), key=lambda d: (d["clientName"], d["name"]))


def get_design(design_id: str) -> Dict[str, Any]:
    r = query_one("SELECT * FROM label_designs WHERE id=%s", (design_id,))
    if not r:
        raise HTTPException(404, "Szablon etykiety nie istnieje")
    return _out(r, _nazwy())


def _sprawdz(dto: Dict[str, Any]) -> None:
    if not (dto.get("client_id") or "").strip():
        raise HTTPException(400, "Wybierz klienta — szablon zawsze należy do klienta")
    if dto.get("print_mode") not in TRYBY:
        raise HTTPException(400, "Sposób druku: A4 albo Zebra")
    if dto["print_mode"] == "a4" and not dto.get("background_pdf"):
        raise HTTPException(400, "Szablon A4 potrzebuje tła z pliku PDF")
    if dto["print_mode"] == "zebra":
        if not dto.get("background_zpl"):
            raise HTTPException(400, "Szablon Zebry potrzebuje tła z pliku PRN albo PDF")
        if not (float(dto.get("width_mm") or 0) > 0 and float(dto.get("height_mm") or 0) > 0):
            raise HTTPException(400, "Podaj rozmiar etykiety Zebry")
    if int(dto.get("labels_per_sheet") or 1) not in (1, 2):
        raise HTTPException(400, "Na arkuszu A4 mieści się 1 albo 2 etykiety")


def save_design(dto: Dict[str, Any], actor: str = "") -> Dict[str, Any]:
    """Nowy szablon albo nowa wersja istniejącego (`id`). Kolizja przypisania → 409."""
    dto = {_snake(k): v for k, v in dto.items()}
    dto.setdefault("print_mode", "a4")
    _sprawdz(dto)
    tlo = dto.get("background_pdf") or dto.get("background_zpl") or ""
    kolumny = {
        "name": (dto.get("name") or "").strip(), "client_id": dto["client_id"].strip(),
        "product_type_id": dto.get("product_type_id") or "", "recipe_id": dto.get("recipe_id") or "",
        "print_mode": dto["print_mode"], "background_pdf": _bez_nul(dto.get("background_pdf")),
        "background_png": _bez_nul(dto.get("background_png")), "background_zpl": _bez_nul(dto.get("background_zpl")),
        "width_mm": float(dto.get("width_mm") or 0), "height_mm": float(dto.get("height_mm") or 0),
        "dpi": int(dto.get("dpi") or 203), "source_name": dto.get("source_name") or "",
        "labels_per_sheet": int(dto.get("labels_per_sheet") or 1),
        "slot_offset": json.dumps(dto.get("slot_offset") or {}), "calibration": json.dumps(dto.get("calibration") or {}),
        "fields": json.dumps(dto.get("fields") or []), "slot2_fields": json.dumps(dto.get("slot2_fields") or {}),
        "updated_by": actor or "",
    }
    try:
        with transaction() as conn:
            if dto.get("id"):
                if not cx_query_one(conn, "SELECT id FROM label_designs WHERE id=%s FOR UPDATE", (dto["id"],)):
                    raise HTTPException(404, "Szablon etykiety nie istnieje")
                ustaw = ", ".join(f"{k}=%s" + ("::jsonb" if k in ("slot_offset", "calibration", "fields", "slot2_fields") else "")
                                  for k in kolumny)
                row = cx_execute_returning(conn, f"UPDATE label_designs SET {ustaw}, updated_at=now() WHERE id=%s RETURNING *",
                                           (*kolumny.values(), dto["id"]))
            else:
                nazwy_k = ", ".join(kolumny)
                miejsca = ", ".join("%s::jsonb" if k in ("slot_offset", "calibration", "fields", "slot2_fields") else "%s"
                                    for k in kolumny)
                row = cx_execute_returning(conn, f"INSERT INTO label_designs (id, {nazwy_k}) VALUES (%s, {miejsca}) RETURNING *",
                                           (cuid(), *kolumny.values()))
            assert row is not None
            nr = cx_query_one(conn, "SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM label_design_revisions WHERE design_id=%s",
                              (row["id"],))["n"]
            snapshot = {k: v for k, v in _out(row).items() if k not in ("backgroundPdf", "backgroundPng", "backgroundZpl")}
            cx_execute(conn, "INSERT INTO label_design_revisions (id, design_id, revision, snapshot, background_sha256, actor) "
                             "VALUES (%s,%s,%s,%s::jsonb,%s,%s)",
                       (cuid(), row["id"], int(nr), json.dumps(snapshot, default=str),
                        hashlib.sha256(tlo.encode()).hexdigest() if tlo else "", actor or ""))
    except psycopg2.errors.UniqueViolation:
        inny = query_one("SELECT name FROM label_designs WHERE active AND client_id=%s AND product_type_id=%s AND recipe_id=%s",
                         (kolumny["client_id"], kolumny["product_type_id"], kolumny["recipe_id"]))
        raise HTTPException(409, f"To samo przypisanie (klient, rodzaj, receptura) ma już szablon „{(inny or {}).get('name') or '—'}” "
                                 "— zmień przypisanie albo usuń tamten szablon")
    logger.info("label_designs.saved", extra={"design_id": row["id"], "revision": int(nr), "actor": actor})
    return {"id": row["id"], "revision": int(nr)}


def delete_design(design_id: str) -> Dict[str, Any]:
    with transaction() as conn:
        if not cx_execute_returning(conn, "UPDATE label_designs SET active=false, updated_at=now() WHERE id=%s RETURNING id",
                                    (design_id,)):
            raise HTTPException(404, "Szablon etykiety nie istnieje")
    return {"ok": True}


def resolve_design(client_id: str, product_type_id: str = "", recipe_id: str = "") -> Optional[Dict[str, Any]]:
    """Najbardziej szczegółowy aktywny szablon klienta: klient+rodzaj+receptura →
    klient+receptura → klient+rodzaj → sam klient."""
    if not client_id:
        return None
    for pt, rec in ((product_type_id, recipe_id), ("", recipe_id), (product_type_id, ""), ("", "")):
        r = query_one(f"SELECT {_KOLUMNY_LISTY} FROM label_designs WHERE active AND client_id=%s "
                      "AND product_type_id=%s AND recipe_id=%s", (client_id, pt or "", rec or ""))
        if r:
            return _out(r, pelny=False)
    return None


def _snake(k: str) -> str:
    return "".join("_" + c.lower() if c.isupper() else c for c in k)
