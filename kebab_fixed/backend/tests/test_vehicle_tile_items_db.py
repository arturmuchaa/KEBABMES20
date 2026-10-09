"""Pełne specyfikacje kafli; SQL sprawdzany na izolowanej bazie testowej."""
from app.db import execute
from app.services.vehicle_loading_service import vehicle_state


def test_mixed_pallet_and_stock_carton_keep_recipes_and_tubes_separate(db):
    execute("INSERT INTO vehicles (id,name,active) VALUES ('v','SOLO',true)")
    execute("INSERT INTO client_orders (id,order_no,client_name,order_date,created_at) "
            "VALUES ('o','Z/1','YALCIN','2026-10-09',now())")
    execute("INSERT INTO vehicle_loading_orders (id,vehicle_id,order_id,position) VALUES ('vo','v','o',0)")
    execute("INSERT INTO order_pallets (id,order_id,pallet_no,status) VALUES ('p','o',1,'created')")
    execute("INSERT INTO stock_cartons (id,carton_no,linked_order_id,status) VALUES ('c',123,'o','open')")
    specs = [('KIRMIZI', '', 30, 30), ('BEYAZ', '80 cm', 70, 12), ('BEYAZ', '100 cm', 70, 2), ('KIRMIZI', '80 cm', 70, 3)]
    for n, (recipe, tube, kg, qty) in enumerate(specs):
        execute("INSERT INTO client_order_lines (id,order_id,recipe_name,product_type_name,packaging_name,kg_per_unit,qty,total_kg) "
                "VALUES (%s,'o',%s,'UDO',%s,%s,%s,%s)", (f'l{n}', recipe, tube, kg, qty, kg*qty))
        execute("INSERT INTO order_pallet_items (id,pallet_id,order_line_id,qty) VALUES (%s,'p',%s,%s)",
                (f'i{n}', f'l{n}', qty))
        execute("INSERT INTO stock_carton_lines (id,carton_id,recipe_name,product_type_name,packaging_name,kg_per_unit,target_qty) "
                "VALUES (%s,'c',%s,'UDO',%s,%s,%s)", (f'c{n}', recipe, tube, kg, qty))
    state = vehicle_state('v')
    assert len(state['orders'][0]['pallets']) == 2
    for p in state['orders'][0]['pallets']:
        assert len(p['items']) == 4
        assert {(i['recipe_name'], i['packaging_name'], i['kg_per_unit'], i['qty']) for i in p['items']} == set(specs)
        assert all(i['product_type_name'] == 'UDO' for i in p['items'])
        assert sum(i['qty'] for i in p['items']) == p['total_qty']
        assert sum(i['qty'] * i['kg_per_unit'] for i in p['items']) == p['total_kg']
