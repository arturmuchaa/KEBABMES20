"""Palety przeżywają usunięcie / anulowanie / zmianę zamówienia i same wracają
do zgodnego zamówienia odbiorcy; stara kartka PAL|<stare>|<nr> działa dalej.

Właściciel 07.10.2026 (ZAGROS/Z/2 usunięte, Z/3 założone — sześć kartek
przestało działać). Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate, PalletDto
from app.services import pallets_service
from app.services.orders_service import create_order, delete_order, update_order, update_order_status
from app.services.pallet_transfer_service import list_orphans


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) VALUES "
            "('cz','ZAG','OKAYTEKIN KG','ZAGROS'), ('ce','EMI','Emin Handels GmbH','EMIN')")
    execute("INSERT INTO product_types (id, name) VALUES ('pt','UDO')")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('rk','KIRMIZI','pt')")


def _poz(kg, qty):
    return {"recipe_id": "rk", "product_type_id": "pt", "packaging_id": "m65", "qty": qty, "kg_per_unit": kg}


def _dto(pozycje, client="cz", **kw):
    return ClientOrderCreate.model_validate(
        {"client_id": client, "order_date": "2026-10-05", "delivery_date": "2026-10-12",
         "lines": pozycje, **kw})


def _z_paletami(pozycje, palety, client="cz"):
    """Zamówienie i palety: `palety` = [[(indeks pozycji, ilość), ...], ...]."""
    o = create_order(_dto(pozycje, client))
    linie = o["lines"]
    pallets_service.save_pallets(o["id"], [
        PalletDto.model_validate({"items": [{"order_line_id": linie[i]["id"], "qty": q} for i, q in p]})
        for p in palety])
    return o


def _palety(order_id):
    return query_all("SELECT id, pallet_no, carton_no, status, notes FROM order_pallets "
                     "WHERE order_id=%s ORDER BY pallet_no", (order_id,))


def _kartka(order_id, nr):
    return f"PAL|{order_id}|{nr}"


def test_usuniete_zamowienie_palety_wracaja_do_nowego_bez_przeklejania(db):
    _slownik()
    z2 = _z_paletami([_poz(30, 30), _poz(50, 15), _poz(15, 60)],
                     [[(0, 30)], [(1, 15)], [(2, 60)]])
    stare = _palety(z2["id"])
    pallets_service.scan(_kartka(z2["id"], 2), "cold_storage")      # P2 w mroźni

    delete_order(z2["id"])
    assert {o["palletNo"] for o in list_orphans()} == {1, 2, 3}
    with pytest.raises(HTTPException) as e:
        pallets_service.scan(_kartka(z2["id"], 1), "cold_storage")
    assert e.value.detail["code"] == "WAITING_FOR_ORDER"

    # Nowe zamówienie bez 15 kg: P1 i P2 wracają same, P3 czeka.
    z3 = create_order(_dto([_poz(30, 30), _poz(50, 45), _poz(40, 20)]))
    assert {m["fromPalletNo"] for m in z3["movedPallets"]} == {1, 2}
    nowe = _palety(z3["id"])
    assert [(p["id"], p["carton_no"]) for p in nowe] == [(stare[0]["id"], stare[0]["carton_no"]),
                                                         (stare[1]["id"], stare[1]["carton_no"])]
    assert nowe[1]["status"] == "cold_storage"
    assert "ZAGROS/Z/" in nowe[0]["notes"] and "P1" in nowe[0]["notes"]
    pozycje = query_all("""SELECT l.kg_per_unit, i.qty FROM order_pallet_items i
                             JOIN client_order_lines l ON l.id=i.order_line_id
                             JOIN order_pallets p ON p.id=i.pallet_id
                            WHERE p.order_id=%s ORDER BY p.pallet_no""", (z3["id"],))
    assert [(float(r["kg_per_unit"]), r["qty"]) for r in pozycje] == [(30.0, 30), (50.0, 15)]
    assert [o["palletNo"] for o in list_orphans()] == [3]

    # Stara kartka P2 trafia w paletę w Z/3 (lookup, skan, cofnięcie).
    p = pallets_service.lookup(_kartka(z2["id"], 2))
    assert p["id"] == stare[1]["id"]
    execute("INSERT INTO vehicles (id, name, plate, active) VALUES ('v1','A','KR 1',true) "
            "ON CONFLICT (id) DO UPDATE SET active=true")
    from app.services import vehicle_loading_service as vehicles
    vehicles.add_order("v1", z3["id"])
    assert pallets_service.scan(_kartka(z2["id"], 2), "loaded", vehicle_id="v1")["result"] == "SUCCESS"
    assert query_one("SELECT status FROM order_pallets WHERE id=%s", (stare[1]["id"],))["status"] == "loaded"
    pallets_service.scan(_kartka(z2["id"], 2), "undo", vehicle_id="v1")

    # Poprawka rozpisu w biurze (palety pisane od nowa) — kartka dalej działa.
    linie = {float(l["kg_per_unit"]): l["id"] for l in z3["lines"]}
    pallets_service.save_pallets(z3["id"], [
        PalletDto.model_validate({"pallet_no": 1, "items": [{"order_line_id": linie[30.0], "qty": 30}]}),
        PalletDto.model_validate({"pallet_no": 2, "items": [{"order_line_id": linie[50.0], "qty": 15}]}),
    ])
    assert pallets_service.lookup(_kartka(z2["id"], 1))["pallet_no"] == 1


def test_edycja_dodaje_pozycje_paleta_czekajaca_wraca(db):
    _slownik()
    z2 = _z_paletami([_poz(15, 60)], [[(0, 60)]])
    z3 = create_order(_dto([_poz(30, 10)]))
    delete_order(z2["id"])
    assert len(list_orphans()) == 1
    upd = update_order(z3["id"], _dto([{**_poz(30, 10), "id": z3["lines"][0]["id"]}, _poz(15, 60)]))
    assert len(upd["movedPallets"]) == 1 and list_orphans() == []
    assert pallets_service.lookup(_kartka(z2["id"], 1))["id"]


def test_tylko_tyle_ile_wolnego_i_tylko_ten_sam_odbiorca(db):
    _slownik()
    z2 = _z_paletami([_poz(30, 60)], [[(0, 30)], [(0, 30)]])
    delete_order(z2["id"])
    obcy = create_order(_dto([_poz(30, 60)], client="ce"))
    assert obcy["movedPallets"] == []
    z3 = create_order(_dto([_poz(30, 30)]))
    assert len(z3["movedPallets"]) == 1 and len(list_orphans()) == 1


def test_anulowanie_przenosi_palety_do_innego_otwartego_zamowienia(db):
    _slownik()
    z3 = create_order(_dto([_poz(30, 30)]))
    z2 = _z_paletami([_poz(30, 30)], [[(0, 30)]])          # Z/3 już jest, Z/2 ma paletę
    paleta = _palety(z2["id"])[0]
    update_order_status(z2["id"], "cancelled")
    assert _palety(z2["id"]) == []
    assert [p["id"] for p in _palety(z3["id"])] == [paleta["id"]]


def test_edycja_zabierajaca_pozycje_odklada_cala_palete(db):
    _slownik()
    o = _z_paletami([_poz(30, 10), _poz(40, 10)], [[(0, 10), (1, 10)]])
    paleta = _palety(o["id"])[0]
    # Usunięcie pozycji 40 kg: paleta nie zostaje okrojona do samych 30 kg.
    update_order(o["id"], _dto([{**_poz(30, 10), "id": o["lines"][0]["id"]}]))
    assert _palety(o["id"]) == []
    sieroty = list_orphans()
    assert len(sieroty) == 1 and sorted(i["qty"] for i in sieroty[0]["items"]) == [10, 10]
    # Pozycja wraca — paleta też.
    update_order(o["id"], _dto([{**_poz(30, 10), "id": o["lines"][0]["id"]}, _poz(40, 10)]))
    assert [p["id"] for p in _palety(o["id"])] == [paleta["id"]] and list_orphans() == []


def test_paleta_na_aucie_blokuje_usuniecie(db):
    _slownik()
    o = _z_paletami([_poz(30, 10)], [[(0, 10)]])
    execute("INSERT INTO vehicles (id, name, plate, active) VALUES ('v1','A','KR 1',true) "
            "ON CONFLICT (id) DO UPDATE SET active=true")
    from app.services import vehicle_loading_service as vehicles
    vehicles.add_order("v1", o["id"])
    pallets_service.scan(_kartka(o["id"], 1), "loaded", vehicle_id="v1")
    with pytest.raises(HTTPException) as e:
        delete_order(o["id"])
    assert "na aucie" in e.value.detail
    assert len(_palety(o["id"])) == 1 and list_orphans() == []
