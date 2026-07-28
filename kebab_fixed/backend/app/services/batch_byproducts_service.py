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

from app.db import (
    cx_execute,
    cx_query_all,
    cx_query_one,
    execute,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.utils.pallets import pallet_containers

logger = get_logger(__name__)

# Tolerancja bilansu masy ubocznych. Luka bilansu (ćwiartka − mięso − grzbiety
# − kości) POWYŻEJ tego progu trzyma partię na kaflu „niedoważona". Próg musi
# pokrywać NORMALNY ubytek procesowy (skóra/tłuszcz/ociek/ociek na wadze),
# który u tego klienta sięga ~1–3% ćwiartki. Dawny próg 1% flagował
# zbalansowane partie jako niedoważone i kusił operatora do doważenia
# FANTOMOWEJ palety ubocznych — często pod ZAMKNIĘTĄ/wysłaną partią, bo jej
# luka = dokładnie ubytek (incydent 428, 2026-07-24: 84 kg kości podpięte pod
# wysłaną partię). Floor w kg zabezpiecza małe partie. Realne niedoważenie
# (zapomniany wózek, zwykle >3%) nadal trzyma kafel.
BYPRODUCT_LOSS_TOL_PCT = 0.03
BYPRODUCT_LOSS_TOL_MIN_KG = 10.0


def _rescale_other_lots(conn, raw_batch_id: str) -> None:
    """Zważone zbiorczo frakcje kurczą loty „other" do realnej reszty.

    Lot „other" per wpis powstaje przy domknięciu wpisu jako CAŁY remainder
    (grzbiety/kości nieznane w tym momencie). Po zważeniu frakcji zbiorczych
    ta sama masa siedziała w lotach dwa razy (audyt 2026-07-22: partia 426 —
    1040 „other" + 581,5 grzbietów + 469 kości przy ~1050 kg realnej części
    niemięsnej) i zawyżała rejestr ABP ~2×. Cel: Σ other(open) =
    ćwiartka − mięso − grzbiety − kości − other już wydane/utylizowane.
    Idempotentne (drugi przebieg: factor=1)."""
    bb = cx_query_one(
        conn,
        "SELECT backs_kg, bones_kg FROM batch_byproducts WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    if not bb or (bb.get("backs_kg") is None and bb.get("bones_kg") is None):
        return
    sums = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_quarter) FILTER (WHERE COALESCE(status,'complete')='complete'),0) AS q, "
        "       COALESCE(SUM(kg_meat)    FILTER (WHERE COALESCE(status,'complete')='complete'),0) AS m "
        "FROM deboning_entries WHERE raw_batch_id=%s",
        (raw_batch_id,),
    ) or {}
    lots = cx_query_all(
        conn,
        "SELECT id, kg, status FROM byproduct_lots "
        "WHERE raw_batch_id=%s AND kind='other' AND deboning_entry_id IS NOT NULL "
        "FOR UPDATE",
        (raw_batch_id,),
    )
    open_lots = [l for l in lots if l.get("status") == "open"]
    if not open_lots:
        return
    closed = sum(float(l.get("kg") or 0) for l in lots if l.get("status") != "open")
    cur = sum(float(l.get("kg") or 0) for l in open_lots)
    if cur <= 0.0005:
        return
    target = max(
        0.0,
        float(sums.get("q") or 0) - float(sums.get("m") or 0)
        - float(bb.get("backs_kg") or 0) - float(bb.get("bones_kg") or 0)
        - closed,
    )
    factor = target / cur
    if abs(factor - 1.0) < 1e-9:
        return
    left = round(target, 3)
    for i, lot in enumerate(open_lots):
        kg = round(float(lot["kg"]) * factor, 3)
        if i == len(open_lots) - 1:
            kg = max(0.0, left)  # ostatni lot domyka sumę (bez dryfu zaokrągleń)
        left = round(left - kg, 3)
        cx_execute(conn, "UPDATE byproduct_lots SET kg=%s WHERE id=%s", (kg, lot["id"]))


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
        # Ręczne zamknięcie z biura — kafel zdjęty mimo otwartego bilansu.
        "closedAt": r["closed_at"].isoformat() if r.get("closed_at") else None,
        "closedBy": r.get("closed_by"),
        "closedReason": r.get("closed_reason"),
    }


