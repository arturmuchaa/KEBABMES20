"""Pozycja „z końcówek” (PM), sztuki z kilku partii na hali i ich bilans (plan B, zad. 2).

Właściciel 26–27.11.2026: łączenie końcówek planuje biuro wieczorem (PM);
kebab mix (udo/filet 70/30, 80/20, 95/5) robi się dużo — musi działać z paletami.
"""
import json
import re

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one, transaction
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.services import production_plans_service as svc
from app.services import seasoned_pallets_service as sp
from app.services.finished_goods_service import _consume_seasoned_for_entry
from app.services.finished_units_service import generate_units_from_plan_line, scan_produced
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


@pytest.fixture(autouse=True)
def receptury(db):
    execute("INSERT INTO recipes(id,name,components) VALUES ('r-kirmizi','KIRMIZI','[]')")


_nr = iter(range(41, 10000))


def partia(batch_no, kg, material=None):
    sm = cuid()
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, material_type_id, "
        "kg_produced, kg_available, kg_used, status, expiry_date, created_at) "
        "VALUES (%s,%s,'r-kirmizi','KIRMIZI',%s,%s,%s,0,'available','2026-12-05',now())",
        (sm, batch_no, material, kg, kg))
    return sm


def paleta(sm, batch_no, kg, koncowka=False):
    pid = cuid()
    execute(
        "INSERT INTO seasoned_pallets (id, pallet_no, seasoned_meat_id, batch_no, recipe_id, "
        "recipe_name, kg_weighed, status, is_remainder) "
        "VALUES (%s,%s,%s,%s,'r-kirmizi','KIRMIZI',%s,'in_cold',%s)",
        (pid, next(_nr), sm, batch_no, kg, koncowka))
    return pid


def koncowki():
    k724 = paleta(partia("724", 24.0), "724", 24.0, koncowka=True)
    k731 = paleta(partia("731", 31.0), "731", 31.0, koncowka=True)
    return k724, k731


def utworz(line):
    return svc.create_plan(ProductionPlanCreate(
        planDate=sp.production_day(), palletGate=True, lines=[line]))


def alokacja(line_id):
    ba = query_one("SELECT batch_allocation FROM production_plan_lines WHERE id=%s", (line_id,))["batch_allocation"]
    return json.loads(ba) if isinstance(ba, str) else ba


def zakoncz_dzien(plan_id, line_id, qty, kg, nos):
    svc.tablet_finish(plan_id, [{
        "planLineId": line_id, "qty": qty, "workerNames": ["Jan"], "kgPerUnit": kg,
        "recipeId": "r-kirmizi", "recipeName": "KIRMIZI", "seasonedBatchNos": nos,
    }])
    svc.office_confirm(plan_id)
    return {r["batch_no"]: r for r in query_all(
        "SELECT * FROM plan_batch_balance WHERE plan_id=%s", (plan_id,))}


def test_pozycja_z_koncowek_dostaje_pm_przy_aktywacji():
    k724, k731 = koncowki()
    plan = utworz(PlanLineCreate(qty=1, kgPerUnit=40, recipeId="r-kirmizi",
                                 fromRemainders=True, palletIds=[k724, k731]))
    lid = plan["lines"][0]["id"]
    ba = alokacja(lid)
    assert list(ba) == [svc.MIXED_KEY]
    assert {b: p["kg"] for b, p in ba[svc.MIXED_KEY]["parts"].items()} == {"724": 24.0, "731": 16.0}
    svc.update_plan_status(plan["id"], "active")
    [klucz] = list(alokacja(lid))
    assert re.match(r"^PM\d+$", klucz)
    generate_units_from_plan_line(lid)
    assert query_one("SELECT batch_no FROM finished_units WHERE plan_line_id=%s", (lid,))["batch_no"] == klucz


def test_pozycja_z_koncowek_ponad_wage_odbija_sie():
    k724, k731 = koncowki()
    with pytest.raises(HTTPException) as e:
        utworz(PlanLineCreate(qty=2, kgPerUnit=40, recipeId="r-kirmizi",
                              fromRemainders=True, palletIds=[k724, k731]))
    assert e.value.status_code == 400
    assert "55 kg" in e.value.detail and "1 pełna sztuka" in e.value.detail
    assert query_one("SELECT count(*) AS n FROM production_plans")["n"] == 0
    assert float(query_one("SELECT SUM(kg_reserved) AS s FROM seasoned_meat")["s"]) == 0


