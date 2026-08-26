"""Ręczne dodanie wyrobu gotowego z biura.

Hala nie ma jeszcze komputerów na produkcji i masowni, więc do czasu pełnego
HMI wyrób wprowadza biuro. Ten wpis musi robić DOKŁADNIE to, co zrobiłby
kiosk: postawić sztuki na magazynie, zdjąć tuleje, zdjąć mięso przyprawione
i policzyć się do pokrycia zamówienia — inaczej stany rozjeżdżają się po
tygodniu i nikt nie wie, gdzie zniknęło mięso.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest

from app.db import execute, query_all, query_one
from app.models.production import FinishedGoodCreate
from app.services.finished_goods_service import create_finished_good
from app.services.orders_service import get_order


def _tuleja(pid="t1", stan=100):
    execute(
        "INSERT INTO packaging (id, code, name, type, unit, kg_initial, kg_available, kg_used) "
        "VALUES (%s,'METAL 65','METAL 65','tuleja','szt',%s,%s,0)",
        (pid, stan, stan),
    )


def _przyprawione(bno="344", kg=1000):
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, kg_produced, kg_available, "
        " kg_reserved, kg_used, status) VALUES (%s,%s,'r1',%s,%s,0,0,'available')",
        (f"sm-{bno}", bno, kg, kg),
    )


def _wpis(**kw):
    dane = dict(
        product_type_id="pt1", product_type_name="KEBAB",
        recipe_id="r1", recipe_name="WROCŁAW",
        qty=10, kg_per_unit=35, produced_date="2026-08-25",
    )
    dane.update(kw)
    return FinishedGoodCreate(**dane)


def _stan_tulei(pid="t1"):
    r = query_one("SELECT kg_available, kg_used FROM packaging WHERE id=%s", (pid,))
    return int(float(r["kg_available"])), int(float(r["kg_used"]))


def _stan_przyprawionego(bno="344"):
    r = query_one("SELECT kg_available, kg_used FROM seasoned_meat WHERE batch_no=%s", (bno,))
    return float(r["kg_available"]), float(r["kg_used"])


# ── Magazyn ──────────────────────────────────────────────────────────────

def test_wyrob_staje_na_magazynie_z_ruchem(db):
    item = create_finished_good(_wpis())

    assert (int(item["qty"]), float(item["total_kg"]), int(item["qty_available"])) == (10, 350.0, 10)
    ruchy = query_all("SELECT movement_type, qty, source_type FROM stock_movements "
                      "WHERE product_type='finished_goods'")
    assert len(ruchy) == 1
    assert (ruchy[0]["movement_type"], float(ruchy[0]["qty"])) == ("IN", 350.0)


def test_numer_partii_liczy_sie_z_wsadu_gdy_nie_podany(db):
    item = create_finished_good(_wpis(seasoned_batch_nos=["344"]))

    assert item["batch_no"] == "250826 344"


def test_wpisany_numer_partii_ma_pierwszenstwo(db):
    item = create_finished_good(_wpis(batch_no="250826 PP13", seasoned_batch_nos=["344"]))

    assert item["batch_no"] == "250826 PP13"


def test_tuleje_schodza_ze_stanu(db):
    _tuleja()

    create_finished_good(_wpis(packaging_id="t1", packaging_name="METAL 65"))

    assert _stan_tulei() == (90, 10)


# ── Mięso przyprawione ───────────────────────────────────────────────────

def test_mieso_przyprawione_schodzi_gdy_biuro_o_to_prosi(db):
    """Bez tego masownia trzyma w systemie mięso, którego fizycznie nie ma."""
    _przyprawione("344", 1000)

    create_finished_good(_wpis(seasoned_batch_nos=["344"], consume_seasoned=True))

    assert _stan_przyprawionego("344") == (650.0, 350.0)
    ruchy = query_all("SELECT movement_type, source_id FROM stock_movements WHERE product_type='seasoned'")
    assert [r["movement_type"] for r in ruchy] == ["OUT"]
    # Ruch wskazuje wiersz wyrobu — inaczej nie widać, na co poszło mięso.
    assert ruchy[0]["source_id"]


def test_domyslnie_mieso_NIE_schodzi(db):
    """Dawne wywołania (korekta wyrobu) nie mogą nagle ruszać masowni."""
    _przyprawione("344", 1000)

    create_finished_good(_wpis(seasoned_batch_nos=["344"]))

    assert _stan_przyprawionego("344") == (1000.0, 0.0)


def test_dwie_partie_dziela_kilogramy_po_rowno(db):
    _przyprawione("344", 1000)
    _przyprawione("355", 1000)

    create_finished_good(_wpis(seasoned_batch_nos=["344", "355"], consume_seasoned=True))

    assert _stan_przyprawionego("344") == (825.0, 175.0)
    assert _stan_przyprawionego("355") == (825.0, 175.0)


def test_brak_partii_w_masowni_nie_blokuje_wpisu(db):
    """Biuro wpisuje też historię — mięsa sprzed wdrożenia nie ma w systemie."""
    item = create_finished_good(_wpis(seasoned_batch_nos=["999"], consume_seasoned=True))

    assert int(item["qty"]) == 10


# ── Powiązanie z zamówieniem ─────────────────────────────────────────────

def _zamowienie(order_no="ZAM/1", qty=20):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','BULLI','Bulli sp. z o.o.') "
            "ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, status) "
        "VALUES ('o1',%s,'c1','Bulli sp. z o.o.','2026-08-25','new')",
        (order_no,),
    )
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, kg_per_unit) "
        "VALUES ('ol1','o1','r1','pt1',%s,35)",
        (qty,),
    )


def test_wpis_z_numerem_zamowienia_liczy_sie_do_pokrycia(db):
    _zamowienie()

    create_finished_good(_wpis(qty=8, client_order_no="ZAM/1", client_name="Bulli sp. z o.o."))

    linia = get_order("o1")["lines"][0]
    assert int(linia["qty_done"]) == 8


def test_wpis_na_magazyn_tez_pokrywa_zamowienie(db):
    """Produkcja „na magazyn" ma pokrywać zamówienia — tak działa WZ."""
    _zamowienie()

    create_finished_good(_wpis(qty=5))

    linia = get_order("o1")["lines"][0]
    assert int(linia["qty_done"]) >= 5


