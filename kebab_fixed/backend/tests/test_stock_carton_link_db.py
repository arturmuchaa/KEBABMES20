"""Spakowany karton magazynowy BEZ zamówienia → późniejsze zamówienie → auto → kurs.

Realna produkcja (wyrób gotowy + sztuki) i karton powstają PRZED zamówieniem;
biuro jawnie przypisuje CAŁY karton, auto skanuje STARĄ etykietę. Zero nowej
produkcji, kopiowania sztuk, wymiany QR, zmiany partii i ruchów magazynu przy
przypisaniu i skanie.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate, OrderLineCreate, PalletDto, PalletItemDto
from app.models.production import StockCartonCreate, StockCartonLineDto
from app.services import loading_service, orders_service, pallets_service
from app.services import stock_carton_link_service as link
from app.services import vehicle_loading_service as vehicles
from app.services.dispatches_service import create_dispatch
from app.services.stock_carton_match_service import suggestions_for_order
from app.services.stock_cartons_service import create_stock_carton, scan_unit_into_carton
from app.utils.unit_codes import unit_qr
from tests.test_finalize_loading_db import _firma, _klient, _pojazd, _receptura, _zamowienie

BATCH = "080926 500"


def _fg_niczyj(gid="f1", qty=2, kg=30):
    """Wyrób gotowy „na magazyn" — bez klienta i bez zamówienia."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, produced_date) "
        "VALUES (%s,%s,'r1','KIRMIZI','pt1','KEBAB UDO 100%%',%s,%s,%s,%s,0,NULL,'','2026-09-08')",
        (gid, BATCH, qty, kg, qty * kg, qty))


def _sztuka(uid, kg=30, tuleja="METAL", fg="f1"):
    execute(
        "INSERT INTO finished_units (id, qr_code, client_name, recipe_id, product_type_id, tuleja, "
        " weight_kg, status, source_finished_goods_id, batch_no) "
        "VALUES (%s,%s,'','r1','pt1',%s,%s,'produced',%s,%s)",
        (uid, unit_qr(uid), tuleja, kg, fg, BATCH))


def _karton(prefix, lines=((30, 2),), client_id="", pack=None, tuleja="METAL"):
    """Karton magazynowy spakowany do pełna sztukami z realnej produkcji.
    `lines` = [(kg, ile)], `pack` = ile sztuk naprawdę spakować (None = wszystkie)."""
    c = create_stock_carton(StockCartonCreate(
        client_id=client_id,
        lines=[StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name=tuleja,
                                  kg_per_unit=kg, qty=n) for kg, n in lines]))
    total = sum(n for _, n in lines) if pack is None else pack
    i = 0
    for kg, n in lines:
        for _ in range(n):
            if i >= total:
                break
            uid = f"{prefix}{i}"
            _sztuka(uid, kg=kg, tuleja=tuleja)
            scan_unit_into_carton(c["id"], unit_qr(uid))
            i += 1
    return c


def _baza():
    _firma(); _pojazd(); _klient(); _receptura()


def _fg_i_ruchy():
    fg = query_one("SELECT qty, qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    ruchy = query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"]
    return fg, ruchy


def _sztuki(cid):
    return query_all("SELECT id, qr_code, batch_no, source_finished_goods_id, order_id, status "
                     "FROM finished_units WHERE carton_id=%s ORDER BY id", (cid,))


# ── Pełna ścieżka ─────────────────────────────────────────────────────────

