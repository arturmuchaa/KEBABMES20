"""Plan odlicza to, co już jest dla zamówienia (właściciel 27.11.2026).

„YALCIN 30 × 30 kg, a 5 sztuk zrobione dwa dni wcześniej — plan ma pokazać
25 × 30, nie 30 × 30.” Odliczamy to samo, co kolumna „Pokrycie” zamówienia
(wyrób na magazynie i wydany do klienta), nie tylko produkcję z planów
powiązanych z pozycją zamówienia.
"""
import pytest

from app.db import execute
from app.models.orders import ClientOrderCreate
from app.services import orders_service
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zamowienie(qty=30, kg=30):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES ('cy','YAL','EMIN GMBH','YALCIN')")
    execute("INSERT INTO product_types (id, name) VALUES ('udo','KEBAB UDO 100%%')")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('kir','KIRMIZI','udo')")
    o = orders_service.create_order(ClientOrderCreate.model_validate({
        "client_id": "cy", "order_date": "2026-11-25", "delivery_date": "2026-11-30",
        "lines": [{"recipe_id": "kir", "product_type_id": "udo", "qty": qty, "kg_per_unit": kg}]}))
    execute("UPDATE client_orders SET status='confirmed' WHERE id=%s", (o["id"],))
    return o


def _wyrob(order_no, qty, kg=30):
    execute("INSERT INTO finished_goods (id, batch_no, recipe_id, product_type_id, kg_per_unit, qty, qty_available, "
            "client_order_no, client_id, produced_date) VALUES (%s,'251126 700','kir','udo',%s,%s,%s,%s,'cy','2026-11-25')",
            (cuid(), kg, qty, qty, order_no))


def _plan(line_id, qty, status, qty_done=0):
    pid = cuid()
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status) VALUES (%s,%s,'2026-11-28',%s)", (pid, f"P/{pid[:5]}", status))
    execute("INSERT INTO production_plan_lines (id, plan_id, qty, qty_done, kg_per_unit, total_kg, recipe_id, client_order_line_id) "
            "VALUES (%s,%s,%s,%s,30,%s,'kir',%s)", (cuid(), pid, qty, qty_done, qty * 30, line_id))


def _zostalo(o):
    return orders_service.production_progress(o["id"])["lines"][0]["qty_remaining"]


def test_piec_sztuk_na_magazynie_plan_pokazuje_25():
    o = _zamowienie()
    _wyrob(o["order_no"], 5)
    assert _zostalo(o) == 25


def test_szkic_planu_na_reszte_zamyka_pozycje():
    o = _zamowienie()
    _wyrob(o["order_no"], 5)
    _plan(o["lines"][0]["id"], 25, "draft")
    assert _zostalo(o) == 0


def test_zrobione_w_planie_i_na_magazynie_nie_liczy_sie_dwa_razy():
    o = _zamowienie()
    _plan(o["lines"][0]["id"], 10, "done", qty_done=10)
    _wyrob(o["order_no"], 10)          # te same 10 sztuk z planu leżą na magazynie
    assert _zostalo(o) == 20


def test_aktywny_plan_w_trakcie_dnia():
    o = _zamowienie()
    _plan(o["lines"][0]["id"], 30, "active", qty_done=12)
    _wyrob(o["order_no"], 12)          # zeskanowane sztuki już na stanie
    assert _zostalo(o) == 0
