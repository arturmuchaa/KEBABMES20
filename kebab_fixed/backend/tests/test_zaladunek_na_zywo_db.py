"""Pulpit PROTRIMA — „Załadunek na żywo” (spec 2026-11-28 §C).

Auto widoczne, gdy ma przypisane zamówienia (`vehicle_loading_orders`) i stoi na nim
co najmniej jedna jednostka albo przypisanie jest z dziś. Jednostka = paleta zamówienia
albo karton magazynowy powiązany z zamówieniem. Wymaga TEST_DATABASE_URL, inaczej skip.
"""
from datetime import date, timedelta

from app.db import execute
from app.services import biuro_zamowienia_service as biuro
from app.services import vehicle_loading_service as auta
from tests.test_biuro_zamowienia_db import _baza, _paleta
from tests.test_finalize_loading_db import _pojazd, _zamowienie


def _loaded_at(pid, ts):
    execute("UPDATE order_pallets SET loaded_at=%s WHERE id=%s", (ts, pid))


def test_brak_aut_pusta_lista(db):
    _baza()
    assert biuro.zaladunek_na_zywo() == []


def test_czesciowy_zaladunek(db):
    _baza(); _zamowienie()
    auta.add_order("v1", "o1")
    _paleta("p1", nr=1, status="loaded", vid="v1", qty=3)
    _paleta("p2", nr=2, status="loaded", vid="v1", qty=3, carton=932)
    _paleta("p3", nr=3, status="cold_storage", qty=4, carton=933)
    _loaded_at("p1", "2026-11-28T09:31:00+00:00")
    _loaded_at("p2", "2026-11-28T10:12:00+00:00")
    [a] = biuro.zaladunek_na_zywo()
    assert a["vehicleId"] == "v1" and a["plate"] == "KR 12345"
    assert (a["unitsLoaded"], a["unitsToLoad"]) == (2, 3)
    assert a["kgLoaded"] == 180.0 and a["kgToLoad"] == 300.0
    assert a["startedAt"].startswith("2026-11-28T09:31")
    assert a["lastLoadedAt"].startswith("2026-11-28T10:12")
    o = a["orders"][0]
    assert (o["unitsHere"], o["unitsTotal"], o["complete"]) == (2, 3, False)
    assert o["clientShortName"] == "YALCIN"


def test_czesc_wyslana_wczesniej(db):
    _baza(); _zamowienie(); _pojazd("v2", "KR 99999")
    auta.add_order("v1", "o1")
    _paleta("p1", nr=1, status="shipped", vid="v2", qty=2)
    _paleta("p2", nr=2, status="shipped", vid="v2", qty=2, carton=932)
    _paleta("p3", nr=3, status="loaded", vid="v1", qty=3, carton=933)
    _paleta("p4", nr=4, status="loaded", vid="v1", qty=3, carton=934)
    [a] = biuro.zaladunek_na_zywo()
    o = a["orders"][0]
    assert o["unitsShippedBefore"] == 2 and o["unitsHere"] == 2 and o["unitsTotal"] == 4
    assert a["unitsToLoad"] == 2 and a["unitsLoaded"] == 2
    assert o["complete"] is True


def test_stare_przypisanie_bez_skanu_ukryte(db):
    _baza(); _zamowienie()
    auta.add_order("v1", "o1")
    _paleta("p1", status="cold_storage")
    execute("UPDATE vehicle_loading_orders SET created_at = now() - interval '2 days'")
    assert biuro.zaladunek_na_zywo() == []
    execute("UPDATE vehicle_loading_orders SET created_at = now()")
    [a] = biuro.zaladunek_na_zywo()
    assert a["startedAt"] is None and a["unitsLoaded"] == 0


def test_karton_magazynowy_liczy_sie(db):
    _baza(); _zamowienie()
    auta.add_order("v1", "o1")
    execute("INSERT INTO stock_cartons (id, carton_no, client_id, client_name, kg_per_unit, target_qty,"
            " packed_qty, status, linked_order_id, loaded_vehicle_id, loaded_at)"
            " VALUES ('sc1',835,'c1','YBM',10,8,8,'closed','o1','v1',now())")
    execute("INSERT INTO stock_carton_lines (id, carton_id, recipe_id, product_type_id, kg_per_unit,"
            " target_qty, packed_qty) VALUES ('sc1-l','sc1','r1','pt1',10,8,8)")
    [a] = biuro.zaladunek_na_zywo()
    o = a["orders"][0]
    assert o["unitsHere"] == 1 and o["kgHere"] == 80.0
    assert o["complete"] is True


def test_dwa_auta_kolejnosc_position(db):
    _baza(); _pojazd("v2", "KR 99999")
    _zamowienie("o1", "A/Z/1"); _zamowienie("o2", "B/Z/2"); _zamowienie("o3", "C/Z/3")
    auta.add_order("v1", "o1"); auta.add_order("v1", "o2"); auta.add_order("v2", "o3")
    auta.reorder("v1", ["o2", "o1"])
    _paleta("p1", oid="o1", status="loaded", vid="v1", line="o1-l1")
    _paleta("p3", oid="o3", status="loaded", vid="v2", line="o3-l1", carton=940)
    _loaded_at("p1", "2026-11-28T08:00:00+00:00")
    _loaded_at("p3", "2026-11-28T07:00:00+00:00")
    wynik = biuro.zaladunek_na_zywo()
    assert [a["vehicleId"] for a in wynik] == ["v2", "v1"]
    assert [o["orderNo"] for o in wynik[1]["orders"]] == ["B/Z/2", "A/Z/1"]
