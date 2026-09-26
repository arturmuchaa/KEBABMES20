"""Regresje audytu HMI: karton→auto→kurs, korekta, atomowość i ponowienia."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import HTTPException
from app.db import execute, query_one, query_all
from app.models.production import StockCartonCreate
from app.services import loading_service, pallets_service, vehicle_loading_service as vehicles
from app.services.magazyn_pakowanie_service import (skanuj_sztuke, stan_pakowania,
    wstaw_karton_do_mrozni, kartony_w_mrozni)
from app.services.stock_cartons_service import create_stock_carton, assign_carton_to_order
from app.services.packing_correction_service import undo_pack
from tests.test_finalize_loading_db import _firma, _pojazd, _klient, _receptura, _zamowienie, _wyrob, _przygotuj


def stock(qty=1, packed=True, linked=True):
    _firma(); _pojazd(); _klient(); _receptura(); _zamowienie(qty=qty); _wyrob(qty=qty)
    c = create_stock_carton(StockCartonCreate(client_id='c1',client_name='YALCIN',recipe_id='r1',
        product_type_id='pt1',packaging_name='METAL',kg_per_unit=30,qty=qty))
    for i in range(qty):
        execute("""INSERT INTO finished_units (id,qr_code,client_name,recipe_id,product_type_id,tuleja,
                   weight_kg,status,source_finished_goods_id,batch_no)
                   VALUES (%s,%s,'YALCIN','r1','pt1','METAL',30,'produced','f1','500')""", (f's{i}',f'U|s{i}'))
        if packed:
            assert skanuj_sztuke(f'U|s{i}',c['id'])['result'] == 'ACTIVE'
    if linked:
        assign_carton_to_order(c['id'],'o1')
    vehicles.add_order('v1','o1')
    return c


def test_stock_carton_uses_same_label_through_freezer_loading_and_course(db):
    c = stock(2)
    code = f"SCARTON|{c['id']}"
    assert wstaw_karton_do_mrozni(code)['result'] == 'SUCCESS'
    assert len(kartony_w_mrozni()) == 1
    assert any(o['id']=='o1' for o in pallets_service.active_orders_for_loading())
    assert pallets_service.scan(code,'loaded',vehicle_id='v1')['result'] == 'SUCCESS'
    assert pallets_service.orders_on_vehicle('v1')[0]['loaded_pallets'] == 1
    assert pallets_service.scan(code,'loaded',vehicle_id='v1')['result'] == 'ALREADY_SCANNED'
    state = vehicles.vehicle_state('v1')
    assert state['totals']['loaded_pallets'] == 1
    assert state['orders'][0]['pallets'][0]['scan_code'] == code
    assert kartony_w_mrozni() == []
    pallets_service.scan(code,'undo',vehicle_id='v1')
    assert len(kartony_w_mrozni()) == 1
    pallets_service.scan(code,'loaded',vehicle_id='v1')
    for action in (lambda: vehicles.remove_order('v1','o1'), lambda: vehicles.clear_vehicle('v1')):
        with pytest.raises(HTTPException): action()
    result = loading_service.finalize_loading('v1',['o1'],request_id='retry-stock',expected_ids=[c['id']])
    assert result['ok'] and result['loading_id']
    assert result['orders'][0]['units'] == 2
    assert query_one("SELECT COUNT(*) AS n FROM finished_units WHERE status='shipped'")['n'] == 2
    assert query_one("SELECT shipped_at FROM stock_cartons WHERE id=%s",(c['id'],))['shipped_at']
    assert vehicles.vehicle_state('v1')['orders'] == []
    assert kartony_w_mrozni() == []
    retry = loading_service.finalize_loading('v1',['o1'],request_id='retry-stock',expected_ids=[c['id']])
    assert retry['loading_id'] == result['loading_id']
    assert len(query_all('SELECT id FROM loadings')) == 1


def test_carton_without_order_or_on_other_vehicle_is_rejected(db):
    c = stock(linked=False)
    code = f"SCARTON|{c['id']}"
    with pytest.raises(HTTPException):
        pallets_service.scan(code,'loaded',vehicle_id='v1')
    assign_carton_to_order(c['id'],'o1')
    pallets_service.scan(code,'loaded',vehicle_id='v1')
    _pojazd('v2')
    vehicles.add_order('v2','o1')
    with pytest.raises(HTTPException): pallets_service.scan(code,'loaded',vehicle_id='v2')
    with pytest.raises(HTTPException): pallets_service.scan(code,'undo',vehicle_id='v2')
    with pytest.raises(HTTPException): wstaw_karton_do_mrozni(code)


def test_stock_carton_warns_about_prior_unloaded_order(db):
    c = stock()
    execute("INSERT INTO client_orders (id,order_no,client_id,client_name) VALUES ('o2','TEST/2','c1','YALCIN')")
    execute("INSERT INTO order_pallets (id,order_id,pallet_no,status) VALUES ('waiting','o2',1,'created')")
    vehicles.add_order('v1','o2')
    execute("UPDATE vehicle_loading_orders SET position=CASE WHEN order_id='o2' THEN 0 ELSE 1 END WHERE vehicle_id='v1'")
    result = pallets_service.scan(f"SCARTON|{c['id']}",'loaded',vehicle_id='v1')
    assert result['result'] == 'SUCCESS'
    assert result['out_of_sequence']['czeka']['order_no'] == 'TEST/2'


def test_undo_packing_reopens_carton_and_records_operator(db):
    c = stock()
    undo_pack('U|s0', c['id'], 'operator-1')
    unit = query_one("SELECT * FROM finished_units WHERE id='s0'")
    assert unit['status'] == 'produced' and unit['carton_id'] is None
    assert unit['client_name'] == 'YALCIN'
    assert query_one('SELECT status,packed_qty FROM stock_cartons WHERE id=%s',(c['id'],)) == {'status':'open','packed_qty':0}
    assert query_one("SELECT operator FROM warehouse_events WHERE action='unpack'")['operator'] == 'operator-1'
    with pytest.raises(HTTPException): undo_pack('U|s0',c['id'],'operator-1')
    with pytest.raises(HTTPException): pallets_service.scan(f"SCARTON|{c['id']}",'loaded',vehicle_id='v1')
    assert skanuj_sztuke('U|s0',c['id'])['result'] == 'ACTIVE'
    wstaw_karton_do_mrozni(f"SCARTON|{c['id']}")
    with pytest.raises(HTTPException): undo_pack('U|s0',c['id'],'operator-1')


def test_course_failure_rolls_back_shipping_and_vehicle_list(db, monkeypatch):
    _przygotuj()
    vehicles.add_order('v1','o1')
    def fail(*a, **kw): raise RuntimeError('injected course failure')
    monkeypatch.setattr(loading_service,'_zapisz_kurs',fail)
    with pytest.raises(RuntimeError): loading_service.finalize_loading('v1',['o1'])
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")['status'] == 'loaded'
    assert query_one("SELECT COUNT(*) AS n FROM finished_units WHERE status='packed'")['n'] == 10
    assert vehicles.order_ids_on_vehicle('v1') == ['o1']
    assert query_all('SELECT id FROM loadings') == []


def test_changed_load_requires_new_confirmation(db):
    _przygotuj()
    with pytest.raises(HTTPException):
        loading_service.finalize_loading('v1',['o1'],request_id='changed',expected_ids=[])
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")['status'] == 'loaded'


def test_stock_and_legacy_pallet_on_same_order_both_reach_course(db):
    c = stock()
    execute("UPDATE client_order_lines SET qty=2,total_kg=60 WHERE order_id='o1'")
    execute("UPDATE finished_goods SET qty=2,qty_available=2,total_kg=60 WHERE id='f1'")
    execute("INSERT INTO order_pallets (id,order_id,pallet_no,status,loaded_vehicle_id) VALUES ('legacy','o1',1,'loaded','v1')")
    execute("INSERT INTO order_pallet_items (id,pallet_id,order_line_id,qty) VALUES ('li','legacy','o1-l1',1)")
    pallets_service.scan(f"SCARTON|{c['id']}",'loaded',vehicle_id='v1')
    result = loading_service.finalize_loading('v1',['o1'])
    assert result['orders'][0]['pallets'] == 2
    assert sum(p['szt'] for p in result['orders'][0]['pozycje']) == 2


def test_two_simultaneous_confirmations_create_one_course(db):
    _przygotuj()
    barrier = Barrier(2)
    def finish():
        barrier.wait(timeout=10)
        return loading_service.finalize_loading('v1',['o1'],request_id='one-request',expected_ids=['p1'])
    with ThreadPoolExecutor(max_workers=2) as executor:
        a,b = list(executor.map(lambda _: finish(),range(2)))
    assert a['loading_id'] == b['loading_id']
    assert len(query_all('SELECT id FROM loadings')) == 1


def test_pallet_lines_distinguish_packaging_and_undo(db):
    from tests.test_magazyn_pakowanie_db import _paleta, _sztuka, _receptury
    _receptury()
    pid = _paleta('o1','YALCIN',qty=1)
    execute("UPDATE client_order_lines SET packaging_name='METAL 80' WHERE id='o1-l1'")
    execute("""INSERT INTO client_order_lines (id,order_id,recipe_id,recipe_name,product_type_id,qty,kg_per_unit,packaging_name)
        VALUES ('l2','o1','r1','KIRMIZI','p1',1,15,'METAL 100')""")
    execute("INSERT INTO order_pallet_items (id,pallet_id,order_line_id,qty) VALUES ('i2',%s,'l2',1)",(pid,))
    _sztuka('u1',tuleja='METAL 80'); _sztuka('u2',tuleja='METAL 100'); _sztuka('u3',tuleja='METAL 80')
    assert skanuj_sztuke('U|u1',pid)['result'] == 'ACTIVE'
    assert skanuj_sztuke('U|u3',pid)['result'] == 'NO_PLACE'
    assert not pallets_service.pack_unit_into_pallet(pid,'U|u3')['ok']
    lines = stan_pakowania()['kontenery'][0]['lines']
    assert {l['packagingName']:l['packedQty'] for l in lines} == {'METAL 80':1,'METAL 100':0}
    assert skanuj_sztuke('U|u2',pid)['full']
    undo_pack('U|u2',pid,'operator-1')
    assert query_one('SELECT status FROM order_pallets WHERE id=%s',(pid,))['status'] == 'packing'
    assert skanuj_sztuke('U|u2',pid)['full']
