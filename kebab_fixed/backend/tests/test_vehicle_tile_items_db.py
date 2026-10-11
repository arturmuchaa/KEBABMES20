"""Pełne specyfikacje kafli; SQL sprawdzany na izolowanej bazie testowej."""
from app.db import execute
from app.services.vehicle_loading_service import vehicle_state
from app.services import vehicle_loading_service


def test_mixed_pallet_and_stock_carton_keep_recipes_and_tubes_separate(db):
    execute("INSERT INTO vehicles (id,name,active) VALUES ('v','SOLO',true) ON CONFLICT (id) DO NOTHING")
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


def test_loading_returns_latest_valid_weighing_for_both_container_kinds(db, monkeypatch):
    execute("INSERT INTO vehicles (id,name,active) VALUES ('v','SOLO',true) ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO client_orders (id,order_no,client_name,order_date,created_at) "
            "VALUES ('o','Z/1','CLIENT','2026-10-11',now())")
    execute("INSERT INTO vehicle_loading_orders (id,vehicle_id,order_id,position) VALUES ('vo','v','o',0)")
    execute("INSERT INTO order_pallets (id,order_id,pallet_no,status,loaded_vehicle_id) VALUES ('p','o',1,'loaded','v')")
    execute("INSERT INTO order_pallets (id,order_id,pallet_no,status) VALUES ('unweighed','o',2,'cold_storage')")
    execute("INSERT INTO stock_cartons (id,carton_no,linked_order_id,status,loaded_vehicle_id) VALUES ('c',123,'o','open','v')")
    execute("INSERT INTO stock_cartons (id,carton_no,linked_order_id,status) VALUES ('invalidated',124,'o','open')")
    execute("INSERT INTO client_order_lines (id,order_id,kg_per_unit,qty,total_kg) VALUES ('l','o',30,2,60)")
    execute("INSERT INTO order_pallet_items (id,pallet_id,order_line_id,qty) VALUES ('i','p','l',2)")
    execute("INSERT INTO stock_carton_lines (id,carton_id,kg_per_unit,target_qty) VALUES ('cl','c',30,2)")
    for wid, kind, cid, gross, ok, invalid, day in [
        ('w-old', 'order', 'p', 95, True, False, 9),
        ('w-new', 'order', 'p', 110.5, False, False, 10),
        ('w-invalid', 'order', 'p', 96, True, True, 11),
        ('w-stock', 'stock', 'c', 95, True, False, 10),
        ('w-removed', 'stock', 'invalidated', 95, True, True, 10),
        ('w-wrong-kind', 'stock', 'p', 500, True, False, 11),
        ('w-other', 'order', 'not-on-this-vehicle', 95, True, False, 10),
    ]:
        execute("INSERT INTO cold_storage_weighings "
                "(id,container_kind,container_id,gross_kg,net_kg,diff_kg,ok,weighed_at,invalid_at) "
                "VALUES (%s,%s,%s,%s,60,%s,%s,%s,CASE WHEN %s THEN now() ELSE NULL END)",
                (wid,kind,cid,gross,gross-95,ok,f'2026-10-{day:02d} 10:00:00+00',invalid))
    queries = []
    original = vehicle_loading_service.cx_query_all
    def record(conn, sql, params):
        queries.append(sql)
        return original(conn, sql, params)
    monkeypatch.setattr(vehicle_loading_service, 'cx_query_all', record)
    state = vehicle_state('v')
    pallets = {p['id']: p for p in state['orders'][0]['pallets']}
    assert pallets['p']['weighing']['id'] == 'w-new'
    assert pallets['p']['weighing']['ok'] is False
    assert pallets['p']['weighing']['gross_kg'] == 110.5
    assert pallets['p']['weighing']['diff_kg'] == 15.5
    assert pallets['p']['on_this_vehicle'] is True
    assert pallets['c']['weighing']['id'] == 'w-stock'
    assert pallets['c']['weighing']['ok'] is True
    assert pallets['c']['on_this_vehicle'] is True
    assert pallets['unweighed']['weighing'] is None  # mroźnia != ważenie
    assert pallets['invalidated']['weighing'] is None
    assert state['totals']['loaded_kg'] == 120  # nadal rozpis, NIE pomiar brutto
    assert sum('FROM cold_storage_weighings' in q for q in queries) == 1
