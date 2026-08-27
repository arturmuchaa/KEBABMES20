"""Reconciliacja dokumentów: sztuki spakowane do kartonu powiązanego z zamówieniem
NIE są liczone drugi raz w FIFO finished_goods (anty-dublowanie)."""
from app.db import execute, query_one
from app.services.order_stock_service import stock_portions_for_order
from app.utils.ids import now_iso


def _seed_order(order_id="ord1", order_no="ZAM/1", client_id="c1"):
    execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (client_id, client_id, client_id))
    execute("INSERT INTO client_orders (id, order_no, client_id) VALUES (%s,%s,%s)",
            (order_id, order_no, client_id))


def _seed_fg(fid="fg1", qty=50, recipe="r1", kg=10.0):
    execute(
        "INSERT INTO finished_goods "
        "(id, batch_no, recipe_id, recipe_name, product_type_name, kg_per_unit, "
        " qty, qty_available, qty_shipped, client_order_no, client_name, produced_date, created_at) "
        "VALUES (%s,'180626 1',%s,'Gold','UDO',%s,%s,%s,0,'','',%s,%s)",
        (fid, recipe, kg, qty, qty, "2026-06-10", now_iso()),
    )


def _seed_linked_carton(order_id="ord1", n=20, recipe="r1", kg=10.0):
    execute(
        "INSERT INTO stock_cartons (id, carton_no, client_id, kg_per_unit, target_qty, "
        " packed_qty, status, linked_order_id, created_at) "
        "VALUES ('sc1', 999, 'c1', %s, %s, %s, 'packed', %s, %s)",
        (kg, n, n, order_id, now_iso()),
    )
    for i in range(n):
        execute(
            "INSERT INTO finished_units "
            "(id, qr_code, status, recipe_id, product_type_id, tuleja, weight_kg, "
            " batch_no, carton_id, created_at) "
            "VALUES (%s,%s,'packed',%s,'p1','T',%s,'180626 1','sc1',%s)",
            (f"fu{i}", f"U|fu{i}", recipe, kg, now_iso()),
        )


def test_portions_exclude_cartoned_units(db):
    _seed_order()
    _seed_fg(qty=50)              # 50 szt dostępne w finished_goods
    _seed_linked_carton(n=20)     # 20 szt już w kartonie pod to zamówienie
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    portions = stock_portions_for_order("ord1", "ZAM/1", order_lines, {})
    # brak 50 − 20 (karton) = 30 do dobrania z finished_goods
    assert sum(p["take"] for p in portions) == 30


def _seed_fg_klienta(fid, qty, klient_id, klient_nazwa, data, recipe="r1", kg=10.0):
    if klient_id:
        execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (klient_id, klient_id, klient_nazwa))
    execute(
        "INSERT INTO finished_goods "
        "(id, batch_no, recipe_id, recipe_name, product_type_name, kg_per_unit, "
        " qty, qty_available, qty_shipped, client_order_no, client_id, client_name, "
        " produced_date, created_at) "
        "VALUES (%s,'180626 1',%s,'Gold','UDO',%s,%s,%s,0,'',%s,%s,%s,%s)",
        (fid, recipe, kg, qty, qty, klient_id or None, klient_nazwa, data, now_iso()),
    )


def test_zapas_obcego_klienta_dobiera_sie_OSTATNI(db):
    """FEFO nie może wyprzedzić właściciela: najstarszy wiersz na magazynie
    bywa podpisany innym klientem, a dokument wystawiamy z niego po cichu."""
    _seed_order(client_id="c1")
    _seed_fg_klienta("fg-obcy", 50, "c2", "Provia Global BV", "2026-06-01")   # starszy
    _seed_fg_klienta("fg-niczyj", 50, None, "", "2026-06-20")                 # młodszy

    portions = stock_portions_for_order(
        "ord1", "ZAM/1", [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 30}], {}
    )

    assert [p["fg"]["id"] for p in portions] == ["fg-niczyj"]


def test_stempel_po_skasowanym_zamowieniu_wraca_do_wydania(db):
    """YBM: 436 szt. stało pod numerem SKASOWANEGO zamówienia, więc HDI dla
    nowego wyszło na 104 szt. zamiast całości (biuro, 27.08.2026)."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_name, kg_per_unit, qty, qty_available, qty_shipped, "
        " client_order_no, client_name, produced_date, created_at) "
        "VALUES ('fg-stary','180626 1','r1','Gold','UDO',10,50,50,0,"
        " 'YALCIN/Z/1/08/26','YBM Gastro GmbH','2026-06-10',%s)",
        (now_iso(),),
    )

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg-stary", 50)]


def test_stempel_ZYWEGO_cudzego_zamowienia_zostaje_nietkniety(db):
    """Towar zaklepany innym, wciąż otwartym zamówieniem nie może wyjechać
    na tym dokumencie."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    execute("INSERT INTO clients (id, code, name) VALUES ('c2','TRUVA','Truva') "
            "ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, status) "
        "VALUES ('ord2','TRUVA/Z/1/08/26','c2','confirmed')")
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_name, kg_per_unit, qty, qty_available, qty_shipped, "
        " client_order_no, client_name, produced_date, created_at) "
        "VALUES ('fg-truva','180626 1','r1','Gold','UDO',10,50,50,0,"
        " 'TRUVA/Z/1/08/26','Truva','2026-06-10',%s)",
        (now_iso(),),
    )

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert portions == []


