"""95/5: explicit 711/715, proportional reservation, edit and shared stock."""
import json

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.services import production_plans_service as svc


def batch(bid, no, material, kg, reserved=0, recipe='kirmizi', expiry='2026-11-22', status='available'):
    execute("""INSERT INTO seasoned_meat
        (id,batch_no,recipe_id,material_type_id,production_day,expiry_date,
         kg_produced,kg_available,kg_reserved,status)
        VALUES (%s,%s,%s,%s,'2026-11-16',%s,%s,%s,%s,%s)""",
        (bid, no, recipe, material, expiry, kg, kg, reserved, status))


@pytest.fixture
def stock(db):
    components = [dict(materialTypeId='thigh', name='Udo', pct=95),
                  dict(materialTypeId='fillet', name='Filet', pct=5)]
    execute("INSERT INTO product_types(id,name,components) VALUES ('mix','95/5',%s::jsonb)",
            (json.dumps(components),))
    execute("INSERT INTO recipes(id,name,components) VALUES ('kirmizi','KIRMIZI','[]')")
    batch('udo', '711', 'thigh', 2031.2)
    batch('filet', '715', 'fillet', 253.9, reserved=72)
    # Older available batch must NOT override an explicit choice.
    batch('old', '700', 'fillet', 500, expiry='2026-11-20')


def line(qty=10, ids=None, product='mix', **kw):
    return PlanLineCreate(qty=qty, kg_per_unit=20, recipe_id='kirmizi',
                          product_type_id=product, seasoned_batch_ids=['udo', 'filet'] if ids is None else ids, **kw)


def dto(*lines):
    return ProductionPlanCreate(plan_date='2026-11-17', lines=list(lines))


def reservations():
    return {r['id']: float(r['kg_reserved']) for r in query_all('SELECT id,kg_reserved FROM seasoned_meat')}


def test_manual_create_read_edit_and_activate_preserve_711_715(stock):
    plan = svc.create_plan(dto(line()))
    saved = svc.get_plan(plan['id'])['lines'][0]
    assert saved['batch_allocation'] == {
        '711/715': {'pieces': 10, 'kg': 200, 'parts': {
            '711': {'batch_id': 'udo', 'kg': 190},
            '715': {'batch_id': 'filet', 'kg': 10},
        }}}
    assert reservations() == {'udo': 190, 'filet': 82, 'old': 0}
    svc.update_plan(plan['id'], dto(line(id=saved['id'])))
    assert reservations() == {'udo': 190, 'filet': 82, 'old': 0}
    svc.update_plan_status(plan['id'], 'active')
    assert reservations() == {'udo': 190, 'filet': 82, 'old': 0}


def test_component_share_not_whole_piece_controls_capacity(stock):
    execute("UPDATE seasoned_meat SET kg_available=190 WHERE id='udo'")
    execute("UPDATE seasoned_meat SET kg_available=82 WHERE id='filet'")
    plan = svc.create_plan(dto(line()))  # 190 + (82 - 72) = ten complete 20 kg pieces
    assert plan['lines'][0]['batch_allocation']['711/715']['pieces'] == 10


@pytest.mark.parametrize('ids', [['udo'], ['filet'], ['udo', 'wrong'], ['udo', 'blocked']])
def test_missing_or_wrong_component_rejected_atomically(stock, ids):
    batch('wrong', '999', 'fillet', 500, recipe='other')
    batch('blocked', '998', 'fillet', 500, status='used')
    before = reservations()
    with pytest.raises(HTTPException) as exc:
        svc.create_plan(dto(line(ids=ids)))
    assert exc.value.status_code == 400
    assert '95%' in str(exc.value.detail) and '5%' in str(exc.value.detail)
    assert reservations() == before
    assert query_all('SELECT id FROM production_plans') == []


def test_other_plan_reservations_cannot_be_reused(stock):
    execute("UPDATE seasoned_meat SET kg_reserved=250 WHERE id='filet'")
    before = reservations()
    with pytest.raises(HTTPException):
        svc.create_plan(dto(line()))
    assert reservations() == before


@pytest.mark.parametrize('ordinary_first', [False, True])
def test_component_and_ordinary_lines_share_snapshot(stock, ordinary_first):
    execute("UPDATE seasoned_meat SET kg_available=390 WHERE id='udo'")
    ordinary = line(ids=['udo'], product='')  # 200 kg
    mixed = line()  # 190 kg thigh and 10 kg fillet
    plan = svc.create_plan(dto(*([ordinary, mixed] if ordinary_first else [mixed, ordinary])))
    assert len(plan['lines']) == 2
    assert reservations() == {'udo': 390, 'filet': 82, 'old': 0}


def test_two_component_lines_do_not_share_same_kilograms(stock):
    execute("UPDATE seasoned_meat SET kg_available=190 WHERE id='udo'")
    with pytest.raises(HTTPException):
        svc.create_plan(dto(line(), line()))
    assert reservations() == {'udo': 0, 'filet': 72, 'old': 0}


def test_auto_fefo_uses_correct_recipe_and_can_be_overridden(stock):
    batch('wrong', '699', 'fillet', 500, recipe='other', expiry='2026-11-19')
    plan = svc.create_plan(dto(line(ids=[])))
    assert set(plan['lines'][0]['batch_allocation']) == {'711/700'}
    svc.update_plan(plan['id'], dto(line(id=plan['lines'][0]['id'])))
    assert reservations() == {'udo': 190, 'filet': 82, 'old': 0, 'wrong': 0}


def test_failed_edit_restores_original_reservations_and_allocation(stock):
    plan = svc.create_plan(dto(line()))
    before = reservations()
    saved = svc.get_plan(plan['id'])
    with pytest.raises(HTTPException):
        svc.update_plan(plan['id'], dto(line(qty=999, id=plan['lines'][0]['id'])))
    assert reservations() == before
    assert svc.get_plan(plan['id']) == saved


def test_started_component_line_is_not_reallocated(stock):
    plan = svc.create_plan(dto(line()))
    lid = plan['lines'][0]['id']
    execute('UPDATE production_plan_lines SET qty_done=1 WHERE id=%s', (lid,))
    before = query_one('SELECT batch_allocation FROM production_plan_lines WHERE id=%s', (lid,))
    svc.update_plan(plan['id'], dto(line(id=lid), line(qty=1)))
    assert query_one('SELECT batch_allocation FROM production_plan_lines WHERE id=%s', (lid,)) == before
    assert reservations() == {'udo': 209, 'filet': 83, 'old': 0}


def test_fefo_equal_dates_compare_numbers_naturally(stock):
    batch('f100', '100', 'fillet', 50)
    batch('f99', '99', 'fillet', 50)
    plan = svc.create_plan(dto(line(ids=['udo', 'f100', 'f99'])))
    assert set(plan['lines'][0]['batch_allocation']) == {'711/99'}
