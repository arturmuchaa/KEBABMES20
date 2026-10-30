"""Rozpis palet nie może przekroczyć ilości pozycji zamówienia.

Incydent ISSA-DISTRIB/Z/3/10/26 (30.10.2026): 26.10 biuro rozpisało 15 kg na
cztery palety po 60 szt. (240). 28.10 edycja zmniejszyła pozycję do 180, a
rozpis został 240. Skaner załadunku liczy towar z palet, więc pokazał 240
i tyle zeskanowano. Nic po drodze nie zaprotestowało: edycja zamówienia nie
patrzyła na palety, a serwer przy zapisie rozpisu pilnował sumy tylko pod
kartonami magazynowymi (limit „Pozostało" był wyłącznie na ekranie biura).

Reguła: zmiana, która ZWIĘKSZA nadmiar palet ponad pozycję, jest odrzucana.
Stary nadmiar (sprzed poprawki) nie blokuje innych edycji — można go tylko
zmniejszać.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate, PalletDto
from app.services.orders_service import create_order, get_order, update_order
from app.services.pallets_service import list_pallets, save_pallets


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('cl-i','ISSA','SAS ISSA DISTRIB','ISSA DISTRIB') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt-udo','KEBAB UDO') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('rec-b','BEYAZ HALAL','pt-udo') "
            "ON CONFLICT (id) DO NOTHING")


def _pozycje(q15=240, q20=40):
    return [
        {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": q20, "kg_per_unit": 20},
        {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": q15, "kg_per_unit": 15},
    ]


def _dto(pozycje, **nadpisz):
    dane = {"client_id": "cl-i", "order_date": "2026-10-20",
            "delivery_date": "2026-10-30", "lines": pozycje}
    dane.update(nadpisz)
    return ClientOrderCreate.model_validate(dane)


def _paleta(line_id, qty, **reszta):
    return PalletDto.model_validate({"items": [{"order_line_id": line_id, "qty": qty}], **reszta})


def _zamowienie_issa():
    """Jak ISSA/Z/3/10/26 26.10: 1 paleta 20 kg + 4 palety po 60 szt. 15 kg."""
    _slownik()
    o = create_order(_dto(_pozycje()))
    l20, l15 = o["lines"][0]["id"], o["lines"][1]["id"]
    save_pallets(o["id"], [_paleta(l20, 40)] + [_paleta(l15, 60) for _ in range(4)])
    return o


def _na_paletach(order_id):
    return {r["order_line_id"]: int(r["n"]) for r in query_all(
        """SELECT pi.order_line_id, SUM(pi.qty) AS n FROM order_pallet_items pi
             JOIN order_pallets p ON p.id = pi.pallet_id
            WHERE p.order_id=%s GROUP BY pi.order_line_id""", (order_id,))}


def test_zmniejszenie_ponizej_rozpisu_jest_odrzucone(db):
    """SEDNO INCYDENTU: 240 → 180 przy 4 paletach po 60 nie może przejść."""
    o = _zamowienie_issa()
    with pytest.raises(HTTPException) as e:
        update_order(o["id"], _dto(_pozycje(q15=180)))
    assert e.value.status_code == 409
    msg = str(e.value.detail)
    assert "240" in msg and "180" in msg
    assert "P2" in msg and "P5" in msg
    # Nic się nie zapisało — ilość i rozpis jak przed próbą.
    assert get_order(o["id"])["lines"][1]["qty"] == 240
    assert _na_paletach(o["id"])[o["lines"][1]["id"]] == 240


def test_zmniejszenie_do_rozpisu_przechodzi(db):
    """Po zdjęciu jednej palety z rozpisu zmniejszenie do 180 jest poprawne."""
    o = _zamowienie_issa()
    palety = list_pallets(o["id"])
    zostaja = [PalletDto.model_validate({"id": p["id"], "pallet_no": p["pallet_no"],
                                         "items": [{"order_line_id": i["order_line_id"], "qty": i["qty"]}
                                                   for i in p["items"]]})
               for p in palety if p["pallet_no"] != 5]
    save_pallets(o["id"], zostaja)
    update_order(o["id"], _dto(_pozycje(q15=180)))
    assert get_order(o["id"])["lines"][1]["qty"] == 180


def test_zwiekszenie_i_inne_edycje_przechodza(db):
    o = _zamowienie_issa()
    update_order(o["id"], _dto(_pozycje(q15=300), delivery_date="2026-10-31"))
    assert get_order(o["id"])["lines"][1]["qty"] == 300


def test_rozpis_ponad_zamowienie_jest_odrzucony(db):
    """Serwer pilnuje sumy także bez kartonów magazynowych — nie tylko ekran."""
    o = _zamowienie_issa()
    l15 = o["lines"][1]["id"]
    palety = list_pallets(o["id"])
    obecne = [PalletDto.model_validate({"id": p["id"], "pallet_no": p["pallet_no"],
                                        "items": [{"order_line_id": i["order_line_id"], "qty": i["qty"]}
                                                  for i in p["items"]]}) for p in palety]
    with pytest.raises(HTTPException) as e:
        save_pallets(o["id"], obecne + [_paleta(l15, 60)])
    assert e.value.status_code == 409
    assert "300" in str(e.value.detail) and "240" in str(e.value.detail)
    assert query_one("SELECT count(*) AS n FROM order_pallets WHERE order_id=%s",
                     (o["id"],))["n"] == 5


def test_stary_nadmiar_nie_blokuje_innych_edycji_ale_nie_rosnie(db):
    """Nadmiar sprzed poprawki (jak ISSA na produkcji) nie zamraża zamówienia:
    zmiana daty przechodzi, ale dalsze zmniejszanie pozycji już nie."""
    o = _zamowienie_issa()
    execute("UPDATE client_order_lines SET qty=180 WHERE id=%s", (o["lines"][1]["id"],))
    update_order(o["id"], _dto(_pozycje(q15=180), delivery_date="2026-10-31"))
    with pytest.raises(HTTPException) as e:
        update_order(o["id"], _dto(_pozycje(q15=120)))
    assert e.value.status_code == 409
    # Zmniejszenie nadmiaru (zdjęcie palety) zawsze wolno.
    palety = list_pallets(o["id"])
    zostaja = [PalletDto.model_validate({"id": p["id"], "pallet_no": p["pallet_no"],
                                         "items": [{"order_line_id": i["order_line_id"], "qty": i["qty"]}
                                                   for i in p["items"]]})
               for p in palety if p["pallet_no"] != 5]
    save_pallets(o["id"], zostaja)
    assert _na_paletach(o["id"])[o["lines"][1]["id"]] == 180
