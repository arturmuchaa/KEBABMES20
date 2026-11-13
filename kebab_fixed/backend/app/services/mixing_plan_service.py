"""Plan masowania w PROTRIMA (13.11.2026): potrzeby z zamówień, zaległe zlecenia,
przeniesienie zlecenia na inny dzień.

Stary ekran planowania pokazywał mięso i przyprawy, ale nie mówił, CO masować:
planista przeliczał zamówienia na kilogramy mięsa w głowie albo na kartce.
Tu liczy to serwer, tą samą drogą co „Zapotrzebowanie na surowiec"
(`material_requirements_service`), tylko rozbite per receptura.

Księgowania (rezerwacje, finish, undo, cancel) zostają w `mixing_service` —
ten moduł niczego w nich nie zmienia.
"""
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.services import material_requirements_service as mrs
from app.services.mixing_service import _today_iso, build_mixing_order

logger = get_logger(__name__)

def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    return v.isoformat()[:10] if hasattr(v, "isoformat") else str(v)[:10]


def _r1(v: float) -> float:
    return round(float(v or 0), 1)


# ── Potrzeby z zamówień ───────────────────────────────────────────────────

def bilans_receptury(
    zamowione_kg: float, wolny_polprodukt_kg: float, w_planie_produkcji_kg: float,
    w_planie_masowania_kg: float,
) -> Dict[str, float]:
    """Ile półproduktu jeszcze trzeba zamasować pod otwarte zamówienia.

    zamówione (niezrobiona część zamówień, kg wyrobu = kg półproduktu)
      − wolny półprodukt na stanie
      − plan produkcji w toku (jego mięso przyprawione jest już zarezerwowane)
      − masowania już zaplanowane, a niewykonane
      = brak.

    Czysta funkcja — te same odejmowania co `compute_reduced_need`, plus
    masowania w planie, których tamten rachunek nie zna.
    """
    pokryte = max(0.0, wolny_polprodukt_kg) + max(0.0, w_planie_produkcji_kg)
    po_stanie = max(0.0, zamowione_kg - pokryte)
    brak = max(0.0, po_stanie - max(0.0, w_planie_masowania_kg))
    return {"po_stanie": round(po_stanie, 3), "brak": round(brak, 3)}


def _masowania_otwarte_per_receptura() -> Dict[str, Dict[str, float]]:
    """Półprodukt, który DA niewykonana część otwartych zleceń masowania.

    Tylko zlecenia na dziś i przyszłość (albo już w masownicy). Zaległe z
    minionych dni NIE są planem — produkcja 13.11.2026 miała 26 takich od
    września i każde udawało pokrycie zamówień, zaniżając brak do zera.
    """
    out: Dict[str, Dict[str, float]] = {}
    for r in query_all(
        """
        SELECT recipe_id, plan_date,
               planned_output_kg, meat_kg, COALESCE(kg_done, 0) AS kg_done
        FROM mixing_orders
        WHERE status IN ('planned', 'confirmed', 'in_progress') AND recipe_id IS NOT NULL
          AND (plan_date IS NULL OR plan_date >= %s OR status = 'in_progress')
        """,
        (_today_iso(),),
    ):
        meat = float(r["meat_kg"] or 0)
        if meat <= 0:
            continue
        reszta = max(0.0, 1.0 - float(r["kg_done"] or 0) / meat)
        kg = float(r["planned_output_kg"] or 0) * reszta
        d = out.setdefault(r["recipe_id"], {"razem": 0.0, "dni": {}})
        d["razem"] += kg
        dzien = _iso(r["plan_date"]) or ""
        d["dni"][dzien] = d["dni"].get(dzien, 0.0) + kg
    return out


def mixing_demand(plan_date: Optional[str] = None) -> Dict[str, Any]:
    """Potrzeby masowania z otwartych zamówień, per receptura.

    Wiersz mówi planiście wprost: ile zamówiono, ile pokrywa stan i plany,
    ile półproduktu brakuje i ile to mięsa. Sortowanie: najbliższy wyjazd.
    """
    from app.services.orders_service import list_orders

    pd = plan_date or _today_iso()
    per: Dict[str, Dict[str, Any]] = {}
    for o in list_orders(None):
        if (o.get("status") or "") in ("done", "cancelled"):
            continue
        for ln in o.get("lines", []):
            rid = ln.get("recipe_id") or ""
            if not rid:
                continue
            zostalo = max(0.0, float(ln.get("qty") or 0) - float(ln.get("qty_done") or 0))
            kg = zostalo * float(ln.get("kg_per_unit") or 0)
            if kg <= 0:
                continue
            w = per.setdefault(rid, {
                "recipeId": rid, "recipeName": ln.get("recipe_name") or "",
                "orderedKg": 0.0, "orders": {},
            })
            w["orderedKg"] += kg
            z = w["orders"].setdefault(o["id"], {
                "id": o["id"], "orderNo": o.get("order_no") or "",
                "clientName": o.get("client_name") or "",
                "deliveryDate": _iso(o.get("delivery_date")), "kg": 0.0,
            })
            z["kg"] += kg

    wolne = mrs.seasoned_free_by_recipe()
    plan_prod = mrs.active_plan_output_by_recipe()
    masowania = _masowania_otwarte_per_receptura()

    wiersze: List[Dict[str, Any]] = []
    for rid, w in per.items():
        mas = masowania.get(rid, {"razem": 0.0, "dni": {}})
        b = bilans_receptury(w["orderedKg"], wolne.get(rid, 0.0), plan_prod.get(rid, 0.0), mas["razem"])
        mieso = mrs.kg_meat_from_output(b["brak"], mrs.recipe_ingredients(rid)) if b["brak"] > 0 else 0.0
        zam = sorted(w["orders"].values(), key=lambda z: (z["deliveryDate"] or "9999", z["orderNo"]))
        wiersze.append({
            "recipeId": rid,
            "recipeName": w["recipeName"],
            "orderedKg": _r1(w["orderedKg"]),
            "seasonedFreeKg": _r1(max(0.0, wolne.get(rid, 0.0))),
            "productionPlanKg": _r1(plan_prod.get(rid, 0.0)),
            "plannedMixingKg": _r1(mas["razem"]),
            "plannedMixingThisDayKg": _r1(mas["dni"].get(pd, 0.0)),
            "missingOutputKg": _r1(b["brak"]),
            "missingMeatKg": _r1(mieso),
            "nearestDelivery": zam[0]["deliveryDate"] if zam else None,
            "orders": [{**z, "kg": _r1(z["kg"])} for z in zam],
        })
    wiersze.sort(key=lambda x: (x["missingMeatKg"] <= 0, x["nearestDelivery"] or "9999", x["recipeName"]))
    return {"planDate": pd, "items": wiersze}


