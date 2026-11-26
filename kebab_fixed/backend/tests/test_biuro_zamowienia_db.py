"""Zamówienia z biura: kursy niezakończone, wyjazd kartonem, przeniesienie sztuk, usunięcie kartonu.

Zgłoszenia właściciela 26.11.2026 (patrz `biuro_zamowienia_service`).
Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import biuro_zamowienia_service as biuro
from app.services import orders_service
from app.services import vehicle_loading_service as auta
from tests.test_finalize_loading_db import _firma, _klient, _pojazd, _receptura, _zamowienie


def _wyrob(gid="f1", qty=10, kg=30, order_no="YALCIN/Z/4/09/26", packaging="pk65"):
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, packaging_id, packaging_name, qty, kg_per_unit, total_kg, qty_available, "
        " qty_shipped, client_id, client_name, client_order_no, produced_date) "
        "VALUES (%s,'231126 733','r1','KIRMIZI','pt1','KEBAB UDO 100%%',%s,'METAL 65CM',%s,%s,%s,%s,0,"
        " 'c1','YBM',%s,'2026-11-23')",
        (gid, packaging, qty, kg, qty * kg, qty, order_no))


def _paleta(pid="p1", oid="o1", nr=1, status="created", qty=10, line="o1-l1", vid=None, carton=931):
    execute(
        "INSERT INTO order_pallets (id, order_id, pallet_no, notes, status, carton_no, loaded_vehicle_id, "
        " loaded_at, cold_storage_at) VALUES (%s,%s,%s,'',%s,%s,%s,%s,%s)",
        (pid, oid, nr, status, carton, vid, "now()" if vid else None,
         "now()" if status in ("cold_storage", "loaded") else None))
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) VALUES (%s,%s,%s,%s)",
            (f"{pid}-i", pid, line, qty))


def _tuleja(oid, packaging="pk65", nazwa="METAL 65CM"):
    execute("UPDATE client_order_lines SET packaging_id=%s, packaging_name=%s WHERE order_id=%s",
            (packaging, nazwa, oid))


def _baza():
    _firma(); _pojazd(); _klient(); _receptura()


# ── Kursy niezakończone ───────────────────────────────────────────────────

def test_kurs_bez_zakonczenia_na_hmi_widoczny_i_zamykany_z_biura(db):
    _baza(); _zamowienie(); _tuleja("o1"); _wyrob()
    auta.add_order("v1", "o1")
    _paleta(status="loaded", vid="v1")
    with pytest.raises(HTTPException):          # jak GOLD-KEBAB: zakończyć się nie da
        orders_service.update_order_status("o1", "done")

    kursy = biuro.kursy_otwarte()
    assert [k["vehicleId"] for k in kursy] == ["v1"]
    assert kursy[0]["orders"][0]["orderNo"] == "YALCIN/Z/4/09/26"
    assert kursy[0]["orders"][0]["szt"] == 10

    wynik = biuro.zakoncz_kurs("v1", "biuro-test")
    assert wynik["ok"] is True
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "shipped"
    assert biuro.kursy_otwarte() == []
    orders_service.update_order_status("o1", "done")


def test_zakonczenie_pustego_auta_odmawia(db):
    _baza()
    with pytest.raises(HTTPException) as e:
        biuro.zakoncz_kurs("v1")
    assert e.value.status_code == 409


# ── Wyjazd kartonem z biura ───────────────────────────────────────────────

def test_wyjazd_kartonem_z_biura_z_mrozni(db):
    _baza(); _zamowienie(); _tuleja("o1"); _wyrob()
    _paleta(status="cold_storage")
    kartony = biuro.kartony_do_wyjazdu("o1")
    assert [(k["id"], k["status"]) for k in kartony] == [("p1", "cold_storage")]

    wynik = biuro.wyjazd_z_biura("o1", "v1", ["p1"], "biuro-test")
    assert wynik["orders"][0]["order_no"] == "YALCIN/Z/4/09/26"
    assert query_one("SELECT status, loaded_vehicle_id FROM order_pallets WHERE id='p1'") == \
        {"status": "shipped", "loaded_vehicle_id": "v1"}
    assert biuro.kartony_do_wyjazdu("o1") == []


def test_wyjazd_z_biura_odmowa_zdejmuje_karton_z_auta(db):
    _baza(); _zamowienie(); _tuleja("o1")           # brak wyrobu na stanie
    _paleta(status="cold_storage")
    with pytest.raises(HTTPException):
        biuro.wyjazd_z_biura("o1", "v1", ["p1"], "biuro-test")
    p = query_one("SELECT status, loaded_vehicle_id FROM order_pallets WHERE id='p1'")
    assert p == {"status": "cold_storage", "loaded_vehicle_id": None}
    assert query_all("SELECT 1 FROM vehicle_loading_orders") == []


def test_wyjazd_z_biura_obcy_karton_odmowa(db):
    _baza(); _zamowienie(); _tuleja("o1"); _wyrob()
    _paleta()
    with pytest.raises(HTTPException) as e:
        biuro.wyjazd_z_biura("o1", "v1", ["nie-ma"], "biuro-test")
    assert e.value.status_code == 409


# ── Przeniesienie sztuk ───────────────────────────────────────────────────

def _dwa_zamowienia(cel_qty=3, cel_tuleja=("pk65", "METAL 65CM")):
    """ALI GOLD (o1) ma gotowy karton 931 w mroźni; KEVN (o2) potrzebuje części sztuk."""
    _baza(); _zamowienie(); _tuleja("o1"); _wyrob()
    _paleta(status="cold_storage")
    execute("INSERT INTO cold_storage_weighings (id, container_kind, container_id, carton_no, gross_kg, "
            " net_kg, diff_kg, ok) VALUES ('w1','order','p1',931,330,300,0,true)")
    execute("INSERT INTO clients (id, code, name) VALUES ('c2','KEV','KEVN GMBH')")
    _zamowienie(oid="o2", order_no="KEVN-GMBH/Z/1/11/26", cid="c2", qty=cel_qty)
    _tuleja("o2", *cel_tuleja)


def test_przeniesienie_wycofuje_z_mrozni_i_dorabia(db):
    _dwa_zamowienia()
    w = biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1"}],
                              "dorob", "biuro-test")
    assert w["sourceWithdrawnFromColdStorage"] is True
    src = query_one("SELECT status, cold_storage_at FROM order_pallets WHERE id='p1'")
    assert src == {"status": "created", "cold_storage_at": None}
    assert query_one("SELECT qty FROM order_pallet_items WHERE pallet_id='p1'")["qty"] == 7
    assert query_one("SELECT invalid_at FROM cold_storage_weighings WHERE id='w1'")["invalid_at"]
    assert query_one("SELECT qty FROM client_order_lines WHERE id='o1-l1'")["qty"] == 10   # dorobić
    nowa = query_one("SELECT p.id, p.status, i.qty, i.order_line_id FROM order_pallets p "
                     "JOIN order_pallet_items i ON i.pallet_id=p.id WHERE p.order_id='o2'")
    assert (nowa["status"], nowa["qty"], nowa["order_line_id"]) == ("created", 3, "o2-l1")
    stemple = {r["client_order_no"]: int(r["qty"]) for r in query_all(
        "SELECT client_order_no, qty FROM finished_goods")}
    assert stemple == {"YALCIN/Z/4/09/26": 7, "KEVN-GMBH/Z/1/11/26": 3}


def test_przeniesienie_zmniejsza_zamowienie_zrodlowe(db):
    _dwa_zamowienia()
    biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1"}],
                          "zmniejsz", "biuro-test")
    assert query_one("SELECT qty, total_kg FROM client_order_lines WHERE id='o1-l1'") == \
        {"qty": 7, "total_kg": 210}
    assert int(query_one("SELECT total_units FROM client_orders WHERE id='o1'")["total_units"]) == 7


def test_przeniesienie_inna_tuleja_wymaga_decyzji(db):
    _dwa_zamowienia(cel_tuleja=("pk60", "METAL 60CM"))
    with pytest.raises(HTTPException) as e:
        biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1"}],
                              "dorob", "biuro-test")
    assert "tuleja" in str(e.value.detail).lower()
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "cold_storage"

    biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1",
                                        "change_packaging": True}], "dorob", "biuro-test")
    assert query_one("SELECT packaging_name FROM client_order_lines WHERE id='o2-l1'")["packaging_name"] == "METAL 65CM"


def test_przeniesienie_jako_nowa_pozycja(db):
    _dwa_zamowienia(cel_qty=0)
    execute("DELETE FROM client_order_lines WHERE order_id='o2'")
    biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 4, "target_line_id": ""}],
                          "dorob", "biuro-test")
    linia = query_one("SELECT qty, packaging_name, recipe_id FROM client_order_lines WHERE order_id='o2'")
    assert linia == {"qty": 4, "packaging_name": "METAL 65CM", "recipe_id": "r1"}


def test_przeniesienie_ponad_wolna_ilosc_odmawia_bez_zmian(db):
    _dwa_zamowienia(cel_qty=2)
    with pytest.raises(HTTPException) as e:
        biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1"}],
                              "dorob", "biuro-test")
    assert e.value.status_code == 409
    assert query_one("SELECT qty FROM order_pallet_items WHERE pallet_id='p1'")["qty"] == 10
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "cold_storage"


def test_przeniesienie_z_auta_odmawia(db):
    _dwa_zamowienia()
    execute("UPDATE order_pallets SET status='loaded', loaded_vehicle_id='v1' WHERE id='p1'")
    with pytest.raises(HTTPException) as e:
        biuro.przenies_sztuki("p1", "o2", [{"line_id": "o1-l1", "qty": 3, "target_line_id": "o2-l1"}],
                              "dorob", "biuro-test")
    assert e.value.status_code == 409


def test_cele_przeniesienia_pokazuja_wolna_ilosc(db):
    _dwa_zamowienia()
    c = biuro.cele_przeniesienia("p1")
    assert c["items"][0]["qty"] == 10
    kevn = next(o for o in c["orders"] if o["orderId"] == "o2")
    assert kevn["lines"][0]["free"] == 3


# ── Usunięcie kartonu magazynowego ────────────────────────────────────────

def _karton_magazynowy(cid="sc1", sztuk=2, **kol):
    execute("INSERT INTO stock_cartons (id, carton_no, client_id, client_name, kg_per_unit, target_qty, "
            " packed_qty, status) VALUES (%s,835,'c1','FUDI',10,80,%s,'open')", (cid, sztuk))
    execute("INSERT INTO stock_carton_lines (id, carton_id, recipe_id, product_type_id, kg_per_unit, "
            " target_qty, packed_qty) VALUES (%s,%s,'r1','pt1',10,80,%s)", (f"{cid}-l", cid, sztuk))
    for i in range(sztuk):
        execute("INSERT INTO finished_units (id, qr_code, recipe_id, weight_kg, status, carton_id) "
                "VALUES (%s,%s,'r1',10,'packed',%s)", (f"u{i}", f"UNIT|{i}", cid))
    for k, v in kol.items():
        execute(f"UPDATE stock_cartons SET {k}=%s WHERE id=%s", (v, cid))


def test_usuniecie_kartonu_ze_sztukami_oddaje_je_na_stan(db):
    _baza(); _karton_magazynowy()
    w = biuro.usun_karton_magazynowy("sc1", "biuro-test")
    assert w == {"ok": True, "cartonNo": "000835", "unitsReleased": 2}
    assert query_all("SELECT 1 FROM stock_cartons") == []
    assert {(u["status"], u["carton_id"]) for u in query_all("SELECT status, carton_id FROM finished_units")} == \
        {("produced", None)}


def test_usuniecie_kartonu_na_aucie_odmawia(db):
    _baza(); _karton_magazynowy(loaded_vehicle_id="v1")
    with pytest.raises(HTTPException) as e:
        biuro.usun_karton_magazynowy("sc1")
    assert e.value.status_code == 409
