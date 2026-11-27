"""Przeniesienie CAŁYCH palet do innego zamówienia (właściciel 27.11.2026).

YALCIN/Z/7/11/26: 21 palet, klient chce 16 na niedzielę, 5 na poniedziałek.
Bez usuwania zamówienia i rozpisywania palet od nowa: palety zachowują id,
karton, ważenie z mroźni i miejsce; stara kartka PAL|<źródło>|<nr> dalej
działa na skanerze magazynu; ilości zamówień przeliczają się same.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import pallets_service
from app.services.order_pallet_move_service import przenies_palety
from app.services.orders_service import create_order
from tests.test_pallet_transfer_db import _dto, _kartka, _palety, _poz, _slownik, _z_paletami

pytestmark = pytest.mark.usefixtures("db")


def _linie(order_id):
    return [(float(r["kg_per_unit"]), int(r["qty"])) for r in query_all(
        "SELECT kg_per_unit, qty FROM client_order_lines WHERE order_id=%s ORDER BY position", (order_id,))]


def _zamowienie_21():
    _slownik()
    # 3 pozycje; palety: P1–P3 po 30 kg, P4–P5 po 50 kg, P6 mieszana.
    o = _z_paletami([_poz(30, 90), _poz(50, 40), _poz(15, 60)],
                    [[(0, 30)], [(0, 30)], [(0, 30)], [(1, 20)], [(1, 20)], [(2, 60)]])
    execute("UPDATE client_orders SET status='confirmed' WHERE id=%s", (o["id"],))
    return o


def test_nowe_zamowienie_z_wybranych_palet_bez_przeklejania():
    o = _zamowienie_21()
    stare = _palety(o["id"])
    pallets_service.scan(_kartka(o["id"], 5), "cold_storage")
    p5 = stare[4]["id"]
    execute("INSERT INTO cold_storage_weighings (id, container_kind, container_id, gross_kg, net_kg, ok) VALUES ('w5','pallet',%s,1030,1000,true)", (p5,))

    out = przenies_palety(o["id"], [stare[3]["id"], p5, stare[5]["id"]], new_delivery_date="2026-12-01")

    nowe = out["targetOrderId"]
    assert out["targetOrderNo"].startswith("ZAGROS/Z/") and out["targetOrderNo"] != o["order_no"]
    zam = query_one("SELECT * FROM client_orders WHERE id=%s", (nowe,))
    assert zam["status"] == "confirmed" and str(zam["delivery_date"]) == "2026-12-01"
    assert zam["client_id"] == "cz"
    # Te same palety (id, karton, status), numery zachowane.
    przeniesione = _palety(nowe)
    assert [(p["id"], p["carton_no"], p["pallet_no"]) for p in przeniesione] == [
        (s["id"], s["carton_no"], s["pallet_no"]) for s in (stare[3], stare[4], stare[5])]
    assert przeniesione[1]["status"] == "cold_storage"
    # Ważenie z mroźni dalej ważne.
    assert query_one("SELECT invalid_at FROM cold_storage_weighings WHERE id='w5'")["invalid_at"] is None
    # Ilości: źródło maleje, nowe ma dokładnie to, co na paletach.
    assert _linie(o["id"]) == [(30.0, 90)]
    assert _linie(nowe) == [(50.0, 40), (15.0, 60)]
    assert float(zam["total_kg"]) == 50 * 40 + 15 * 60
    # Stara kartka magazynu trafia w paletę w nowym zamówieniu.
    assert pallets_service.lookup(_kartka(o["id"], 5))["id"] == p5
    assert pallets_service.lookup(_kartka(o["id"], 1))["id"] == stare[0]["id"]


def test_do_istniejacego_zamowienia_klienta_najpierw_wolna_ilosc():
    o = _zamowienie_21()
    pon = create_order(_dto([_poz(30, 40)]))          # poniedziałek: 40 × 30 kg, bez palet
    stare = _palety(o["id"])
    out = przenies_palety(o["id"], [stare[0]["id"], stare[1]["id"]], target_order_id=pon["id"])
    assert out["targetOrderId"] == pon["id"]
    # 60 szt. 30 kg: 40 wolnych w Z/pon, nadwyżka 20 dolicza się do pozycji.
    assert _linie(pon["id"]) == [(30.0, 60)]
    assert _linie(o["id"]) == [(30.0, 30), (50.0, 40), (15.0, 60)]
    assert [p["id"] for p in _palety(pon["id"])] == [stare[0]["id"], stare[1]["id"]]
    assert pallets_service.lookup(_kartka(o["id"], 2))["id"] == stare[1]["id"]


def test_numer_zajety_w_celu_dostaje_nastepny_i_kartka_dziala():
    o = _zamowienie_21()
    pon = _z_paletami([_poz(30, 30)], [[(0, 30)]])     # ma już P1
    stare = _palety(o["id"])
    przenies_palety(o["id"], [stare[0]["id"]], target_order_id=pon["id"])
    nr = {p["id"]: p["pallet_no"] for p in _palety(pon["id"])}
    assert nr[stare[0]["id"]] == 2
    assert pallets_service.lookup(_kartka(o["id"], 1))["id"] == stare[0]["id"]


def test_paleta_na_aucie_nie_przechodzi():
    o = _zamowienie_21()
    stare = _palety(o["id"])
    execute("UPDATE order_pallets SET status='loaded' WHERE id=%s", (stare[0]["id"],))
    with pytest.raises(HTTPException) as e:
        przenies_palety(o["id"], [stare[0]["id"]], new_delivery_date="2026-12-01")
    assert e.value.status_code == 409 and "P1" in e.value.detail
    assert len(_palety(o["id"])) == 6


def test_inny_klient_odmowa():
    o = _zamowienie_21()
    obcy = create_order(_dto([_poz(30, 30)], client="ce"))
    with pytest.raises(HTTPException) as e:
        przenies_palety(o["id"], [_palety(o["id"])[0]["id"]], target_order_id=obcy["id"])
    assert e.value.status_code == 409 and "innego klienta" in e.value.detail


def test_paleta_spoza_zamowienia_odmowa():
    o = _zamowienie_21()
    inne = _z_paletami([_poz(30, 30)], [[(0, 30)]])
    with pytest.raises(HTTPException) as e:
        przenies_palety(o["id"], [_palety(inne["id"])[0]["id"]], new_delivery_date="2026-12-01")
    assert e.value.status_code == 400


def test_wszystkie_palety_i_wystawiony_dokument():
    o = _zamowienie_21()
    ids = [p["id"] for p in _palety(o["id"])]
    with pytest.raises(HTTPException) as e:
        przenies_palety(o["id"], ids, new_delivery_date="2026-12-01")
    assert "zmień datę" in e.value.detail
    execute("INSERT INTO wz_documents (id, number, source_type, source_id, status) VALUES ('wz1','WZ/1','order',%s,'wystawiony')", (o["id"],))
    with pytest.raises(HTTPException) as e:
        przenies_palety(o["id"], ids[:1], new_delivery_date="2026-12-01")
    assert e.value.status_code == 409 and "WZ/1" in e.value.detail


def test_sztuki_qr_na_palecie_ida_za_paleta():
    o = _zamowienie_21()
    p1 = _palety(o["id"])[0]["id"]
    execute("INSERT INTO finished_units (id, qr_code, status, order_id, pallet_id) VALUES ('u1','U|u1','packed',%s,%s)", (o["id"], p1))
    out = przenies_palety(o["id"], [p1], new_delivery_date="2026-12-01")
    assert query_one("SELECT order_id FROM finished_units WHERE id='u1'")["order_id"] == out["targetOrderId"]