def test_karton_przed_zamowieniem_przypisany_ladowany_stara_etykieta_capslock(db):
    _baza()
    _fg_niczyj(qty=2)
    c = _karton("g", lines=((30, 2),))           # karton niczyj, PRZED zamówieniem
    przed = _sztuki(c["id"])
    stan0 = _fg_i_ruchy()
    _zamowienie(qty=2, kg=30)                     # zamówienie przychodzi później

    opcje = link.options_for_order("o1")
    assert [a["cartonId"] for a in opcje["available"]] == [c["id"]]
    assert opcje["available"][0]["generic"] is True
    assert opcje["assigned"] == []
    assert [s["cartonId"] for s in suggestions_for_order("o1")] == [c["id"]]

    res = link.assign(c["id"], "o1", "biuro-1")
    assert res["ok"] and not res["already"] and res["units"] == 2
    po = _sztuki(c["id"])
    assert [u["order_id"] for u in po] == ["o1", "o1"]
    # tylko order_id: QR, partia i źródłowy wyrób gotowy bez zmian
    assert [(u["id"], u["qr_code"], u["batch_no"], u["source_finished_goods_id"]) for u in po] == \
           [(u["id"], u["qr_code"], u["batch_no"], u["source_finished_goods_id"]) for u in przed]
    assert _fg_i_ruchy() == stan0
    ev = query_one("SELECT action, operator FROM warehouse_events WHERE container_id=%s", (c["id"],))
    assert ev == {"action": "order_link:o1", "operator": "biuro-1"}

    opcje = link.options_for_order("o1")
    assert opcje["available"] == []
    assert [a["cartonId"] for a in opcje["assigned"]] == [c["id"]]
    assert opcje["assignedTotals"] == {"cartons": 1, "units": 2}
    assert opcje["assigned"][0]["canDetach"] is True

    vehicles.add_order("v1", "o1")
    kod = f"SCARTON|{c['id'].upper()}"            # CapsLock na skanerze
    assert pallets_service.scan(kod, "loaded", vehicle_id="v1")["result"] == "SUCCESS"
    assert pallets_service.scan(f"]Q1SCARTON|{c['id']}\r", "loaded", vehicle_id="v1")["result"] == "ALREADY_SCANNED"
    assert _fg_i_ruchy() == stan0

    wynik = loading_service.finalize_loading("v1", ["o1"], expected_ids=[c["id"]])
    zam = wynik["orders"][0]
    assert zam["units"] == 2
    assert zam["pozycje"] == [{"stock_id": "f1", "batch_no": BATCH, "szt": 2, "kg_per_unit": 30.0}]
    assert query_one("SELECT COUNT(*) AS n FROM finished_units WHERE status='shipped'")["n"] == 2
    assert query_one("SELECT shipped_at FROM stock_cartons WHERE id=%s", (c["id"],))["shipped_at"]
    # kurs nie dubluje sztuk ani nie zdejmuje stanu (papiery wystawia biuro)
    assert _fg_i_ruchy() == stan0
    # wydany karton dalej liczony jako rezerwacja — nie da się go „sprzedać" drugi raz
    assert link.reservations(None, "o1")[1] == {("r1", "pt1", "", 30.0): 2}


def test_retry_idempotentny_bez_drugiego_zdarzenia_drugie_zamowienie_odmowa(db):
    _baza(); _fg_niczyj()
    c = _karton("i")
    _zamowienie(qty=5)
    _zamowienie(oid="o2", order_no="YALCIN/Z/5/09/26", qty=5)
    link.assign(c["id"], "o1")
    assert link.assign(c["id"], "o1")["already"] is True
    assert query_one("SELECT COUNT(*) AS n FROM warehouse_events WHERE container_id=%s", (c["id"],))["n"] == 1
    with pytest.raises(HTTPException) as e:
        link.assign(c["id"], "o2")
    assert e.value.status_code == 409 and "już przypisany" in e.value.detail
    assert query_one("SELECT linked_order_id FROM stock_cartons WHERE id=%s", (c["id"],))["linked_order_id"] == "o1"


# ── Odmowy ────────────────────────────────────────────────────────────────

def test_ponad_ilosc_zamowienia_odmowa(db):
    _baza(); _fg_niczyj(qty=3)
    c = _karton("q", lines=((30, 3),))
    _zamowienie(qty=2)
    with pytest.raises(HTTPException) as e:
        link.assign(c["id"], "o1")
    assert "Brak wolnej ilości" in e.value.detail
    assert link.options_for_order("o1")["unavailable"][0]["reason"].startswith("Brak wolnej ilości")


def test_karton_mieszany_tylko_w_calosci_duplikaty_sumowane(db):
    _baza(); _fg_niczyj(qty=4)
    mieszany = _karton("m", lines=((30, 1), (15, 1)))
    _zamowienie(qty=5)                            # tylko 30 kg — pozycja 15 kg nie pasuje
    with pytest.raises(HTTPException) as e:
        link.assign(mieszany["id"], "o1")
    assert "Niezgodna waga" in e.value.detail
    # ta sama specyfikacja w dwóch pozycjach zamówienia (1+1) mieści karton 2 szt.
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, status) "
            "VALUES ('o3','YALCIN/Z/6/09/26','c1','YBM','confirmed')")
    for lid in ("o3-a", "o3-b"):
        execute("INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
                " kg_per_unit, total_kg) VALUES (%s,'o3','r1','pt1',1,30,30)", (lid,))
    dwa = _karton("d", lines=((30, 2),))
    assert link.assign(dwa["id"], "o3")["ok"]


