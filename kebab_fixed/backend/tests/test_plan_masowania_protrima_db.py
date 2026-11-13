"""Plan masowania w PROTRIMA (13.11.2026): potrzeby z zamówień, zaległe zlecenia,
przeniesienie zlecenia z rezerwacjami, uwagi dla operatora."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import mixing_plan_service as svc
from app.services.mixing_service import get_day_plan, save_day_plan

DZIS = date.today().isoformat()
WCZORAJ = (date.today() - timedelta(days=1)).isoformat()
JUTRO = (date.today() + timedelta(days=1)).isoformat()


def _receptura(rid="r1", nazwa="KIRMIZI", woda=20.0, przyprawa=5.0):
    execute("INSERT INTO ingredients (id, name, unit, is_unlimited, active) VALUES "
            "('i-p','BERG','kg',false,true), ('i-w','WODA','l',true,true) ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, active, total_output_per_100kg, created_at) VALUES (%s,%s,true,%s,now())",
            (rid, nazwa, 100 + woda + przyprawa))
    execute("INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg, seq) VALUES "
            "(%s,%s,'i-p','BERG','kg',%s,0), (%s,%s,'i-w','WODA','l',%s,1)",
            (f"{rid}-a", rid, przyprawa, f"{rid}-b", rid, woda))


def _zamowienie(oid, rid, qty, kg_szt, status="confirmed", wyjazd="2026-12-01"):
    execute("INSERT INTO client_orders (id, order_no, client_name, order_date, delivery_date, created_at, status) "
            "VALUES (%s,%s,'VATAN',%s,%s,now(),%s)", (oid, f"Z/{oid}", DZIS, wyjazd, status))
    execute("INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, qty, kg_per_unit, total_kg, position) "
            "VALUES (%s,%s,%s,'KIRMIZI',%s,%s,%s,0)", (f"{oid}-l", oid, rid, qty, kg_szt, qty * kg_szt))


def _mieso(ms="ms1", lot="701", kg=2000, reserved=0):
    execute("INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) VALUES (%s,%s,%s,'active') "
            "ON CONFLICT (id) DO NOTHING", (f"rb-{ms}", lot, int(lot)))
    execute("INSERT INTO meat_stock (id, lot_no, kg_available, kg_reserved, status, raw_batch_id, material_type_id, material_name) "
            "VALUES (%s,%s,%s,%s,'AVAILABLE',%s,'mat-mieso-zs','Mięso z/s')", (ms, lot, kg, reserved, f"rb-{ms}"))


def _zlecenie(mid, rid, meat_kg, plan_date, status="confirmed", output=None, kg_done=0):
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, planned_output_kg, kg_done, status, plan_date, day_seq) "
            "VALUES (%s,%s,%s,'KIRMIZI',%s,%s,%s,%s,%s,1)",
            (mid, f"MAS/{mid}", rid, meat_kg, output if output is not None else meat_kg * 1.25, kg_done, status, plan_date))


def test_bilans_czysta_funkcja():
    assert svc.bilans_receptury(1000, 200, 100, 300) == {"po_stanie": 700, "brak": 400}
    # Nadwyżka stanu i planów nie daje ujemnego braku.
    assert svc.bilans_receptury(500, 800, 0, 0)["brak"] == 0
    assert svc.bilans_receptury(500, 0, 0, 900)["brak"] == 0


def test_potrzeby_z_zamowien_odejmuja_stan_i_zaplanowane_masowania(db):
    _receptura()                                   # 100 kg mięsa → 125 kg półproduktu
    _zamowienie("o1", "r1", 40, 25, wyjazd="2026-12-05")      # 1000 kg
    _zamowienie("o2", "r1", 10, 25, wyjazd="2026-12-02")      # 250 kg
    _zamowienie("o3", "r1", 99, 25, status="done")            # zamknięte — nie liczy się
    execute("INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced, kg_available, kg_reserved) "
            "VALUES ('s1','700','r1','KIRMIZI',300,250,0)")
    _zlecenie("m1", "r1", 400, DZIS)               # da 500 kg półproduktu
    _zlecenie("m2", "r1", 800, WCZORAJ, status="done", kg_done=800)   # wykonane — nie liczy się

    d = svc.mixing_demand(DZIS)
    w = d["items"][0]
    assert w["recipeId"] == "r1"
    assert w["orderedKg"] == 1250
    assert w["seasonedFreeKg"] == 250
    assert w["plannedMixingKg"] == 500 and w["plannedMixingThisDayKg"] == 500
    assert w["missingOutputKg"] == 500             # 1250 − 250 − 500
    assert w["missingMeatKg"] == 400               # 500 / 1,25
    assert w["nearestDelivery"] == "2026-12-02"
    assert [z["orderNo"] for z in w["orders"]] == ["Z/o2", "Z/o1"]


def test_zlecenie_w_polowie_liczy_tylko_niewykonana_czesc(db):
    _receptura(); _zamowienie("o1", "r1", 40, 25)
    _zlecenie("m1", "r1", 800, DZIS, status="in_progress", output=1000, kg_done=400)
    assert svc.mixing_demand(DZIS)["items"][0]["plannedMixingKg"] == 500


def test_zalegle_zlecenia_i_przeniesienie_z_rezerwacja(db):
    _receptura(); _mieso(kg=2000, reserved=600)
    _zlecenie("stare", "r1", 600, WCZORAJ)
    execute("INSERT INTO mixing_order_lots (id, order_id, meat_stock_id, kg_planned) VALUES ('l1','stare','ms1',600)")
    _zlecenie("dzis", "r1", 200, DZIS)
    _zlecenie("zrobione", "r1", 200, WCZORAJ, status="done", kg_done=200)

    zal = svc.stale_orders()
    assert [z["id"] for z in zal] == ["stare"]
    assert zal[0]["reservedKg"] == 600 and zal[0]["planDate"] == WCZORAJ

    svc.move_order("stare", DZIS)
    plan = get_day_plan(DZIS)["items"]
    assert [p["id"] for p in plan] == ["dzis", "stare"]          # na koniec kolejki
    assert plan[1]["meatLots"][0]["kgPlanned"] == 600            # rezerwacja jedzie ze zleceniem
    assert float(query_one("SELECT kg_reserved FROM meat_stock WHERE id='ms1'")["kg_reserved"]) == 600
    assert svc.stale_orders() == []


def test_przeniesienie_odmawia_wstecz_i_po_masowaniu(db):
    _receptura()
    _zlecenie("a", "r1", 600, WCZORAJ)
    _zlecenie("b", "r1", 600, WCZORAJ, status="in_progress", kg_done=200)
    with pytest.raises(HTTPException) as e:
        svc.move_order("a", WCZORAJ)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        svc.move_order("b", DZIS)
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        svc.move_order("brak", DZIS)
    assert e.value.status_code == 404
    svc.move_order("a", JUTRO)
    assert str(query_one("SELECT plan_date FROM mixing_orders WHERE id='a'")["plan_date"]) == JUTRO


def test_uwagi_dla_operatora_zapis_i_stary_ekran_ich_nie_kasuje(db):
    _receptura()
    plan = save_day_plan([{"recipeId": "r1", "meatKg": 600, "seq": 1, "meatLots": [], "notes": " najpierw 600, potem 2×200 "}], DZIS)
    oid = plan["items"][0]["id"]
    assert plan["items"][0]["notes"] == "najpierw 600, potem 2×200"
    # Stary ekran planowania nie wysyła `notes` — uwaga zostaje.
    plan = save_day_plan([{"id": oid, "recipeId": "r1", "meatKg": 800, "seq": 1, "meatLots": []}], DZIS)
    assert plan["items"][0]["notes"] == "najpierw 600, potem 2×200" and plan["items"][0]["meatKg"] == 800
    # PROTRIMA pustym tekstem ją kasuje.
    plan = save_day_plan([{"id": oid, "recipeId": "r1", "meatKg": 800, "seq": 1, "meatLots": [], "notes": ""}], DZIS)
    assert not plan["items"][0]["notes"]
