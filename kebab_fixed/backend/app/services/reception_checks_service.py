"""Kontrola HACCP dostawy — kolumny f-k karty 1.1.1.

Wpis jest ZAWSZE opcjonalny: dostawa zapisuje się bez niego, a system
tylko przypomina o uzupełnieniu (żadnej blokady — dostawa o 6 rano nie
może czekać na kierownika).
"""
from typing import Any, Dict, Optional

from app.db import execute, query_all, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.utils.ids import now_iso

#: Pola, bez których karta 1.1.1 ma dziurę w wierszu.
_WYMAGANE = ("visual", "tempChamber", "tempMeat", "kgMatch", "verdict")


def _f(v: Any) -> Optional[float]:
    return None if v is None else float(v)


def _pusty(reception_id: str) -> Dict[str, Any]:
    return {
        "receptionId": reception_id, "visual": None, "tempChamber": None,
        "tempMeat": None, "kgMatch": None, "notes": "", "verdict": None,
        "ncDescription": "", "ncAction": "", "ncAt": None,
        "updatedAt": None,
    }


def check_status(check: Dict[str, Any]) -> str:
    """'brak' — nic nie wpisano; 'niepelne' — brakuje pola; 'komplet'."""
    wypelnione = [k for k in _WYMAGANE if check.get(k) not in (None, "")]
    if not wypelnione:
        return "brak"
    return "komplet" if len(wypelnione) == len(_WYMAGANE) else "niepelne"


def get_check(reception_id: str) -> Dict[str, Any]:
    """Wpis dostawy. Brak wiersza to stan NORMALNY, nie błąd — zwracamy
    pusty szkic, żeby formularz miał co pokazać i gdzie zapisać."""
    row = query_one(
        "SELECT * FROM reception_checks WHERE reception_id=%s", (reception_id,))
    out = _pusty(reception_id) if not row else {
        "receptionId": row["reception_id"],
        "visual": row["visual"],
        "tempChamber": _f(row["temp_chamber"]),
        "tempMeat": _f(row["temp_meat"]),
        "kgMatch": row["kg_match"],
        "notes": row["notes"] or "",
        "verdict": row["verdict"],
        "ncDescription": row["nc_description"] or "",
        "ncAction": row["nc_action"] or "",
        "ncAt": row["nc_at"].isoformat() if row["nc_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }
    out["status"] = check_status(out)
    return out


def save_check(reception_id: str, dto: ReceptionCheckIn) -> Dict[str, Any]:
    """Zapis wpisu. UPSERT po kluczu głównym — jedna dostawa, jeden wpis."""
    teraz = now_iso()
    execute(
        """INSERT INTO reception_checks
             (reception_id, visual, temp_chamber, temp_meat, kg_match, notes,
              verdict, nc_description, nc_action, nc_at, created_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (reception_id) DO UPDATE SET
             visual=EXCLUDED.visual, temp_chamber=EXCLUDED.temp_chamber,
             temp_meat=EXCLUDED.temp_meat, kg_match=EXCLUDED.kg_match,
             notes=EXCLUDED.notes, verdict=EXCLUDED.verdict,
             nc_description=EXCLUDED.nc_description, nc_action=EXCLUDED.nc_action,
             nc_at=EXCLUDED.nc_at, updated_at=EXCLUDED.updated_at""",
        (reception_id, dto.visual, dto.temp_chamber, dto.temp_meat, dto.kg_match,
         dto.notes, dto.verdict, dto.nc_description, dto.nc_action, dto.nc_at,
         teraz, teraz),
    )
    # Zmiana danych po podpisaniu UNIEWAŻNIA podpis. Wiersze zostają
    # (historia), ale karta ich nie drukuje, a ekran żąda podpisania od nowa.
    # Import LOKALNY: signatures_service sięga tutaj po `current_hash`,
    # więc import na poziomie modułu byłby cyklem i wywracał start aplikacji.
    from app.services.signatures_service import current_hash, supersede_if_changed
    supersede_if_changed("reception_check", reception_id, current_hash(reception_id))
    return get_check(reception_id)


def pending(days: int = 14) -> list:
    """Dostawy bez kompletu HACCP z ostatnich `days` dni.

    Okno, nie cała historia: pulpit pokazuje STAN, nie archiwum — inaczej
    kafel od pierwszego dnia świeciłby setką starych dostaw, których nikt
    już nie uzupełni, i przestałby cokolwiek znaczyć.
    """
    rows = query_all(
        """SELECT r.id, r.reception_no, r.supplier_name, r.received_date,
                  c.visual, c.temp_chamber, c.temp_meat, c.kg_match, c.verdict
             FROM receptions r
             LEFT JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.received_date >= CURRENT_DATE - %s::int
            ORDER BY r.received_date DESC, r.reception_seq DESC""",
        (days,),
    )
    out = []
    for r in rows:
        stan = check_status({
            "visual": r["visual"], "tempChamber": r["temp_chamber"],
            "tempMeat": r["temp_meat"], "kgMatch": r["kg_match"],
            "verdict": r["verdict"],
        })
        if stan == "komplet":
            continue
        out.append({
            "receptionId": r["id"],
            "receptionNo": r["reception_no"],
            "supplierName": r["supplier_name"] or "",
            "receivedDate": r["received_date"].isoformat() if r["received_date"] else "",
            "status": stan,
        })
    return out


def checks_for_range(date_from: str, date_to: str) -> list:
    """Wpisy kontroli dla zakresu dat — źródło kolumn f-m karty 1.1.1.

    Zwraca też PODPISY, żeby karta miesiąca powstawała z jednego żądania.
    Podpisy unieważnione tu nie docierają: karta ma drukować pustą kratkę,
    a nie podpis pod treścią, która zmieniła się po podpisaniu.

    Tabela podpisów powstaje dopiero razem z podpisami elektronicznymi,
    więc do tego czasu pytamy o nią warunkowo — karta ma działać z samymi
    kolumnami f-k, zanim l-m w ogóle zaistnieją.
    """
    rows = query_all(
        """SELECT r.id, c.visual, c.temp_chamber, c.temp_meat, c.kg_match,
                  c.notes, c.verdict, c.nc_description, c.nc_action, c.nc_at
             FROM receptions r
             JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.received_date BETWEEN %s AND %s""",
        (date_from, date_to),
    )
    wg_dostawy: dict = {}
    if query_one("SELECT to_regclass('public.document_signatures') AS t")["t"]:
        podpisy = query_all(
            """SELECT s.doc_id, s.role, s.png, s.signer_name, s.signed_at
                 FROM document_signatures s
                 JOIN receptions r ON r.id = s.doc_id
                WHERE s.doc_type = 'reception_check'
                  AND s.superseded_at IS NULL
                  AND r.received_date BETWEEN %s AND %s""",
            (date_from, date_to),
        )
        for p in podpisy:
            wg_dostawy.setdefault(p["doc_id"], {})[p["role"]] = {
                "png": p["png"],
                "signerName": p["signer_name"],
                "signedAt": p["signed_at"].isoformat() if p["signed_at"] else None,
            }
    return [{
        "receptionId": r["id"],
        "visual": r["visual"],
        "tempChamber": _f(r["temp_chamber"]),
        "tempMeat": _f(r["temp_meat"]),
        "kgMatch": r["kg_match"],
        "notes": r["notes"] or "",
        "verdict": r["verdict"],
        "ncDescription": r["nc_description"] or "",
        "ncAction": r["nc_action"] or "",
        "ncAt": r["nc_at"].isoformat() if r["nc_at"] else None,
        "signatures": wg_dostawy.get(r["id"], {}),
    } for r in rows]
