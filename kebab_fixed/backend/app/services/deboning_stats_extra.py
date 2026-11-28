"""Sekcje statystyk rozbioru dla PROTRIMA (`deboning_stats(..., extended=True)`).

Spec: docs/superpowers/specs/2026-11-28-rozbior-statystyki-pulpit-zaladunek-design.md §B.

Zasada: każdy kilogram z JEDNEGO źródła, tymi samymi regułami co `deboning_stats`
(dzień = dzień POBRANIA wpisu; uboczne = palety `batch_byproducts` w dniu palety).
- mięso: porcje `deboning_take_weighings` wpisów z okresu (mięso z rozliczenia
  pracownika też tu trafia — `deboning_settlement_weighings` kind=meat to ta sama
  waga, więc jej nie liczymy); wpis bez porcji → `deboning_entries.weigh_mode`;
- grzbiety/kości: palety `batch_byproducts.*_pallets` (paleta rozliczenia pracownika
  ma `tareLabel` 'ręcznie' albo 'pracownik'); `tareLabel == 'ręcznie'` = ręcznie, inna
  tara = z wagi; palety sprzed 2026-07-07 (od kiedy ręczna paleta ma znacznik —
  commit 61b34120) = nieznane; kg bez palet i per-wpisowe kg_backs/kg_bones = nieznane;
- `office` = różnica między kg frakcji w `summary` a sumą ważeń — korekty biura.
NULL w trybie = nieznany: nigdy nie zgadujemy „z wagi”.
"""
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Set

from app.db import query_all

MARKER_CUTOFF = "2026-07-07"
FRACTIONS = ("meat", "backs", "bones")
MANUAL_LIST_LIMIT = 200


def _f(v) -> float:
    return float(v or 0)


def _mode(v: Optional[str]) -> str:
    return v if v in ("auto", "manual") else "unknown"


def _empty_fraction() -> Dict[str, Any]:
    return {"auto": {"n": 0, "kg": 0.0}, "manual": {"n": 0, "kg": 0.0},
            "unknown": {"n": 0, "kg": 0.0}, "office": {"kg": 0.0}}