def test_klient_zapisuje_sie_takze_po_id(db):
    """Bez client_id wyrób wisi tylko na nazwie — po zmianie nazwy klienta
    w kartotece traci powiązanie."""
    item = create_finished_good(_wpis(client_id="c1", client_name="Bulli sp. z o.o."))

    assert item["client_id"] == "c1"


# ── Kilka pozycji naraz ───────────────────────────────────────────────────

def test_kilka_pozycji_zapisuje_sie_razem(db):
    """Biuro zaznacza kilka pozycji zamówienia i klika RAZ."""
    from app.services.finished_goods_service import create_finished_goods_bulk
    _tuleja(stan=100)

    out = create_finished_goods_bulk([
        _wpis(qty=10, packaging_id="t1", packaging_name="METAL 65"),
        _wpis(qty=4, kg_per_unit=17.5, packaging_id="t1", packaging_name="METAL 65"),
    ])

    assert len(out) == 2
    assert sum(int(i["qty"]) for i in out) == 14
    assert _stan_tulei() == (86, 14)


def test_blad_w_drugiej_pozycji_cofa_CALOSC(db):
    """Bez jednej transakcji zostawałby wyrób bez pary i rozjechane tuleje."""
    from fastapi import HTTPException

    from app.services.finished_goods_service import create_finished_goods_bulk
    _tuleja(stan=12)      # starczy na pierwszą pozycję, na drugą już nie

    with pytest.raises(HTTPException):
        create_finished_goods_bulk([
            _wpis(qty=10, packaging_id="t1", packaging_name="METAL 65"),
            _wpis(qty=10, packaging_id="t1", packaging_name="METAL 65"),
        ])

    assert query_all("SELECT id FROM finished_goods") == []
    assert _stan_tulei() == (12, 0)
    assert query_all("SELECT id FROM stock_movements WHERE product_type='finished_goods'") == []


def test_pusta_lista_niczego_nie_robi(db):
    from app.services.finished_goods_service import create_finished_goods_bulk

    assert create_finished_goods_bulk([]) == []