def test_niezgodna_tuleja_widoczna_jako_powod(db):
    _baza(); _fg_niczyj()
    c = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_id="pk9",
                           packaging_name="METAL", kg_per_unit=30, qty=1)]))
    _sztuka("t0"); scan_unit_into_carton(c["id"], unit_qr("t0"))
    _zamowienie(qty=5)
    opcje = link.options_for_order("o1")
    assert opcje["available"] == []
    assert "Niezgodna tuleja" in opcje["unavailable"][0]["reason"]
    with pytest.raises(HTTPException):
        link.assign(c["id"], "o1")


def test_karton_czesciowy_i_pusty_odmowa_z_powodem(db):
    _baza(); _fg_niczyj(qty=3)
    czesciowy = _karton("p", lines=((30, 3),), pack=1)
    pusty = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM",
                                                  recipe_id="r1", product_type_id="pt1",
                                                  packaging_name="METAL", kg_per_unit=30, qty=1))
    _zamowienie(qty=10)
    with pytest.raises(HTTPException) as e:
        link.assign(czesciowy["id"], "o1")
    assert "częściowo (1/3" in e.value.detail
    # Pusty karton = tryb bez skanera; sztuki 30 kg z wyrobu f1 siedzą w częściowym
    # kartonie, ale stan f1 (3 szt.) pokrywa 1 szt. — przechodzi. Pustego
    # kartonu 40 kg nikt nie wyprodukował — odmowa z powodem.
    pusty40 = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM",
                                                    recipe_id="r1", product_type_id="pt1",
                                                    packaging_name="METAL", kg_per_unit=40, qty=1))
    execute("INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
            " kg_per_unit, total_kg) VALUES ('o1-l2','o1','r1','pt1',5,40,200)")
    with pytest.raises(HTTPException) as e:
        link.assign(pusty40["id"], "o1")
    assert "Brak wyprodukowanego towaru" in e.value.detail
    powody = {u["cartonId"]: u["reason"] for u in link.options_for_order("o1")["unavailable"]}
    assert "częściowo" in powody[czesciowy["id"]] and "Brak wyprodukowanego" in powody[pusty40["id"]]
    assert pusty["id"] not in powody
    assert query_one("SELECT linked_order_id FROM stock_cartons WHERE id=%s", (czesciowy["id"],))["linked_order_id"] is None


def test_obcy_klient_i_nazwa_bez_karty_nie_sa_wildcardem(db):
    _baza(); _fg_niczyj(qty=4)
    execute("INSERT INTO clients (id, code, name) VALUES ('c2','Z','Zagros') ON CONFLICT (id) DO NOTHING")
    obcy = _karton("o", client_id="c2")
    nazwa = _karton("n")
    execute("UPDATE stock_cartons SET client_name='Zagros' WHERE id=%s", (nazwa["id"],))
    _zamowienie(qty=10)
    for c in (obcy, nazwa):
        with pytest.raises(HTTPException) as e:
            link.assign(c["id"], "o1")
        assert e.value.status_code == 409
    opcje = link.options_for_order("o1")
    assert opcje["available"] == [] and opcje["unavailable"] == []   # cudze nie są pokazywane


def test_auto_wydanie_wyjazd_blokuja_mroznia_nie(db):
    _baza(); _fg_niczyj(qty=8)
    _pojazd("v1")
    _zamowienie(qty=20)
    na_aucie, wydany, na_wyjezdzie, w_mrozni = (_karton(p) for p in ("a", "w", "y", "z"))
    execute("UPDATE stock_cartons SET loaded_vehicle_id='v1' WHERE id=%s", (na_aucie["id"],))
    execute("UPDATE stock_cartons SET shipped_at=now() WHERE id=%s", (wydany["id"],))
    wyjazd = create_dispatch({})
    execute("UPDATE finished_units SET dispatch_id=%s WHERE carton_id=%s", (wyjazd["id"], na_wyjezdzie["id"]))
    execute("UPDATE stock_cartons SET cold_storage_at=now() WHERE id=%s", (w_mrozni["id"],))
    for c, slowo in ((na_aucie, "aucie"), (wydany, "wydany"), (na_wyjezdzie, "wydaniu")):
        with pytest.raises(HTTPException) as e:
            link.assign(c["id"], "o1")
        assert slowo in e.value.detail
    assert link.assign(w_mrozni["id"], "o1")["ok"]


