"""Palety przy pozycjach planu — zapis z PROTRIMA (plan B, zad. 1).

Plan z PROTRIMA wskazuje konkretne palety z chłodni; serwer wyprowadza z nich
partie, zapisuje przypisanie (plan_line_pallets) i włącza blokadę palet.
"""
import json

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.services import production_plans_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")

DZIEN = "2026-11-28"


@pytest.fixture(autouse=True)
def receptury(db):
    execute("INSERT INTO recipes(id,name,components) VALUES ('r-kirmizi','KIRMIZI','[]')")
    execute("INSERT INTO recipes(id,name,components) VALUES ('r-doner','DONER','[]')")


def partia(batch_no="724", recipe_id="r-kirmizi", kg=1198.0, material=None):
    sm = cuid()
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, material_type_id, "
        "kg_produced, kg_available, kg_used, status, expiry_date, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,0,'available','2026-12-05',now())",
        (sm, batch_no, recipe_id, "DONER" if recipe_id == "r-doner" else "KIRMIZI", material, kg, kg))
    return sm


_nr = iter(range(41, 10000))


def paleta(sm, batch_no="724", recipe_id="r-kirmizi", kg=598.0, status="in_cold"):
    pid = cuid()
    execute(
        "INSERT INTO seasoned_pallets (id, pallet_no, seasoned_meat_id, batch_no, recipe_id, "
        "recipe_name, kg_weighed, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (pid, next(_nr), sm, batch_no, recipe_id,
         "DONER" if recipe_id == "r-doner" else "KIRMIZI", kg, status))
    return pid


def pozycja(palety, qty=29, kg=40, recipe="r-kirmizi", **kw):
    return PlanLineCreate(qty=qty, kgPerUnit=kg, recipeId=recipe, palletIds=palety, **kw)


def plan_dto(*lines, gate=True):
    return ProductionPlanCreate(planDate=DZIEN, palletGate=gate, lines=list(lines))


def przypisane(line_id):
    return {r["pallet_id"] for r in query_all(
        "SELECT pallet_id FROM plan_line_pallets WHERE plan_line_id=%s", (line_id,))}


def test_plan_z_paletami_zapisuje_przypisanie_i_blokade():
    sm = partia()
    p1 = paleta(sm, kg=600.0)
    p2 = paleta(sm, kg=598.0)
    plan = svc.create_plan(plan_dto(pozycja([p2, p1])))
    assert plan["pallet_gate"] is True
    line = plan["lines"][0]
    assert przypisane(line["id"]) == {p1, p2}
    assert line["seasoned_batch_nos"] == ["724"]
    pelny = svc.get_plan(plan["id"])
    assert [p["id"] for p in pelny["lines"][0]["pallets"]] == [p2, p1]
    assert [p["position"] for p in pelny["lines"][0]["pallets"]] == [1, 2]


def test_paleta_innej_receptury_odbija_sie():
    doner = paleta(partia("730", recipe_id="r-doner"), batch_no="730", recipe_id="r-doner")
    with pytest.raises(HTTPException) as e:
        svc.create_plan(plan_dto(pozycja([doner], qty=10)))
    assert e.value.status_code == 400
    assert "Paleta " in e.value.detail and "DONER" in e.value.detail


def test_paleta_zuzyta_albo_na_hali_odbija_sie():
    sm = partia()
    zuzyta = paleta(sm, status="closed")
    na_hali = paleta(sm, status="on_hall")
    nr = query_one("SELECT pallet_no FROM seasoned_pallets WHERE id=%s", (zuzyta,))["pallet_no"]
    with pytest.raises(HTTPException) as e:
        svc.create_plan(plan_dto(pozycja([zuzyta], qty=10)))
    assert e.value.status_code == 409
    assert f"Paleta {nr} jest już zużyta" in e.value.detail
    with pytest.raises(HTTPException) as e:
        svc.create_plan(plan_dto(pozycja([na_hali], qty=10)))
    assert e.value.status_code == 409
    assert "wyjechała na halę" in e.value.detail
    assert query_one("SELECT count(*) AS n FROM production_plans")["n"] == 0


