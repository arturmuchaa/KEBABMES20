"""Read path integration: shared stock is allocated before UI selection/filtering."""
import json

from app.db import execute
from app.services.orders_service import list_orders, get_order


def seed():
    execute("INSERT INTO clients(id, code, name) VALUES ('c1','C1','Pierwszy'), ('c2','C2','Drugi')")
    execute("INSERT INTO recipes(id, name, product_type_name) VALUES ('r','BEYAZ','UDO')")
    execute("INSERT INTO packaging(id, name, type, unit) VALUES ('p65','METAL 65 cm','tuleja','szt'), ('p80','METAL 80 cm','tuleja','szt')")
    for i in range(1, 4):
        execute("INSERT INTO client_orders(id, order_no, client_id, status, order_date) VALUES (%s,%s,%s,%s,%s)",
                (f"o{i}", f"Z/{i}", 'c1' if i < 3 else 'c2', 'cancelled' if i == 3 else 'confirmed', f"2026-10-0{i}"))
        execute("INSERT INTO client_order_lines(id, order_id, qty, kg_per_unit, recipe_id, packaging_id) VALUES (%s,%s,10,20,'r','p65')",
                (f"l{i}", f"o{i}"))
    execute("INSERT INTO finished_goods(id,batch_no,recipe_id,kg_per_unit,qty,qty_available,packaging_id) VALUES ('fg','batch','r',20,15,15,'p65')")


def test_list_and_single_order_have_same_metrics_and_no_double_allocation(db):
    seed()
    orders = {o['id']: o for o in list_orders(None)}
    assert orders['o1']['fulfillment']['covered_kg'] == 200
    assert orders['o2']['fulfillment']['covered_kg'] == 100
    assert orders['o3']['fulfillment']['covered_kg'] == 0
    for oid in orders:
        assert orders[oid]['fulfillment'] == get_order(oid)['fulfillment']
        assert orders[oid]['lines'] == get_order(oid)['lines']
    assert sum(o['fulfillment']['covered_kg'] for o in orders.values()) == 300
    assert all(o['lines'][0]['packaging_name'] == 'METAL 65 cm' for o in orders.values())
    assert all(o['lines'][0]['recipe_name'] == 'BEYAZ' for o in orders.values())


def test_different_lengths_and_weights_remain_separate(db):
    seed()
    execute("INSERT INTO client_order_lines(id,order_id,qty,kg_per_unit,recipe_id,packaging_id,position) VALUES ('long','o1',3,20,'r','p80',1), ('heavy','o1',2,30,'r','p65',2)")
    order = get_order('o1')
    assert [l['fulfillment']['remaining_kg'] for l in order['lines']] == [0, 60, 60]
    assert order['fulfillment']['remaining_kg'] == 120


def test_delivered_and_available_are_not_counted_twice(db):
    seed()
    execute("UPDATE finished_goods SET qty_available=3 WHERE id='fg'")
    execute("INSERT INTO wz_documents(id,number,status,source_type,source_id,lines) VALUES ('w','WZ/1','wystawiony','order','o1',%s::jsonb)",
            (json.dumps([{'stock_type': 'fg', 'stock_id': 'fg', 'qty': 7}]),))
    order = get_order('o1')
    assert order['fulfillment'] == {'ordered_kg': 200, 'stock_kg': 60, 'delivered_kg': 140, 'covered_kg': 200, 'remaining_kg': 0}
    execute("UPDATE wz_documents SET status='anulowany' WHERE id='w'")
    assert get_order('o1')['fulfillment']['delivered_kg'] == 0


def test_inactive_client_does_not_delete_open_demand_and_deleted_order_disappears(db):
    seed()
    execute("UPDATE clients SET active=false WHERE id='c1'")
    assert len(list_orders('confirmed')) == 2
    execute("DELETE FROM client_orders WHERE id='o1'")
    orders = list_orders('confirmed')
    assert [o['id'] for o in orders] == ['o2']
    assert orders[0]['fulfillment']['ordered_kg'] == 200


def test_filtering_list_does_not_redistribute_stock(db):
    seed()
    execute("UPDATE client_orders SET status='in_production' WHERE id='o1'")
    confirmed = list_orders('confirmed')
    assert len(confirmed) == 1
    assert confirmed[0]['id'] == 'o2'
    assert confirmed[0]['fulfillment']['covered_kg'] == 100
