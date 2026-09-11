"""Komplet dokumentów przy podziale — i reguła, że stan rusza TYLKO WM."""
import json

import pytest

from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate
from app.services.orders_service import update_order
from app.services.split_documents_service import (anuluj_dokumenty_podzialu,
                                                   wystaw_wz_klienta,
                                                   wystaw_wz_wewnetrzny)
from app.services.wz_service import create_wz_from_order
from tests.conftest_split import (_przygotuj_bez_podzialu, _przygotuj_z_podzialem,
                                  _stary_wz)


def test_wz_wewnetrzny_jest_na_calosc(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości
    wm = wystaw_wz_wewnetrzny("o1")
    assert wm["number"].startswith("WM/")
    assert wm["kg"] == 800.0


def test_wz_klienta_jest_na_czesc_niefakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wz = wystaw_wz_klienta("o1")
    assert wz["number"].startswith("WZ/")
    assert wz["kg"] == 500.0


def test_TYLKO_wz_wewnetrzny_rusza_magazyn(db):
    """Najważniejsza reguła projektu: dwa dokumenty, jeden rozchód."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    ruchy = query_all(
        "SELECT source_id FROM stock_movements WHERE product_type='finished_goods'")
    assert len(ruchy) > 0, "WM nie zdjął stanu"
    zrodla = {r["source_id"] for r in ruchy}
    wz_klienta = query_all("SELECT id FROM wz_documents WHERE doc_series='WZ'")
    assert not ({r["id"] for r in wz_klienta} & zrodla), "WZ klienta ruszył magazyn"


def test_stan_schodzi_dokladnie_raz(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    fg = query_all("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")[0]
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 30)


def test_powtorne_wystawienie_nie_dubluje(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_wewnetrzny("o1")
    assert len(query_all("SELECT id FROM wz_documents WHERE doc_series='WM'")) == 1


def test_bez_podzialu_wz_klienta_jest_odrzucony(db):
    _przygotuj_bez_podzialu()
    try:
        wystaw_wz_klienta("o1")
        assert False, "wystawiono WZ klienta bez podziału"
    except Exception as e:
        assert "podzia" in str(e).lower()


def test_powtorne_wz_klienta_nie_dubluje(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    # WM musi być pierwszy — od fix round 4 WZ klienta bez niego jest odrzucany
    # (zamówienie z samym WZ klienta wpadało w załadunku w gałąź „wystaw nowy").
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    wystaw_wz_klienta("o1")
    assert len(query_all(
        "SELECT id FROM wz_documents WHERE doc_series='WZ' AND split_scope='wz_klienta'")) == 1


def test_powtorne_wz_wewnetrzny_nie_dubluje_rozchodu(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    ruchy_po_pierwszym = len(query_all(
        "SELECT id FROM stock_movements WHERE product_type='finished_goods'"))
    wystaw_wz_wewnetrzny("o1")
    ruchy_po_drugim = len(query_all(
        "SELECT id FROM stock_movements WHERE product_type='finished_goods'"))
    assert ruchy_po_drugim == ruchy_po_pierwszym, "drugie wystawienie zdublowało rozchód"
    fg = query_all("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")[0]
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 30)


def test_zwykly_wz_ma_puste_split_scope(db):
    """Nie zaczynamy oznaczać dokumentów, które nie należą do podziału —
    zwykły WZ ze starej ścieżki zostaje z `split_scope IS NULL`, tak samo
    jak wszystkie historyczne dokumenty sprzed tej kolumny."""
    _przygotuj_bez_podzialu()
    stary = create_wz_from_order("o1")
    row = query_all("SELECT split_scope FROM wz_documents WHERE id=%s", (stary["id"],))[0]
    assert row["split_scope"] is None


# ── Fix round 2: `split_scope` odróżnia dokumenty od siebie, ale nikt nie
# sprawdzał, czy zamówienie w ogóle MOŻE dostać podział. Zamówienie z już
# istniejącym zwykłym WZ (stan zszedł INNĄ ścieżką) musi być ODRZUCONE, nie
# cicho współistnieć — inaczej `wystaw_wz_wewnetrzny` liczy braki od zera
# (`picks_for_order` nic nie wie o starym rozchodzie) i zdejmuje stan DRUGI
# RAZ. Odmowa jest w pełni odwracalna (biuro anuluje stary dokument i
# powtarza), drugi rozchód — nie.
def test_istniejacy_zwykly_wz_blokuje_wz_wewnetrzny(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    stary = _stary_wz("o1")
    przed = query_all(
        "SELECT qty_available FROM finished_goods WHERE id IN ('f1','f2') ORDER BY id")
    ruchy_przed = len(query_all(
        "SELECT id FROM stock_movements WHERE product_type='finished_goods'"))

    try:
        wystaw_wz_wewnetrzny("o1")
        assert False, "wystawiono WM mimo istniejącego zwykłego WZ"
    except Exception as e:
        assert stary["number"] in str(e), "komunikat nie wskazuje kolidującego dokumentu"

    po = query_all(
        "SELECT qty_available FROM finished_goods WHERE id IN ('f1','f2') ORDER BY id")
    ruchy_po = len(query_all(
        "SELECT id FROM stock_movements WHERE product_type='finished_goods'"))
    assert po == przed, "odmowa mimo to ruszyła stan magazynu"
    assert ruchy_po == ruchy_przed, "odmowa mimo to dopisała ruch magazynowy"


def test_istniejacy_zwykly_wz_blokuje_wz_klienta(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    stary = _stary_wz("o1")

    try:
        wystaw_wz_klienta("o1")
        assert False, "wystawiono WZ klienta mimo istniejącego zwykłego WZ"
    except Exception as e:
        assert stary["number"] in str(e), "komunikat nie wskazuje kolidującego dokumentu"


def test_anulowany_stary_wz_nie_blokuje(db):
    """Anulowany dokument zwolnił stan (odwzorowane w zasiewie: `status=
    'anulowany'` NIE zdejmuje magazynu) — podział ma przejść normalnie."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    _stary_wz("o1", status="anulowany")

    wm = wystaw_wz_wewnetrzny("o1")
    assert wm["number"].startswith("WM/")
    assert wm["kg"] == 800.0

    wz = wystaw_wz_klienta("o1")
    assert wz["number"].startswith("WZ/")
    assert wz["kg"] == 500.0


# ── Kolejność: WM musi być pierwszy ───────────────────────────────────────
def test_wz_klienta_BEZ_wz_wewnetrznego_jest_odrzucony(db):
    """Zamówienie z samym WZ klienta przechodzi obie bramki `finalize_loading`
    i wpada w gałąź „wystaw nowy" — załadunek zrobiłby TRZECI dokument
    i zdjął stan drugi raz, a wystawienia WM już by nie puścił guard kolizji."""
    _przygotuj_z_podzialem(cel_kg=300.0)

    with pytest.raises(Exception) as e:
        wystaw_wz_klienta("o1")

    assert "wewnętrzny" in str(e.value).lower()
    assert query_all("SELECT id FROM wz_documents") == []


# ── Droga powrotna: anulowanie kompletu ───────────────────────────────────
#
# Guard w `wz_service` odmawia zwykłego WZ na zamówieniu z podziałem. Bez
# możliwości anulowania jedno omyłkowe kliknięcie zamykałoby zamówienie na
# głucho — `cancel_wz` odrzuca wszystko z `source_type != 'manual'` (409),
# czyli OBA dokumenty podziału (re-review Task 4, fix round 4).
def test_anulowanie_zdejmuje_oba_dokumenty(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")

    wynik = anuluj_dokumenty_podzialu("o1")

    assert len(wynik["documents"]) == 2
    zywe = query_all(
        "SELECT id FROM wz_documents WHERE source_id='o1' AND split_scope IS NOT NULL "
        "AND COALESCE(status,'')<>'anulowany'")
    assert zywe == []


def test_anulowanie_ZWRACA_TOWAR_na_stan(db):
    """Sedno: dokument bez zwrotu towaru byłby gorszy niż brak anulowania —
    `finalize_loading` pomija anulowane, więc wystawiłby nowy i zdjął stan
    drugi raz."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")

    anuluj_dokumenty_podzialu("o1")

    f1 = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    f2 = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f2'")
    assert (int(f1["qty_available"]), int(f1["qty_shipped"])) == (30, 0)
    assert (int(f2["qty_available"]), int(f2["qty_shipped"])) == (2, 0)


def test_anulowanie_zwraca_towar_TYLKO_RAZ(db):
    """WZ klienta nigdy stanu nie ruszał — jego anulowanie nie może niczego
    dodać, inaczej magazyn urósłby o część niefakturowaną z powietrza."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")

    anuluj_dokumenty_podzialu("o1")

    zwroty = query_all(
        "SELECT qty FROM stock_movements WHERE movement_type='CANCEL' "
        "AND product_type='finished_goods'")
    assert round(sum(float(r["qty"]) for r in zwroty), 3) == 800.0


def test_po_anulowaniu_zwykly_WZ_znowu_dziala(db):
    """Cała racja bytu tej funkcji — odmowa ma być odwracalna."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    anuluj_dokumenty_podzialu("o1")

    nowy = create_wz_from_order("o1")

    assert nowy["number"].startswith("WZ/")


def test_po_anulowaniu_mozna_wystawic_podzial_ponownie(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    pierwszy = wystaw_wz_wewnetrzny("o1")
    anuluj_dokumenty_podzialu("o1")

    drugi = wystaw_wz_wewnetrzny("o1")

    assert drugi["id"] != pierwszy["id"]
    assert drugi["kg"] == 800.0


def test_anulowanie_bez_dokumentow_mowi_wprost(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    with pytest.raises(Exception) as e:
        anuluj_dokumenty_podzialu("o1")
    assert "nie ma dokument" in str(e.value).lower()


# ── Edycja zamówienia POD wystawionymi dokumentami ────────────────────────
#
# Wystawienie kompletu NIE zmienia statusu zamówienia — zostaje `confirmed`,
# czyli w pełni edytowalne. `_reconcile_lines_cx` po cichu PRZYCINA
# `qty_invoice` do nowego `qty` (min(stare, nowe)), zabiera je razem z
# usuniętą pozycją i daje NULL pozycji dopisanej. Po takiej edycji
# `qty - qty_invoice` opisuje co innego niż WYDRUKOWANY WZ dla klienta —
# cicha zmiana liczb, które są już na papierze (review końcowy, I1).
#
# Bramka stoi w `order_split_service` obok swoich sióstr
# (`zapisz_podzial`, `wyczysc_podzial`), bo to jedno i to samo pojęcie:
# „na tym zamówieniu leżą już papiery z podziału".
def test_edycja_zamowienia_POD_dokumentami_podzialu_jest_odrzucona(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # o1-l1: 30 szt, 11 na fakturę
    wystaw_wz_wewnetrzny("o1")
    wz = wystaw_wz_klienta("o1")

    with pytest.raises(Exception) as e:
        update_order("o1", ClientOrderCreate.model_validate({
            "client_id": "c1", "order_date": "2026-09-08",
            "lines": [
                {"id": "o1-l1", "recipe_id": "r1", "product_type_id": "pt1",
                 "qty": 3, "kg_per_unit": 25},
                {"id": "o1-l2", "recipe_id": "r2", "product_type_id": "pt2",
                 "qty": 2, "kg_per_unit": 25},
            ]}))

    assert "anuluj dokumenty podziału" in str(e.value), e.value
    linia = query_one("SELECT qty, qty_invoice FROM client_order_lines WHERE id='o1-l1'")
    assert (int(linia["qty"]), int(linia["qty_invoice"])) == (30, 11), (
        "edycja przeszła mimo wystawionych dokumentów")
    # Papier się nie zmienił, więc liczby w bazie też nie mają prawa.
    assert wz["kg"] == 500.0


def test_edycja_zamowienia_BEZ_dokumentow_podzialu_dziala_dalej(db):
    """Bramka ma zatrzymać edycję tylko tam, gdzie są papiery. Zamówienie
    z samym ZAPISANYM podziałem (bez dokumentów) biuro poprawia normalnie —
    po to jest okno podziału."""
    _przygotuj_z_podzialem(cel_kg=300.0)

    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "o1-l1", "recipe_id": "r1", "product_type_id": "pt1",
             "qty": 3, "kg_per_unit": 25},
            {"id": "o1-l2", "recipe_id": "r2", "product_type_id": "pt2",
             "qty": 2, "kg_per_unit": 25},
        ]}))

    linia = query_one("SELECT qty, qty_invoice FROM client_order_lines WHERE id='o1-l1'")
    assert (int(linia["qty"]), int(linia["qty_invoice"])) == (3, 3)


def test_ANULOWANY_komplet_odblokowuje_edycje_zamowienia(db):
    """Odmowa musi być odwracalna — anulowanie kompletu zwraca towar na stan
    i oddaje zamówienie do edycji."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    anuluj_dokumenty_podzialu("o1")

    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "o1-l1", "recipe_id": "r1", "product_type_id": "pt1",
             "qty": 3, "kg_per_unit": 25},
            {"id": "o1-l2", "recipe_id": "r2", "product_type_id": "pt2",
             "qty": 2, "kg_per_unit": 25},
        ]}))

    linia = query_one("SELECT qty, qty_invoice FROM client_order_lines WHERE id='o1-l1'")
    assert (int(linia["qty"]), int(linia["qty_invoice"])) == (3, 3)


