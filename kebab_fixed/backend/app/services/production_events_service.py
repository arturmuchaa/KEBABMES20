"""Log zapisów sztuk — jedyny ślad czasowy przebiegu dnia produkcyjnego.

Bez tego logu po dniu nie zostaje nic, z czego dałoby się liczyć tempo:
`progress_updated_at` trzyma tylko OSTATNI zapis pozycji, a
`worker_entries[].addedAt` tylko PIERWSZY wpis danej osoby na pozycji.

Zdarzenia z ujemną deltą (korekty) też zapisujemy — nie są pracą i nie wchodzą
do uczenia, ale bez nich nie da się później odtworzyć, co się na hali działo.
"""
from typing import Any, Dict, List, Tuple

from app.db import cx_execute, cx_query_one
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def changed_worker(
    old_entries: List[Dict[str, Any]], new_entries: List[Dict[str, Any]]
) -> Tuple[str, str]:
    """Kto stoi za tym zapisem — osoba, której liczba sztuk się zmieniła.

    HMI zmienia przy jednym zapisie DOKŁADNIE jedną osobę, więc różnica list
    wskazuje ją jednoznacznie. Gdy ruszyły się dwie (przepisanie sztuk), nie ma
    komu zaliczyć pracy i zwracamy pustkę — to nie jest praca, tylko zmiana
    przypisania.
    """
    def suma(entries):
        out: Dict[str, Tuple[str, int]] = {}
        for e in entries or []:
            wid = str(e.get("workerId") or "")
            if not wid:
                continue
            nazwa, ile = out.get(wid, ("", 0))
            out[wid] = (str(e.get("workerName") or nazwa), ile + int(e.get("pieces") or 0))
        return out

    a, b = suma(old_entries), suma(new_entries)
    zmienione = [
        wid for wid in set(a) | set(b)
        if a.get(wid, ("", 0))[1] != b.get(wid, ("", 0))[1]
    ]
    if len(zmienione) != 1:
        return ("", "")
    wid = zmienione[0]
    nazwa = b.get(wid, ("", 0))[0] or a.get(wid, ("", 0))[0]
    return (wid, nazwa)


def crew_size(conn, plan_id: str) -> int:
    """Ilu ludzi UKŁADA dziś na tym planie — liczone z żywych wpisów.

    Załoga zmienia się w ciągu dnia (ktoś odchodzi na foliowanie), więc
    prognoza ma płynąć razem z nią, a nie stać na kartotece działu.
    """
    row = cx_query_one(
        conn,
        """
        SELECT count(DISTINCT e->>'workerId') AS n
        FROM production_plan_lines l
        CROSS JOIN LATERAL jsonb_array_elements(l.worker_entries) AS e
        WHERE l.plan_id = %s
          AND COALESCE(e->>'workerId','') <> ''
          AND COALESCE((e->>'pieces')::int, 0) > 0
        """,
        (plan_id,),
    )
    return int((row or {}).get("n") or 0)


def record_work_event(
    conn,
    plan_id: str,
    line: Dict[str, Any],
    pieces_delta: int,
    worker_id: str,
    worker_name: str,
) -> None:
    """Dopisz zdarzenie w TRWAJĄCEJ transakcji zapisu postępu.

    Ta sama transakcja co `qty_done` — inaczej log rozjechałby się z postępem
    przy błędzie zapisu, a uczenie liczyłoby pracę, której nie ma.
    """
    if not pieces_delta:
        return
    cx_execute(
        conn,
        """
        INSERT INTO production_work_events
            (id, plan_id, plan_line_id, recipe_id, recipe_name, kg_per_unit,
             pieces_delta, worker_id, worker_name, crew_size, at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        """,
        (
            cuid(), plan_id, line.get("id"),
            line.get("recipe_id") or "", line.get("recipe_name") or "",
            float(line.get("kg_per_unit") or 0), int(pieces_delta),
            worker_id or "", worker_name or "",
            crew_size(conn, plan_id),
        ),
    )
