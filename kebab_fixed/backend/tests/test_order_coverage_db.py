"""Pokrycie zamówienia wyrobem gotowym — czyje sztuki liczą się komu.

Zamówienie pokazuje „zrobione" z dwóch źródeł: sztuk ostemplowanych JEGO
numerem oraz zapasu bez zamówienia („na magazyn"). Oba źródła potrafiły
kłamać:

* zapas liczył się KAŻDEMU zamówieniu na ten sam wyrób — jeden klient
  „zabierał" kebab drugiego (biuro, 27.08.2026);
* numer zamówienia po usunięciu wracał do puli i przyklejał się do dawno
  wysłanej produkcji — nowe zamówienie POLAT startowało z pokryciem 100 %,
  choć magazyn był pusty.

REGUŁA NADRZĘDNA (właściciel, 27.08.2026): „magazyn wyrobu gotowego to
świętość". Zamówienie pokrywa WYŁĄCZNIE towar, który FIZYCZNIE leży na
magazynie, plus to, co wyjechało NA TO ZAMÓWIENIE (wydanie do tego klienta).
Sprzedaż towaru jednego klienta komuś innemu jest dozwolona i NIE pokazuje
się na zamówieniu — po prostu znika z magazynu, więc pokrycie spada.

Testy DB — bez TEST_DATABASE_URL skip."""
import json

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
                recipe="r1", rodzaj="pt1", tuleja=None):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,%s,%s,%s,%s,'confirmed')",
        (oid, order_no, cid, nazwa, data, f"{data} 08:00:00+00"),
    )
    _pozycja(oid, f"{oid}-l1", qty=qty, kg=kg, recipe=recipe, rodzaj=rodzaj, tuleja=tuleja)


def _pozycja(oid, lid, qty=20, kg=35, recipe="r1", rodzaj="pt1", tuleja=None):
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit, packaging_id) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (lid, oid, recipe, rodzaj, qty, kg, tuleja),
    )


def _zapas(fid, qty=20, kg=35, recipe="r1", cid=None, nazwa=None,
           order_no=None, dostepne=None, rodzaj="pt1", tuleja=None):
    """Wiersz wyrobu gotowego wprost do bazy — bez serwisu, bo serwis sam
    dobiera zamówienie, a tu badamy właśnie dobieranie."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, product_type_id, qty, "
        " kg_per_unit, total_kg, qty_available, qty_shipped, client_id, client_name, "
        " client_order_no, packaging_id, produced_date) "
        "VALUES (%s,'260826 500',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'2026-08-26')",
        (fid, recipe, rodzaj, qty, kg, qty * kg,
         qty if dostepne is None else dostepne,
         0 if dostepne is None else qty - dostepne,
         cid, nazwa, order_no, tuleja),
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


def test_pokrycie_konczy_sie_na_zamowionej_ilosci(db):
    """Nadprodukcja leży na magazynie, ale zamówienie nie pokazuje 120 z 80 —
    „żadnych dziwnych duplikatów" (właściciel, 27.08.2026)."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=20)
    _pozycja("o1", "o1-l2", qty=20)

    _zapas("f1", qty=50, order_no="BULLI/Z/1/08/26", cid="c1", nazwa="Bulli sp. z o.o.")

    assert _zrobione_pozycji("o1") == [20, 20]