# ── Nazwa wyrobu: jedna wysyłka, jedna nazwa na obu papierach ─────────────
def test_nazwa_na_WM_ma_dopisek_tulei_tak_jak_WZ_klienta(db):
    """`wystaw_wz_wewnetrzny` czytało wiersz wyrobu BEZ `product_type_id`
    i `packaging_name`, a `build_goods_wz_lines` bierze z nich rodzaj
    z kartoteki odbiorcy i dopisek tulei. Ten sam wyrób nazywał się więc
    inaczej na WM i na WZ dla klienta (`_pozycje_niefakturowane` czyta oba
    pola) — a biuro te dwa papiery zestawia (review końcowy, minor 1)."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    execute("UPDATE finished_goods SET packaging_name='METAL 80CM' WHERE id='f1'")
    execute("UPDATE client_order_lines SET packaging_name='METAL 80CM' WHERE id='o1-l1'")

    wm = wystaw_wz_wewnetrzny("o1")
    wz = wystaw_wz_klienta("o1")

    def _nazwy(wid):
        linie = query_one("SELECT lines FROM wz_documents WHERE id=%s", (wid,))["lines"]
        if isinstance(linie, str):
            linie = json.loads(linie or "[]")
        return [l["name"] for l in linie]

    assert any(n.endswith("(80cm)") for n in _nazwy(wm["id"])), _nazwy(wm["id"])
    assert any(n.endswith("(80cm)") for n in _nazwy(wz["id"])), _nazwy(wz["id"])