def test_zamowienie_zamkniete_i_z_dokumentem_odmawia_odczyt_dziala(db):
    _baza(); _fg_niczyj(qty=4)
    a, b = _karton("x"), _karton("y")
    _zamowienie(qty=10)
    link.assign(a["id"], "o1")
    execute("INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
            " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, created_at) "
            "VALUES ('w1','WZ/1/09/26',1,'09/26','order','o1','YBM',false,%s::jsonb,'wstepny',"
            " 'PLN',0,0,now())", (json.dumps([]),))
    with pytest.raises(HTTPException) as e:
        link.assign(b["id"], "o1")
    assert "WZ/1/09/26" in e.value.detail
    assert link.assign(a["id"], "o1")["already"] is True      # retry nie jest blokowany
    opcje = link.options_for_order("o1")
    assert opcje["assignBlockedReason"] and [x["cartonId"] for x in opcje["assigned"]] == [a["id"]]
    assert opcje["assigned"][0]["canDetach"] is False
    with pytest.raises(HTTPException):
        link.detach(a["id"], "o1")
    assert suggestions_for_order("o1") == []

    _zamowienie(oid="o9", order_no="YALCIN/Z/9/09/26", qty=10)
    execute("UPDATE client_orders SET status='done' WHERE id='o9'")
    with pytest.raises(HTTPException) as e:
        link.assign(b["id"], "o9")
    assert "zakończone" in e.value.detail


def test_dwa_rownolegle_kartony_na_ostatnia_ilosc(db):
    _baza(); _fg_niczyj(qty=4)
    k1, k2 = _karton("r"), _karton("s")
    _zamowienie(qty=2)
    bariera = Barrier(2)

    def przypisz(cid):
        bariera.wait(timeout=10)
        try:
            return link.assign(cid, "o1")["ok"]
        except HTTPException:
            return False

    with ThreadPoolExecutor(max_workers=2) as ex:
        wyniki = list(ex.map(przypisz, [k1["id"], k2["id"]]))
    assert sorted(wyniki) == [False, True]
    assert query_one("SELECT COUNT(*) AS n FROM stock_cartons WHERE linked_order_id='o1'")["n"] == 1


# ── Palety i edycja zamówienia ────────────────────────────────────────────

def test_save_pallets_respektuje_przypisany_karton_i_odwrotnie(db):
    _baza(); _fg_niczyj(qty=4)
    c = _karton("v")
    _zamowienie(qty=3)
    link.assign(c["id"], "o1")
    with pytest.raises(HTTPException) as e:
        pallets_service.save_pallets("o1", [PalletDto(items=[PalletItemDto(order_line_id="o1-l1", qty=2)])])
    assert "przypisanych kartonów" in e.value.detail
    assert query_all("SELECT id FROM order_pallets WHERE order_id='o1'") == []
    assert len(pallets_service.save_pallets(
        "o1", [PalletDto(items=[PalletItemDto(order_line_id="o1-l1", qty=1)])])) == 1

    # rozpis palet zajmuje miejsce → nowy karton dostaje konkretny powód
    drugi = _karton("u")
    with pytest.raises(HTTPException) as e:
        link.assign(drugi["id"], "o1")
    assert "rozpisana na palety/kartony" in e.value.detail
    assert query_all("SELECT id FROM order_pallets WHERE order_id='o1'") != []   # nic nie kasujemy


def _dto(qty, client_id="c1", notes="", recipe_id="r1"):
    return ClientOrderCreate(client_id=client_id, order_date="2026-09-08", notes=notes, lines=[
        OrderLineCreate(id="o1-l1", qty=qty, kg_per_unit=30, product_type_id="pt1", recipe_id=recipe_id)])


