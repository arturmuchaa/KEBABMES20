from types import SimpleNamespace

import pytest

from app.services import production_plans_service as svc


@pytest.mark.parametrize('selected', [[], ['udo', 'filet'], ['udo']])
def test_component_selection_limits_pool_and_preserves_ratio(monkeypatch, selected):
    rows = {
        'udo': dict(id='udo', batch_no='711', material_type_id='thigh',
                    kg_available=2031.2, kg_reserved=0, expiry_date='2026-11-22'),
        'filet': dict(id='filet', batch_no='715', material_type_id='fillet',
                      kg_available=253.9, kg_reserved=72, expiry_date='2026-11-22'),
    }
    for row in rows.values():
        row.update(status='available', recipe_id='kirmizi')

    def query_all(conn, sql, params):
        material, recipe, automatic, ids = params
        assert recipe == 'kirmizi'
        assert 'recipe_id = %s' in sql
        assert 'id = ANY(%s)' in sql
        assert ids == selected
        return [{'id': key} for key, row in rows.items()
                if row['material_type_id'] == material and (automatic or key in ids)]

    monkeypatch.setattr(svc, 'cx_query_all', query_all)
    monkeypatch.setattr(svc, 'cx_query_one', lambda conn, sql, params: rows[params[0]])
    line = SimpleNamespace(qty=10, kg_per_unit=20, recipe_id='kirmizi',
                           seasoned_batch_ids=selected, seasoned_batch_id=None)
    _, allocation, _, _ = svc._compute_component_allocation(None, line, [
        {'materialTypeId': 'thigh', 'pct': 95},
        {'materialTypeId': 'fillet', 'pct': 5},
    ])
    if selected == ['udo']:
        assert not allocation  # Never silently replace a missing selected component.
    else:
        assert allocation['711/715']['pieces'] == 10
        assert svc._allocation_kg_per_batch(allocation) == {'udo': 190, 'filet': 10}
