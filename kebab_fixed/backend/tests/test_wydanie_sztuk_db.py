"""Wydanie pojedynczych sztuk z kiosku magazynu (właściciel 30.09.2026).

Skan sztuki = sztuka wychodzi ze swojego kartonu (także z mroźni i z palety
innego klienta), karton robi się niepełny, jego ważenie traci ważność. Kiosk
niczego nie wystawia — przekazuje do biura, biuro wystawia WZ (rozchód stanu).
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import wydanie_sztuk_service as ws
from app.services.dispatches_service import close_dispatch
from app.services.magazyn_pakowanie_service import kartony_w_mrozni, skanuj_sztuke
from app.services.mroznia_wazenie_service import ostatnie_wazenie, wazenia_w_mrozni, zwaz_i_wstaw
from app.utils.unit_codes import unit_qr
from tests.test_magazyn_pakowanie_db import _karton, _paleta, _receptury, _sztuka


@pytest.fixture(autouse=True)
def _palety(db):
    execute("DELETE FROM app_settings WHERE key='magazyn_pallet_tares'")
    yield


def _klient(cid="kebap", nazwa="KEBAP HAUS"):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (id) DO NOTHING", (cid, nazwa, nazwa, nazwa))
    return cid


def _karton_w_mrozni(n=3):
    _receptury()
    k = _karton("YALCIN", qty=n)
    for i in range(n):
        _sztuka(f"u{i}")
        skanuj_sztuke(unit_qr(f"u{i}"), k["id"])
    zwaz_i_wstaw(f"SCARTON|{k['id']}", "euro", 80.0, "auto", "Jan")
    return k


def test_skan_zdejmuje_sztuke_z_kartonu_w_mrozni_i_uniewaznia_wazenie(db):
    k = _karton_w_mrozni()
    assert ostatnie_wazenie(k["id"]) is not None
    d = ws.zaloz(_klient(), "klient", None, "Ola")
    w = ws.skanuj(d["id"], unit_qr("u0"), "Ola")
    assert w["result"] == "OK" and w["qty"] == 1 and w["from"]["kind"] == "stock"
    assert w["from"]["cartonNo"]
    u = query_one("SELECT * FROM finished_units WHERE id='u0'")
    assert u["carton_id"] is None and u["dispatch_id"] == d["id"] and u["status"] == "produced"
    c = query_one("SELECT * FROM stock_cartons WHERE id=%s", (k["id"],))
    assert c["packed_qty"] == 2 and c["status"] == "open" and c["cold_storage_at"]
    # Karton w mroźni: niepełny i „do zważenia".
    assert ostatnie_wazenie(k["id"]) is None and k["id"] not in wazenia_w_mrozni()
    assert next(x for x in kartony_w_mrozni() if x["id"] == k["id"])["full"] is False
    # Drugi skan tej samej sztuki — ALREADY, bez podwajania.
    assert ws.skanuj(d["id"], unit_qr("u0"))["result"] == "ALREADY"
    assert ws.szczegoly(d["id"])["qty"] == 1


def test_z_palety_innego_klienta_wolno(db):
    _receptury()
    pid = _paleta("o1", "ZAGROS", qty=2)
    for i in range(2):
        _sztuka(f"p{i}", client="ZAGROS")
        skanuj_sztuke(unit_qr(f"p{i}"), pid)
    execute("UPDATE order_pallets SET status='cold_storage' WHERE id=%s", (pid,))
    d = ws.zaloz(_klient(), "nasze", None, "")
    w = ws.skanuj(d["id"], unit_qr("p0"))
    assert w["result"] == "OK" and w["from"]["kind"] == "order" and w["from"]["orderNo"] == "ZAGROS/Z/1"
    u = query_one("SELECT * FROM finished_units WHERE id='p0'")
    assert u["pallet_id"] is None and u["order_id"] is None
    # Paleta zostaje w mroźni, ale ma już o sztukę mniej.
    assert query_one("SELECT status FROM order_pallets WHERE id=%s", (pid,))["status"] == "cold_storage"
    assert query_one("SELECT COUNT(*) AS n FROM finished_units WHERE pallet_id=%s", (pid,))["n"] == 1


def test_cofnij_odklada_do_kartonu(db):
    k = _karton_w_mrozni()
    d = ws.zaloz(_klient(), "klient", None, "")
    ws.skanuj(d["id"], unit_qr("u1"))
    r = ws.cofnij(d["id"], "u1")
    assert r["backToCarton"] is True and r["qty"] == 0
    u = query_one("SELECT * FROM finished_units WHERE id='u1'")
    assert u["carton_id"] == k["id"] and u["status"] == "packed" and u["dispatch_id"] is None
    c = query_one("SELECT * FROM stock_cartons WHERE id=%s", (k["id"],))
    assert c["packed_qty"] == 3 and c["status"] == "packed"


def test_pakowanie_nie_bierze_sztuki_z_wydania(db):
    _receptury()
    _sztuka("x1")
    d = ws.zaloz(_klient(), "klient", None, "")
    assert ws.skanuj(d["id"], unit_qr("x1"))["from"]["kind"] == "loose"
    _karton("YALCIN", qty=1)
    assert skanuj_sztuke(unit_qr("x1"))["result"] == "ON_DISPATCH"


def test_przekazanie_blokuje_zmiany_a_biuro_wystawia_wz(db):
    _receptury()
    execute("INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_name, "
            " qty, qty_available, qty_shipped, kg_per_unit, total_kg) "
            "VALUES ('fg1','200926 1','r1','KIRMIZI',%s,5,5,0,15,75)", ("UDO 100%",))
    _sztuka("w1")
    execute("UPDATE finished_units SET source_finished_goods_id='fg1' WHERE id='w1'")
    d = ws.zaloz(_klient(), "klient", None, "")
    with pytest.raises(HTTPException):
        ws.przekaz_do_biura(d["id"])                         # puste
    ws.skanuj(d["id"], unit_qr("w1"))
    r = ws.przekaz_do_biura(d["id"], "Ola")
    assert r["status"] == "ready" and r["handedAt"]
    # conftest nie czyści `dispatches` — sprawdzamy TO wydanie, nie całą listę.
    assert d["id"] in [x["id"] for x in ws.do_wystawienia()]
    assert d["id"] not in [x["id"] for x in ws.otwarte()]
    with pytest.raises(HTTPException):
        ws.skanuj(d["id"], unit_qr("w1"))                     # przekazane — bez zmian
    with pytest.raises(HTTPException):
        ws.cofnij(d["id"], "w1")                              # przekazane — bez zmian
    wz = close_dispatch(d["id"])
    assert wz["status"] == "shipped" and wz["wzNumber"]
    assert query_one("SELECT status FROM finished_units WHERE id='w1'")["status"] == "shipped"
    assert query_one("SELECT qty_available FROM finished_goods WHERE id='fg1'")["qty_available"] == 4
    assert d["id"] not in [x["id"] for x in ws.do_wystawienia()]


def test_zly_wybor(db):
    with pytest.raises(HTTPException):
        ws.zaloz("brak", "klient", None, "")
    with pytest.raises(HTTPException):
        ws.zaloz(_klient(), "kurier", None, "")


def test_cmr_dla_wydania_sztuk(db):
    from app.services.cmr_service import generate_cmr_for_dispatch
    _receptury()
    for i in range(3):
        _sztuka(f"c{i}", kg=50.0)
    d = ws.zaloz(_klient(), "nasze", None, "")
    for i in range(3):
        ws.skanuj(d["id"], unit_qr(f"c{i}"))
    r = generate_cmr_for_dispatch(d["id"], {"instructions": "TRANSPORT MROŻNICZY -22"})
    kebab = r["payload"]["goods"][0]
    assert kebab["qty"] == 3 and kebab["kg"] == 150.0
    assert r["payload"]["consignee"]["name"] == "KEBAP HAUS"
    # Drugi raz — ten sam numer, bez nabijania kolejnego.
    assert generate_cmr_for_dispatch(d["id"], {})["number"] == r["number"]
