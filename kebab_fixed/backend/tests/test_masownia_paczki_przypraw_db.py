"""Paczki przypraw: worki zamiast pojemników, numer ciągły od 1.

Hala pakuje odważone przyprawy do WORKÓW (18.09.2026), a nie do sześciu
ponumerowanych pojemników: 200 kg mieści się w jednym worku, 600 kg w trzech.
Numer paczki leci ciągle od 1, bez miesiąca i roku — jest jednorazowy, więc
nie wraca do puli jak numer umytego pojemnika.
"""
import pytest

from app.db import execute, query_one
from app.models.masownia import SpiceCartCreate
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=2000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,'MAS/18/09/26','r1',%s,0,'confirmed')",
        (oid, meat_kg),
    )
    return oid


def test_paczka_zapamietuje_liczbe_workow():
    oid = _zlecenie()
    p = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=600, bags=3))
    assert p["bags"] == 3
    assert query_one("SELECT bags FROM mixing_spice_carts WHERE id=%s", (p["id"],))["bags"] == 3


def test_numer_leci_ciagle_od_jedynki():
    oid = _zlecenie()
    a = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))
    b = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=600, bags=3))
    assert b["cart_no"] == a["cart_no"] + 1


def test_numer_zuzytej_paczki_nie_wraca_do_puli():
    """Pojemnik wracał po umyciu, worek nie — numer jest jednorazowy."""
    oid = _zlecenie()
    a = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))
    svc.cancel_cart(a["id"])
    b = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))
    assert b["cart_no"] > a["cart_no"]


def test_panel_nie_narzuca_numeru():
    """Numer nadaje backend — panel mógłby podać ten sam dwa razy."""
    oid = _zlecenie()
    a = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200, bags=1))
    b = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200, bags=1))
    assert a["cart_no"] != b["cart_no"]


def test_szosta_paczka_przechodzi():
    """Stary limit 1–6 opisywał sześć fizycznych pojemników; worków nie ma ile."""
    oid = _zlecenie(meat_kg=4000)
    numery = [svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200, bags=1))["cart_no"]
              for _ in range(8)]
    assert len(set(numery)) == 8


def test_bez_workow_zostaje_jeden():
    """Stara ścieżka bez pola `bags` nie może wywrócić zakładania paczki."""
    oid = _zlecenie()
    p = svc.create_cart(SpiceCartCreate(orderId=oid, kgTarget=200))
    assert p["bags"] == 1