# ── Zaległe zlecenia ──────────────────────────────────────────────────────

def stale_orders() -> List[Dict[str, Any]]:
    """Zlecenia z MINIONYCH dni, których nikt nie wykonał — a trzymają mięso.

    30.08.2026 dwa takie zlecenia zamroziły 7 000 kg z partii 512–514; plan
    miniony jest tylko do podglądu, więc biuro nie widziało ich na dzisiejszym
    ekranie wcale. Tu wracają na wierzch z dwiema drogami: przenieś albo anuluj.
    """
    rows = query_all(
        """
        SELECT o.* FROM mixing_orders o
        WHERE o.plan_date < %s
          AND o.status IN ('planned', 'confirmed', 'in_progress')
          AND COALESCE(o.kg_done, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM mixing_sessions s WHERE s.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM mixing_charges c WHERE c.order_id = o.id AND c.status = 'mixing')
        ORDER BY o.plan_date, COALESCE(o.day_seq, 0), o.created_at
        """,
        (_today_iso(),),
    )
    out = []
    for o in rows:
        dto = build_mixing_order(o)
        dto["planDate"] = _iso(o.get("plan_date"))
        dto["reservedKg"] = _r1(sum(float(l["kgPlanned"] or 0) for l in dto["meatLots"]))
        out.append(dto)
    return out


def move_order(order_id: str, target_date: str) -> Dict[str, Any]:
    """Przenosi niewykonane zlecenie na inny dzień — z jego rezerwacjami mięsa.

    Rezerwacje wiszą na zleceniu (`mixing_order_lots`), nie na dniu, więc
    zmiana `plan_date` w jednej transakcji z blokadą wiersza niczego nie
    „zawiesza": zlecenie od razu widać na docelowym dniu z tym samym mięsem.
    (Goły UPDATE w bazie robił to samo po cichu i bez kontroli — stąd zakaz
    w notatkach; tu są warunki: nic nie zmasowano, żaden wsad nie chodzi,
    dzień docelowy nie leży w przeszłości.)
    """
    cel = (target_date or "")[:10]
    dzis = _today_iso()
    if len(cel) != 10 or cel < dzis:
        raise HTTPException(400, "Zlecenie można przenieść na dziś albo na przyszły dzień.")
    with transaction() as conn:
        o = cx_query_one(conn, "SELECT * FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,))
        if not o:
            raise HTTPException(404, "Zlecenie nie znalezione")
        if o["status"] not in ("planned", "confirmed") or float(o.get("kg_done") or 0) > 0:
            raise HTTPException(409, "Przenieść można tylko zlecenie z kolejki, którego jeszcze nie masowano.")
        if cx_query_one(conn, "SELECT id FROM mixing_sessions WHERE order_id=%s LIMIT 1", (order_id,)):
            raise HTTPException(409, "Zlecenie ma zapisane masowanie — nie można go przenieść.")
        if cx_query_one(
            conn, "SELECT id FROM mixing_charges WHERE order_id=%s AND status='mixing' LIMIT 1", (order_id,)
        ):
            raise HTTPException(409, "Wsad tego zlecenia jest w masownicy — najpierw go odbierz albo anuluj.")
        if _iso(o.get("plan_date")) == cel:
            return build_mixing_order(o)
        ost = cx_query_one(
            conn,
            "SELECT COALESCE(MAX(day_seq), 0) AS n FROM mixing_orders "
            "WHERE plan_date=%s AND status <> 'cancelled'",
            (cel,),
        )
        cx_execute(
            conn, "UPDATE mixing_orders SET plan_date=%s, day_seq=%s WHERE id=%s",
            (cel, int(ost["n"] or 0) + 1, order_id),
        )
        row = cx_query_one(conn, "SELECT * FROM mixing_orders WHERE id=%s", (order_id,))
    logger.info("mixing.order.moved", extra={"order_id": order_id, "plan_date": cel})
    return build_mixing_order(row)