def test_kazda_pozycja_moze_miec_wlasna_partie(db):
    from app.services.finished_goods_service import create_finished_goods_bulk

    out = create_finished_goods_bulk([
        _wpis(qty=2, batch_no="250826 344"),
        _wpis(qty=3, batch_no="250826 PP13"),
    ])

    assert sorted(i["batch_no"] for i in out) == ["250826 344", "250826 PP13"]


# ── Scalanie z zamówieniem ────────────────────────────────────────────────
#
# Wpis bez numeru zamówienia lądował w „puli bez przypisania", która liczy się
# do pokrycia KAŻDEGO pasującego zamówienia naraz: 30 szt. KIRMIZI 50 kg
# pokazywało postęp jednocześnie na ZAGROS i TRUVA (produkcja, 26.08.2026).
# Jeśli wszystko pasuje — klient, receptura i waga sztuki — wyrób ma się
# przypiąć do KONKRETNEGO zamówienia.

def _zamowienie2(order_no, client_name="ZAGROS", client_id="c1", qty=30, kg=50,
                 order_date="2026-08-25", status="confirmed", oid=None):
    oid = oid or f"o-{order_no}".replace("/", "-")
    execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (client_id, client_id.upper(), client_name))
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, status) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (oid, order_no, client_id, client_name, order_date, status),
    )
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, kg_per_unit) "
        "VALUES (%s,%s,'r1','pt1',%s,%s)",
        (f"l-{oid}", oid, qty, kg),
    )
    return oid


def test_wpis_przypina_sie_do_pasujacego_zamowienia(db):
    _zamowienie2("ZAGROS/Z/1")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="ZAGROS", client_id="c1"))

    assert item["client_order_no"] == "ZAGROS/Z/1"
    assert int(get_order("o-ZAGROS-Z-1")["lines"][0]["qty_done"]) == 30


def test_inna_waga_sztuki_to_inny_towar_i_nie_scala(db):
    _zamowienie2("ZAGROS/Z/1", qty=30, kg=50)

    item = create_finished_good(_wpis(qty=30, kg_per_unit=40, client_name="ZAGROS", client_id="c1"))

    assert not item["client_order_no"]


def test_inny_klient_nie_dostaje_cudzego_wyrobu(db):
    _zamowienie2("ZAGROS/Z/1", client_name="ZAGROS", client_id="c1")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="TRUVA", client_id="c2"))

    assert not item["client_order_no"]


def test_zamowienie_juz_pokryte_nie_bierze_wiecej(db):
    _zamowienie2("ZAGROS/Z/1", qty=30, kg=50)
    create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="ZAGROS", client_id="c1"))

    drugi = create_finished_good(_wpis(qty=5, kg_per_unit=50, client_name="ZAGROS", client_id="c1"))

    assert not drugi["client_order_no"]


def test_przy_dwoch_pasujacych_wybiera_NAJSTARSZE(db):
    _zamowienie2("ZAGROS/Z/2", order_date="2026-08-25", oid="o-nowe")
    _zamowienie2("ZAGROS/Z/1", order_date="2026-08-20", oid="o-stare")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="ZAGROS", client_id="c1"))

    assert item["client_order_no"] == "ZAGROS/Z/1"


def test_zamkniete_zamowienie_nie_lapie_wyrobu(db):
    _zamowienie2("ZAGROS/Z/1", status="done")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="ZAGROS", client_id="c1"))

    assert not item["client_order_no"]


def test_wskazane_recznie_zamowienie_wygrywa_z_dopasowaniem(db):
    _zamowienie2("ZAGROS/Z/1", order_date="2026-08-20", oid="o-stare")
    _zamowienie2("ZAGROS/Z/2", order_date="2026-08-25", oid="o-nowe")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50, client_name="ZAGROS",
                                      client_id="c1", client_order_no="ZAGROS/Z/2"))

    assert item["client_order_no"] == "ZAGROS/Z/2"


def test_wyrob_na_magazyn_bez_klienta_zostaje_bez_zamowienia(db):
    _zamowienie2("ZAGROS/Z/1")

    item = create_finished_good(_wpis(qty=30, kg_per_unit=50))

    assert not item["client_order_no"]