def test_bilans_dzieli_sztuke_pm_na_partie():
    k724, k731 = koncowki()
    plan = utworz(PlanLineCreate(qty=1, kgPerUnit=40, recipeId="r-kirmizi",
                                 fromRemainders=True, palletIds=[k724, k731]))
    pid, lid = plan["id"], plan["lines"][0]["id"]
    svc.update_plan_status(pid, "active")
    generate_units_from_plan_line(lid)
    sp.take_pallet("SP|" + k724, plan_id=pid)
    sp.take_pallet("SP|" + k731, plan_id=pid)
    u = query_one("SELECT id, batch_no FROM finished_units WHERE plan_line_id=%s", (lid,))
    scan_produced("U|" + u["id"])
    sp.return_pallet("SP|" + k724, 0)
    sp.return_pallet("SP|" + k731, 15)
    b = zakoncz_dzien(pid, lid, 1, 40, ["724", "731"])
    assert float(b["724"]["kg_goods"]) == 24.0 and float(b["724"]["kg_loss"]) == 0.0
    assert float(b["731"]["kg_in"]) == 31.0
    assert float(b["731"]["kg_goods"]) == 16.0
    assert float(b["731"]["kg_returned"]) == 15.0
    assert float(b["731"]["kg_loss"]) == 0.0


def _mix():
    execute("INSERT INTO product_types(id,name,components) VALUES ('mix7030','MIX 70/30',%s::jsonb)",
            (json.dumps([dict(materialTypeId="udo", name="UDO", pct=70),
                         dict(materialTypeId="filet", name="FILET", pct=30)]),))
    p_udo = paleta(partia("355", 600.0, "udo"), "355", 600.0)
    p_filet = paleta(partia("356", 300.0, "filet"), "356", 300.0)
    plan = utworz(PlanLineCreate(qty=20, kgPerUnit=40, recipeId="r-kirmizi",
                                 productTypeId="mix7030", palletIds=[p_udo, p_filet]))
    pid, lid = plan["id"], plan["lines"][0]["id"]
    svc.update_plan_status(pid, "active")
    generate_units_from_plan_line(lid)
    return pid, lid, p_udo, p_filet


def test_sztuka_mix_wymaga_wywozu_palet_obu_partii():
    pid, lid, p_udo, p_filet = _mix()
    sp.take_pallet("SP|" + p_udo, plan_id=pid)
    u = query_one("SELECT id, batch_no FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq LIMIT 1", (lid,))
    assert u["batch_no"] == "355/356"
    with pytest.raises(HTTPException) as e:
        scan_produced("U|" + u["id"])
    assert e.value.status_code == 409
    assert "brakuje palety partii 356" in e.value.detail
    sp.take_pallet("SP|" + p_filet, plan_id=pid)
    scan_produced("U|" + u["id"])
    assert query_one("SELECT status FROM finished_units WHERE id=%s", (u["id"],))["status"] != "planned"


def test_bilans_dzieli_sztuke_mix_na_partie():
    pid, lid, p_udo, p_filet = _mix()
    sp.take_pallet("SP|" + p_udo, plan_id=pid)
    sp.take_pallet("SP|" + p_filet, plan_id=pid)
    for u in query_all("SELECT id FROM finished_units WHERE plan_line_id=%s", (lid,)):
        scan_produced("U|" + u["id"])
    sp.return_pallet("SP|" + p_udo, 40)
    sp.return_pallet("SP|" + p_filet, 60)
    b = zakoncz_dzien(pid, lid, 20, 40, ["355", "356"])
    assert float(b["355"]["kg_goods"]) == 560.0 and float(b["355"]["kg_loss"]) == 0.0
    assert float(b["356"]["kg_goods"]) == 240.0
    assert float(b["356"]["kg_returned"]) == 60.0
    assert float(b["356"]["kg_loss"]) == 0.0


def _linia_bez_alokacji(gate, batch_no):
    sm = partia(batch_no, 400.0)
    pid, lid = cuid(), cuid()
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status, pallet_gate) "
            "VALUES (%s,%s,%s,'active',%s)", (pid, f"PP/{pid[:6]}", sp.production_day(), gate))
    execute("INSERT INTO production_plan_lines (id, plan_id, qty, kg_per_unit, total_kg, recipe_id, "
            "batch_allocation) VALUES (%s,%s,5,40,200,'r-kirmizi','{}')", (lid, pid))
    return sm, pid, lid


def test_finish_day_bez_podzialu_po_rowno_w_planie_z_blokada():
    sm, pid, lid = _linia_bez_alokacji(gate=True, batch_no="724")
    with transaction() as conn:
        _consume_seasoned_for_entry(conn, plan_id=pid, plan_line_id=lid, entry_qty=5,
                                    total_kg=200, seasoned_batch_nos=["724"])
    assert float(query_one("SELECT kg_available FROM seasoned_meat WHERE id=%s", (sm,))["kg_available"]) == 400.0

    sm2, pid2, lid2 = _linia_bez_alokacji(gate=False, batch_no="800")
    with transaction() as conn:
        _consume_seasoned_for_entry(conn, plan_id=pid2, plan_line_id=lid2, entry_qty=5,
                                    total_kg=200, seasoned_batch_nos=["800"])
    assert float(query_one("SELECT kg_available FROM seasoned_meat WHERE id=%s", (sm2,))["kg_available"]) == 200.0
