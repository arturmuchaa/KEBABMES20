"""Tempo produkcji — uczone z zakończonych dni, czytane przez prognozę.

Model przypisania godzin: praca między dwoma kolejnymi zapisami poszła w to,
co WŁAŚNIE zapisano. Pozycje przeplatają się w ciągu dnia, więc z sum dobowych
nie da się rozdzielić godzin między receptury.

Trzymamy PRÓBKI (jedna na dzień i recepturę), a nie gotową średnią wykładniczą:
`tablet_reopen` pozwala cofnąć zamknięcie dnia i zamknąć go ponownie, a średniej
doliczanej przyrostowo nie da się cofnąć — dzień liczyłby się drugi raz.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.db import execute, query_all, query_one
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Sufit na przerwę, której nikt nie odnotował. Bez niego jedna czterogodzinna
#: dziura (awaria, brak surowca) wywraca tempo całego dnia.
MAX_GAP_MIN = 30.0
#: Waga kurczenia do rodzica — przy pierwszym dniu receptura waży 1/3.
K = 2.0
#: Okno próbek. Hala zmienia obsadę i maszyny.
OKNO_DNI = 90
SEED_KEY = "production.seed_kg_per_person_hour"
BREAK_KEY = "production.planned_break_minutes"
DOMYSLNE_ZIARNO = 120.0


def _overlap_min(od: datetime, do: datetime, breaks: List[Tuple]) -> float:
    """Ile minut przedziału [od, do] przypada na przerwy."""
    total = 0.0
    for b_od, b_do in breaks or []:
        if not b_od:
            continue
        koniec = b_do or do
        start = max(od, b_od)
        stop = min(do, koniec)
        if stop > start:
            total += (stop - start).total_seconds() / 60.0
    return total


def person_hours_by_recipe(
    events: List[Dict[str, Any]],
    breaks: List[Tuple],
    max_gap_min: float = MAX_GAP_MIN,
) -> Dict[str, Dict[str, float]]:
    """Kilogramy i roboczogodziny per receptura z jednego dnia."""
    out: Dict[str, Dict[str, float]] = {}
    poprzednie: Optional[datetime] = None
    for e in sorted(events or [], key=lambda x: x["at"]):
        teraz = e["at"]
        if poprzednie is None:
            # Pierwsze zdarzenie tylko ustawia zegar: nie wiadomo, kiedy
            # zaczęła się praca, która do niego doprowadziła.
            poprzednie = teraz
            continue
        sztuk = int(e.get("pieces_delta") or 0)
        if sztuk <= 0:
            poprzednie = teraz          # korekta nie jest pracą, ale zjada czas
            continue
        minut = (teraz - poprzednie).total_seconds() / 60.0
        minut -= _overlap_min(poprzednie, teraz, breaks)
        minut = max(0.0, min(minut, max_gap_min))
        rid = str(e.get("recipe_id") or "")
        wpis = out.setdefault(rid, {"kg": 0.0, "personHours": 0.0})
        wpis["kg"] += sztuk * float(e.get("kg_per_unit") or 0)
        wpis["personHours"] += (minut / 60.0) * int(e.get("crew_size") or 0)
        poprzednie = teraz
    return out


def learn_from_plan(plan_id: str) -> Dict[str, Any]:
    """Policz próbki tempa z zakończonego dnia. UPSERT — odporne na powtórzenie."""
    plan = query_one("SELECT id, plan_date FROM production_plans WHERE id=%s", (plan_id,))
    if not plan:
        return {"ok": False, "recipes": 0}
    events = query_all(
        "SELECT at, recipe_id, pieces_delta, kg_per_unit, crew_size "
        "FROM production_work_events WHERE plan_id=%s ORDER BY at",
        (plan_id,),
    )
    breaks = [
        (r["started_at"], r["ended_at"])
        for r in query_all(
            "SELECT started_at, ended_at FROM production_breaks WHERE plan_id=%s",
            (plan_id,),
        )
    ]
    rozbicie = person_hours_by_recipe(events, breaks)
    ile = 0
    for rid, v in rozbicie.items():
        if v["personHours"] <= 0 or v["kg"] <= 0:
            continue                    # dzielenie przez zero — próbka bezwartościowa
        execute(
            """
            INSERT INTO production_rate_samples
                (plan_id, recipe_id, plan_date, kg, person_hours, computed_at)
            VALUES (%s,%s,%s,%s,%s, now())
            ON CONFLICT (plan_id, recipe_id) DO UPDATE
            SET kg = EXCLUDED.kg,
                person_hours = EXCLUDED.person_hours,
                plan_date = EXCLUDED.plan_date,
                computed_at = now()
            """,
            (plan_id, rid, plan.get("plan_date"), v["kg"], v["personHours"]),
        )
        ile += 1
    logger.info("production.rates_learned", extra={"plan_id": plan_id, "recipes": ile})
    return {"ok": True, "recipes": ile}


def shrink(srednia: float, n: int, rodzic: float, k: float = K) -> float:
    """Kurczenie do rodzica: (n·swoje + k·rodzica) / (n + k).

    Wybrane zamiast twardego progu („receptura liczy się od 3. dnia"), bo próg
    dawałby skok prognozy w dniu przejścia. Tu waga rośnie płynnie: przy
    pierwszym dniu receptura waży 1/3, po pięciu 5/7.
    """
    n = max(0, int(n))
    if n <= 0:
        return float(rodzic)
    return (n * float(srednia) + k * float(rodzic)) / (n + k)


def _setting(key: str, domyslne: float) -> float:
    row = query_one("SELECT value FROM app_settings WHERE key=%s", (key,))
    if not row:
        return domyslne
    try:
        return float(row["value"])
    except (TypeError, ValueError):
        return domyslne


def current_rates() -> Dict[str, Any]:
    """Tempa do prognozy: ziarno, globalne i per receptura (już skurczone)."""
    ziarno = _setting(SEED_KEY, DOMYSLNE_ZIARNO)
    granica = (datetime.now() - timedelta(days=OKNO_DNI)).date()
    rows = query_all(
        "SELECT recipe_id, kg, person_hours FROM production_rate_samples "
        "WHERE person_hours > 0 AND (plan_date IS NULL OR plan_date >= %s)",
        (granica,),
    )

    kg_all = sum(float(r["kg"]) for r in rows)
    rbh_all = sum(float(r["person_hours"]) for r in rows)
    globalne = shrink(kg_all / rbh_all if rbh_all > 0 else 0.0, len(rows), ziarno)

    per: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        per.setdefault(str(r["recipe_id"] or ""), []).append(r)

    by_recipe: Dict[str, float] = {}
    for rid, lista in per.items():
        if not rid:
            continue
        kg = sum(float(x["kg"]) for x in lista)
        rbh = sum(float(x["person_hours"]) for x in lista)
        by_recipe[rid] = shrink(kg / rbh if rbh > 0 else 0.0, len(lista), globalne)

    return {
        "seed": ziarno,
        "global": globalne,
        "plannedBreakMinutes": _setting(BREAK_KEY, 30.0),
        "byRecipe": by_recipe,
    }
