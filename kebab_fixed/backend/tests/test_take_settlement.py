import pytest
from pydantic import ValidationError

from app.models.deboning_settlement import SettlementWeighing
from app.services.take_settlement_service import mass_balance


@pytest.mark.parametrize('total,ok', [(297, True), (303, True), (300, True), (296.99, False), (303.01, False)])
def test_one_percent_inclusive(total, ok):
    result = mass_balance(300, 200, 55, total - 255)
    assert result['withinTolerance'] is ok
    assert result['tolerancePct'] == 1
    assert result['toleranceKg'] == 3
    assert result['minKg'] == 297 and result['maxKg'] == 303


def test_small_take_has_no_hidden_one_kg_floor():
    assert mass_balance(15, 10, 3, 2.15)['withinTolerance']
    assert not mass_balance(15, 10, 3, 2.16)['withinTolerance']
    assert not mass_balance(0, 0, 0, 0)['withinTolerance']


def test_decimal_boundary_does_not_depend_on_float_rounding():
    assert mass_balance('15.3', '10', '3', '2.453')['withinTolerance']
    assert not mass_balance('15.3', '10', '3', '2.454')['withinTolerance']


def measurement(**overrides):
    return SettlementWeighing(requestId='test-request', kind='meat', **{
        'kgNet': 100, 'weighMode': 'auto', 'kgGross': 116,
        'tareCartKg': 6, 'tareE2Kg': 10, 'e2Count': 5, **overrides,
    })


@pytest.mark.parametrize('overrides', [
    {'kgNet': float('nan')}, {'kgNet': float('inf')}, {'kgNet': -1}, {'kgNet': 0},
    {'kgGross': None}, {'tareCartKg': None}, {'e2Count': 4}, {'kgNet': 101},
    {'weighMode': 'manual'},
])
def test_invalid_measurement_rejected(overrides):
    with pytest.raises(ValidationError):
        measurement(**overrides)


def test_auto_and_explicit_manual_measurements():
    assert measurement().kg_net == 100
    assert measurement(weighMode='manual', reason='Waga niedostępna').kg_net == 100


def test_scale_measurement_must_subtract_cart_and_containers():
    """Net from the scale = gross − carts − E2 × 2 kg; anything else is refused (2026-11-06 check)."""
    import pytest
    from pydantic import ValidationError
    from app.models.deboning_settlement import SettlementWeighing
    base = {'requestId': 'abcdefgh-1', 'kind': 'meat', 'weighMode': 'auto', 'kgGross': 132, 'tareCartKg': 12, 'tareE2Kg': 10, 'e2Count': 5}
    assert SettlementWeighing(**base, kgNet=110).kg_net == 110          # two 6 kg carts + 5 E2
    with pytest.raises(ValidationError, match='Netto nie zgadza'):
        SettlementWeighing(**base, kgNet=154)                          # tare added instead of subtracted
    with pytest.raises(ValidationError, match='Tara E2'):
        SettlementWeighing(**{**base, 'tareE2Kg': 8}, kgNet=112)       # containers × 2 kg must match
