"""Czysta logika powiązania kartonu magazynowego z zamówieniem + parser etykiety
SCARTON (ta sama reguła co `skanKodu.idKartonu` we froncie). Bez DB."""
import pytest

from app.services import stock_carton_link_service as link
from app.services.dispatches_service import _parse_stock_carton
from app.services.stock_carton_match_service import match_cartons

ID = "0123456789abcdef0123"


def _ol(lid="l1", kg=30.0, qty=10, pack="", recipe="r1", ptype="pt1"):
    return {"id": lid, "recipe_id": recipe, "product_type_id": ptype, "packaging_id": pack,
            "kg_per_unit": kg, "qty": qty, "product_type_name": "UDO", "packaging_name": ""}


def _cl(kg=30.0, n=2, pack="", recipe="r1", ptype="pt1", packed=None, tuleja="METAL"):
    return {"recipe_id": recipe, "product_type_id": ptype, "packaging_id": pack,
            "packaging_name": tuleja, "kg_per_unit": kg, "target_qty": n,
            "packed_qty": n if packed is None else packed}


def _u(i, kg=30.0, status="packed", tuleja="METAL", **kw):
    return {"id": f"u{i}", "recipe_id": "r1", "product_type_id": "pt1", "tuleja": tuleja,
            "weight_kg": kg, "status": status, **kw}


# ── Klient ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("carton", [
    {"client_id": "c1", "client_name": "YBM"},
    {"client_id": None, "client_name": ""},
    {"client_id": "", "client_name": " Na magazyn "},
    {"client_id": None, "client_name": "MAGAZYN"},
    {"client_id": None, "client_name": "stan"},
])
def test_ten_sam_klient_albo_karton_niczyj(carton):
    assert link.client_reason(carton, "c1") is None


@pytest.mark.parametrize("carton", [
    {"client_id": "c2", "client_name": "Zagros"},
    {"client_id": None, "client_name": "Zagros"},      # sama nazwa nie jest wildcardem
])
def test_obcy_klient_odrzucony(carton):
    assert link.client_reason(carton, "c1")


def test_zamowienie_bez_klienta_nie_przejmuje_kartonu_klienta():
    assert link.client_reason({"client_id": "c1"}, "")


# ── Zgodność i ilość ──────────────────────────────────────────────────────

def test_mieszany_tylko_w_calosci():
    lines = [_cl(30, 2), _cl(15, 1)]
    assert "waga" in link.match_reason({"client_id": "c1"}, lines, "c1", [_ol(kg=30)])
    assert link.match_reason({"client_id": "c1"}, lines, "c1", [_ol(kg=30), _ol("l2", kg=15)]) is None


def test_niezgodna_tuleja_nazwana_w_powodzie():
    r = link.match_reason({"client_id": "c1"}, [_cl(pack="pk2")], "c1", [_ol(pack="pk1")])
    assert r.startswith("Niezgodna tuleja")


def test_powtorzone_specyfikacje_liczone_ilosciowo():
    karton = [_cl(30, 2), _cl(30, 2)]                    # 4 szt. tej samej specyfikacji
    assert "Brak wolnej ilości" in link.match_reason({"client_id": ""}, karton, "c1", [_ol(qty=3)])
    assert link.match_reason({"client_id": ""}, karton, "c1", [_ol(qty=2), _ol("l2", qty=2)]) is None


def test_brak_miejsca_przez_rozpis_mowi_o_rozpisie():
    k = ("r1", "pt1", "", 30.0)
    r = link.match_reason({"client_id": "c1"}, [_cl(30, 2)], "c1", [_ol(qty=10)],
                          pallet_res={k: 7}, carton_res={k: 2})
    assert "wolne 1" in r and link.MSG_ROZPIS in r
    assert link.match_reason({"client_id": "c1"}, [_cl(30, 2)], "c1", [_ol(qty=10)],
                             pallet_res={k: 6}, carton_res={k: 2}) is None


def test_waga_zaokraglona_do_3_miejsc():
    assert link.match_reason({"client_id": "c1"}, [_cl(30.0004, 1)], "c1", [_ol(kg=30.0)]) is None
    assert link.match_reason({"client_id": "c1"}, [_cl(30.002, 1)], "c1", [_ol(kg=30.0)])


def test_match_cartons_niczyj_wchodzi_obcy_nie():
    cartons = [{"id": "k1", "carton_no": 1, "client_id": None, "client_name": "", "lines": [_cl(30, 2)]},
               {"id": "k2", "carton_no": 2, "client_id": "c9", "lines": [_cl(30, 2)]}]
    assert [s["cartonId"] for s in match_cartons("c1", [_ol()], cartons)] == ["k1"]


def test_nadmiar_rezerwacji_tylko_dla_specyfikacji_z_kartonami():
    a, b = ("r1", "pt1", "", 30.0), ("r1", "pt1", "", 15.0)
    assert link.overflow_by_spec({a: 3, b: 1}, {a: 2, b: 5}, {a: 2}) == {a: 1}


# ── Kompletność kartonu ───────────────────────────────────────────────────

def _carton(**kw):
    return {"status": "packed", **kw}


