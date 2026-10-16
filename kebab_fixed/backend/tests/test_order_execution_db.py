from app.db import execute, query_all
from app.services.orders_service import list_orders
from app.services.order_planning_service import enrich_orders
from app.routes.orders import list_orders as route_list


def seed():
    execute("INSERT INTO recipes(id,name,total_output_per_100kg) VALUES ('r','BEYAZ',125)")
    execute("INSERT INTO ingredients(id,name,unit,is_unlimited) VALUES ('water','Woda','l',true), ('spice','Przyprawa','kg',false)")
    execute("INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,qty_per_100kg,unit) VALUES ('ri1','r','water',20,'l'), ('ri2','r','spice',5,'kg')")
    execute("INSERT INTO client_orders(id,order_no,status,order_date) VALUES ('o','Z/1','confirmed','2026-10-15')")
    execute("INSERT INTO client_order_lines(id,order_id,recipe_id,qty,kg_per_unit,product_type_id,packaging_id) VALUES ('l','o','r',40,20,'udo','65')")
    execute("INSERT INTO production_plans(id,plan_no,plan_date,status) VALUES ('p','P/1','2026-10-15','active')")
    execute("INSERT INTO production_plan_lines(id,plan_id,client_order_id,client_order_line_id,recipe_id,qty,qty_done,kg_per_unit,product_type_id,packaging_id) VALUES ('pl','p','o','l','r',40,5,20,'udo','65')")


def test_route_projects_hmi_and_recipe_without_mutations(db):
    seed()
    before = query_all('SELECT * FROM production_plan_lines')
    order = route_list(status='', planning=True)[0]
    assert order['lines'][0]['production']['reported_qty'] == 5
    assert order['lines'][0]['mixing']['meat_kg'] == 560
    assert before == query_all('SELECT * FROM production_plan_lines')
    assert query_all('SELECT * FROM stock_movements') == []
    assert 'production' not in route_list(status='', planning=False)[0]['lines'][0]


def test_sessions_deduplicate_posted_report_and_coverage(db):
    seed()
    execute("INSERT INTO finished_goods(id,batch_no,recipe_id,qty,qty_available,kg_per_unit,product_type_id,packaging_id) VALUES ('fg','B/1','r',5,5,20,'udo','65')")
    execute("INSERT INTO finished_goods_sessions(id,goods_id,plan_line_id,qty,total_kg) VALUES ('s1','fg','pl',2,40), ('s2','fg','pl',3,60)")
    line = enrich_orders(list_orders(None))[0]['lines'][0]
    assert line['qty_done'] == 5
    assert line['production']['reported_qty'] == 5
    assert line['production']['unposted_qty'] == 0
    assert line['mixing']['remaining_qty'] == 35


def test_cancelled_and_variant_changes_fail_safely(db):
    seed()
    execute("UPDATE production_plans SET status='cancelled'")
    assert enrich_orders(list_orders(None))[0]['lines'][0]['production']['reported_qty'] == 0
    execute("UPDATE production_plans SET status='active'")
    execute("UPDATE production_plan_lines SET packaging_id='80'")
    line = enrich_orders(list_orders(None))[0]['lines'][0]
    assert line['production'] is None
    assert line['mixing']['meat_kg'] is None