def close_weighing(raw_batch_id: str, by: str = "", reason: str = "") -> Dict[str, Any]:
    """Zamknij ważenie ubocznych partii — kafel znika z HMI, kilogramy zostają.

    Potrzebne, gdy bilans masy zostaje otwarty ŚWIADOMIE: biuro skorygowało
    partię (np. usunęło paletę, której fizycznie nie było — 437, 28.07.2026)
    i wie, że nikt już nic nie doważy. Bez tego pending() trzyma kafel bez
    końca i operator widzi partię sprzed tygodni. Powód jest wymagany —
    zdjęcie kafla musi zostawiać ślad, kto uznał partię za rozliczoną."""
    if not (reason or "").strip():
        raise HTTPException(400, "Podaj powód zamknięcia — to ślad audytowy")
    with transaction() as conn:
        rec = cx_query_one(
            conn, "SELECT raw_batch_id FROM batch_byproducts WHERE raw_batch_id=%s FOR UPDATE",
            (raw_batch_id,),
        )
        if not rec:
            raise HTTPException(404, "Partia nie ma rekordu ubocznych")
        cx_execute(
            conn,
            "UPDATE batch_byproducts SET closed_at=now(), closed_by=%s, closed_reason=%s "
            "WHERE raw_batch_id=%s",
            (by or "", reason.strip(), raw_batch_id),
        )
    logger.info("byproducts.closed", extra={"raw_batch_id": raw_batch_id, "by": by})
    return get(raw_batch_id)


