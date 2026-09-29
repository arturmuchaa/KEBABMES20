"""Werdykt ważenia kartonu przy wjeździe do mroźni — czysta reguła.

Widełki tar od właściciela (29.09.2026): jednorazowa 20–30 kg, EURO 35 kg ±5%,
plastikowa jednorazowa 24 kg ±10%. Zapas netto ustawia biuro per pozycja.
"""
import pytest

from app.utils.wazenie_mrozni import DEFAULT_PALLET_TYPES, normalize_pallet_types, werdykt

EURO = {"id": "euro", "name": "EURO", "tareMinKg": 33.25, "tareMaxKg": 36.75, "marginPct": 1}
JEDNORAZOWA = {"id": "jedn", "name": "Jednorazowa", "tareMinKg": 20, "tareMaxKg": 30, "marginPct": 1}


def test_przyklad_wlasciciela_euro_zgodna():
    w = werdykt(750, 780, EURO)
    assert w["ok"] is True
    # 780 − 35 (środek widełek) − 750 = −5
    assert w["diffKg"] == -5.0
    assert w["tareKg"] == 35.0


def test_brakujaca_sztuka_niezgodna():
    # 15 × 50 kg w systemie, na palecie 14 sztuk: 700 + 35 = 735 brutto
    w = werdykt(750, 735, EURO)
    assert w["ok"] is False
    assert w["diffKg"] == -50.0


def test_granica_zapasu_wlacznie():
    # najniższe dopuszczalne brutto: 750 + 33.25 − 7.5 = 775.75
    assert werdykt(750, 775.75, EURO)["ok"] is True
    assert werdykt(750, 775.7, EURO)["ok"] is False
    # najwyższe: 750 + 36.75 + 7.5 = 794.25
    assert werdykt(750, 794.25, EURO)["ok"] is True
    assert werdykt(750, 794.3, EURO)["ok"] is False


def test_szerokie_widelki_jednorazowej():
    assert werdykt(750, 772, JEDNORAZOWA)["ok"] is True   # tara 22
    assert werdykt(750, 787.5, JEDNORAZOWA)["ok"] is True  # 750 + 30 + zapas 7,5
    assert werdykt(750, 788, JEDNORAZOWA)["ok"] is False


def test_zapas_zero_to_same_widelki_tary():
    t = {**EURO, "marginPct": 0}
    assert werdykt(750, 783.25, t)["ok"] is True
    assert werdykt(750, 783.2, t)["ok"] is False


def test_domyslne_palety_wlasciciela():
    nazwy = {p["id"]: p for p in normalize_pallet_types(DEFAULT_PALLET_TYPES)}
    assert nazwy["euro"]["tareMinKg"] == 33.25 and nazwy["euro"]["tareMaxKg"] == 36.75
    assert nazwy["jednorazowa"]["tareMinKg"] == 20 and nazwy["jednorazowa"]["tareMaxKg"] == 30
    assert nazwy["plastikowa"]["tareMinKg"] == 21.6 and nazwy["plastikowa"]["tareMaxKg"] == 26.4


def test_normalizacja_przecinki_i_id():
    out = normalize_pallet_types([{"name": " Paleta X ", "tareMinKg": "20,5", "tareMaxKg": "25", "marginPct": "1,5"}])
    assert out == [{"id": "paleta-x", "name": "Paleta X", "tareMinKg": 20.5, "tareMaxKg": 25.0, "marginPct": 1.5}]


@pytest.mark.parametrize("zla", [
    [],
    [{"name": "", "tareMinKg": 1, "tareMaxKg": 2}],
    [{"name": "A", "tareMinKg": 30, "tareMaxKg": 20}],
    [{"name": "A", "tareMinKg": -1, "tareMaxKg": 20}],
    [{"name": "A", "tareMinKg": 1, "tareMaxKg": 250}],
    [{"name": "A", "tareMinKg": 1, "tareMaxKg": 2, "marginPct": 50}],
    [{"name": "A", "tareMinKg": "x", "tareMaxKg": 2}],
    [{"name": "A", "tareMinKg": 1, "tareMaxKg": 2}, {"name": "a", "tareMinKg": 1, "tareMaxKg": 2}],
])
def test_normalizacja_odrzuca_smieci(zla):
    with pytest.raises(ValueError):
        normalize_pallet_types(zla)
