from copy import deepcopy
from decimal import Decimal

import pytest

from app.services.order_planning_service import project_line, technology, enrich_orders
from app.services import order_planning_service as svc
from app.services.recipes_service import calc_kg_output


LINE = dict(id='l', qty=40, kg_per_unit=20, recipe_id='r', product_type_id='udo', packaging_id='65', qty_done=0)
RECIPE = {'total_output_per_100kg': 125}
INGREDIENTS = [{'unit': 'l', 'qty_per_100kg': 20, 'is_unlimited': True}, {'unit': 'kg', 'qty_per_100kg': 5}]


def report(**overrides):
    return {**LINE, 'id': 'pl', 'client_order_line_id': 'l', 'qty_done': 5, 'posted_qty': 0, 'plan_status': 'active', **overrides}


def project(line=None, reports=None, recipe=RECIPE, ingredients=INGREDIENTS, status='confirmed'):
    return project_line({**LINE, **(line or {})}, reports or [], recipe, ingredients, status)


def test_5_of_40_before_acceptance_uses_actual_report_not_plan_or_pallet_count():
    production, mixing = project(reports=[report(qty=100, packed_qty=5)])
    assert production == {'reported_qty': 5, 'reported_kg': 100, 'remaining_qty': 35, 'remaining_kg': 700, 'unposted_qty': 5, 'source': 'linked_plan_reports'}
    assert mixing['remaining_kg'] == 700
    assert mixing['meat_kg'] == 560
    assert mixing['additives_kg'] == 140
    assert mixing['growth_pct'] == 25


@pytest.mark.parametrize('reported,remaining,meat', [(0, 2450, 1960), (20, 1950, 1560), (98, 0, 0)])
def test_user_examples_with_real_recipe(reported, remaining, meat):
    _, mixing = project({'qty': 98, 'kg_per_unit': 25}, [report(kg_per_unit=25, qty_done=reported)])
    assert mixing['remaining_kg'] == remaining
    assert mixing['meat_kg'] == meat


def test_posted_production_never_added_to_stock_and_deliveries_again():
    production, mixing = project({'qty_done': 5, 'qty_stock': 3, 'qty_delivered': 2}, [report(posted_qty=5)])
    assert production['reported_qty'] == 5
    assert mixing['remaining_qty'] == 35


def test_unposted_and_stock_overlap_is_unknown_not_sum_or_max():
    production, mixing = project({'qty_done': 3}, [report()])
    assert production['reported_qty'] == 5
    assert mixing['remaining_qty'] is None
    assert mixing['meat_kg'] is None
    assert 'te same sztuki' in mixing['reason']


def test_product_reallocated_away_does_not_reduce_new_demand():
    production, mixing = project(reports=[report(qty_done=40, posted_qty=40)])
    assert production['reported_qty'] == 40
    assert mixing['remaining_qty'] == 40  # stock no longer belongs to this order


def test_closed_or_cancelled_not_manufactured_by_status():
    for status in ('done', 'cancelled'):
        p, m = project(status=status, recipe=None, ingredients=[])
        assert p['reported_qty'] == 0
        assert m['meat_kg'] == 0
        assert m['remaining_kg'] == 0


def test_overproduction_retained_but_remainder_never_negative():
    p, m = project(reports=[report(qty_done=48)])
    assert p['reported_qty'] == 48
    assert p['remaining_qty'] == 0
    assert m['remaining_qty'] == 0


def test_duplicate_report_ids_and_cancelled_plans_never_added():
    p, _ = project(reports=[report(), report(), report(id='cancel', plan_status='cancelled', qty_done=100)])
    assert p['reported_qty'] == 5


@pytest.mark.parametrize('field,value', [('recipe_id', 'other'), ('product_type_id', 'mix'), ('kg_per_unit', 40), ('packaging_id', '80')])
def test_linked_but_mismatched_variant_is_unknown(field, value):
    p, m = project(reports=[report(**{field: value})])
    assert p is None
    assert m['meat_kg'] is None
    assert 'inny wariant' in m['reason']


@pytest.mark.parametrize('recipe,ingredients', [
    (None, INGREDIENTS), (RECIPE, []), ({'total_output_per_100kg': 130}, INGREDIENTS),
    (RECIPE, [{'unit': 'kg', 'qty_per_100kg': -1}]),
    (RECIPE, [{'unit': 'g', 'qty_per_100kg': 25000}]),
    (RECIPE, [{'unit': 'l', 'qty_per_100kg': 25, 'is_unlimited': False}]),
    (RECIPE, [{'unit': 'kg', 'qty_per_100kg': 'NaN'}]),
    ({'total_output_per_100kg': 'NaN'}, INGREDIENTS),
    ({'total_output_per_100kg': -1}, INGREDIENTS),
    (RECIPE, [{'unit': ' kg ', 'qty_per_100kg': 25}]),
])
def test_unreliable_yield_never_defaults_to_25_or_100(recipe, ingredients):
    _, mixing = project(recipe=recipe, ingredients=ingredients)
    assert mixing['meat_kg'] is None
    assert mixing['growth_pct'] is None
    assert mixing['reason']


def test_calculation_agrees_with_mixing_service(monkeypatch):
    monkeypatch.setattr('app.services.recipes_service.query_all', lambda *a: INGREDIENTS)
    output, issue = technology(RECIPE, INGREDIENTS)
    assert issue is None
    assert output == Decimal(str(calc_kg_output('r', 100))) == 125


def test_non_integer_meat_not_rounded_to_full_mixer_batch():
    _, m = project({'qty': 1, 'kg_per_unit': 20.125})
    assert m['meat_kg'] == 16.1
    assert m['additives_kg'] == 4.025


@pytest.mark.parametrize('weight', [None, 0, -5, 'NaN', 'Infinity', 'invalid'])
def test_invalid_weight_never_means_zero_demand(weight):
    production, mixing = project({'kg_per_unit': weight}, [report()])
    assert production is None
    assert mixing['remaining_kg'] is None
    assert mixing['meat_kg'] is None
    assert 'wagi' in mixing['reason']


def test_invalid_report_weight_fails_closed():
    production, mixing = project(reports=[report(kg_per_unit='invalid')])
    assert production is None
    assert mixing['meat_kg'] is None


def test_batch_queries_are_bounded_and_lines_not_reallocated_on_filter(monkeypatch):
    calls = []
    def query(sql, params):
        calls.append(sql)
        if 'production_plan_lines' in sql:
            return [report(posted_qty=5)]
        if 'recipe_ingredients' in sql:
            return [dict(i, recipe_id='r') for i in INGREDIENTS]
        return [dict(RECIPE, id='r')]
    monkeypatch.setattr(svc, 'query_all', query)
    orders = [{'id': str(i), 'status': 'confirmed', 'lines': [{**LINE, 'id': 'l' if i == 0 else f'l{i}', 'qty_done': 5}]} for i in range(100)]
    result = enrich_orders(deepcopy(orders))
    assert len(calls) == 3
    assert result[0]['lines'][0]['production']['reported_qty'] == 5
    assert result[1]['lines'][0]['production']['reported_qty'] == 0
    assert all(o['lines'][0]['mixing']['remaining_qty'] == 35 for o in result)
    assert 'production' not in orders[0]['lines'][0]