def reopen_weighing(raw_batch_id: str) -> Dict[str, Any]:
    """Cofnij zamknięcie — partia wraca na kafle (np. znalazła się paleta)."""
    execute(
        "UPDATE batch_byproducts SET closed_at=NULL, closed_by=NULL, closed_reason=NULL "
        "WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    return get(raw_batch_id)


def get(raw_batch_id: str) -> Optional[Dict[str, Any]]:
    return _row(query_one("SELECT * FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,)))


def finish_batch(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Zakończ rozbiór partii → rekord oczekujący na ważenie ubocznych.
    quarter_kg = suma ćwiartki tej partii (baza procentu). Idempotentne —
    ponowne wywołanie nie kasuje już zważonych frakcji."""
    with transaction() as conn:
        b = cx_query_one(
            conn, "SELECT internal_batch_no FROM raw_batches WHERE id=%s FOR UPDATE",
            (raw_batch_id,),
        )
        if not b:
            raise HTTPException(404, "Partia nie istnieje")
        # Partia z otwartym pobraniem NIE jest zakończona — ktoś czeka z mięsem
        # na wagę. Automat (_auto_finish_exhausted) sprawdzał to od dawna;
        # ręczne „Zakończ partię" z HMI mogło ostemplować finished_at mimo to.
        pending_take = cx_query_one(
            conn,
            "SELECT 1 FROM deboning_entries WHERE raw_batch_id=%s "
            "AND COALESCE(status,'complete')='pending' LIMIT 1",
            (raw_batch_id,),
        )
        if pending_take:
            raise HTTPException(
                400,
                "Partia ma otwarte pobrania (mięso czeka na wagę) — "
                "domknij je przed zakończeniem partii",
            )
        q = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
            (raw_batch_id,),
        )
        quarter = float(q["s"] or 0)
        existing = cx_query_one(
            conn,
            "SELECT raw_batch_id FROM batch_byproducts WHERE raw_batch_id=%s FOR UPDATE",
            (raw_batch_id,),
        )
        if existing:
            # Rekord mógł powstać przy ważeniu W TRAKCIE rozbioru (finished_at
            # NULL) — teraz partia się kończy: stempluj finished_at i przelicz
            # procenty względem pełnej ćwiartki (baza z ważeń w trakcie była
            # częściowa).
            cx_execute(
                conn,
                "UPDATE batch_byproducts SET "
                "  quarter_kg = GREATEST(COALESCE(quarter_kg,0), %s), "
                "  finished_at = COALESCE(finished_at, now()) "
                "WHERE raw_batch_id=%s",
                (quarter, raw_batch_id),
            )
            cx_execute(
                conn,
                "UPDATE batch_byproducts SET "
                "  backs_pct = CASE WHEN backs_kg IS NOT NULL AND quarter_kg > 0 "
                "    THEN ROUND(backs_kg / quarter_kg * 100, 2) ELSE backs_pct END, "
                "  bones_pct = CASE WHEN bones_kg IS NOT NULL AND quarter_kg > 0 "
                "    THEN ROUND(bones_kg / quarter_kg * 100, 2) ELSE bones_pct END "
                "WHERE raw_batch_id=%s",
                (raw_batch_id,),
            )
        else:
            cx_execute(
                conn,
                "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator) "
                "VALUES (%s,%s,%s,%s)",
                (raw_batch_id, b["internal_batch_no"], quarter, operator),
            )
        _rescale_other_lots(conn, raw_batch_id)
    return get(raw_batch_id)


def ensure_record(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Rekord ubocznych do ważenia W TRAKCIE rozbioru partii (przytrzymanie
    kafelka na HMI). NIE oznacza partii jako zakończonej — finished_at zostaje
    NULL aż do finish_batch, więc partia nie trafia na szare kafle pending()
    i auto-zakończenie przy wyczerpaniu ćwiartki działa normalnie."""
    existing = get(raw_batch_id)
    if existing:
        return existing
    with transaction() as conn:
        b = cx_query_one(
            conn, "SELECT internal_batch_no FROM raw_batches WHERE id=%s", (raw_batch_id,)
        )
        if not b:
            raise HTTPException(404, "Partia nie istnieje")
        q = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
            (raw_batch_id,),
        )
        cx_execute(
            conn,
            "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator, finished_at) "
            "VALUES (%s,%s,%s,%s,NULL) ON CONFLICT (raw_batch_id) DO NOTHING",
            (raw_batch_id, b["internal_batch_no"], float(q["s"] or 0), operator),
        )
    return get(raw_batch_id)


def pending() -> List[Dict[str, Any]]:
    """Szare kafle ważenia ubocznych. Dwie grupy:

    1. NIEDOWAŻONE (bilans masy otwarty) — bez filtra daty, przechodzą na
       kolejne dni: mięso + grzbiety + kości nie pokrywa ćwiartki
       (tolerancja BYPRODUCT_LOSS_TOL_PCT=3%, floor 10 kg — pokrywa NORMALNY
       ubytek procesowy 1–3%; dawny próg 1% flagował zbalansowane partie jako
       niedoważone i kusił do fantomowej palety, incydent 428 2026-07-24).
       Przedwczesne znikanie kafla w trakcie ważenia (2% na 7 t = 140 kg,
       prod 2026-07-09) blokuje teraz grupa 2 — dzisiejsza aktywność trzyma
       kafel niezależnie od bilansu, więc luźniejszy próg jest bezpieczny.
    2. ZAKOŃCZONE DZISIAJ (czas PL) — nawet z domkniętym bilansem: partia
       z dzisiejszego dnia musi dać się przywrócić/doważyć (balanced=True,
       kafel „zważona ✓ dotknij aby poprawić").

    Rekordy ważenia w trakcie rozbioru (finished_at NULL) nie wchodzą —
    partia jest wtedy nadal aktywnym kaflem."""
    rows = query_all(
        f"""
        SELECT b.*, COALESCE((
            SELECT SUM(kg_meat) FROM deboning_entries de
            WHERE de.raw_batch_id = b.raw_batch_id
              AND COALESCE(de.status, 'complete') = 'complete'
        ), 0) AS meat_sum
        FROM batch_byproducts b
        WHERE b.finished_at IS NOT NULL AND b.closed_at IS NULL AND (
            b.backs_kg IS NULL OR b.bones_kg IS NULL OR
            (COALESCE(b.quarter_kg, 0) - COALESCE((
                SELECT SUM(kg_meat) FROM deboning_entries de
                WHERE de.raw_batch_id = b.raw_batch_id
                  AND COALESCE(de.status, 'complete') = 'complete'
            ), 0) - COALESCE(b.backs_kg, 0) - COALESCE(b.bones_kg, 0))
            > GREATEST(COALESCE(b.quarter_kg, 0) * {BYPRODUCT_LOSS_TOL_PCT}, {BYPRODUCT_LOSS_TOL_MIN_KG})
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
            and missing <= max(quarter * BYPRODUCT_LOSS_TOL_PCT, BYPRODUCT_LOSS_TOL_MIN_KG)
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


def _pallet_rows(
    date_from: Optional[str] = None, date_to: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Palety grzbietów/kości zważone w zakresie dni (czas PL), po jednym
    wierszu na paletę; None = dzisiaj. JEDNO źródło dnia ważenia dla paska HMI
    (today_totals) i dziennika ważeń w biurze (list_weighings): paleta należy
    do dnia SWOJEGO ważenia, nie do dnia zakończenia partii — partia
    rozbierana przez kilka dni (411: 13–14.07) rozlicza każdą paletę osobno.
    Palety sprzed stemplowania (bez weighedAt) nie mają dnia — odpadają
    w WHERE."""
    return query_all(
        """
        SELECT bb.raw_batch_id, bb.raw_batch_no, k.kind, p.pallet, p.idx,
               ((p.pallet->>'weighedAt')::timestamptz AT TIME ZONE 'Europe/Warsaw')       AS "weighedAtLocal",
               ((p.pallet->>'weighedAt')::timestamptz AT TIME ZONE 'Europe/Warsaw')::date AS "dayLocal"
        FROM batch_byproducts bb
        CROSS JOIN LATERAL (VALUES
            ('backs', bb.backs_pallets), ('bones', bb.bones_pallets)
        ) AS k(kind, pallets)
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.pallets, '[]'::jsonb))
             WITH ORDINALITY AS p(pallet, idx)
        WHERE ((p.pallet->>'weighedAt')::timestamptz AT TIME ZONE 'Europe/Warsaw')::date
              BETWEEN COALESCE(%s::date, (now() AT TIME ZONE 'Europe/Warsaw')::date)
                  AND COALESCE(%s::date, (now() AT TIME ZONE 'Europe/Warsaw')::date)
        ORDER BY (p.pallet->>'weighedAt')::timestamptz
        """,
        (date_from, date_to),
    )


def list_weighings(date_from: str, date_to: str) -> Dict[str, Any]:
    """Dziennik ważeń ubocznych dla biura — każda zważona PALETA grzbietów
    i kości z audytem wagi (brutto − tara palety − pojemniki E2 = netto).
    Odpowiednik deboning_service.list_take_weighings dla mięsa; biuro ma trzy
    zakładki jednego dziennika: Mięso / Grzbiety / Kości."""
    data: List[Dict[str, Any]] = []
    for r in _pallet_rows(date_from, date_to):
        p = r["pallet"] or {}
        data.append({
            # klucz wiersza: rekord ubocznych jest JEDEN na (partia, frakcja),
            # więc pozycja palety w tablicy identyfikuje ważenie jednoznacznie
            "id":             f"{r['raw_batch_id']}:{r['kind']}:{r['idx']}",
            "rawBatchId":     r["raw_batch_id"],
            "rawBatchNo":     r["raw_batch_no"],
            "kind":           r["kind"],
            "weighedAtLocal": r["weighedAtLocal"],
            "dayLocal":       r["dayLocal"],
            "tareLabel":      p.get("tareLabel") or "",
            "tareKg":         float(p.get("tareKg") or 0),
            "containers":     int(p.get("containers") or 0),
            "kgGross":        round(float(p.get("gross") or 0), 2),
            "netKg":          round(float(p.get("net") or 0), 2),
        })
    return {"data": data}


def today_totals() -> Dict[str, Any]:
    """Dzisiejsze ważenia grzbietów/kości (czas PL) — pasek dolny HMI + modal
    listy ważeń. Suma i lista liczone z PALET po ich weighedAt (patrz
    _pallet_rows) — partia ważona przez kilka dni rozlicza każdą paletę w JEJ
    dniu. Poprzednia wersja sumowała narastające backs_kg/bones_kg po
    backs_at/bones_at, przez co CAŁA frakcja wpadała do dnia OSTATNIEGO
    ważenia."""
    rows = _pallet_rows()
    weighings: List[Dict[str, Any]] = []
    backs = bones = 0.0
    for r in rows:
        p = r["pallet"] or {}
        net = float(p.get("net") or 0)
        if r["kind"] == "backs":
            backs += net
        else:
            bones += net
        weighings.append({
            "kind": r["kind"],
            "rawBatchNo": r["raw_batch_no"],
            "weighedAt": p.get("weighedAt"),
            "tareLabel": p.get("tareLabel") or "",
            "containers": int(p.get("containers") or 0),
            "netKg": round(net, 2),
        })
    return {"backsKg": round(backs, 2), "bonesKg": round(bones, 2), "weighings": weighings}


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
    # JEDNA transakcja + lock rekordu partii i lotów frakcji. Wcześniej trzy
    # auto-commity (UPDATE frakcji, DELETE lotu, INSERT lotu) — crash w środku
    # albo wyścig z równoległym wydaniem WZ (konsumuje loty) zostawiał
    # niespójność frakcja↔lot (ta sama klasa co incydent 411: 2252,5 kg).
    with transaction() as conn:
        rec = cx_query_one(
            conn,
            f"SELECT quarter_kg, raw_batch_no, {kind}_pallets AS old_pallets, "
            f"       {kind}_kg AS old_kg "
            "FROM batch_byproducts WHERE raw_batch_id=%s FOR UPDATE",
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
        # FOR UPDATE na lotach: WZ w locie nie może zmienić stanu między
        # naszym odczytem a podmianą lotu.
        cx_query_all(
            conn,
            "SELECT id FROM byproduct_lots WHERE raw_batch_id=%s AND kind=%s "
            "AND deboning_entry_id IS NULL FOR UPDATE",
            (raw_batch_id, kind),
        )
        live = cx_query_one(
            conn,
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

        # Doważenie po zamknięciu (znalazła się paleta) OTWIERA partię z
        # powrotem — inaczej zamknięcie na zawsze chowałoby realne
        # niedoważenie, a operator nie miałby jak wrócić do kafla.
        cx_execute(
            conn,
            f"UPDATE batch_byproducts SET {kind}_kg=%s, {kind}_pct=%s, {kind}_pallets=%s, "
            f"{kind}_at=now(), closed_at=NULL, closed_by=NULL, closed_reason=NULL "
            "WHERE raw_batch_id=%s",
            (round(kg, 3), pct, json.dumps(pallets or []), raw_batch_id),
        )
        # Lot ABP w magazynie produktów ubocznych — żeby zważone zbiorczo grzbiety/
        # kości trafiły do MES z traceability partii (partia→lot→utylizacja przez
        # /api/byproducts). Lot zbiorczy: deboning_entry_id NULL, powiązany z partią.
        # Idempotentne: nadpisujemy poprzedni otwarty lot tej partii+frakcji.
        cx_execute(
            conn,
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
            cx_execute(
                conn,
                "INSERT INTO byproduct_lots (id, deboning_entry_id, raw_batch_id, "
                "raw_batch_no, kind, kg, status, containers_available, created_at) "
                "VALUES (%s, NULL, %s, %s, %s, %s, 'open', %s, now())",
                (cuid(), raw_batch_id, rec["raw_batch_no"], kind, new_kg, new_available),
            )
        _rescale_other_lots(conn, raw_batch_id)
    return get(raw_batch_id)
