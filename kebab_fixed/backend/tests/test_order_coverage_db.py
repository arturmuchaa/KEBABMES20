"""Pokrycie zamówienia wyrobem gotowym — czyje sztuki liczą się komu.

Zamówienie pokazuje „zrobione" z dwóch źródeł: sztuk ostemplowanych JEGO
numerem oraz zapasu bez zamówienia („na magazyn"). Oba źródła potrafiły
kłamać:

* zapas liczył się KAŻDEMU zamówieniu na ten sam wyrób — jeden klient
  „zabierał" kebab drugiego (biuro, 27.08.2026);
* numer zamówienia po usunięciu wracał do puli i przyklejał się do dawno
  wysłanej produkcji — nowe zamówienie POLAT startowało z pokryciem 100 %,
  choć magazyn był pusty.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest

from app.db import execute, query_one
from app.models.orders import ClientOrderCreate, OrderLineCreate
from app.services.orders_service import create_order, delete_order, get_order


def _klient(cid, nazwa, display):
    execute(
        "INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING",
        (cid, display, nazwa, display),
    )


def _zamowienie(oid, order_no, cid, nazwa, data="2026-08-26", qty=20, kg=35,
                recipe="r1", rodzaj="pt1"):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,%s,%s,%s,%s,'confirmed')",
        (oid, order_no, cid, nazwa, data, f"{data} 08:00:00+00"),
    )
    _pozycja(oid, f"{oid}-l1", qty=qty, kg=kg, recipe=recipe, rodzaj=rodzaj)


def _pozycja(oid, lid, qty=20, kg=35, recipe="r1", rodzaj="pt1"):
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit) VALUES (%s,%s,%s,%s,%s,%s)",
        (lid, oid, recipe, rodzaj, qty, kg),
    )


def _zapas(fid, qty=20, kg=35, recipe="r1", cid=None, nazwa=None,
           order_no=None, dostepne=None, rodzaj="pt1"):
    """Wiersz wyrobu gotowego wprost do bazy — bez serwisu, bo serwis sam
    dobiera zamówienie, a tu badamy właśnie dobieranie."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, product_type_id, qty, "
        " kg_per_unit, total_kg, qty_available, qty_shipped, client_id, client_name, "
        " client_order_no, produced_date) "
        "VALUES (%s,'260826 500',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'2026-08-26')",
        (fid, recipe, rodzaj, qty, kg, qty * kg,
         qty if dostepne is None else dostepne,
         0 if dostepne is None else qty - dostepne,
         cid, nazwa, order_no),
    )


def _zrobione(oid):
    return int(get_order(oid)["lines"][0]["qty_done"] or 0)


# ── Zapas bez zamówienia: czyj jest ───────────────────────────────────────

def test_zapas_innego_klienta_nie_pokrywa_zamowienia(db):
    """17 szt. wpisanych na LEZZĘ pokazywało postęp u YALCINA i TRUVY."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _klient("c2", "Provia Global BV", "LEZZA")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.")

    _zapas("f1", qty=20, cid="c2", nazwa="Provia Global BV")

    assert _zrobione("o1") == 0


def test_zapas_wlasnego_klienta_pokrywa(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.")

    _zapas("f1", qty=20, cid="c1", nazwa="Bulli sp. z o.o.")

    assert _zrobione("o1") == 20


def test_zapas_niczyj_pokrywa_kazde_zamowienie(db):
    """Produkcja „na magazyn" nie ma klienta — ma pokrywać zamówienia."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.")

    _zapas("f1", qty=20)

    assert _zrobione("o1") == 20


def test_zapas_klienta_omija_starsze_zamowienie_obcego(db):
    """Kolejka „od najstarszego" nie może przenosić sztuk między klientami."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _klient("c2", "Provia Global BV", "LEZZA")
    _zamowienie("o0", "LEZZA/Z/1/08/26", "c2", "Provia Global BV", data="2026-08-20")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", data="2026-08-26")

    _zapas("f1", qty=20, cid="c1", nazwa="Bulli sp. z o.o.")

    assert (_zrobione("o0"), _zrobione("o1")) == (0, 20)


def test_zapas_niczyj_idzie_do_starszego_zamowienia(db):
    """Wspólnej puli nie wolno pokazać dwa razy — bierze ją starsze."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _klient("c2", "Provia Global BV", "LEZZA")
    _zamowienie("o0", "LEZZA/Z/1/08/26", "c2", "Provia Global BV", data="2026-08-20")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", data="2026-08-26")

    _zapas("f1", qty=20)

    assert (_zrobione("o0"), _zrobione("o1")) == (20, 0)


