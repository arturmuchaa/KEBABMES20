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


def _zamowienie(oid, order_no, cid, nazwa, data="2026-08-26", qty=20, kg=35, recipe="r1"):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,%s,%s,%s,%s,'confirmed')",
        (oid, order_no, cid, nazwa, data, f"{data} 08:00:00+00"),
    )
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit) VALUES (%s,%s,%s,'pt1',%s,%s)",
        (f"{oid}-l1", oid, recipe, qty, kg),
    )


def _zapas(fid, qty=20, kg=35, recipe="r1", cid=None, nazwa=None,
           order_no=None, dostepne=None):
    """Wiersz wyrobu gotowego wprost do bazy — bez serwisu, bo serwis sam
    dobiera zamówienie, a tu badamy właśnie dobieranie."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, product_type_id, qty, "
        " kg_per_unit, total_kg, qty_available, qty_shipped, client_id, client_name, "
        " client_order_no, produced_date) "
        "VALUES (%s,'260826 500',%s,'pt1',%s,%s,%s,%s,%s,%s,%s,%s,'2026-08-26')",
        (fid, recipe, qty, kg, qty * kg,
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

def _pozycja(oid, lid, qty=20, kg=35, recipe="r1"):
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit) VALUES (%s,%s,%s,'pt1',%s,%s)",
        (lid, oid, recipe, qty, kg),
    )


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
