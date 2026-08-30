"""Pozycje magazynu pod „Wystaw WZ" na zamówieniu.

Od 30.08.2026 zamówienie przenosi się do ZWYKŁEGO formularza WZ, więc
potrzebuje WIERSZY magazynu (rozchód idzie po stock_id), a nie abstrakcyjnych
pozycji z linii planu.
"""
from app.db import execute, query_one
from app.services.order_stock_service import picks_for_order
from app.utils.ids import cuid, now_iso


def _zamowienie(order_no="ZAM/1/08", client_id="cl-1"):
    execute("INSERT INTO clients (id, code, name, active, created_at) "
            "VALUES (%s,'K1','KLIENT A',true,%s) ON CONFLICT (id) DO NOTHING",
            (client_id, now_iso()))
    oid = cuid()
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, status, created_at) "
            "VALUES (%s,%s,%s,'KLIENT A','new',%s)", (oid, order_no, client_id, now_iso()))
    return oid


def _pozycja_zamowienia(oid, qty=10, kg=20.0, recipe="rec-1", ptype="pt-1"):
    execute("INSERT INTO client_order_lines (id, order_id, qty, kg_per_unit, "
            "recipe_id, product_type_id) VALUES (%s,%s,%s,%s,%s,%s)",
            (cuid(), oid, qty, kg, recipe, ptype))


def _na_magazynie(qty=10, kg=20.0, recipe="rec-1", ptype="pt-1",
                  client_order_no=None, client_name="", client_id=""):
    fid = cuid()
    execute(
        "INSERT INTO finished_goods (id, batch_no, product_type_id, product_type_name, "
        "recipe_id, recipe_name, kg_per_unit, qty, qty_available, qty_shipped, total_kg, "
        "client_order_no, client_name, client_id, created_at) "
        "VALUES (%s,'B1',%s,'KEBAB UDO 100%%',%s,'KIRMIZI',%s,%s,%s,0,%s,%s,%s,%s,%s)",
        (fid, ptype, recipe, kg, qty, qty, qty * kg, client_order_no, client_name,
         client_id, now_iso()))
    return fid


class TestPicksForOrder:
    def test_zamowienie_dostaje_wiersze_magazynu_z_iloscia(self, db):
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=10)
        fid = _na_magazynie(qty=10)
        picks = picks_for_order(oid)
        assert [(p["fg"]["id"], p["take"]) for p in picks] == [(fid, 10)]

    def test_bierze_tylko_tyle_ile_zamowiono(self, db):
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=4)
        _na_magazynie(qty=10)
        assert sum(p["take"] for p in picks_for_order(oid)) == 4

    def test_liczy_CALE_zamowienie_nie_tylko_braki(self, db):
        # Różnica wobec `stock_portions_for_order`: dokument ma wykazać
        # wszystko, co jedzie, także towar zrobiony pod plan tego zamówienia.
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=10)
        _na_magazynie(qty=10)
        assert sum(p["take"] for p in picks_for_order(oid)) == 10

    def test_nie_wciaga_towaru_INNEGO_klienta(self, db):
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=10)
        _na_magazynie(qty=10, client_name="KTOS INNY", client_id="cl-2")
        assert picks_for_order(oid) == []

    def test_stempel_TEGO_zamowienia_idzie_pierwszy(self, db):
        oid = _zamowienie(order_no="ZAM/7/08")
        _pozycja_zamowienia(oid, qty=5)
        _na_magazynie(qty=5)                                   # wolny
        ostemplowany = _na_magazynie(qty=5, client_order_no="ZAM/7/08")
        picks = picks_for_order(oid)
        assert picks[0]["fg"]["id"] == ostemplowany

    def test_pozycja_bez_pokrycia_nie_zwraca_nic(self, db):
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=10)
        assert picks_for_order(oid) == []

    def test_zamowienie_bez_pozycji_nie_wywraca_sie(self, db):
        assert picks_for_order(_zamowienie()) == []

    def test_nieznane_zamowienie_nie_wywraca_sie(self, db):
        assert picks_for_order("nie-ma-takiego") == []

    def test_wydany_towar_nie_wraca_jako_dostepny(self, db):
        # Wiersz rozchodowany do zera nie ma czego wydać drugi raz.
        oid = _zamowienie()
        _pozycja_zamowienia(oid, qty=10)
        fid = _na_magazynie(qty=10)
        execute("UPDATE finished_goods SET qty_available=0, qty_shipped=10 WHERE id=%s", (fid,))
        assert picks_for_order(oid) == []
