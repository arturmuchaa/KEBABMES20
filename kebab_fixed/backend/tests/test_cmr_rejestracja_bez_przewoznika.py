"""CMR: numer rejestracyjny tylko z wybranym przewoźnikiem (biuro, 30.10.2026).

Przy własnym aucie bez przewoźnika numer z kursu (np. KOL47267) nie ma
trafiać na dokument. Bez przewoźnika `_carrier_snapshot` nie pyta bazy."""
from app.services.cmr_service import _carrier_snapshot


def test_bez_przewoznika_nie_ma_numeru():
    assert _carrier_snapshot("", "KOL47267")["plate"] == ""


def test_bez_przewoznika_pusta_reszta_pola():
    snap = _carrier_snapshot("", "KOL47267")
    assert snap["name"] == "" and snap["nip"] == ""


def test_z_przewoznikiem_numer_zostaje(db):
    from app.db import execute
    execute("INSERT INTO carriers (id, name, default_plate) VALUES ('car-1','TRANS SP','WE12345') "
            "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, default_plate=EXCLUDED.default_plate")
    assert _carrier_snapshot("car-1", "KOL47267")["plate"] == "KOL47267"
    assert _carrier_snapshot("car-1", "")["plate"] == "WE12345"


def test_nieistniejacy_przewoznik_jak_brak(db):
    assert _carrier_snapshot("car-nie-ma", "KOL47267")["plate"] == ""