def test_zapas_wydany_nie_pokrywa_juz_nikogo(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.")

    _zapas("f1", qty=20, cid="c1", nazwa="Bulli sp. z o.o.", dostepne=0)

    assert _zrobione("o1") == 0


def test_z_czesciowo_wydanego_zapasu_liczy_sie_RESZTA(db):
    """Nie sztuki wyprodukowane kiedyś, tylko te, które leżą na półce."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=20)

    _zapas("f1", qty=20, cid="c1", nazwa="Bulli sp. z o.o.", dostepne=5)

    assert _zrobione("o1") == 5


# ── Numer zamówienia: kiedy wolno go użyć drugi raz ───────────────────────

def _dto(cid="c1", data="2026-08-26", qty=20, kg=35):
    return ClientOrderCreate(
        client_id=cid, order_date=data,
        lines=[OrderLineCreate(qty=qty, kg_per_unit=kg, recipe_id="r1", product_type_id="pt1")],
    )


def test_numer_z_produkcja_nie_wraca_po_usunieciu(db):
    """POLAT/Z/1/08/26 wysłany 14.08 przykleił się do zamówienia z 26.08
    i pokazał 100 % pokrycia przy pustym magazynie."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    pierwsze = create_order(_dto())
    _zapas("f1", qty=20, order_no=pierwsze["order_no"], dostepne=0,
           cid="c1", nazwa="Bulli sp. z o.o.")
    delete_order(pierwsze["id"])

    drugie = create_order(_dto())

    assert drugie["order_no"] != pierwsze["order_no"]
    assert int(get_order(drugie["id"])["lines"][0]["qty_done"] or 0) == 0


def test_numer_bez_produkcji_wraca_do_puli(db):
    """Pomyłkowo założone i skasowane zamówienie nie zjada numeru."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    pierwsze = create_order(_dto())
    delete_order(pierwsze["id"])

    drugie = create_order(_dto())

    assert drugie["order_no"] == pierwsze["order_no"]


def test_numer_zajety_przez_zywe_zamowienie_nie_wraca(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    pierwsze = create_order(_dto())

    drugie = create_order(_dto())

    assert drugie["order_no"] != pierwsze["order_no"]


# ── Dwie pozycje na ten sam wyrób ─────────────────────────────────────────

def _zrobione_pozycji(oid):
    return [int(l["qty_done"] or 0) for l in get_order(oid)["lines"]]


def test_dwie_identyczne_pozycje_dziela_sztuki_a_nie_mnoza(db):
    """TRUVA: dwie pozycje 80×20 kg i te same 80 sztuk przy obu — 160 z 160."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=20)
    _pozycja("o1", "o1-l2", qty=20)

    _zapas("f1", qty=20, order_no="BULLI/Z/1/08/26", cid="c1", nazwa="Bulli sp. z o.o.")

    assert sorted(_zrobione_pozycji("o1"), reverse=True) == [20, 0]


def test_nadprodukcja_zostaje_widoczna(db):
    """Sztuk ponad zamówienie nie chowamy — magazynier musi je zobaczyć."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=20)
    _pozycja("o1", "o1-l2", qty=20)

    _zapas("f1", qty=50, order_no="BULLI/Z/1/08/26", cid="c1", nazwa="Bulli sp. z o.o.")

    assert sum(_zrobione_pozycji("o1")) == 50


def test_zapas_nie_dokłada_sie_do_pozycji_juz_zrobionej(db):
    """Pozycja pokryta stemplem nie sięga po pulę — inaczej rośnie ponad 100 %."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=20)

    _zapas("f1", qty=20, order_no="BULLI/Z/1/08/26", cid="c1", nazwa="Bulli sp. z o.o.")
    _zapas("f2", qty=20, cid="c1", nazwa="Bulli sp. z o.o.")

    assert _zrobione("o1") == 20


# ── Rodzaj (95/5 to nie UDO 100 %) ────────────────────────────────────────

def test_rodzaj_rozroznia_pozycje_o_tej_samej_recepturze(db):
    """TRUVA: KIRMIZI 25 kg jako MIX 95/5 i jako UDO 100 % to DWA produkty.
    Wysłane 30 szt. 95/5 wpadło na pozycję UDO."""
    _klient("c1", "Truva gastro s.r.o.", "TRUVA")
    _zamowienie("o1", "TRUVA/Z/1/08/26", "c1", "Truva gastro s.r.o.",
                qty=60, kg=25, rodzaj="pt-udo")            # pierwsza w kolejce
    _pozycja("o1", "o1-l2", qty=60, kg=25, rodzaj="pt-95-5")

    _zapas("f1", qty=30, kg=25, rodzaj="pt-95-5", order_no="TRUVA/Z/1/08/26",
           cid="c1", nazwa="Truva gastro s.r.o.")

    assert _zrobione_pozycji("o1") == [0, 30]


def test_zapas_innego_rodzaju_nie_pokrywa(db):
    _klient("c1", "Truva gastro s.r.o.", "TRUVA")
    _zamowienie("o1", "TRUVA/Z/1/08/26", "c1", "Truva gastro s.r.o.",
                qty=60, kg=25, rodzaj="pt-95-5")

    _zapas("f1", qty=30, kg=25, rodzaj="pt-udo", cid="c1", nazwa="Truva gastro s.r.o.")

    assert _zrobione("o1") == 0


def test_wpis_bez_rodzaju_liczy_sie_dalej(db):
    """Wyroby wpisane zanim w formularzu pojawił się rodzaj — nie gubimy ich."""
    _klient("c1", "Truva gastro s.r.o.", "TRUVA")
    _zamowienie("o1", "TRUVA/Z/1/08/26", "c1", "Truva gastro s.r.o.",
                qty=60, kg=25, rodzaj="pt-95-5")

    _zapas("f1", qty=30, kg=25, rodzaj=None, cid="c1", nazwa="Truva gastro s.r.o.")

    assert _zrobione("o1") == 30


# ── Zrobione ≠ wysłane ────────────────────────────────────────────────────

def _wyslane_pozycji(oid):
    return [int(l["qty_shipped"] or 0) for l in get_order(oid)["lines"]]


def test_wyslane_widac_osobno_od_lezacego_na_magazynie(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, order_no="BULLI/Z/1/08/26", dostepne=0,
           cid="c1", nazwa="Bulli sp. z o.o.")          # wyjechało na WZ
    _zapas("f2", qty=20, order_no="BULLI/Z/1/08/26",
           cid="c1", nazwa="Bulli sp. z o.o.")          # leży na magazynie

    assert (_zrobione("o1"), _wyslane_pozycji("o1")[0]) == (50, 30)


def test_pozycja_w_calosci_wyslana_jest_zamknieta(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=30)

    _zapas("f1", qty=30, order_no="BULLI/Z/1/08/26", dostepne=0,
           cid="c1", nazwa="Bulli sp. z o.o.")

    linia = get_order("o1")["lines"][0]
    assert (int(linia["qty_done"]), int(linia["qty_shipped"])) == (30, 30)


# ── Stempel po skasowanym zamówieniu ──────────────────────────────────────

def test_stempel_nieistniejacego_zamowienia_wraca_na_magazyn(db):
    """Po usunięciu zamówienia jego sztuki nie mogą zniknąć z widoku —
    wracają do zapasu klienta i pokrywają jego kolejne zamówienie."""
    _klient("c1", "Polat d.o.o.", "POLAT")
    _zamowienie("o2", "POLAT/Z/2/08/26", "c1", "Polat d.o.o.", qty=60)

    _zapas("f1", qty=40, order_no="POLAT/Z/1/08/26",   # zamówienie skasowane
           cid="c1", nazwa="Polat d.o.o.")

    assert _zrobione("o2") == 40


def test_stempel_zywego_zamowienia_nie_wycieka_do_innego(db):
    _klient("c1", "Polat d.o.o.", "POLAT")
    _zamowienie("o1", "POLAT/Z/1/08/26", "c1", "Polat d.o.o.", data="2026-08-20", qty=60)
    _zamowienie("o2", "POLAT/Z/2/08/26", "c1", "Polat d.o.o.", data="2026-08-26", qty=60)

    _zapas("f1", qty=40, order_no="POLAT/Z/1/08/26", cid="c1", nazwa="Polat d.o.o.")

    assert (_zrobione("o1"), _zrobione("o2")) == (40, 0)


# ── Zamknięcie zamówienia po wysyłce ──────────────────────────────────────

def test_zamowienie_w_calosci_wyslane_zamyka_sie(db):
    from app.services.orders_service import zamknij_wyslane_zamowienia
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=30)
    _zapas("f1", qty=30, order_no="BULLI/Z/1/08/26", dostepne=0,
           cid="c1", nazwa="Bulli sp. z o.o.")

    assert zamknij_wyslane_zamowienia(["BULLI/Z/1/08/26"]) == ["BULLI/Z/1/08/26"]
    assert get_order("o1")["status"] == "done"


def test_zamowienie_z_towarem_na_polce_zostaje_otwarte(db):
    """Zrobione ≠ wysłane: dopóki towar leży u nas, zamówienie żyje."""
    from app.services.orders_service import zamknij_wyslane_zamowienia
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=30)
    _zapas("f1", qty=30, order_no="BULLI/Z/1/08/26",
           cid="c1", nazwa="Bulli sp. z o.o.")

    assert zamknij_wyslane_zamowienia(["BULLI/Z/1/08/26"]) == []
    assert get_order("o1")["status"] == "confirmed"


def test_zamowienie_bez_sztuk_nie_zamyka_sie_samo(db):
    """Pozycje z zerową ilością nie mogą udawać wysyłki."""
    from app.services.orders_service import zamknij_wyslane_zamowienia
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=0)

    assert zamknij_wyslane_zamowienia(["BULLI/Z/1/08/26"]) == []
    assert get_order("o1")["status"] == "confirmed"
