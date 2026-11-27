"""Szablon etykiety i dane sztuk dla pozycji planu (projektor etykiet, 27.11.2026)."""
import pytest

from app.db import execute
from app.services import finished_units_service as fu
from app.services import label_designs_service as svc
from tests.test_label_designs_db import a4, slownik  # noqa: F401

pytestmark = pytest.mark.usefixtures("db")


def _plan(**linia):
    execute("UPDATE recipes SET shelf_life_days=364 WHERE id='kir'")
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, status) "
            "VALUES ('o1','ZAGROS/Z/1/11/26','cz','ZAGROS','2026-11-27','confirmed')")
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status) VALUES ('p1','PROD/1','2026-11-28','active')")
    d = {"id": "l1", "client_order_id": "o1", "client_name": "ZAGROS", "product_type_id": "udo", "recipe_id": "kir"}
    d.update(linia)
    execute("INSERT INTO production_plan_lines (id, plan_id, position, qty, kg_per_unit, total_kg, product_type_id, "
            "recipe_id, recipe_name, client_order_id, client_name) VALUES (%s,'p1',1,2,40,80,%s,%s,'KIRMIZI',%s,%s)",
            (d["id"], d["product_type_id"], d["recipe_id"], d["client_order_id"], d["client_name"]))
    execute("INSERT INTO finished_units (id, qr_code, qr_seq, plan_line_id, client_name, recipe_id, product_type_id, "
            "weight_kg, batch_no, produced_date, status) VALUES ('u1','U|u1',1,%s,%s,%s,%s,40,'724','2026-11-28','planned')",
            (d["id"], d["client_name"], d["recipe_id"], d["product_type_id"]))


def test_sztuki_planu_niosa_klienta_i_termin():
    _plan()
    u = fu.units_for_plan("p1")[0]
    assert u["clientId"] == "cz" and u["productTypeId"] == "udo" and u["recipeId"] == "kir"
    assert u["shelfLifeDays"] == 364


def test_pozycja_z_zamowienia_dobiera_szablon_klienta():
    _plan()
    sid = svc.save_design(a4(recipeId="kir"), "b")["id"]
    assert svc.designs_for_plan("p1") == {"l1": {"designId": sid, "name": "ZAGROS · A4", "printMode": "a4"}}


def test_pozycja_tylko_z_nazwa_klienta_dobiera_po_nazwie_wyswietlanej():
    _plan(client_order_id=None, client_name="ZAGROS")
    sid = svc.save_design(a4(), "b")["id"]
    assert svc.designs_for_plan("p1")["l1"]["designId"] == sid
    assert fu.units_for_plan("p1")[0]["clientId"] == "cz"


def test_pozycja_bez_szablonu_none():
    _plan()
    assert svc.designs_for_plan("p1") == {"l1": None}