def _mix(db_components=(("udo", "UDO", 70), ("filet", "FILET", 30))):
    execute("INSERT INTO product_types(id,name,components) VALUES ('mix7030','MIX 70/30',%s::jsonb)",
            (json.dumps([dict(materialTypeId=m, name=n, pct=p) for m, n, p in db_components]),))
    udo = partia("355", kg=600.0, material="udo")
    filet = partia("356", kg=300.0, material="filet")
    return paleta(udo, batch_no="355", kg=600.0), paleta(filet, batch_no="356", kg=300.0)


def test_kebab_mix_z_paletami_obu_rodzajow():
    p_udo, p_filet = _mix()
    plan = svc.create_plan(plan_dto(pozycja([p_udo, p_filet], qty=20, productTypeId="mix7030")))
    line = svc.get_plan(plan["id"])["lines"][0]
    ba = line["batch_allocation"]
    assert list(ba) == ["355/356"]
    assert ba["355/356"]["pieces"] == 20
    assert ba["355/356"]["parts"]["355"]["kg"] == 560.0
    assert ba["355/356"]["parts"]["356"]["kg"] == 240.0
    assert przypisane(line["id"]) == {p_udo, p_filet}


def test_kebab_mix_bez_palety_jednego_rodzaju_odbija_sie():
    p_udo, _ = _mix()
    with pytest.raises(HTTPException) as e:
        svc.create_plan(plan_dto(pozycja([p_udo], qty=20, productTypeId="mix7030")))
    assert e.value.status_code == 400
    assert "brak palety z mięsem" in e.value.detail and "FILET" in e.value.detail


def test_plan_z_blokada_wymaga_palet_w_kazdej_pozycji():
    sm = partia()
    p = paleta(sm)
    with pytest.raises(HTTPException) as e:
        svc.create_plan(plan_dto(pozycja([p], qty=10),
                                 PlanLineCreate(qty=5, kgPerUnit=40, recipeId="r-kirmizi",
                                                seasonedBatchIds=[sm])))
    assert e.value.status_code == 400
    assert "wybierz palety" in e.value.detail and "KIRMIZI" in e.value.detail


def test_plan_bez_blokady_dziala_jak_dotad():
    sm = partia()
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, lines=[
        PlanLineCreate(qty=10, kgPerUnit=40, recipeId="r-kirmizi", seasonedBatchIds=[sm])]))
    assert plan["pallet_gate"] is False
    assert query_all("SELECT * FROM plan_line_pallets") == []
    assert svc.get_plan(plan["id"])["lines"][0]["pallets"] == []


def test_edycja_planu_podmienia_palety():
    sm = partia()
    p1 = paleta(sm, kg=600.0)
    p2 = paleta(sm, kg=598.0)
    sm2 = partia("725")
    p3 = paleta(sm2, batch_no="725", kg=600.0)
    plan = svc.create_plan(plan_dto(pozycja([p1, p2]), pozycja([p3], qty=10)))
    l1, l2 = plan["lines"]
    # Druga pozycja jest już w produkcji — zamrożona razem ze swoimi paletami.
    execute("UPDATE production_plan_lines SET qty_done=3 WHERE id=%s", (l2["id"],))
    svc.update_plan(plan["id"], plan_dto(
        pozycja([p1], qty=14, id=l1["id"]), pozycja([p3], qty=10, id=l2["id"])))
    assert przypisane(l1["id"]) == {p1}
    assert przypisane(l2["id"]) == {p3}


def test_edycja_aktywnego_planu_zostawia_palete_wywieziona_do_niego():
    sm = partia()
    p1 = paleta(sm, kg=600.0)
    plan = svc.create_plan(plan_dto(pozycja([p1], qty=14)))
    l1 = plan["lines"][0]
    execute("UPDATE seasoned_pallets SET status='on_hall', taken_plan_id=%s, taken_at=now() WHERE id=%s",
            (plan["id"], p1))
    svc.update_plan(plan["id"], plan_dto(pozycja([p1], qty=12, id=l1["id"])))
    assert przypisane(l1["id"]) == {p1}
