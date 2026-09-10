"""Wspólny zasiew dla testów dokumentów przy podziale wysyłki (Task 4-7).

Jedna wersja fixture zamiast przepisywania jej w każdym pliku zadania —
`_przygotuj_z_podzialem` / `_przygotuj_bez_podzialu`. NIE jest to plugin
pytest (nazwa celowo NIE jest `conftest.py`) — importuj funkcje wprost:

    from tests.conftest_split import _przygotuj_z_podzialem

Wzorzec zasiewu (firma/klient/receptura/zamówienie/wyrób) skopiowany z
`tests/test_finalize_loading_db.py` — ta sama rodzina dokumentów WZ.

Zamówienie ma DWIE pozycje różnych receptur, razem 800 kg (30 szt. po 25 kg
+ 2 szt. po 25 kg) — tak dobrane, żeby `podziel_pozycje` z cel_kg=300.0
trafiało DOKŁADNIE (11 szt. z pierwszej pozycji + 1 szt. z drugiej =
11*25 + 1*25 = 300 kg), a reszta (800-300=500 kg) szła na WZ klienta.
"""
import json

from app.db import execute
from app.services.order_split_service import zapisz_podzial


def _firma():
    execute("INSERT INTO app_settings (key, value) VALUES ('company', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"name": "F.H.U.P. MAREK KSIĘŻYC", "city": "Rudawa",
                         "address": "ul. Księżyca 83", "postalCode": "32-064",
                         "nip": "1234567890"}),))


def _klient(cid="c1", name="YBM Gastro GmbH", display="YALCIN"):
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES (%s,'YAL',%s,%s) ON CONFLICT (id) DO NOTHING", (cid, name, display))
    return cid


def _slownik():
    # `%%` — psycopg2 traktuje pojedynczy `%` jako placeholder nawet bez params.
    execute("INSERT INTO product_types (id, name) VALUES ('pt1','KEBAB UDO 100%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r1','KIRMIZI','pt1') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt2','KEBAB MIX 95%%/5%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r2','GOLD2','pt2') "
            "ON CONFLICT (id) DO NOTHING")


def _zamowienie(oid="o1", order_no="YALCIN/Z/9/09/26", cid="c1"):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,%s,'YBM Gastro GmbH','2026-09-08',"
        " '2026-09-08 08:00:00+00','confirmed')", (oid, order_no, cid))
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, "
        " product_type_id, product_type_name, qty, kg_per_unit, total_kg, position) "
        "VALUES (%s,%s,'r1','KIRMIZI','pt1','KEBAB UDO 100%%',30,25,750,1)",
        (f"{oid}-l1", oid))
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, "
        " product_type_id, product_type_name, qty, kg_per_unit, total_kg, position) "
        "VALUES (%s,%s,'r2','GOLD2','pt2','KEBAB MIX 95%%/5%%',2,25,50,2)",
        (f"{oid}-l2", oid))
    return oid


def _wyroby(cid="c1"):
    """Wyroby gotowe na stanie, pokrywające CAŁE zamówienie (id `f1`/`f2`)."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, produced_date) "
        "VALUES ('f1','080926 501','r1','KIRMIZI','pt1','KEBAB UDO 100%%',30,25,750,30,0,"
        " %s,'YBM Gastro GmbH','2026-09-08')", (cid,))
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, produced_date) "
        "VALUES ('f2','080926 502','r2','GOLD2','pt2','KEBAB MIX 95%%/5%%',2,25,50,2,0,"
        " %s,'YBM Gastro GmbH','2026-09-08')", (cid,))


def _przygotuj_bez_podzialu(oid="o1"):
    """Zamówienie BEZ podziału — `qty_invoice` puste, zachowanie jak dziś."""
    _firma()
    _klient()
    _slownik()
    _zamowienie(oid)
    _wyroby()
    return oid


def _przygotuj_z_podzialem(oid="o1", cel_kg=300.0):
    """Jak wyżej, plus zapisany podział — drogą produkcyjną (przez serwis,
    nie SQL-em wprost, [[kebab-nie-ruszac-planu-sql]])."""
    _przygotuj_bez_podzialu(oid)
    zapisz_podzial(oid, cel_kg)
    return oid


def _stary_wz(oid="o1", nr=1, status="wstepny"):
    """Zwykły WZ CAŁOŚCI zamówienia wystawiony STARĄ ścieżką
    (`create_wz_from_order` / `finalize_loading`) — `source_type='order'`,
    `doc_series='WZ'`, `split_scope IS NULL`. Ten ostatni punkt jest CAŁYM
    sensem tego zasiewu: kolumna `split_scope` (fix round 1) nigdy go nie
    oznacza, więc ten dokument wygląda dokładnie jak każdy inny zwykły WZ —
    nie do odróżnienia po samym `doc_series`+`source_id`.

    Zdejmuje stan NAPRAWDĘ (f1 i f2 w całości, z wierszami w
    `stock_movements`) — odwzorowuje realny rozchód z produkcji, żeby test
    guardu w `wystaw_wz_wewnetrzny`/`wystaw_wz_klienta` (fix round 2, review
    Task 4, 2026-09-10) sprawdzał prawdziwe zagrożenie („drugi rozchód"), nie
    tylko sam wiersz w tabeli.

    `status="anulowany"` odwzorowuje dokument PO anulowaniu: wiersz (ślad)
    zostaje, ale magazynu w ogóle nie dotykamy — jak po realnym `cancel_wz`,
    którego tu użyć nie można (odrzuca WZ z `source_type != 'manual'`; WZ z
    zamówienia anuluje się przez samo zamówienie, poza zakresem tego zasiewu).
    """
    wid = f"stary-wz-{oid}-{nr}"
    number = f"WZ/{nr}/09/26"
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, total_value, status, currency, pallets_h1, "
        " pallets_other, issued_date, release_date, doc_series, created_at) "
        "VALUES (%s,%s,%s,'09/26','order',%s,'YBM Gastro GmbH',false,'[]'::jsonb,0,%s,"
        " 'PLN',0,0,'2026-09-09','2026-09-09','WZ',now())",
        (wid, number, nr, oid, status))
    if status != "anulowany":
        execute(
            "UPDATE finished_goods SET qty_available=0, qty_shipped=qty WHERE id IN ('f1','f2')")
        execute(
            "INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type, "
            " source_type, source_id) VALUES (%s,'finished_goods','f1',-750,'OUT','wz',%s)",
            (f"{wid}-mv1", wid))
        execute(
            "INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type, "
            " source_type, source_id) VALUES (%s,'finished_goods','f2',-50,'OUT','wz',%s)",
            (f"{wid}-mv2", wid))
    return {"id": wid, "number": number}