def test_nadwyzka_ze_stempla_pokrywa_kolejne_zamowienie_klienta(db):
    """Sztuki zrobione ponad jedno zamówienie nie mogą zniknąć z widoku."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", data="2026-08-20", qty=20)
    _zamowienie("o2", "BULLI/Z/2/08/26", "c1", "Bulli sp. z o.o.", data="2026-08-26", qty=20)

    _zapas("f1", qty=35, order_no="BULLI/Z/1/08/26", cid="c1", nazwa="Bulli sp. z o.o.")

    assert (_zrobione("o1"), _zrobione("o2")) == (20, 15)


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

def _wydane(oid):
    return [int(l["qty_delivered"] or 0) for l in get_order(oid)["lines"]]


def _na_magazynie(oid):
    return [int(l["qty_stock"] or 0) for l in get_order(oid)["lines"]]


def _wz(wid, buyer, linie, source_type="manual", source_id=None,
        status="wstepny", seq=1, kiedy="2026-08-26 12:00:00+00"):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, "
        " source_id, buyer_name, valued, lines, status, currency, pallets_h1, "
        " pallets_other, issued_date, created_at) "
        "VALUES (%s,%s,%s,'08/26',%s,%s,%s,false,%s::jsonb,%s,'PLN',0,0,'2026-08-26',%s)",
        (wid, f"WZ/{seq}/08/26", seq, source_type, source_id, buyer,
         json.dumps(linie), status, kiedy),
    )


def _linia_wz(stock_id, qty):
    return {"stock_type": "fg", "stock_id": stock_id, "qty": qty, "unit": "szt"}


def test_towar_ktory_zszedl_z_magazynu_nie_pokrywa_juz_zamowienia(db):
    """Sprzedany komuś innemu — TRUVA nadal czeka na swoje 60 szt."""
    _klient("c1", "Truva gastro s.r.o.", "TRUVA")
    _klient("c9", "Katarzyna Księżyc", "KK")
    _zamowienie("o1", "TRUVA/Z/1/08/26", "c1", "Truva gastro s.r.o.", qty=60, kg=25)

    _zapas("f1", qty=30, kg=25, order_no="TRUVA/Z/1/08/26", dostepne=0,
           cid="c1", nazwa="Truva gastro s.r.o.")
    _wz("w1", "Katarzyna Księżyc", [_linia_wz("f1", 30)])

    assert (_zrobione("o1"), _wydane("o1")[0]) == (0, 0)


def test_wydanie_na_to_zamowienie_liczy_sie_dalej(db):
    """Towar pojechał do TEGO klienta — nie każemy robić go drugi raz."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, order_no="BULLI/Z/1/08/26", dostepne=0,
           cid="c1", nazwa="Bulli sp. z o.o.")
    _wz("w1", "Bulli sp. z o.o.", [_linia_wz("f1", 30)],
        source_type="order", source_id="o1")

    linia = get_order("o1")["lines"][0]
    assert (int(linia["qty_stock"]), int(linia["qty_delivered"]),
            int(linia["qty_done"])) == (0, 30, 30)


def test_reczny_wz_do_wlasciwego_klienta_tez_jest_wydaniem(db):
    """Biuro wystawia WZ ręcznie — to nadal wydanie temu klientowi."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="Bulli sp. z o.o.")
    _wz("w1", "BULLI", [_linia_wz("f1", 30)])          # nazwa handlowa

    assert _wydane("o1")[0] == 30


def test_wydane_plus_lezace_nie_przekracza_zamowienia(db):
    """Zamówienie 60: 30 pojechało, a na magazynie leży jeszcze 50 —
    pozycja pokazuje 60 z 60, nie 80 z 60."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="Bulli sp. z o.o.")   # wydane
    _zapas("f2", qty=50, cid="c1", nazwa="Bulli sp. z o.o.")               # leży
    _wz("w1", "BULLI", [_linia_wz("f1", 30)])

    linia = get_order("o1")["lines"][0]
    assert (int(linia["qty_stock"]), int(linia["qty_delivered"]),
            int(linia["qty_done"])) == (30, 30, 60)


def test_wz_sprzed_zalozenia_zamowienia_nie_jest_jego_wydaniem(db):
    """Lipcowa dostawa do YBM doklejała się do zamówienia z 27.08 i pokazywała
    „wydane" na pozycjach, których nikt nie wydał (biuro, 27.08.2026)."""
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH",
                data="2026-08-27", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="YBM Gastro GmbH")
    _wz("w1", "YBM Gastro GmbH", [_linia_wz("f1", 30)], kiedy="2026-07-20 08:28:00+00")

    assert _wydane("o1")[0] == 0


def test_wz_wystawiony_po_zalozeniu_zamowienia_jest_wydaniem(db):
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH",
                data="2026-08-20", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="YBM Gastro GmbH")
    _wz("w1", "YBM Gastro GmbH", [_linia_wz("f1", 30)], kiedy="2026-08-26 12:00:00+00")

    assert _wydane("o1")[0] == 30


def test_wydanie_idzie_do_zamowienia_ktore_wtedy_istnialo(db):
    """Dwa zamówienia klienta: WZ z 26.08 nie może trafić na to z 27.08."""
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/1/08/26", "c1", "YBM Gastro GmbH",
                data="2026-08-20", qty=60)
    _zamowienie("o2", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH",
                data="2026-08-27", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="YBM Gastro GmbH")
    _wz("w1", "YBM Gastro GmbH", [_linia_wz("f1", 30)], kiedy="2026-08-26 12:00:00+00")

    assert (_wydane("o1")[0], _wydane("o2")[0]) == (30, 0)


def test_anulowany_wz_nie_jest_wydaniem(db):
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="Bulli sp. z o.o.")
    _wz("w1", "BULLI", [_linia_wz("f1", 30)], status="anulowany")

    assert _wydane("o1")[0] == 0


