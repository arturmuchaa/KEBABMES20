"""Lista planów ze stanem etykiet i palet, bilans strat za zakres dat (plan B, zad. 4)."""
import pytest
from fastapi import HTTPException

from app.db import execute
from app.main import app
from app.models.production import ProductionPlanCreate
from app.services import finished_units_service as fu
from app.services import production_plans_service as svc
from app.services import seasoned_pallets_service as sp
from app.utils.ids import cuid
from tests.test_plan_palety_zapis_db import DZIEN, paleta, partia, pozycja, receptury  # noqa: F401

pytestmark = pytest.mark.usefixtures("db")


def test_lista_planow_ma_stan_etykiet_i_palet():
    sm = partia()
    a, b = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=[pozycja([a, b], qty=3)]))
    fu.generate_units_from_plan_line(plan["lines"][0]["id"])
    fu.mark_labels_printed([fu.units_for_plan(plan["id"])[0]["id"]])
    execute("UPDATE seasoned_pallets SET status='on_hall', taken_plan_id=%s, taken_at=now() WHERE id=%s",
            (plan["id"], a))
    [p] = [x for x in svc.list_plans() if x["id"] == plan["id"]]
    assert p["summary"] == {"units": 3, "labelsPrinted": 1, "pallets": 2, "palletsTaken": 1,
                            "palletsReturned": 0, "balanceReady": False}


def _plan_z_bilansem(dzien, wiersze):
    pid = cuid()
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status, pallet_gate) "
            "VALUES (%s,%s,%s,'done',true)", (pid, f"PROD/{dzien}", dzien))
    for batch, recipe, kg_in, goods, ret, loss in wiersze:
        execute("INSERT INTO plan_batch_balance (plan_id, batch_no, recipe_id, kg_in, kg_goods, "
                "kg_returned, kg_loss) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (pid, batch, recipe, kg_in, goods, ret, loss))
    return pid


def test_bilans_zakresu_sumuje_dni_i_receptury():
    p1 = _plan_z_bilansem("2026-11-25", [("724", "r-kirmizi", 598, 560, 24, 14)])
    _plan_z_bilansem("2026-11-26", [("725", "r-kirmizi", 600, 560, 30, 10),
                                    ("730", "r-doner", 300, 280, 15, 5)])
    _plan_z_bilansem("2026-11-29", [("731", "r-kirmizi", 100, 50, 0, 50)])  # poza zakresem
    pal = paleta(partia("724"), kg=598.0)
    execute("UPDATE seasoned_pallets SET kg_theory=610, taken_plan_id=%s, status='closed' WHERE id=%s", (p1, pal))
    out = sp.balance_range("2026-11-25", "2026-11-27")
    assert [d["date"] for d in out["days"]] == ["2026-11-25", "2026-11-26"]
    assert out["days"][0] == {"date": "2026-11-25", "kgIn": 598.0, "kgLoss": 14.0, "lossPct": 2.3}
    assert out["days"][1]["kgIn"] == 900.0 and out["days"][1]["lossPct"] == 1.7
    rec = {r["recipeName"]: r for r in out["recipes"]}
    assert rec["KIRMIZI"]["kgIn"] == 1198.0 and rec["KIRMIZI"]["kgLoss"] == 24.0 and rec["KIRMIZI"]["lossPct"] == 2.0
    assert rec["DONER"]["lossPct"] == 1.7
    r724 = next(r for r in out["rows"] if r["batchNo"] == "724")
    assert r724["kgTheory"] == 610.0 and r724["lossPct"] == 2.3 and r724["planDate"] == "2026-11-25"
    assert next(r for r in out["rows"] if r["batchNo"] == "725")["kgTheory"] is None


def test_bilans_zakresu_zle_daty():
    with pytest.raises(HTTPException) as e:
        sp.balance_range("2026-11-27", "2026-11-25")
    assert e.value.status_code == 400 and "Data od jest po dacie do" in e.value.detail


def test_trasa_bilansu_zakresu_nie_jest_brana_za_id_planu():
    """GET /balance-range musi stać przed GET /{plan_id} (FastAPI dopasowuje po kolei)."""
    sciezki = [r.path for r in app.routes if "GET" in getattr(r, "methods", set())]
    assert "/api/production-plans/balance-range" in sciezki
    assert sciezki.index("/api/production-plans/balance-range") < sciezki.index("/api/production-plans/{plan_id}")
