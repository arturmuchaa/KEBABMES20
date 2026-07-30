"""Czysta logika pojemników — bez DB, bez I/O."""
from app.utils.containers import (
    ASSET_TYPES,
    CALIBERS,
    containers_for_kg,
    format_container_doc_number,
    normalize_name,
    normalize_nip,
    prorate_containers,
)


# ── Przeliczenie kg → pojemniki ──────────────────────────────────────
def test_kaliber_15_dzieli_bez_reszty():
    assert containers_for_kg(300, 15) == 20


def test_kaliber_15_niepelny_pojemnik_liczy_sie_w_calosci():
    # 305 kg = 20 pełnych + 5 kg → 21 fizycznych pojemników (ceil, nie floor!)
    assert containers_for_kg(305, 15) == 21


def test_kaliber_20():
    assert containers_for_kg(300, 20) == 15
    assert containers_for_kg(310, 20) == 16


def test_niekalibrowany_nie_da_sie_wyliczyc():
    assert containers_for_kg(1000, None) is None


def test_zero_i_ujemne_kg_to_zero_pojemnikow():
    assert containers_for_kg(0, 15) == 0
    assert containers_for_kg(-5, 15) == 0


def test_kaliber_zerowy_traktowany_jak_niekalibrowany():
    assert containers_for_kg(100, 0) is None


def test_dostepne_kalibry():
    assert CALIBERS == (15.0, 20.0, None)
    # E2 pierwsze — to główny nośnik; reszta rodzajów w test_kazdy_rodzaj_*.
    assert ASSET_TYPES[0] == "e2"


# ── Proporcja dla partii niekalibrowanej ─────────────────────────────
def test_prorate_polowa_partii_to_polowa_pojemnikow():
    assert prorate_containers(400, 3000, 6000) == 200


def test_prorate_bez_danych_zrodlowych():
    assert prorate_containers(None, 1, 2) is None
    assert prorate_containers(400, 1, 0) is None
    assert prorate_containers(400, 0, 6000) is None


def test_prorate_niezerowa_czesc_to_minimum_jeden_pojemnik():
    # 1 kg z 6000 kg → 0.07 pojemnika, ale fizycznie to nadal jeden pojemnik
    assert prorate_containers(400, 1, 6000) == 1


# ── Normalizacja tożsamości kontrahenta ──────────────────────────────
def test_normalize_nip_zdejmuje_myslniki_i_spacje():
    assert normalize_nip("513-006-44-78") == "5130064478"
    assert normalize_nip(" 513 006 44 78 ") == "5130064478"


def test_normalize_nip_pusty():
    assert normalize_nip(None) == ""
    assert normalize_nip("") == ""


def test_normalize_name_scala_biale_znaki_i_wielkosc():
    assert normalize_name("  FHUP   MAREK  Księżyc ") == "fhup marek księżyc"
    assert normalize_name(None) == ""


# ── Numeracja dokumentu ──────────────────────────────────────────────
def test_format_numeru_dokumentu():
    assert format_container_doc_number(7, "2607") == "POJ/7/07/26"
    assert format_container_doc_number(112, "2612") == "POJ/112/12/26"


# ── Rodzaje nośników (2026-07-30) ────────────────────────────────────
# Siatki E1 nie zwraca się europaletą, więc każdy rodzaj ma własne saldo.
def test_kazdy_rodzaj_nosnika_ma_wlasny_typ():
    from app.utils.containers import ASSET_TYPES
    for a in ("e2", "net_e1", "pallet_h1", "pallet_euro", "pallet_plastic", "pallet_wood"):
        assert a in ASSET_TYPES, f"brak typu {a}"


def test_stary_typ_zostaje_dla_danych_historycznych():
    from app.utils.containers import ASSET_TYPES
    assert "pallet_other" in ASSET_TYPES


def test_kazdy_typ_ma_etykiete_na_druk_i_do_tabel():
    from app.utils.containers import ASSET_LABELS, ASSET_SHORT, ASSET_TYPES
    for a in ASSET_TYPES:
        assert ASSET_LABELS.get(a), f"brak etykiety druku dla {a}"
        assert ASSET_SHORT.get(a), f"brak krótkiej etykiety dla {a}"


def test_lista_rozwijana_innych_opakowan():
    """Kolejność jak podał zakład: siatka E1, plastik, europaleta, drewniana."""
    from app.utils.containers import OTHER_CARRIER_KINDS
    assert [k["value"] for k in OTHER_CARRIER_KINDS] == [
        "net_e1", "pallet_plastic", "pallet_euro", "pallet_wood"]
    assert OTHER_CARRIER_KINDS[0]["label"] == "Siatka E1"
