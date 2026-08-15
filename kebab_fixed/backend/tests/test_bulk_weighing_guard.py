"""Strażnik ważenia zbiorczego: paleta nie może wziąć z partii więcej mięsa,
niż ta partia dała.

Ważenie zbiorcze nie rusza stanu magazynowego (paleta to OPIS), więc żaden
istniejący mechanizm tego nie pilnował — operator mógł zważyć 10 ton z partii,
która dała 3 tony, i nic go nie zatrzymywało. Limitem jest to, co partia dała
na rozbiorze, a licznikiem — suma tego, co już z niej wyszło na paletach.

Czyste funkcje, bez DB.
"""
from app.services.meat_pallets_service import validate_bulk_lots


def test_paleta_w_granicach_partii_przechodzi():
    assert validate_bulk_lots([("478", 800.0)], {"478": 918.5}) is None


def test_paleta_ponad_wydajnosc_partii_nie_przechodzi():
    err = validate_bulk_lots([("478", 800.0)], {"478": 118.5})
    assert err is not None
    assert "478" in err
    assert "118,5" in err or "118.5" in err


def test_ta_sama_partia_dwa_razy_na_palecie_sumuje_sie():
    """Bez sumowania operator obszedłby limit, wpisując partię w dwóch
    wierszach po połowie."""
    assert validate_bulk_lots([("478", 500.0), ("478", 500.0)], {"478": 800.0}) is not None
    assert validate_bulk_lots([("478", 400.0), ("478", 400.0)], {"478": 800.0}) is None


def test_partia_spoza_magazynu_miesa_nie_blokuje():
    """Stare dane i mięso przyjęte z zewnątrz nie mają lotu z rozbioru —
    brak wiersza to brak wiedzy, a nie zero kilogramów."""
    assert validate_bulk_lots([("999", 800.0)], {}) is None
    assert validate_bulk_lots([("999", 800.0)], {"999": None}) is None


def test_dokladnie_tyle_ile_zostalo_przechodzi():
    assert validate_bulk_lots([("478", 118.5)], {"478": 118.5}) is None


def test_zaokraglenie_wagi_nie_wywraca_zapisu():
    """Waga podaje 0,1 kg, składy liczą się po kilku dodawaniach — 5 dag
    ponad limit to zaokrąglenie, nie nadużycie."""
    assert validate_bulk_lots([("478", 118.53)], {"478": 118.5}) is None
    assert validate_bulk_lots([("478", 119.0)], {"478": 118.5}) is not None


def test_partia_juz_przekroczona_pokazuje_zero_a_nie_ujemne():
    err = validate_bulk_lots([("478", 100.0)], {"478": -50.0})
    assert err is not None
    assert "-" not in err.split("zostało")[1].split("kg")[0]


def test_komunikat_mowi_co_zrobic():
    err = validate_bulk_lots([("478", 800.0)], {"478": 118.5})
    assert "kolejnej partii" in err