def test_wydanie_nie_dubluje_sie_z_zapasem(db):
    """Część wydana, część leży — razem nie więcej niż zamówiono."""
    _klient("c1", "Bulli sp. z o.o.", "BULLI")
    _zamowienie("o1", "BULLI/Z/1/08/26", "c1", "Bulli sp. z o.o.", qty=60)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="Bulli sp. z o.o.")   # wydane
    _zapas("f2", qty=20, cid="c1", nazwa="Bulli sp. z o.o.")               # leży
    _wz("w1", "BULLI", [_linia_wz("f1", 30)])

    linia = get_order("o1")["lines"][0]
    assert (int(linia["qty_stock"]), int(linia["qty_delivered"]),
            int(linia["qty_done"])) == (20, 30, 50)


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
    _wz("w1", "BULLI", [_linia_wz("f1", 30)])

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


def test_zamowienia_nabywcy_po_nazwie_z_kartoteki(db):
    """Po ręcznym WZ trzeba sprawdzić zamówienia NABYWCY — sztuki bywają
    niczyje, więc sam stempel na wierszu wyrobu nie wystarczy."""
    from app.services.orders_service import numery_zamowien_klienta
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH", qty=60)

    assert numery_zamowien_klienta("YBM Gastro GmbH") == ["YALCIN/Z/2/08/26"]
    assert numery_zamowien_klienta("YALCIN") == ["YALCIN/Z/2/08/26"]
    assert numery_zamowien_klienta("Katarzyna Księżyc") == []


def test_zamkniete_zamowienie_nie_wraca_na_liste_nabywcy(db):
    from app.services.orders_service import numery_zamowien_klienta
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH", qty=60)
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")

    assert numery_zamowien_klienta("YALCIN") == []


# ── Tuleja (METAL 65 to nie 80 cm) ────────────────────────────────────────

def test_tuleja_rozroznia_pozycje(db):
    """Cały KIRMIZI leżał na METAL 65, a 5 szt. 40 kg i 15 szt. 30 kg system
    przypisał do 80 cm (biuro, 27.08.2026)."""
    _klient("c1", "Emin Handels GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/3/08/26", "c1", "Emin Handels GmbH",
                qty=15, kg=30, tuleja="t-80cm")
    _pozycja("o1", "o1-l2", qty=15, kg=30, tuleja="t-metal65")

    _zapas("f1", qty=15, kg=30, tuleja="t-metal65", cid="c1", nazwa="Emin Handels GmbH")

    assert _zrobione_pozycji("o1") == [0, 15]


def test_zapas_na_innej_tulei_nie_pokrywa(db):
    _klient("c1", "Emin Handels GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/3/08/26", "c1", "Emin Handels GmbH",
                qty=5, kg=40, tuleja="t-80cm")

    _zapas("f1", qty=5, kg=40, tuleja="t-metal65", cid="c1", nazwa="Emin Handels GmbH")

    assert _zrobione("o1") == 0


def test_zapas_bez_tulei_liczy_sie_dalej(db):
    """Wyroby sprzed wpisywania tulei — nie gubimy ich."""
    _klient("c1", "Emin Handels GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/3/08/26", "c1", "Emin Handels GmbH",
                qty=5, kg=40, tuleja="t-metal65")

    _zapas("f1", qty=5, kg=40, tuleja=None, cid="c1", nazwa="Emin Handels GmbH")

    assert _zrobione("o1") == 5


# ── Zamówienie zrealizowane jest ZAMKNIĘTE ────────────────────────────────
#
# Zgłoszenie właściciela 28.08.2026: „zrealizowane YALCIN znowu uciekły 10 kg,
# nie może być tak, że zamówienie zrealizowane się modyfikuje". Zamówienie samo
# się nie zmieniało — zmieniało się jego POKRYCIE, liczone na żywo z puli
# wspólnej dla klienta. Każdy nowy ręczny WZ przetasowywał tę pulę i przepisywał
# liczby na dokumencie, który dawno wyjechał. Ta sama klasa błędu przepisała
# wcześniej HDI YALCINA z 12 920 kg na 5 220 kg (stąd zamrożenie w hdi_service).
#
# Zamówienie zamyka się DOPIERO, gdy każda pozycja jest w całości wydana
# (`zamknij_wyslane_zamowienia`), więc jego pokrycie jest znane bez migawki:
# wydane = zamówione. I tyle ma pokazywać już zawsze.

def _zrealizowane(oid):
    execute("UPDATE client_orders SET status='done' WHERE id=%s", (oid,))


def test_zrealizowane_zamowienie_pokazuje_pelne_wydanie(db):
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH", qty=60)
    _zrealizowane("o1")

    assert _wydane("o1")[0] == 60


def test_nowy_wz_nie_rusza_zrealizowanego_zamowienia(db):
    """Sedno zgłoszenia: wysyłka do innej spółki tej samej firmy nie może
    przepisać liczb na zamówieniu, które już wyjechało."""
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH", qty=60)
    _zrealizowane("o1")
    przed = _wydane("o1")[0]

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="YBM Gastro GmbH")
    _wz("w1", "YALCIN", [_linia_wz("f1", 30)], kiedy="2026-08-28 09:00:00+00")

    assert _wydane("o1")[0] == przed == 60


