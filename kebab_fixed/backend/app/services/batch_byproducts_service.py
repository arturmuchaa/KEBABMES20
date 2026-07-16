"""Ważenie zbiorcze produktów ubocznych partii (grzbiety + kości) po rozbiorze.

Osobny od byproducts_service (loty ABP / utylizacja). Tu operator hali waży
ZBIORCZO grzbiety i kości zakończonej partii — paletami na wadze najazdowej
(tara palety + pojemniki × 2 kg), a system liczy % względem ćwiartki tej partii.
Stan przeżywa zamknięcie dnia i przechodzi na kolejne dni aż do dokończenia.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.utils.pallets import pallet_containers

logger = get_logger(__name__)


def _stamp_pallets(pallets: Optional[list]) -> List[Dict[str, Any]]:
    """Ostempluj czasem ważenia palety, które go jeszcze nie mają.

    Kreator odsyła przy każdym zapisie CAŁĄ listę palet frakcji (sumę
    narastającą), więc palety z poprzednich ważeń przychodzą ze swoim
    stemplem i zostają nietknięte — tylko nowa paleta dostaje „teraz".
    Dzięki temu partia rozbierana i ważona przez kilka dni (411: 13–14.07)
    rozlicza każdą paletę w JEJ dniu, zamiast wrzucać całe uboczne do dnia
    zakończenia partii (raport pokazywał wtedy 137% bilansu masy).
    """
    now = datetime.now(timezone.utc).isoformat()
    out: List[Dict[str, Any]] = []
    for p in pallets or []:
        q = dict(p)
        if not q.get("weighedAt"):
            q["weighedAt"] = now
        out.append(q)
    return out


def _row(r: Optional[Dict]) -> Optional[Dict[str, Any]]:
    if not r:
        return None
    return {
        "rawBatchId": r["raw_batch_id"],
        "rawBatchNo": r["raw_batch_no"],
        "quarterKg": float(r["quarter_kg"] or 0),
        "backsKg": None if r["backs_kg"] is None else float(r["backs_kg"]),
        "bonesKg": None if r["bones_kg"] is None else float(r["bones_kg"]),
        "backsPct": None if r["backs_pct"] is None else float(r["backs_pct"]),
        "bonesPct": None if r["bones_pct"] is None else float(r["bones_pct"]),
        "backsDone": r["backs_kg"] is not None,
        "bonesDone": r["bones_kg"] is not None,
        "finishedAt": r["finished_at"].isoformat() if r["finished_at"] else None,
        "backsAt": r["backs_at"].isoformat() if r.get("backs_at") else None,
        "bonesAt": r["bones_at"].isoformat() if r.get("bones_at") else None,
        # Palety poprzednich ważeń — kreator doładowuje je do sumy przy
        # ważeniu w trakcie rozbioru (kolejna paleta dolicza, nie nadpisuje).
        "backsPallets": r.get("backs_pallets") or [],
        "bonesPallets": r.get("bones_pallets") or [],
    }


def get(raw_batch_id: str) -> Optional[Dict[str, Any]]:
    return _row(query_one("SELECT * FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,)))


def finish_batch(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Zakończ rozbiór partii → rekord oczekujący na ważenie ubocznych.
    quarter_kg = suma ćwiartki tej partii (baza procentu). Idempotentne —
    ponowne wywołanie nie kasuje już zważonych frakcji."""
    b = query_one("SELECT internal_batch_no FROM raw_batches WHERE id=%s", (raw_batch_id,))
    if not b:
        raise HTTPException(404, "Partia nie istnieje")
    q = query_one(
        "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    quarter = float(q["s"] or 0)
    existing = query_one("SELECT raw_batch_id FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,))
    if existing:
        # Rekord mógł powstać przy ważeniu W TRAKCIE rozbioru (finished_at
        # NULL) — teraz partia się kończy: stempluj finished_at i przelicz
        # procenty względem pełnej ćwiartki (baza z ważeń w trakcie była
        # częściowa).
        execute(
            "UPDATE batch_byproducts SET "
            "  quarter_kg = GREATEST(COALESCE(quarter_kg,0), %s), "
            "  finished_at = COALESCE(finished_at, now()) "
            "WHERE raw_batch_id=%s",
            (quarter, raw_batch_id),
        )
        execute(
            "UPDATE batch_byproducts SET "
            "  backs_pct = CASE WHEN backs_kg IS NOT NULL AND quarter_kg > 0 "
            "    THEN ROUND(backs_kg / quarter_kg * 100, 2) ELSE backs_pct END, "
            "  bones_pct = CASE WHEN bones_kg IS NOT NULL AND quarter_kg > 0 "
            "    THEN ROUND(bones_kg / quarter_kg * 100, 2) ELSE bones_pct END "
            "WHERE raw_batch_id=%s",
            (raw_batch_id,),
        )
    else:
        execute(
            "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator) "
            "VALUES (%s,%s,%s,%s)",
            (raw_batch_id, b["internal_batch_no"], quarter, operator),
        )
    return get(raw_batch_id)


def ensure_record(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Rekord ubocznych do ważenia W TRAKCIE rozbioru partii (przytrzymanie
    kafelka na HMI). NIE oznacza partii jako zakończonej — finished_at zostaje
    NULL aż do finish_batch, więc partia nie trafia na szare kafle pending()
    i auto-zakończenie przy wyczerpaniu ćwiartki działa normalnie."""
    existing = get(raw_batch_id)
    if existing:
        return existing
    b = query_one("SELECT internal_batch_no FROM raw_batches WHERE id=%s", (raw_batch_id,))
    if not b:
        raise HTTPException(404, "Partia nie istnieje")
    q = query_one(
        "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    execute(
        "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator, finished_at) "
        "VALUES (%s,%s,%s,%s,NULL)",
        (raw_batch_id, b["internal_batch_no"], float(q["s"] or 0), operator),
    )
    return get(raw_batch_id)


def pending() -> List[Dict[str, Any]]:
    """Szare kafle ważenia ubocznych. Dwie grupy:

    1. NIEDOWAŻONE (bilans masy otwarty) — bez filtra daty, przechodzą na
       kolejne dni: mięso + grzbiety + kości nie pokrywa ćwiartki
       (tolerancja 1%, min 10 kg — 2% przy 7 t dawało 140 kg i kafel
       znikał w trakcie ważenia kości, prod 2026-07-09).
    2. ZAKOŃCZONE DZISIAJ (czas PL) — nawet z domkniętym bilansem: partia
       z dzisiejszego dnia musi dać się przywrócić/doważyć (balanced=True,
       kafel „zważona ✓ dotknij aby poprawić").

    Rekordy ważenia w trakcie rozbioru (finished_at NULL) nie wchodzą —
    partia jest wtedy nadal aktywnym kaflem."""
    rows = query_all(
        """
        SELECT b.*, COALESCE((
            SELECT SUM(kg_meat) FROM deboning_entries de
            WHERE de.raw_batch_id = b.raw_batch_id
              AND COALESCE(de.status, 'complete') = 'complete'
        ), 0) AS meat_sum
        FROM batch_byproducts b
        WHERE b.finished_at IS NOT NULL AND (
            b.backs_kg IS NULL OR b.bones_kg IS NULL OR
            (COALESCE(b.quarter_kg, 0) - COALESCE((
                SELECT SUM(kg_meat) FROM deboning_entries de
                WHERE de.raw_batch_id = b.raw_batch_id
                  AND COALESCE(de.status, 'complete') = 'complete'
            ), 0) - COALESCE(b.backs_kg, 0) - COALESCE(b.bones_kg, 0))
            > GREATEST(COALESCE(b.quarter_kg, 0) * 0.01, 10)
            -- JAKAKOLWIEK dzisiejsza aktywność trzyma kafel (nie znika
            -- samoczynnie w dniu pracy nad partią):
            OR (b.finished_at AT TIME ZONE 'Europe/Warsaw')::date
               = (now() AT TIME ZONE 'Europe/Warsaw')::date
            OR (b.backs_at AT TIME ZONE 'Europe/Warsaw')::date
               = (now() AT TIME ZONE 'Europe/Warsaw')::date
            OR (b.bones_at AT TIME ZONE 'Europe/Warsaw')::date
               = (now() AT TIME ZONE 'Europe/Warsaw')::date
        )
        ORDER BY b.finished_at
        """
    )
    out = []
    for r in rows:
        d = _row(r)
        quarter = float(r.get("quarter_kg") or 0)
        missing = (
            quarter
            - float(r.get("meat_sum") or 0)
            - float(r.get("backs_kg") or 0)
            - float(r.get("bones_kg") or 0)
        )
        d["missingKg"] = round(max(0.0, missing), 1)
        # Bilans domknięty = kafel tylko „do przywrócenia" (dzisiejsza partia).
        d["balanced"] = (
            r.get("backs_kg") is not None
            and r.get("bones_kg") is not None
            and missing <= max(quarter * 0.01, 10)
        )
        out.append(d)
    return out


def list_all() -> List[Dict[str, Any]]:
    """Wszystkie rekordy zbiorczego ważenia — magazyn surowca w biurze
    (zakładki Grzbiety/Kości) scala je z per-wpisowymi kg_backs/kg_bones."""
    rows = query_all(
        "SELECT * FROM batch_byproducts "
        "ORDER BY COALESCE(finished_at, backs_at, bones_at) DESC NULLS LAST"
    )
    return [_row(r) for r in rows]


def today_totals() -> Dict[str, float]:
    """Suma zbiorczo zważonych grzbietów/kości z DZISIAJ (czas PL) — pasek
    dolny HMI. Frakcja liczy się w dniu jej zważenia (backs_at/bones_at)."""
    r = query_one(
        "SELECT "
        "  COALESCE(SUM(backs_kg) FILTER (WHERE (backs_at AT TIME ZONE 'Europe/Warsaw')::date "
        "    = (now() AT TIME ZONE 'Europe/Warsaw')::date), 0) AS backs, "
        "  COALESCE(SUM(bones_kg) FILTER (WHERE (bones_at AT TIME ZONE 'Europe/Warsaw')::date "
        "    = (now() AT TIME ZONE 'Europe/Warsaw')::date), 0) AS bones "
        "FROM batch_byproducts"
    )
    return {"backsKg": float(r["backs"] or 0), "bonesKg": float(r["bones"] or 0)}


def record(raw_batch_id: str, kind: str, kg: float, pallets: Optional[list] = None) -> Dict[str, Any]:
    """Zapisz zważoną frakcję (backs|bones): kg + wyliczony % + szczegóły palet.

    Pojemniki: byproduct_lots.containers_available to ŻYWY licznik (maleje
    przy wydaniu WZ). Ta funkcja bywa wołana WIELOKROTNIE w ciągu dnia
    (kolejne palety dokładane na wadze) i za każdym razem PODMIENIA lot
    (DELETE+INSERT) — bez poniższego zabiegu ponowne ważenie resetowałoby
    licznik do pełnej liczby palet, kasując już wydane pojemniki. Liczymy
    więc, ile już skonsumowano (stara suma z palet − stary licznik) i
    odejmujemy TĘ SAMĄ liczbę od nowej sumy z palet.
    """
    if kind not in ("backs", "bones"):
        raise HTTPException(400, "kind musi być 'backs' albo 'bones'")
    rec = query_one(
        f"SELECT quarter_kg, raw_batch_no, {kind}_pallets AS old_pallets, "
        f"       {kind}_kg AS old_kg "
        "FROM batch_byproducts WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    if not rec:
        raise HTTPException(404, "Partia nie została zakończona (brak rekordu ubocznych)")
    quarter = float(rec["quarter_kg"] or 0)
    pct = round(kg / quarter * 100, 2) if quarter > 0 else 0.0
    pallets = _stamp_pallets(pallets)

    # Ile z poprzednio zważonej frakcji JUŻ WYJECHAŁO (WZ / utylizacja).
    # Loty tej partii+frakcji są ŻYWYM stanem — wydanie zdejmuje z lotu kg
    # i pojemniki (0 kg → 'shipped'). Kreator przysyła sumę NARASTAJĄCĄ całej
    # frakcji, więc na magazyn wolno wstawić tylko to, czego jeszcze nie
    # wydano. Bez tego wydane kg wracały na stan drugi raz: 411/kości —
    # 1027,5 kg wyjechało 13.07 (lot 'shipped'), a doważenie 14.07 wstawiało
    # lot na PEŁNE 1225 kg; po anulowaniu tamtej WZ (lot wraca) partia miała
    # 2252,5 kg przy realnych 1225 kg (WZ/9 + WZ/10, prod 2026-07-14).
    # Liczymy po WSZYSTKICH lotach frakcji (też 'shipped'), bo DELETE niżej
    # zdejmuje wyłącznie otwarte — wydane zostają jako ślad dla WZ.
    live = query_one(
        "SELECT COUNT(*) AS n, COALESCE(SUM(kg),0) AS kg, "
        "       COUNT(containers_available) AS n_cont, "
        "       COALESCE(SUM(containers_available),0) AS cont "
        "FROM byproduct_lots WHERE raw_batch_id=%s AND kind=%s "
        "AND deboning_entry_id IS NULL",
        (raw_batch_id, kind),
    )
    consumed_kg = 0.0
    consumed = 0
    if live is not None and int(live["n"] or 0) > 0:
        consumed_kg = max(0.0, float(rec.get("old_kg") or 0) - float(live["kg"] or 0))
        if int(live["n_cont"] or 0) > 0:
            consumed = max(0, pallet_containers(rec.get("old_pallets")) - int(live["cont"] or 0))

    execute(
        f"UPDATE batch_byproducts SET {kind}_kg=%s, {kind}_pct=%s, {kind}_pallets=%s, "
        f"{kind}_at=now() WHERE raw_batch_id=%s",
        (round(kg, 3), pct, json.dumps(pallets or []), raw_batch_id),
    )
    # Lot ABP w magazynie produktów ubocznych — żeby zważone zbiorczo grzbiety/
    # kości trafiły do MES z traceability partii (partia→lot→utylizacja przez
    # /api/byproducts). Lot zbiorczy: deboning_entry_id NULL, powiązany z partią.
    # Idempotentne: nadpisujemy poprzedni otwarty lot tej partii+frakcji.
    execute(
        "DELETE FROM byproduct_lots WHERE raw_batch_id=%s AND kind=%s "
        "AND deboning_entry_id IS NULL AND status='open'",
        (raw_batch_id, kind),
    )
    # Na stan idzie zważona suma MINUS to, co już wyjechało. batch_byproducts
    # (wyżej) trzyma PEŁNĄ wagę frakcji — to rekord ważenia i baza procentów,
    # nie stan magazynowy.
    new_kg = round(max(0.0, kg - consumed_kg), 3)
    if new_kg > 0:
        new_available = max(0, pallet_containers(pallets) - consumed)
        execute(
            "INSERT INTO byproduct_lots (id, deboning_entry_id, raw_batch_id, "
            "raw_batch_no, kind, kg, status, containers_available, created_at) "
            "VALUES (%s, NULL, %s, %s, %s, %s, 'open', %s, now())",
            (cuid(), raw_batch_id, rec["raw_batch_no"], kind, new_kg, new_available),
        )
    return get(raw_batch_id)
