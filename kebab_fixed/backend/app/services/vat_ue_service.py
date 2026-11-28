"""Kontrola VAT UE odbiorców (27.11.2026).

Właściciel: „przy każdej wysyłce zamówienia weryfikował, czy klient nadal ma
aktywny VAT UE”; nieaktywny = TYLKO ostrzeżenie, wtedy faktura z VAT.

- Dotyczy odbiorców z krajem w UE innym niż PL (`adresy.KRAJE_UE`).
- `aktywny` / `nieaktywny` zapisuje się w kartotece (`clients.vat_ue_*`).
- `blad` (VIES nie odpowiada, brak numeru) idzie WYŁĄCZNIE do historii:
  awaria VIES nie może zmienić statusu klienta ani stawki VAT na WZ.
- Każde sprawdzenie zostaje w `vat_ue_checks` z numerem potwierdzenia VIES
  i wysyłką, której dotyczyło — to dowód przy WDT 0 %.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, execute_returning, query_all, query_one
from app.logging_config import get_logger
from app.services.adresy import KRAJE_UE, kraj_z_vat
from app.services.vies_service import vies_check
from app.utils.ids import cuid

logger = get_logger(__name__)


def _kraj(klient: Dict[str, Any]) -> str:
    return (klient.get("country") or "").strip().upper() or kraj_z_vat(klient.get("nip") or "")


def _ostatni_pewny(client_id: str) -> Optional[Dict[str, Any]]:
    r = query_one("SELECT vat_ue_status, vat_ue_checked_at, vat_ue_request_id FROM clients WHERE id=%s",
                  (client_id,))
    if not r or r["vat_ue_status"] not in ("aktywny", "nieaktywny"):
        return None
    return {"status": r["vat_ue_status"],
            "checked_at": r["vat_ue_checked_at"].isoformat() if r["vat_ue_checked_at"] else None,
            "request_id": r["vat_ue_request_id"] or ""}


def _zapisz(client_id, vat, status, request_id, name, address, error, context,
            order_id, loading_id, wz_id, operator) -> str:
    row = execute_returning(
        """INSERT INTO vat_ue_checks (id, client_id, vat_number, status, request_id, vies_name,
               vies_address, error, context, loading_id, order_id, wz_id, operator)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING checked_at""",
        (cuid(), client_id, vat, status, request_id or "", name or "", address or "", error or "",
         context, loading_id, order_id, wz_id, operator or ""))
    return row["checked_at"].isoformat()


def sprawdz_klienta(client_id: str, *, context: str, order_id: Optional[str] = None,
                    loading_id: Optional[str] = None, wz_id: Optional[str] = None,
                    operator: str = "", timeout: int = 15, attempts: int = 3) -> Dict[str, Any]:
    """Sprawdź VAT UE odbiorcy w VIES i zapisz wynik. Nigdy nie rzuca z powodu
    VIES — wtedy `status='blad'` i ostatni pewny wynik obok."""
    klient = query_one("SELECT id, nip, country FROM clients WHERE id=%s", (client_id,))
    if not klient:
        raise HTTPException(404, "Kontrahent nie znaleziony")
    kraj = _kraj(klient)
    vat = "".join(ch for ch in (klient.get("nip") or "").upper() if ch.isalnum())
    wynik: Dict[str, Any] = {"client_id": client_id, "vat_number": vat, "kraj": kraj,
                             "status": "nie_dotyczy", "request_id": "", "checked_at": None,
                             "komunikat": "", "ostatni_pewny": None}
    if kraj == "PL" or kraj not in KRAJE_UE:
        return wynik

    if not vat or vat[:2].isdigit():
        status, req_id, name, addr = "blad", "", "", ""
        komunikat = "Kontrahent z UE bez numeru VAT UE (brak numeru VAT UE w kartotece)"
    else:
        try:
            r = vies_check(vat, timeout=timeout, attempts=attempts)
            status = "aktywny" if r.get("valid") else "nieaktywny"
            req_id, name, addr = r.get("requestIdentifier") or "", r.get("traderName"), r.get("traderAddress")
            komunikat = "" if status == "aktywny" else "VAT UE nieaktywny — wystaw fakturę z VAT"
        except HTTPException as e:
            status, req_id, name, addr, komunikat = "blad", "", "", "", str(e.detail)
        except Exception as e:  # sieć, nieoczekiwany format — to też tylko „nie sprawdzono”
            logger.warning("vat_ue.check.error", extra={"client_id": client_id, "error": str(e)})
            status, req_id, name, addr = "blad", "", "", ""
            komunikat = "VIES nie odpowiada — spróbuj ponownie"

    checked_at = _zapisz(client_id, vat, status, req_id, name, addr,
                         komunikat if status == "blad" else "", context,
                         order_id, loading_id, wz_id, operator)
    if status in ("aktywny", "nieaktywny"):
        execute("UPDATE clients SET vat_ue_status=%s, vat_ue_checked_at=%s, vat_ue_request_id=%s "
                "WHERE id=%s", (status, checked_at, req_id, client_id))
    wynik.update(status=status, request_id=req_id, checked_at=checked_at, komunikat=komunikat,
                 ostatni_pewny=_ostatni_pewny(client_id))
    return wynik


def _klienci_kursu(loading_id: str) -> List[str]:
    rows = query_all(
        """SELECT o.client_id, MIN(o.client_name) AS nazwa FROM loading_orders lo
             JOIN client_orders o ON o.id = lo.order_id
            WHERE lo.loading_id=%s AND o.client_id IS NOT NULL AND o.client_id <> ''
            GROUP BY o.client_id ORDER BY MIN(o.client_name)""", (loading_id,))
    return [r["client_id"] for r in rows]


def sprawdz_kurs(loading_id: str, operator: str = "", timeout: int = 8,
                 attempts: int = 1) -> List[Dict[str, Any]]:
    """Sprawdź każdego zagranicznego (UE) odbiorcę kursu — raz na klienta."""
    out = []
    for cid in _klienci_kursu(loading_id):
        w = sprawdz_klienta(cid, context="kurs", loading_id=loading_id, operator=operator,
                            timeout=timeout, attempts=attempts)
        if w["status"] != "nie_dotyczy":
            out.append(w)
    return out


def historia(client_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Sprawdzenia VAT UE odbiorcy, najnowsze pierwsze, z numerem zamówienia/WZ."""
    return query_all(
        """SELECT v.id, v.vat_number, v.status, v.request_id, v.vies_name, v.vies_address, v.error,
                  v.context, v.loading_id, v.order_id, v.wz_id, v.operator, v.checked_at,
                  o.order_no, w.number AS wz_number, l.plate
             FROM vat_ue_checks v
             LEFT JOIN client_orders o ON o.id = v.order_id
             LEFT JOIN wz_documents w ON w.id = v.wz_id
             LEFT JOIN loadings l ON l.id = v.loading_id
            WHERE v.client_id=%s
            ORDER BY v.checked_at DESC
            LIMIT %s""", (client_id, limit))


def dopelnij_kurs(loading_id: str, operator: str = "") -> None:
    """Przy wystawianiu papierów z kursu: sprawdź odbiorców, których w tym
    kursie jeszcze nikt nie sprawdził (biuro pominęło okno papierów).
    Krótko (8 s, jedna próba) i NIGDY nie przerywa wystawienia."""
    try:
        sprawdzeni = {r["client_id"] for r in query_all(
            "SELECT DISTINCT client_id FROM vat_ue_checks WHERE loading_id=%s", (loading_id,))}
        for cid in _klienci_kursu(loading_id):
            if cid in sprawdzeni:
                continue
            try:
                sprawdz_klienta(cid, context="kurs", loading_id=loading_id, operator=operator,
                                timeout=8, attempts=1)
            except Exception as e:
                logger.warning("vat_ue.kurs.error", extra={"loading_id": loading_id,
                                                           "client_id": cid, "error": str(e)})
    except Exception as e:
        logger.warning("vat_ue.kurs.error", extra={"loading_id": loading_id, "error": str(e)})