def portions_by_entry(entry_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    if not entry_ids:
        return out
    for p in query_all(
        "SELECT entry_id, kg_meat, weigh_mode, COALESCE(meat_type, 'zs') AS meat_type, weighed_at "
        "FROM deboning_take_weighings WHERE entry_id = ANY(%s) ORDER BY weighed_at",
        (entry_ids,),
    ):
        out[p["entry_id"]].append(p)
    return out


def byproduct_pallets(date_from: str, date_to: str) -> List[Dict[str, Any]]:
    """Palety grzbietów/kości ważone w okresie (dzień palety, PL) + kg frakcji bez palet."""
    return query_all(
        """
        WITH pal AS (
            SELECT b.raw_batch_no AS bno, k.kind,
                   COALESCE((p->>'weighedAt')::timestamptz,
                            CASE k.kind WHEN 'backs' THEN b.backs_at ELSE b.bones_at END,
                            b.finished_at) AS at,
                   COALESCE((p->>'net')::numeric, 0) AS kg,
                   p->>'tareLabel' AS tare_label, p->>'workerId' AS worker_id,
                   p->>'workerName' AS worker_name, p->>'weighingId' AS weighing_id,
                   TRUE AS is_pallet
              FROM batch_byproducts b
              CROSS JOIN LATERAL (VALUES ('backs', b.backs_pallets), ('bones', b.bones_pallets)) k(kind, pallets)
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.pallets, '[]'::jsonb)) p
            UNION ALL
            SELECT b.raw_batch_no, k.kind, COALESCE(k.at, b.finished_at), COALESCE(k.kg, 0),
                   NULL, NULL, NULL, NULL, FALSE
              FROM batch_byproducts b
              CROSS JOIN LATERAL (VALUES ('backs', b.backs_pallets, b.backs_kg, b.backs_at),
                                         ('bones', b.bones_pallets, b.bones_kg, b.bones_at)) k(kind, pallets, kg, at)
             WHERE jsonb_array_length(COALESCE(k.pallets, '[]'::jsonb)) = 0 AND k.kg IS NOT NULL
        )
        SELECT bno, kind, at, kg, tare_label, worker_id, worker_name, weighing_id, is_pallet,
               (at AT TIME ZONE 'Europe/Warsaw')::date AS day
          FROM pal
         WHERE at IS NOT NULL
           AND (at AT TIME ZONE 'Europe/Warsaw')::date BETWEEN %s AND %s
        """,
        (date_from, date_to),
    )


def _pallet_mode(p: Dict[str, Any]) -> str:
    if not p["is_pallet"] or str(p["day"]) < MARKER_CUTOFF:
        return "unknown"
    return "manual" if (p.get("tare_label") or "") == "ręcznie" else "auto"


def _settlement_reasons(ids: Iterable[str]) -> Dict[str, str]:
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    return {r["id"]: r["reason"] or "" for r in query_all(
        "SELECT id, reason FROM deboning_settlement_weighings WHERE id = ANY(%s)", (ids,))}


def meat_by_type(entries: List[Dict[str, Any]], portions: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    """z/s i b/s osobno. Pobranie z porcjami obu rodzajów: ćwiartka i mięso wpisu
    dzielone proporcjonalnie do kg porcji (rodzaj z porcji — wpis ma typ ostatniej)."""
    acc = {"zs": [0.0, 0.0], "bs": [0.0, 0.0]}
    for e in entries:
        q, m = _f(e["kg_quarter"]), _f(e["kg_meat"])
        ps = portions.get(e["id"]) or []
        tot = sum(_f(p["kg_meat"]) for p in ps)
        if tot > 0:
            shares = defaultdict(float)
            for p in ps:
                shares[p["meat_type"] if p["meat_type"] == "bs" else "zs"] += _f(p["kg_meat"]) / tot
        else:
            shares = {("bs" if e.get("meat_type") == "bs" else "zs"): 1.0}
        for t, sh in shares.items():
            acc[t][0] += q * sh
            acc[t][1] += m * sh
    return {t: {"kgQuarter": round(v[0], 1), "kgMeat": round(v[1], 1),
                "yieldPct": round(v[1] / v[0] * 100, 1) if v[0] > 0 else None}
            for t, v in acc.items()}


def attach(result: Dict[str, Any], entries: List[Dict[str, Any]], backs_covered: Set[str],
           bones_covered: Set[str], date_from: str, date_to: str) -> None:
    """Dopisuje do odpowiedzi `deboning_stats`: weighing, manualList,
    summary.meatByType, workers[].weighings|manualWeighings|manualKg."""
    summary = result["summary"]
    portions = portions_by_entry([e["id"] for e in entries])
    weighing = {fr: _empty_fraction() for fr in FRACTIONS}
    per_worker: Dict[str, Dict[str, float]] = defaultdict(lambda: {"n": 0, "manual": 0, "manualKg": 0.0})
    manual: List[Dict[str, Any]] = []

    def add(fr: str, mode: str, kg: float, worker_key: Optional[str], item: Optional[Dict[str, Any]]):
        cell = weighing[fr][mode]
        cell["n"] += 1
        cell["kg"] += kg
        if worker_key:
            w = per_worker[worker_key]
            w["n"] += 1
            if mode == "manual":
                w["manual"] += 1
                w["manualKg"] += kg
        if mode == "manual" and item is not None:
            manual.append({**item, "fraction": fr, "kg": round(kg, 1)})

    # Mięso
    for e in entries:
        wkey = e["worker_id"] or e["worker_name"] or "—"
        base = {"workerName": e["worker_name"] or None, "batchNo": e["raw_batch_no"] or "—", "reason": ""}
        ps = portions.get(e["id"]) or []
        if ps:
            for p in ps:
                add("meat", _mode(p["weigh_mode"]), _f(p["kg_meat"]), wkey,
                    {**base, "at": p["weighed_at"].isoformat()})
        elif _f(e["kg_meat"]) > 0:
            at = e.get("completed_at") or e["at"]
            add("meat", _mode(e.get("weigh_mode")), _f(e["kg_meat"]), wkey,
                {**base, "at": at.isoformat() if at else None})

    # Grzbiety / kości — per-wpisowe tylko dla partii bez zbiorczego ważenia (jak deboning_stats)
    for e in entries:
        for fr, col, covered in (("backs", "kg_backs", backs_covered), ("bones", "kg_bones", bones_covered)):
            if e["raw_batch_no"] not in covered and _f(e[col]) > 0:
                add(fr, "unknown", _f(e[col]), e["worker_id"] or e["worker_name"] or "—", None)
    pallets = byproduct_pallets(date_from, date_to)
    reasons = _settlement_reasons(p["weighing_id"] for p in pallets if _pallet_mode(p) == "manual")
    for p in pallets:
        mode = _pallet_mode(p)
        add(p["kind"], mode, _f(p["kg"]), p["worker_id"],
            {"at": p["at"].isoformat(), "workerName": p["worker_name"] or None,
             "batchNo": p["bno"] or "—", "reason": reasons.get(p["weighing_id"] or "", "")})

    totals = {"meat": summary["kgMeat"], "backs": summary["kgBacks"], "bones": summary["kgBones"]}
    auto_kg = manual_kg = 0.0
    for fr in FRACTIONS:
        cell = weighing[fr]
        for m in ("auto", "manual", "unknown"):
            cell[m]["kg"] = round(cell[m]["kg"], 1)
        office = round(totals[fr] - cell["auto"]["kg"] - cell["manual"]["kg"] - cell["unknown"]["kg"], 1)
        cell["office"]["kg"] = 0.0 if abs(office) < 0.05 else office
        auto_kg += cell["auto"]["kg"]
        manual_kg += cell["manual"]["kg"]
    weighing["autoPct"] = round(auto_kg / (auto_kg + manual_kg) * 100, 1) if auto_kg + manual_kg > 0 else None
    weighing["manualCount"] = sum(weighing[fr]["manual"]["n"] for fr in FRACTIONS)

    result["weighing"] = weighing
    manual.sort(key=lambda x: x["at"] or "", reverse=True)
    result["manualList"] = manual[:MANUAL_LIST_LIMIT]
    summary["meatByType"] = meat_by_type(entries, portions)
    for w in result["workers"]:
        pw = per_worker.get(w["workerId"]) or {"n": 0, "manual": 0, "manualKg": 0.0}
        w["weighings"] = int(pw["n"])
        w["manualWeighings"] = int(pw["manual"])
        w["manualKg"] = round(pw["manualKg"], 1)