def test_edycja_anulowanie_usuwanie_z_przypisanym_kartonem(db):
    _baza(); _fg_niczyj()
    c = _karton("e")
    _zamowienie(qty=3)
    link.assign(c["id"], "o1")
    with pytest.raises(HTTPException) as e:
        orders_service.update_order("o1", _dto(1))
    assert e.value.status_code == 409
    _receptura("r2", "GOLD")
    with pytest.raises(HTTPException):
        orders_service.update_order("o1", _dto(3, recipe_id="r2"))        # zmiana specyfikacji
    execute("INSERT INTO clients (id, code, name) VALUES ('c2','Z','Zagros') ON CONFLICT (id) DO NOTHING")
    with pytest.raises(HTTPException):
        orders_service.update_order("o1", _dto(3, client_id="c2"))
    assert int(query_one("SELECT qty FROM client_order_lines WHERE id='o1-l1'")["qty"]) == 3
    assert orders_service.update_order("o1", _dto(3, notes="rampa 2"))["notes"] == "rampa 2"
    assert int(orders_service.update_order("o1", _dto(5))["lines"][0]["qty"]) == 5

    for akcja in (lambda: orders_service.update_order_status("o1", "cancelled"),
                  lambda: orders_service.delete_order("o1")):
        with pytest.raises(HTTPException) as e:
            akcja()
        assert "odłącz" in e.value.detail
    assert query_one("SELECT status FROM client_orders WHERE id='o1'")["status"] == "confirmed"
    assert query_one("SELECT linked_order_id FROM stock_cartons WHERE id=%s", (c["id"],))["linked_order_id"] == "o1"

    link.detach(c["id"], "o1")
    assert orders_service.delete_order("o1")["ok"]
    assert query_one("SELECT id FROM stock_cartons WHERE id=%s", (c["id"],))  # karton zostaje


def test_bezpieczne_odlaczenie(db):
    _baza(); _fg_niczyj()
    c = _karton("k")
    _zamowienie(qty=3)
    przed = _sztuki(c["id"])
    prev = query_all("SELECT packing_previous FROM finished_units WHERE carton_id=%s ORDER BY id", (c["id"],))
    link.assign(c["id"], "o1")
    res = link.detach(c["id"], "o1", "biuro-2")
    assert res["ok"] and not res["already"]
    assert link.detach(c["id"], "o1")["already"] is True
    karton = query_one("SELECT * FROM stock_cartons WHERE id=%s", (c["id"],))
    assert karton["linked_order_id"] is None and karton["linked_order_no"] is None
    assert karton["status"] == "packed" and karton["carton_no"] == c["carton_no"]
    assert _sztuki(c["id"]) == przed
    assert query_all("SELECT packing_previous FROM finished_units WHERE carton_id=%s ORDER BY id", (c["id"],)) == prev
    akcje = [r["action"] for r in query_all(
        "SELECT action FROM warehouse_events WHERE container_id=%s ORDER BY created_at, action", (c["id"],))]
    assert sorted(akcje) == ["order_link:o1", "order_unlink:o1"]

    link.assign(c["id"], "o1")
    execute("UPDATE stock_cartons SET loaded_vehicle_id='v1' WHERE id=%s", (c["id"],))
    with pytest.raises(HTTPException) as e:
        link.detach(c["id"], "o1")
    assert "aucie" in e.value.detail
    assert link.options_for_order("o1")["assigned"][0]["canDetach"] is False


def test_nowy_karton_bez_klienta_nie_zapisuje_pseudo_wlasnosci(db):
    c = create_stock_carton(StockCartonCreate(client_name="Zagros", recipe_id="r1",
                                              product_type_id="pt1", kg_per_unit=30, qty=1))
    row = query_one("SELECT client_id, client_name FROM stock_cartons WHERE id=%s", (c["id"],))
    assert row == {"client_id": None, "client_name": ""}
    with pytest.raises(HTTPException):        # ten sam skład niczyj, otwarty → duplikat
        create_stock_carton(StockCartonCreate(recipe_id="r1", product_type_id="pt1", kg_per_unit=30, qty=1))
    jawny = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM", recipe_id="r1",
                                                  product_type_id="pt1", kg_per_unit=30, qty=1))
    assert query_one("SELECT client_id FROM stock_cartons WHERE id=%s", (jawny["id"],))["client_id"] == "c1"


# ── Tryb bez skanera (tymczasowy: hala nie skanuje sztuk) ─────────────────

