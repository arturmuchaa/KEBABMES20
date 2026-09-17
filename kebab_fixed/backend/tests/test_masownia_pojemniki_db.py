"""Pojemniki z przyprawami: numer 1-6, rezerwacja kg zlecenia, anulowanie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.masownia import SpiceCartCreate, SpiceWeighDto
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/17/09/26", "r1", meat_kg),
    )
    return oid


def test_zaklada_pojemnik_na_wskazany_wsad():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert cart["cart_no"] == 2 and float(cart["kg_target"]) == 200.0
    assert cart["status"] == "prepared"


def test_numer_pojemnika_jest_zajety_tylko_raz():
    oid = _zlecenie()
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    with pytest.raises(HTTPException) as e:
        svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert "pojemnik" in str(e.value.detail).lower()


def test_anulowany_pojemnik_zwalnia_numer():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    svc.cancel_cart(cart["id"])
    znowu = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert znowu["cart_no"] == 2


def test_pojemnik_rezerwuje_kilogramy_zlecenia():
    # Bez tego operator rozpisałby dwa razy to samo zlecenie.
    oid = _zlecenie(meat_kg=1000)
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=600))
    assert svc.kg_prepared_of(oid) == 600.0


def test_nie_da_sie_rozpisac_wiecej_niz_zostalo_w_zleceniu():
    oid = _zlecenie(meat_kg=1000)
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=600))
    with pytest.raises(HTTPException) as e:
        svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=600))
    assert "zostało" in str(e.value.detail).lower()


def test_zapisuje_odwazony_skladnik_ze_sladem_recznym():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    out = svc.weigh_ingredient(cart["id"], SpiceWeighDto(
        seq=0, name="BERG SERHAT", unit="kg", qty=3.5, weighed=3.52, manual=True))
    assert out["ingredients"][0] == {
        "seq": 0, "name": "BERG SERHAT", "unit": "kg",
        "qty": 3.5, "weighed": 3.52, "manual": True,
    }


def test_kolejny_odczyt_tego_samego_skladnika_nadpisuje_poprzedni():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    svc.weigh_ingredient(cart["id"], SpiceWeighDto(seq=0, name="X", unit="kg", qty=1, weighed=0.9, manual=False))
    out = svc.weigh_ingredient(cart["id"], SpiceWeighDto(seq=0, name="X", unit="kg", qty=1, weighed=1.0, manual=False))
    assert len(out["ingredients"]) == 1 and out["ingredients"][0]["weighed"] == 1.0


def test_lista_pokazuje_tylko_stojace_pojemniki():
    oid = _zlecenie()
    a = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    b = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=3, kgTarget=200))
    svc.cancel_cart(b["id"])
    assert [c["id"] for c in svc.list_carts()] == [a["id"]]


def test_pojemnik_powstaje_od_razu_z_odwazonymi_skladnikami():
    # Panel zaklada pojemnik DOPIERO po zatwierdzeniu calego wazenia, wiec
    # przysyla komplet naraz. Wczesniej pojemnik powstawal przy wyborze
    # wielkosci wsadu i „przygotowane przyprawy" pojawialy sie po samym
    # wejsciu i wyjsciu z ekranu — bez zwazenia czegokolwiek.
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200, ingredients=[
        SpiceWeighDto(seq=0, name="BERG SERHAT", unit="kg", qty=3.5, weighed=3.5, manual=False),
        SpiceWeighDto(seq=1, name="SKROBIA", unit="kg", qty=3.0, weighed=3.02, manual=True),
    ]))
    assert [i["name"] for i in cart["ingredients"]] == ["BERG SERHAT", "SKROBIA"]
    assert cart["ingredients"][1]["manual"] is True


def test_pojemnik_bez_skladnikow_dalej_wolno_zalozyc():
    # Zgodnosc wstecz: stara sciezka (zaloz, potem wazenie po jednym) dziala.
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    assert cart["ingredients"] == []