def test_kompletny_karton_przechodzi_mroznia_nie_blokuje():
    assert link.completeness_reason(_carton(cold_storage_at="x"), [_cl(30, 2)], [_u(1), _u(2)]) is None


@pytest.mark.parametrize("carton,lines,units,slowo", [
    (_carton(status="open"), [_cl(30, 2, packed=1)], [_u(1)], "częściowo (1/2"),
    (_carton(status="packed"), [_cl(30, 2, packed=0)], [], "niespójne liczniki"),
    (_carton(), [_cl(30, 2)], [_u(1)], "Niespójny"),
    (_carton(), [_cl(30, 2)], [_u(1), _u(2, kg=15)], "Niespójny"),
    (_carton(), [_cl(30, 2)], [_u(1), _u(2, pallet_id="p1")], "Niespójny"),
    (_carton(), [_cl(30, 2)], [_u(1), _u(2, dispatch_id="d1")], "wydaniu"),
    (_carton(loaded_vehicle_id="v1"), [_cl(30, 2)], [_u(1), _u(2)], "aucie"),
    (_carton(shipped_at="x"), [_cl(30, 2)], [_u(1), _u(2)], "wydany"),
    (_carton(), [_cl(30, 2)], [_u(1), _u(2, status="shipped")], "wydany"),
    (_carton(), [], [_u(1)], "nie ma pozycji"),
    (_carton(), [_cl(30, 2)], [_u(1), _u(2, order_id="inne")], "innego zamówienia"),
])
def test_niekompletny_ma_czytelny_powod(carton, lines, units, slowo):
    assert slowo in link.completeness_reason(carton, lines, units, "o1")


# ── Tryb bez skanera (tymczasowy) ─────────────────────────────────────────

def test_karton_bez_zadnej_sztuki_to_tryb_bez_skanera():
    pusty = _carton(status="open", packed_qty=0)
    assert link.is_scannerless(pusty, [_cl(30, 2, packed=0)], [])
    assert link.completeness_reason(pusty, [_cl(30, 2, packed=0)], [], "o1") is None
    # Jedna zeskanowana sztuka = zwykłe reguły (częściowy), nie tryb bez skanera.
    assert not link.is_scannerless(_carton(status="open", packed_qty=1), [_cl(30, 2, packed=1)], [_u(1)])
    assert not link.is_scannerless(pusty, [], [])


@pytest.mark.parametrize("carton,slowo", [
    (_carton(status="open", loaded_vehicle_id="v1"), "aucie"),
    (_carton(status="open", shipped_at="x"), "wydany"),
])
def test_bez_skanera_auto_i_wydanie_nadal_blokuja(carton, slowo):
    assert slowo in link.completeness_reason(carton, [_cl(30, 2, packed=0)], [], "o1")


def test_bez_skanera_potrzebny_wyprodukowany_towar_na_stanie():
    k = ("r1", "pt1", "", 30.0)
    assert link.scannerless_stock_reason({k: 2}, {k: 2}, {}, {}) is None
    assert link.scannerless_stock_reason({k: 2}, {k: 5}, {k: 3}, {}) is None
    r = link.scannerless_stock_reason({k: 2}, {k: 3}, {k: 2}, {k: "UDO · METAL · 30 kg"})
    assert "Brak wyprodukowanego towaru" in r and "na magazynie 3 szt." in r and "UDO · METAL · 30 kg" in r
    assert "Brak wyprodukowanego towaru" in link.scannerless_stock_reason({k: 1}, {}, {}, {})


def test_sztuki_juz_tego_zamowienia_nie_blokuja():
    assert link.completeness_reason(_carton(), [_cl(30, 1)], [_u(1, order_id="o1")], "o1") is None


# ── Parser etykiety SCARTON ───────────────────────────────────────────────

@pytest.mark.parametrize("kod,oczekiwane", [
    (f"SCARTON|{ID}", ID),
    (f"SCARTON|{ID.upper()}", ID),                     # CapsLock
    (f"scarton|{ID.upper()}", ID),
    (f"]Q1SCARTON|{ID.upper()}", ID),                  # prefiks AIM
    (f"\x02SCARTON|{ID}\r\n", ID),                     # znaki sterujące
    (f"SCARTON<{ID.upper()}", ID),                     # przekręcony separator
    (f"SCARTON{ID}", ID),                              # zgubiony separator
    ("SCARTON|k3", "k3"),                              # stare id — bez zmian
    ("SCARTON|AbC123", "AbC123"),
])
def test_parser_kartonu(kod, oczekiwane):
    assert _parse_stock_carton(kod) == oczekiwane


@pytest.mark.parametrize("kod", [
    f"SCARTON|{ID}SCARTON|{ID[::-1]}",                 # sklejone dwa skany
    f"SCARTON<{ID}SCARTON<{ID[::-1]}",
    f"SCARTON<{ID[:12]}",                              # ucięte
    f"U|{ID}",
    f"xSCARTON|{ID}",
    "",
    None,
])
def test_parser_odrzuca_zepsute(kod):
    assert _parse_stock_carton(kod) is None


def test_parser_nie_ucina_dlugiego_id():
    dlugi = ID + ID
    assert _parse_stock_carton(f"SCARTON|{dlugi}") == dlugi