def test_zrealizowane_nie_zabiera_wydania_zywemu_zamowieniu(db):
    """Zamknięte zamówienie przestaje też SIĘGAĆ do wspólnej puli — inaczej
    trzymałoby sztuki, których żywe zamówienie potrzebuje."""
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/2/08/26", "c1", "YBM Gastro GmbH", qty=60)
    _zrealizowane("o1")
    _zamowienie("o2", "YALCIN/Z/3/08/26", "c1", "YBM Gastro GmbH",
                data="2026-08-27", qty=30)

    _zapas("f1", qty=30, dostepne=0, cid="c1", nazwa="YBM Gastro GmbH")
    _wz("w1", "YALCIN", [_linia_wz("f1", 30)], kiedy="2026-08-28 09:00:00+00")

    assert _wydane("o2")[0] == 30


# ── Grupa odbiorców: kilka spółek, wspólna pula ───────────────────────────
#
# Jeden kontrahent bywa kilkoma firmami: YALCIN to dwie spółki, odbiorca
# wrocławski ma pięć oddziałów. Towar zrobiony dla jednej ma pokrywać
# zamówienia pozostałych — dla hali to jeden klient. Poza grupą nic się nie
# zmienia: obcy nadal nie sięga do cudzego zapasu.

def _klient_g(cid, nazwa, display):
    """Klient z UNIKALNYM kodem, ale wspólną nazwą handlową — tak wygląda
    kartoteka, gdy jeden kontrahent ma kilka spółek."""
    execute(
        "INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING", (cid, cid, nazwa, display))


def _grupa(gid, nazwa, *client_ids):
    execute("INSERT INTO client_groups (id, name) VALUES (%s,%s) "
            "ON CONFLICT (id) DO NOTHING", (gid, nazwa))
    for cid in client_ids:
        execute("UPDATE clients SET group_id=%s WHERE id=%s", (gid, cid))


def test_towar_jednej_spolki_pokrywa_zamowienie_drugiej_z_grupy(db):
    _klient_g("c1", "YBM Gastro GmbH", "YALCIN")
    _klient_g("c2", "Emin Handels GmbH", "YALCIN")
    _grupa("g1", "YALCIN", "c1", "c2")
    _zamowienie("o1", "YALCIN/Z/9/08/26", "c2", "Emin Handels GmbH", qty=20)

    # Wyrób zrobiony dla PIERWSZEJ spółki, zamówienie ma DRUGA.
    _zapas("f1", qty=20, cid="c1", nazwa="YBM Gastro GmbH")

    assert _zrobione("o1") == 20


def test_bez_grupy_towar_obcej_spolki_nadal_nie_pokrywa(db):
    """Regresja reguły «magazyn to świętość» — grupa łączy tylko to, co wskazane."""
    _klient_g("c1", "YBM Gastro GmbH", "YALCIN")
    _klient_g("c2", "Emin Handels GmbH", "YALCIN")
    _zamowienie("o1", "YALCIN/Z/9/08/26", "c2", "Emin Handels GmbH", qty=20)

    _zapas("f1", qty=20, cid="c1", nazwa="YBM Gastro GmbH")

    assert _zrobione("o1") == 0


def test_spolka_spoza_grupy_nie_siega_do_puli_grupy(db):
    _klient_g("c1", "Oddzial Wroclaw I", "WROCŁAW")
    _klient_g("c2", "Oddzial Wroclaw II", "WROCŁAW")
    _klient_g("c9", "Truva gastro s.r.o.", "TRUVA")
    _grupa("g1", "WROCŁAW", "c1", "c2")
    _zamowienie("o9", "TRUVA/Z/1/08/26", "c9", "Truva gastro s.r.o.", qty=20)

    _zapas("f1", qty=20, cid="c1", nazwa="Oddzial Wroclaw I")

    assert _zrobione("o9") == 0


def test_piec_oddzialow_dzieli_jedna_pule(db):
    """Pięć oddziałów Wrocławia: zapas leży na jednym, zamówienie ma piąty."""
    for i in range(1, 6):
        _klient_g(f"c{i}", f"Oddzial Wroclaw {i}", "WROCŁAW")
    _grupa("g1", "WROCŁAW", "c1", "c2", "c3", "c4", "c5")
    _zamowienie("o5", "WROCLAW/Z/1/08/26", "c5", "Oddzial Wroclaw 5", qty=12)

    _zapas("f1", qty=12, cid="c3", nazwa="Oddzial Wroclaw 3")

    assert _zrobione("o5") == 12
