"""Pozycje dodatkowe na WZ/WM — „z ręki” (towar obcy, np. jogurt) i „z magazynu
surowca” (np. łój otokowy do yapraku), dopisywane do już wystawionych dokumentów,
także z kursu.

Zasada właściciela (14.11.2026): **WM = wszystko, co wyszło z magazynu (rusza
stan); WZ = dokument dla klienta do zapłaty** (Rozrachunki liczą tylko serię WZ).
Stąd reguły w `cel_pozycji`:

* zwykła WZ (bez pary WM) — robi obie rzeczy: pozycja i stan na tej WZ;
* WM + WZ klienta (podział wysyłki) — surowiec zdejmuje stan na WM, a z ceną
  trafia na WZ klienta (gdy `doZaplaty`); pozycja z ręki tylko na WZ klienta
  (nie wyszła z naszego magazynu);
* sam WM (całość na fakturę z Subiekta) — surowiec na WM (stan), pozycja
  z ręki odrzucona: obciążenie klienta idzie fakturą, nie tym dokumentem.

Kopie tej samej pozycji na WM i WZ klienta mają wspólny `line_id`, więc
usunięcie zdejmuje obie, a powtórzone kliknięcie nie dopisuje drugi raz.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, transaction
from app.logging_config import get_logger
from app.services.wz_service import (SUROWIEC, _rebook_wz_containers, build_wz_lines, get_wz,
                                     stempluj_daty_surowca, wydaj_surowiec, zwroc_surowiec)

logger = get_logger(__name__)

JEDNOSTKI = ("szt", "kg", "opak.")
KOMUNIKAT_SAM_WM = ("Ten kurs idzie w całości na fakturę z Subiekta — dopisz tę pozycję "
                    "na fakturze.")


def _liczba(v: Any, pole: str, *, dodatnia: bool = True) -> float:
    try:
        x = float(str(v).replace(" ", "").replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        raise HTTPException(400, f"Nieprawidłowa wartość pola „{pole}”")
    if dodatnia and x <= 0:
        raise HTTPException(400, f"Pole „{pole}” musi być większe od zera")
    return x


def _wspolne(dane: Dict[str, Any], valued: bool, unit: str) -> Dict[str, Any]:
    name = str(dane.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Podaj nazwę pozycji")
    if unit not in JEDNOSTKI:
        raise HTTPException(400, f"Jednostka musi być jedną z: {', '.join(JEDNOSTKI)}")
    qty = _liczba(dane.get("qty"), "ilość")
    cena = dane.get("price")
    price = _liczba(cena, "cena", dodatnia=False) if valued and cena not in (None, "") else 0.0
    item = {"name": name, "qty": qty, "unit": unit, "price": price,
            "vat_rate": dane.get("vatRate", dane.get("vat_rate"))}
    if unit == "kg":
        item["total_kg"] = qty
    return item


def linia_reczna(dane: Dict[str, Any], valued: bool) -> Dict[str, Any]:
    """Pozycja z ręki — towar spoza stanów; nie rusza magazynu."""
    item = _wspolne(dane, valued, str(dane.get("unit") or "szt"))
    [line], _ = build_wz_lines([item], valued)
    if line["unit"] != "kg":
        line["qty"] = item["qty"] if item["qty"] != int(item["qty"]) else int(item["qty"])
    line["stock_type"] = "reczna"
    line["line_id"] = str(dane.get("lineId") or dane.get("line_id") or uuid.uuid4())
    return line


def _linia_surowca(dane: Dict[str, Any], valued: bool) -> Dict[str, Any]:
    stype = dane.get("stockType") or dane.get("stock_type")
    if stype not in SUROWIEC or not (dane.get("stockId") or dane.get("stock_id")):
        raise HTTPException(400, "Wybierz partię z magazynu surowca")
    item = _wspolne(dane, valued, "kg")
    [line], _ = build_wz_lines([item], valued)
    line["line_id"] = str(dane.get("lineId") or dane.get("line_id") or uuid.uuid4())
    line["stock_type"] = stype
    line["stock_id"] = dane.get("stockId") or dane.get("stock_id")
    return line


def _linie(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    lines = row.get("lines") or []
    return json.loads(lines) if isinstance(lines, str) else list(lines)


def _dokument(conn, wz_id: str) -> Dict[str, Any]:
    row = cx_query_one(
        conn,
        "SELECT id, number, status, source_type, source_id, loading_id, split_scope, "
        "       COALESCE(doc_series,'WZ') AS doc_series, valued, lines "
        "FROM wz_documents WHERE id=%s FOR UPDATE", (wz_id,))
    if not row:
        raise HTTPException(404, "Dokument WZ nie istnieje")
    if row.get("status") == "anulowany":
        raise HTTPException(409, f"Dokument {row['number']} jest anulowany — nie można go zmieniać")
    return dict(row)


def _para(conn, wz: Dict[str, Any]) -> Dict[str, Optional[Dict[str, Any]]]:
    """WM (`calosc`) i WZ klienta tej samej wysyłki. Blokady w stałej
    kolejności: najpierw WM, potem WZ klienta."""
    if wz["source_type"] != "order" or not wz.get("split_scope"):
        return {"wm": None, "wzk": None}
    if wz["split_scope"] == "calosc":
        wm = wz
    else:
        wm_row = cx_query_one(
            conn,
            "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s "
            "AND split_scope='calosc' AND loading_id IS NOT DISTINCT FROM %s "
            "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at LIMIT 1",
            (wz["source_id"], wz.get("loading_id")))
        wm = _dokument(conn, wm_row["id"]) if wm_row else None
    wzk_row = cx_query_one(
        conn,
        "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "AND split_scope='wz_klienta' AND loading_id IS NOT DISTINCT FROM %s "
        "AND COALESCE(status,'')<>'anulowany' ORDER BY created_at LIMIT 1",
        (wz["source_id"], wz.get("loading_id")))
    wzk = (wz if wz["split_scope"] == "wz_klienta"
           else _dokument(conn, wzk_row["id"]) if wzk_row else None)
    return {"wm": wm, "wzk": wzk}


def cel_pozycji(conn, wz: Dict[str, Any], rodzaj: str, do_zaplaty: bool = True) -> Dict[str, Optional[Dict[str, Any]]]:
    """Na który dokument idzie stan („stan”), a na który pozycja do zapłaty („zaplata”)."""
    para = _para(conn, wz)
    wm, wzk = para["wm"], para["wzk"]
    if wm is None and wzk is None:
        # Zwykła WZ albo ręczna — jeden dokument robi obie rzeczy.
        return {"stan": wz if rodzaj == "surowiec" else None, "zaplata": wz}
    if rodzaj == "reczna":
        if wzk is None:
            raise HTTPException(409, KOMUNIKAT_SAM_WM)
        return {"stan": None, "zaplata": wzk}
    if wm is None:
        raise HTTPException(409, "Brak WM tej wysyłki — surowiec musi zejść ze stanu na WM")
    return {"stan": wm, "zaplata": wzk if do_zaplaty else None}


def _zapisz(conn, doc: Dict[str, Any], lines: List[Dict[str, Any]]) -> None:
    valued = bool(doc.get("valued"))
    total = round(sum(float(l.get("value") or 0) for l in lines), 2) if valued else None
    cx_execute(conn, "UPDATE wz_documents SET lines=%s, total_value=%s WHERE id=%s",
               (json.dumps(lines), total, doc["id"]))
    _rebook_wz_containers(conn, doc["id"])


def dopisz_pozycje(wz_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    rodzaj = body.get("rodzaj")
    if rodzaj not in ("reczna", "surowiec"):
        raise HTTPException(400, "Rodzaj pozycji: „reczna” albo „surowiec”")
    line_id = str(body.get("lineId") or uuid.uuid4())
    body = {**body, "lineId": line_id}
    teraz = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with transaction() as conn:
        wz = _dokument(conn, wz_id)
        cel = cel_pozycji(conn, wz, rodzaj, bool(body.get("doZaplaty", True)))
        dokumenty = [d for d in (cel["stan"], cel["zaplata"]) if d is not None]
        # Powtórzone kliknięcie (ten sam line_id) — nic nie dopisujemy drugi raz.
        if any(l.get("line_id") == line_id for d in dokumenty for l in _linie(d)):
            return get_wz(wz_id)
        if rodzaj == "reczna":
            doc = cel["zaplata"]
            nowa = linia_reczna(body, bool(doc.get("valued")))
            nowa["dopisana_at"] = teraz
            _zapisz(conn, doc, _linie(doc) + [nowa])
        else:
            stan = cel["stan"]
            nowa = _linia_surowca(body, bool(stan.get("valued")))
            pola = wydaj_surowiec(conn, stan["id"], {
                "stock_type": nowa["stock_type"], "stock_id": nowa["stock_id"],
                "qty": nowa["qty"], "containers": body.get("containers")})
            nowa["batch_no"] = pola.get("batch_no")
            nowa["dopisana_at"] = teraz
            stempluj_daty_surowca([nowa])
            zaplata = cel["zaplata"]
            if zaplata is None or zaplata["id"] == stan["id"]:
                _zapisz(conn, stan, _linie(stan) + [nowa])
            else:
                # Kopia do zapłaty na WZ klienta: wyceniona wg TEGO dokumentu,
                # bez stock_id — stan zszedł raz, na WM (Rozrachunki WM nie liczą).
                _zapisz(conn, stan, _linie(stan) + [nowa])
                kopia = _linia_surowca(body, bool(zaplata.get("valued")))
                kopia.pop("stock_id")
                kopia.update({k: nowa[k] for k in ("batch_no", "dopisana_at", "slaughter_date", "expiry_date") if k in nowa})
                _zapisz(conn, zaplata, _linie(zaplata) + [kopia])
    logger.info("wz.pozycja_dopisana", extra={"wz_id": wz_id, "rodzaj": rodzaj, "line_id": line_id})
    return get_wz(wz_id)


def usun_pozycje(wz_id: str, line_id: str) -> Dict[str, Any]:
    with transaction() as conn:
        wz = _dokument(conn, wz_id)
        para = _para(conn, wz)
        dokumenty = [d for d in (para["wm"], para["wzk"]) if d is not None] or [wz]
        znaleziono = False
        for doc in dokumenty:
            lines = _linie(doc)
            zostaja = [l for l in lines if l.get("line_id") != line_id]
            if len(zostaja) == len(lines):
                continue
            znaleziono = True
            for l in lines:
                if l.get("line_id") == line_id and l.get("stock_id") and l.get("stock_type") in SUROWIEC:
                    zwroc_surowiec(conn, doc["id"], l)
            _zapisz(conn, doc, zostaja)
        if not znaleziono:
            raise HTTPException(409, "Usunąć można tylko pozycję dopisaną (z ręki albo z surowca)")
    logger.info("wz.pozycja_usunieta", extra={"wz_id": wz_id, "line_id": line_id})
    return get_wz(wz_id)


def opis_dokumentu(wz_id: str) -> Dict[str, Any]:
    """Dla okna „Dopisz pozycję”: waluta, para dokumentów i czy wolno dopisać
    pozycję z ręki. Tylko odczyt (transakcja bez zmian — blokady zwalnia commit)."""
    with transaction() as conn:
        wz = _dokument(conn, wz_id)
        para = _para(conn, wz)
        wm, wzk = para["wm"], para["wzk"]
        if wm is None and wzk is None:
            rodzaj, docs, bez = "jeden", [wz], None
        elif wzk is None:
            rodzaj, docs, bez = "sam_wm", [wm], KOMUNIKAT_SAM_WM
        else:
            rodzaj, docs, bez = "wm_wzk", [d for d in (wm, wzk) if d], None
        glowny = cx_query_one(conn, "SELECT currency, eur_rate, valued FROM wz_documents WHERE id=%s",
                              ((wzk or wz)["id"],))
    return {
        "para": rodzaj, "bez_recznej": bez,
        "currency": glowny.get("currency") or "PLN",
        "eur_rate": float(glowny["eur_rate"]) if glowny.get("eur_rate") is not None else None,
        "valued": bool(glowny.get("valued")),
        "dokumenty": [{"id": d["id"], "number": d["number"], "doc_series": d["doc_series"],
                       "valued": bool(d.get("valued")), "lines": _linie(d)} for d in docs],
    }
