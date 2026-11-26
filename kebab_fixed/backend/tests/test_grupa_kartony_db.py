"""Karton magazynowy klienta z grupy odbiorców idzie do zamówienia innego klienta tej grupy.

Właściciel 26.11.2026: „mam karton magazynowy FUDI 80×10, FUDI i IGLOMEN to
grupa klientów; tworzę zamówienie IGLOMEN i karton się nie przypisuje ani nie
mogę go przypisać ręcznie". Decyzja: cała grupa — automatycznie (FEFO) i ręcznie.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import stock_carton_link_service as link
from tests.test_stock_carton_link_db import _baza, _fg_niczyj, _karton
from tests.test_finalize_loading_db import _zamowienie


def _grupa():
    execute("INSERT INTO client_groups (id, name) VALUES ('g1','FUDI+IGLOMEN')")
    execute("UPDATE clients SET group_id='g1' WHERE id='c1'")
    execute("INSERT INTO clients (id, code, name, group_id) VALUES ('c2','IGL','IGLOMEN','g1')")


def _zamowienie_c2(qty=2):
    _zamowienie(qty=qty)
    execute("UPDATE client_orders SET client_id='c2', client_name='IGLOMEN' WHERE id='o1'")


def test_karton_klienta_z_grupy_reczne_przypisanie(db):
    _baza(); _grupa(); _fg_niczyj(qty=2)
    c = _karton("g", client_id="c1")
    _zamowienie_c2()
    opcje = link.options_for_order("o1")
    assert [a["cartonId"] for a in opcje["available"]] == [c["id"]]
    assert link.assign(c["id"], "o1")["ok"]
    assert query_one("SELECT linked_order_id FROM stock_cartons WHERE id=%s", (c["id"],))["linked_order_id"] == "o1"


def test_karton_klienta_z_grupy_przypina_fefo(db):
    _baza(); _grupa(); _fg_niczyj(qty=2)
    c = _karton("g", client_id="c1")
    _zamowienie_c2()
    assert [w["cartonId"] for w in link.auto_assign_fefo("o1")] == [c["id"]]


def test_klient_spoza_grupy_dalej_odrzucony(db):
    _baza(); _grupa(); _fg_niczyj(qty=2)
    execute("INSERT INTO clients (id, code, name) VALUES ('c3','Z','Zagros')")
    c = _karton("g", client_id="c3")
    _zamowienie_c2()
    with pytest.raises(HTTPException) as e:
        link.assign(c["id"], "o1")
    assert e.value.status_code == 409
    assert link.options_for_order("o1")["available"] == []
