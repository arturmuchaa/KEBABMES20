"""Pozycje usługowe w zamówieniu (VATAN, 13.11.2026).

Jedno zamówienie: kebab z kurczaka robimy NA USŁUGĘ (towar usługobiorcy —
fakturuje go sam), YAPRAK produkujemy pod siebie i sprzedajemy. Oba jadą
w JEDNYM kartonie. Papiery:

* WM wewnętrzny — całość (zdejmuje stan obu wyrobów),
* WZ / faktura dla klienta — tylko sprzedaż (yaprak),
* HDI „towar własny" (scope calosc) — tylko yaprak,
* HDI „usługa" (scope usluga) — tylko kurczak, własny numer z licznika,
* jeden wspólny CMR na całe auto.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate, OrderLineCreate
from app.services import hdi_service, loading_service as loading
from app.services import orders_service
from app.services.order_split_service import podglad_podzialu
from tests.test_finalize_loading_db import _firma, _pojazd, _klient, _receptura, _paleta
from tests.partial_loading_helpers import finalize_loading


def _seed(kurczak_usluga=True, yaprak=True):
    _firma(); _pojazd(); _klient(); _receptura("r1", "KURCZAK")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r2','YAPRAK','pt1') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
            " created_at, status) VALUES ('o1','VATAN/Z/1/11/26','c1','VATAN','2026-11-13',"
            " '2026-11-13 08:00:00+00','confirmed')")
    execute("INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, product_type_id, "
            " qty, kg_per_unit, total_kg, position, usluga) "
            "VALUES ('o1-l1','o1','r1','KURCZAK','pt1',10,30,300,1,%s)", (kurczak_usluga,))
    if yaprak:
        execute("INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, product_type_id, "
                " qty, kg_per_unit, total_kg, position) "
                "VALUES ('o1-l2','o1','r2','YAPRAK','pt1',5,20,100,2)")
    for gid, rid, name, qty, kg in (("f1", "r1", "KURCZAK", 10, 30), ("f2", "r2", "YAPRAK", 5, 20)):
        if gid == "f2" and not yaprak:
            continue
        execute("INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
                " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
                " client_id, client_name, produced_date) "
                "VALUES (%s,%s,%s,%s,'pt1','KEBAB UDO 100%%',%s,%s,%s,%s,0,'c1','VATAN','2026-11-12')",
                (gid, f"121126 {gid}", rid, name, qty, kg, qty * kg, qty))
    # JEDEN karton z obiema pozycjami — sedno zgłoszenia.
    _paleta()
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i1','p1','o1-l1',10)")
    if yaprak:
        execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p1','o1-l2',5)")


def _kurs():
    return finalize_loading("v1", ["o1"], request_id="vatan-usluga")["loading_id"]


def _wystaw(kurs, cel_kg=0.0, hdi_fv=False):
    return loading.wystaw_z_kursu(
        kurs, [{"order_id": "o1", "cel_kg": cel_kg, "hdi_fv": hdi_fv}], {})["orders"][0]


def _linie_wz(wz_id):
    import json
    doc = query_one("SELECT lines FROM wz_documents WHERE id=%s", (wz_id,))
    lines = doc["lines"]
    return json.loads(lines) if isinstance(lines, str) else lines


def test_vatan_calosc_na_wz_daje_dwa_hdi_i_wz_tylko_na_sprzedaz(db):
    _seed()
    docs = _wystaw(_kurs(), cel_kg=0)
    # WM na całość — kurczak też fizycznie wyjechał.
    assert docs["wm"]["kg"] == 400
    # WZ klienta — wyłącznie yaprak.
    assert docs["wz"]["kg"] == 100
    assert all("KURCZAK" not in (l.get("name") or "").upper() for l in _linie_wz(docs["wz"]["id"]))
    # HDI własne — yaprak; HDI usługa — kurczak; dwa różne numery z licznika.
    assert docs["hdi_calosc"]["totals"] == {"qty": 5, "kg": 100}
    assert docs["hdi_usluga"]["totals"] == {"qty": 10, "kg": 300}
    assert docs["hdi_usluga"]["number"] != docs["hdi_calosc"]["number"]
    assert not docs["hdi_usluga"]["number"].endswith("/1")
    assert query_one("SELECT scope FROM hdi_documents WHERE id=%s",
                     (docs["hdi_usluga"]["id"],))["scope"] == "usluga"
    # Jeden wspólny CMR na całe auto.
    assert len(docs["cmr"]) == 1
    # Stan obu wyrobów zszedł w całości, dokładnie raz.
    stan = {r["id"]: r["qty_available"] for r in query_all(
        "SELECT id, qty_available FROM finished_goods ORDER BY id")}
    assert stan == {"f1": 0, "f2": 0}
    # Dane do faktury: usługa nie idzie ani na fakturę, ani na WZ klienta.
    assert docs["invoice_data"]["invoice_kg"] == 0
    assert docs["invoice_data"]["wz_kg"] == 100


def test_vatan_yaprak_na_fakture_nie_wciaga_uslugi(db):
    _seed()
    # Biuro wpisuje „całość na fakturę" = wszystko, co wyjechało (400 kg).
    # Na fakturę może pójść tylko sprzedaż — 100 kg yapraku.
    docs = _wystaw(_kurs(), cel_kg=400, hdi_fv=True)
    assert docs["wz"] is None
    assert docs["hdi_fv"]["totals"] == {"qty": 5, "kg": 100}
    assert docs["hdi_calosc"]["totals"] == {"qty": 5, "kg": 100}
    assert docs["hdi_usluga"]["totals"] == {"qty": 10, "kg": 300}
    assert docs["invoice_data"]["invoice_kg"] == 100
    assert docs["invoice_data"]["wz_kg"] == 0
    assert [l["order_line_id"] for l in docs["invoice_data"]["lines"]] == ["o1-l2"]
    # Dwa CMR: na drogę (całe auto) i do faktury (tylko yaprak).
    assert len(docs["cmr"]) == 2


def test_zamowienie_tylko_uslugowe_ma_wm_hdi_usluga_i_cmr(db):
    _seed(yaprak=False)
    docs = _wystaw(_kurs(), cel_kg=0)
    assert docs["wm"]["kg"] == 300
    assert docs["wz"] is None
    assert docs["hdi_calosc"] is None
    assert docs["hdi_usluga"]["totals"] == {"qty": 10, "kg": 300}
    assert len(docs["cmr"]) == 1
    assert query_one("SELECT qty_available FROM finished_goods WHERE id='f1'")["qty_available"] == 0


def test_zamowienie_bez_uslugi_nie_ma_hdi_usluga(db):
    _seed(kurczak_usluga=False)
    docs = _wystaw(_kurs(), cel_kg=0)
    assert docs["hdi_usluga"] is None
    assert docs["hdi_calosc"]["totals"] == {"qty": 15, "kg": 400}
    assert docs["wz"]["kg"] == 400


def test_podzial_pomija_pozycje_uslugowe(db):
    _seed()
    p = podglad_podzialu("o1", 400)
    po_id = {l["id"]: l for l in p["lines"]}
    assert po_id["o1-l1"]["qty_invoice"] == 0 and po_id["o1-l1"]["qty_wz"] == 0
    assert po_id["o1-l1"]["usluga"] is True
    assert po_id["o1-l2"]["qty_invoice"] == 5
    assert p["kg_calosc"] == 100


def test_hdi_wstepne_usluga_przed_zaladunkiem(db):
    _seed()
    execute("DELETE FROM order_pallet_items"); execute("DELETE FROM order_pallets")
    wlasne = hdi_service.build_hdi("o1")
    usluga = hdi_service.build_hdi("o1", scope="usluga")
    assert wlasne["totals"] == {"qty": 5, "kg": 100}
    assert usluga["totals"] == {"qty": 10, "kg": 300}
    assert usluga["incomplete"] is False


def test_hdi_usluga_odmawia_gdy_brak_pozycji_uslugowych(db):
    _seed(kurczak_usluga=False)
    with pytest.raises(HTTPException) as e:
        hdi_service.build_hdi("o1", scope="usluga")
    assert e.value.status_code == 400


def _dto(usluga):
    return ClientOrderCreate(client_id="c1", order_date="2026-11-13", lines=[
        OrderLineCreate(qty=10, kg_per_unit=30, recipe_id="r1", product_type_id="pt1", usluga=usluga),
        OrderLineCreate(qty=5, kg_per_unit=20, recipe_id="r2", product_type_id="pt1"),
    ])


def test_zamowienie_zapisuje_i_zachowuje_flage_uslugi(db):
    _firma(); _klient(); _receptura("r1", "KURCZAK")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r2','YAPRAK','pt1') "
            "ON CONFLICT (id) DO NOTHING")
    order = orders_service.create_order(_dto(True))
    linie = query_all("SELECT id, recipe_id, usluga FROM client_order_lines "
                      "WHERE order_id=%s ORDER BY position", (order["id"],))
    assert [(l["recipe_id"], l["usluga"]) for l in linie] == [("r1", True), ("r2", False)]
    # Starszy klient (bez pola `usluga`) przy edycji NIE kasuje flagi.
    dto = ClientOrderCreate(client_id="c1", order_date="2026-11-13", lines=[
        OrderLineCreate(id=linie[0]["id"], qty=12, kg_per_unit=30, recipe_id="r1", product_type_id="pt1"),
        OrderLineCreate(id=linie[1]["id"], qty=5, kg_per_unit=20, recipe_id="r2", product_type_id="pt1"),
    ])
    orders_service.update_order(order["id"], dto)
    assert query_one("SELECT usluga FROM client_order_lines WHERE id=%s",
                     (linie[0]["id"],))["usluga"] is True
    # Jawne wyłączenie działa.
    dto.lines[0].usluga = False
    orders_service.update_order(order["id"], dto)
    assert query_one("SELECT usluga FROM client_order_lines WHERE id=%s",
                     (linie[0]["id"],))["usluga"] is False


def test_kurs_podaje_kg_uslugi(db):
    _seed()
    kurs = _kurs()
    poz = loading.zaladunek(kurs)["pozycje"][0]
    assert poz["kg_zaladowane"] == 400
    assert poz["kg_usluga"] == 300


def test_zwykla_wz_z_zamowienia_z_usluga_jest_odrzucona(db):
    from app.services import wz_service
    _seed()
    with pytest.raises(HTTPException) as e:
        wz_service.create_wz_from_order("o1")
    assert "usługow" in str(e.value.detail)
    with pytest.raises(HTTPException):
        wz_service.picks_from_order("o1")


def test_zaladunek_wystawia_oba_hdi_z_numerem_auta(db):
    import json
    _seed()
    kurs = _kurs()
    hdi = {r["scope"]: r for r in query_all(
        "SELECT scope, number, header, totals FROM hdi_documents WHERE order_id='o1' AND loading_id=%s", (kurs,))}
    assert set(hdi) == {"calosc", "usluga"}
    for r in hdi.values():
        header = r["header"] if isinstance(r["header"], dict) else json.loads(r["header"])
        assert header.get("reg_number") == "KR 12345"
    # Komplet z kursu oddaje TE SAME dokumenty, bez nowych numerów.
    docs = _wystaw(kurs, cel_kg=0)
    assert docs["hdi_calosc"]["number"] == hdi["calosc"]["number"]
    assert docs["hdi_usluga"]["number"] == hdi["usluga"]["number"]


def test_zaladunek_samej_uslugi_nie_wystawia_hdi_wlasnego(db):
    _seed(yaprak=False)
    kurs = _kurs()
    scopes = [r["scope"] for r in query_all(
        "SELECT scope FROM hdi_documents WHERE order_id='o1' AND loading_id=%s", (kurs,))]
    assert scopes == ["usluga"]


def test_klient_zapisuje_produkcje_na_usluge(db):
    from app.models.clients import ClientCreate
    from app.services import clients_service
    c = clients_service.create_client(ClientCreate(name="VATAN Sp. z o.o.", uslugi=True))
    assert query_one("SELECT uslugi FROM clients WHERE id=%s", (c["id"],))["uslugi"] is True
    clients_service.update_client(c["id"], ClientCreate(name="VATAN Sp. z o.o."))
    assert query_one("SELECT uslugi FROM clients WHERE id=%s", (c["id"],))["uslugi"] is False