def test_dokument_nie_siega_po_towar_innego_klienta(db):
    """Cudzy towar wolno sprzedać, ale RĘCZNYM WZ — dokument z zamówienia nie
    może po cichu wciągnąć kebabu innego klienta."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    _seed_fg_klienta("fg-obcy", 50, "c2", "Provia Global BV", "2026-06-01")

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert portions == []


def test_dokument_bierze_towar_niczyj(db):
    """Produkcja „na magazyn" nie ma klienta — z niej wolno wystawić."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    _seed_fg_klienta("fg-niczyj", 50, None, "", "2026-06-01")

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg-niczyj", 50)]


def _wz_fg(wid, buyer, stock_id, qty, kiedy, source_type="manual", source_id=None, seq=1):
    import json
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, created_at) "
        "VALUES (%s,%s,%s,'08/26',%s,%s,%s,false,%s::jsonb,'wstepny','PLN',0,0,%s)",
        (wid, f"WZ/{seq}/08/26", seq, source_type, source_id, buyer,
         json.dumps([{"stock_type": "fg", "stock_id": stock_id, "qty": qty}]), kiedy),
    )


def _fg_wydany(fid, qty, klient, data="2026-07-14"):
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_name, kg_per_unit, qty, qty_available, qty_shipped, "
        " client_order_no, client_name, produced_date, created_at) "
        "VALUES (%s,'140726 411','r1','Gold','UDO',10,%s,0,%s,'',%s,%s,%s)",
        (fid, qty, qty, klient, data, now_iso()),
    )


def test_lipcowa_wz_nie_wciaga_starych_kebabow_do_dokumentu(db):
    """Magazyn wyrobu gotowego to świętość: HDI nie może wykazać towaru
    z lipca, którego fizycznie nie ma (biuro, 27.08.2026)."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    execute("UPDATE clients SET name='YBM Gastro GmbH' WHERE id='c1'")
    _fg_wydany("fg-lipiec", 50, "YBM Gastro GmbH")
    _wz_fg("w-lipiec", "YBM Gastro GmbH", "fg-lipiec", 50, "2026-07-20 08:28:00+00")

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert portions == []


def test_wz_wystawiony_na_to_zamowienie_zostaje_na_dokumencie(db):
    """WZ poszedł dziś z tego zamówienia — HDI po nim musi te sztuki wykazać."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    execute("UPDATE clients SET name='YBM Gastro GmbH' WHERE id='c1'")
    _fg_wydany("fg-dzis", 50, "YBM Gastro GmbH", data="2026-08-27")
    _wz_fg("w-dzis", "YBM Gastro GmbH", "fg-dzis", 50, now_iso())

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg-dzis", 50)]


def test_sprzedaz_cudzemu_nabywcy_zdejmuje_stempel(db):
    """Sztuki sprzedane komuś innemu przestają należeć do zamówienia —
    inaczej weszłyby jego właścicielowi na HDI, choć ich nie dostał."""
    from app.db import transaction
    from app.services.wz_service import zdejmij_stempel_obcej_sprzedazy
    _seed_order(order_id="ord1", order_no="TRUVA/Z/1/08/26", client_id="c1")
    execute("INSERT INTO clients (id, code, name) VALUES ('c9','KK','Katarzyna Księżyc') "
            "ON CONFLICT (id) DO NOTHING")
    _seed_fg_klienta("fg1", 30, "c1", "Truva", "2026-08-26")
    execute("UPDATE finished_goods SET client_order_no='TRUVA/Z/1/08/26' WHERE id='fg1'")

    with transaction() as conn:
        zdejmij_stempel_obcej_sprzedazy(conn, "fg1", "TRUVA/Z/1/08/26", "Katarzyna Księżyc")

    assert query_one("SELECT client_order_no FROM finished_goods WHERE id='fg1'")["client_order_no"] in (None, "")


def test_sprzedaz_TEMU_klientowi_zostawia_stempel(db):
    """WZ ręczny na tego samego klienta to normalne wydanie na zamówienie."""
    from app.db import transaction
    from app.services.wz_service import zdejmij_stempel_obcej_sprzedazy
    _seed_order(order_id="ord1", order_no="TRUVA/Z/1/08/26", client_id="c1")
    execute("UPDATE clients SET name='Truva gastro s.r.o.', display_name='TRUVA' WHERE id='c1'")
    _seed_fg_klienta("fg1", 30, "c1", "Truva gastro s.r.o.", "2026-08-26")
    execute("UPDATE finished_goods SET client_order_no='TRUVA/Z/1/08/26' WHERE id='fg1'")

    with transaction() as conn:
        zdejmij_stempel_obcej_sprzedazy(conn, "fg1", "TRUVA/Z/1/08/26", "TRUVA")

    assert query_one("SELECT client_order_no FROM finished_goods WHERE id='fg1'")["client_order_no"] == "TRUVA/Z/1/08/26"


def test_stempel_tego_zamowienia_wazniejszy_niz_nazwa_klienta(db):
    """W kartotece bywają dwie karty o tej samej nazwie handlowej (biuro
    rozbiło YBM na dwie, 27.08.2026). Wiersz ostemplowany TYM zamówieniem
    należy do niego niezależnie od tego, na którą kartę wskaże nazwa."""
    _seed_order(order_id="ord1", order_no="YALCIN/Z/2/08/26", client_id="c1")
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('c-inny','K20','YBM Gastro GmbH','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_name, kg_per_unit, qty, qty_available, qty_shipped, "
        " client_order_no, client_name, produced_date, created_at) "
        "VALUES ('fg-klon','220826 493','r1','Gold','UDO',10,50,0,50,"
        " 'YALCIN/Z/2/08/26','YALCIN','2026-08-22',%s)",
        (now_iso(),),
    )

    portions = stock_portions_for_order(
        "ord1", "YALCIN/Z/2/08/26",
        [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}], {})

    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg-klon", 50)]