def test_bez_skanera_karton_z_wyrobu_na_stanie_przypisany_bez_ruchow(db):
    _baza(); _fg_niczyj(qty=3)
    a = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="METAL",
                           kg_per_unit=30, qty=2)]))
    # Drugi taki sam otwarty karton klienta jest blokowany przy tworzeniu — B jest niczyj.
    b = create_stock_carton(StockCartonCreate(client_id="", client_name="", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="METAL",
                           kg_per_unit=30, qty=2)]))
    _zamowienie(qty=10)
    stan0 = _fg_i_ruchy()

    opcje = link.options_for_order("o1")
    dostepne = {c["cartonId"]: c for c in opcje["available"]}
    assert set(dostepne) == {a["id"], b["id"]}
    assert dostepne[a["id"]]["scannerless"] is True and dostepne[a["id"]]["units"] == 2

    res = link.assign(a["id"], "o1", "biuro")
    assert res["ok"] and res["units"] == 0
    assert _fg_i_ruchy() == stan0                  # przypisanie nie rusza stanu
    opcje = link.options_for_order("o1")
    assert opcje["assignedTotals"] == {"cartons": 1, "units": 2}
    assert opcje["assigned"][0]["scannerless"] is True
    # Na stanie 3 szt., karton A zajął 2 — drugi karton 2 szt. już się nie mieści.
    powod = {c["cartonId"]: c["reason"] for c in opcje["unavailable"]}[b["id"]]
    assert "na magazynie 3 szt." in powod and "inne kartony bez skanowania 2 szt." in powod
    with pytest.raises(HTTPException) as e:
        link.assign(b["id"], "o1")
    assert "Brak wyprodukowanego towaru" in e.value.detail

    # Odłączenie zwalnia stan dla drugiego kartonu.
    link.detach(a["id"], "o1", "biuro")
    assert b["id"] in {c["cartonId"] for c in link.options_for_order("o1")["available"]}
    assert _fg_i_ruchy() == stan0
    link.assign(a["id"], "o1", "biuro")

    # Załadunek etykietą kartonu bez sztuk: operator widzi go na aucie,
    # kurs liczy go jak paletę bez sztuk QR — pozycje z kartonu, partia z magazynu.
    vehicles.add_order("v1", "o1")
    wynik = pallets_service.scan(f"SCARTON|{a['id']}", "loaded", vehicle_id="v1")
    assert wynik["result"] == "SUCCESS" and wynik["total_qty"] == 2 and wynik["total_kg"] == 60.0
    assert pallets_service.scan(f"SCARTON|{a['id']}", "loaded", vehicle_id="v1")["result"] == "ALREADY_SCANNED"
    assert _fg_i_ruchy() == stan0
    zam = loading_service.finalize_loading("v1", ["o1"], expected_ids=[a["id"]])["orders"][0]
    assert zam["pozycje"] == [{"stock_id": "f1", "batch_no": BATCH, "szt": 2, "kg_per_unit": 30.0}]
    assert query_one("SELECT shipped_at FROM stock_cartons WHERE id=%s", (a["id"],))["shipped_at"]
    assert _fg_i_ruchy() == stan0                  # stan zdejmie dopiero WZ biura
    # Wydany kursem, ale bez WZ — towar dalej zajęty, drugi karton nie przejdzie.
    assert b["id"] in {c["cartonId"] for c in link.options_for_order("o1")["unavailable"]}


def test_bez_skanera_obcy_wyrob_i_wyrob_innego_zamowienia_nie_licza_sie(db):
    _baza()
    execute("INSERT INTO clients (id, code, name, display_name) VALUES ('c2','ZAG','Zagros GmbH','ZAGROS')")
    execute("INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
            " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
            " client_id, client_name, client_order_no, produced_date) VALUES "
            "('f2','x','r1','KIRMIZI','pt1','UDO',5,30,150,5,0,'c2','Zagros GmbH',NULL,'2026-09-08'),"
            "('f3','y','r1','KIRMIZI','pt1','UDO',5,30,150,5,0,NULL,'','INNE/1','2026-09-08')")
    _zamowienie("o9", order_no="INNE/1", qty=5)
    k = create_stock_carton(StockCartonCreate(client_id="c1", client_name="YBM", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="METAL",
                           kg_per_unit=30, qty=1)]))
    _zamowienie(qty=10)
    powod = {c["cartonId"]: c["reason"] for c in link.options_for_order("o1")["unavailable"]}[k["id"]]
    assert "na magazynie 0 szt." in powod
    # Wyrób ostemplowany TYM zamówieniem się liczy.
    execute("UPDATE finished_goods SET client_order_no='YALCIN/Z/4/09/26' WHERE id='f3'")
    assert k["id"] in {c["cartonId"] for c in link.options_for_order("o1")["available"]}
