"""Załadunek auta od skanu palety do dokumentu — cała ścieżka.

Biuro (2026-09-09, przed załadunkiem YALCIN/Z/4): „sprawdź czy cały przepływ
działa, czy nie ma błędów, jak będą wystawiane dokumenty po załadunku".

Powód, dla którego ten plik powstał: `finalize_loading` — funkcja, która przy
załadunku wystawia albo weryfikuje WZ, zdejmuje stan i zamyka palety — NIE
MIAŁA ŻADNEGO TESTU. Testowane były tylko jej funkcje pomocnicze
(`verify_wz_against_loaded`, `aggregate_loaded_units`). Na produkcji ścieżka
też nigdy nie przeszła: 177 dokumentów WZ i ani jednego z `loaded_at`.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json

import pytest

from app.db import execute, query_all, query_one
from app.services.loading_service import finalize_loading
from app.services.order_split_service import zapisz_podzial
from app.services.split_documents_service import (anuluj_dokumenty_podzialu,
                                                  wystaw_wz_klienta,
                                                  wystaw_wz_wewnetrzny)


# ── Zasiew ────────────────────────────────────────────────────────────────
def _firma():
    execute("INSERT INTO app_settings (key, value) VALUES ('company', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"name": "F.H.U.P. MAREK KSIĘŻYC", "city": "Rudawa",
                         "address": "ul. Księżyca 83", "postalCode": "32-064",
                         "nip": "1234567890"}),))


def _pojazd(vid="v1", plate="KR 12345"):
    execute("INSERT INTO vehicles (id, name, plate, active) "
            "VALUES (%s,'Chłodnia 1',%s,true) ON CONFLICT (id) DO NOTHING", (vid, plate))
    return vid


def _klient(cid="c1", name="YBM Gastro GmbH", display="YALCIN"):
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES (%s,'YAL',%s,%s) ON CONFLICT (id) DO NOTHING", (cid, name, display))
    return cid


def _receptura(rid="r1", nazwa="KIRMIZI"):
    # `%%` — psycopg2 traktuje pojedynczy `%` jako placeholder nawet bez params.
    execute("INSERT INTO product_types (id, name) VALUES ('pt1','KEBAB UDO 100%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES (%s,%s,'pt1') "
            "ON CONFLICT (id) DO NOTHING", (rid, nazwa))
    return rid


def _zamowienie(oid="o1", order_no="YALCIN/Z/4/09/26", cid="c1", qty=10, kg=30):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,%s,'YBM Gastro GmbH','2026-09-08',"
        " '2026-09-08 08:00:00+00','confirmed')", (oid, order_no, cid))
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit, total_kg) VALUES (%s,%s,'r1','pt1',%s,%s,%s)",
        (f"{oid}-l1", oid, qty, kg, qty * kg))
    return oid


def _wyrob(gid="f1", qty=10, kg=30, cid="c1"):
    """Wyrób gotowy na stanie — to z niego schodzi towar przy załadunku."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, produced_date) "
        "VALUES (%s,'080926 500','r1','KIRMIZI','pt1','KEBAB UDO 100%%',%s,%s,%s,%s,0,"
        " %s,'YBM Gastro GmbH','2026-09-08')",
        (gid, qty, kg, qty * kg, qty, cid))
    return gid


def _paleta(pid="p1", oid="o1", nr=1, status="loaded", vid="v1"):
    execute(
        "INSERT INTO order_pallets (id, order_id, pallet_no, notes, status, "
        " loaded_vehicle_id, loaded_at) VALUES (%s,%s,%s,'',%s,%s,now())",
        (pid, oid, nr, status, vid if status == "loaded" else None))
    return pid


def _sztuki(pallet_id, gid, ile=10, kg=30, oid="o1", od=1, status="packed"):
    """Sztuki QR leżące na palecie, powiązane z wyrobem gotowym."""
    for i in range(ile):
        execute(
            "INSERT INTO finished_units (id, qr_code, order_id, client_name, "
            " product_type_id, recipe_id, weight_kg, batch_no, status, pallet_id, "
            " source_finished_goods_id) "
            "VALUES (%s,%s,%s,'YBM Gastro GmbH','pt1','r1',%s,'500',%s,%s,%s)",
            (f"u{od + i}", f"UNIT|{od + i}", oid, kg, status, pallet_id, gid))


def _wz_zamowienia(wid="w1", oid="o1", linie=None, nr=1):
    """WZ wystawiony WCZEŚNIEJ z zamówienia — tryb „przygotuj przed załadunkiem"."""
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, "
        " issued_date, created_at) "
        "VALUES (%s,%s,%s,'09/26','order',%s,'YBM Gastro GmbH',false,%s::jsonb,'wstepny',"
        " 'PLN',0,0,'2026-09-10',now())",
        (wid, f"WZ/{nr}/09/26", nr, oid, json.dumps(linie or [])))
    return wid


def _linia_wz(qty=10, kg=30, recipe_id="r1", batch="500"):
    return {"stock_type": "fg", "stock_id": "f1", "qty": qty, "unit": "szt",
            "recipe_id": recipe_id, "kg_per_unit": kg, "batch_no": batch,
            "name": "KEBAB UDO 100% KIRMIZI 30 kg"}


def _przygotuj(qty=10, kg=30):
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=qty, kg=kg)
    _wyrob(qty=qty, kg=kg)
    _paleta()
    _sztuki("p1", "f1", ile=qty, kg=kg)


# ── Ścieżka 1: dokumenty powstają PRZY załadunku ──────────────────────────
def test_zaladunek_bez_wz_wystawia_dokument(db):
    """Nie ma WZ — załadunek go tworzy z faktycznej zawartości auta."""
    _przygotuj()

    wynik = finalize_loading("v1", ["o1"], plate="KR 99999")

    assert wynik["ok"] is True
    zam = wynik["orders"][0]
    assert zam.get("skipped") is None, zam
    assert zam["wz_number"], "załadunek nie wystawił WZ"
    assert zam["wz_status"] == "potwierdzony"
    assert zam["units"] == 10


def test_zaladunek_zdejmuje_stan_magazynu(db):
    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")

    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)


def test_zaladunek_zamyka_palety_i_sztuki(db):
    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")

    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "shipped"
    statusy = {r["status"] for r in query_all(
        "SELECT status FROM finished_units WHERE pallet_id='p1'")}
    assert statusy == {"shipped"}


def test_wz_z_zaladunku_ma_slad_auta(db):
    """Kontrola musi widzieć, czym towar pojechał i kiedy."""
    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")

    wz = query_one("SELECT vehicle_plate, loaded_at, loading_status FROM wz_documents "
                   "WHERE source_id='o1'")
    assert wz["vehicle_plate"] == "KR 99999"
    assert wz["loaded_at"] is not None
    assert wz["loading_status"] == "potwierdzony"


def test_zaladunek_jest_idempotentny(db):
    """Drugie kliknięcie nie może wystawić drugiego WZ ani zdjąć stanu dwa razy."""
    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")
    finalize_loading("v1", ["o1"], plate="KR 99999")

    assert len(query_all("SELECT id FROM wz_documents WHERE source_id='o1'")) == 1
    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)


# ── Ścieżka 2: WZ przygotowany wcześniej, załadunek go WERYFIKUJE ─────────
def test_wz_przygotowany_wczesniej_zgadza_sie_z_autem(db):
    _przygotuj()
    _wz_zamowienia(linie=[_linia_wz(qty=10)])

    wynik = finalize_loading("v1", ["o1"], plate="KR 99999")
    zam = wynik["orders"][0]

    assert zam["wz_status"] == "potwierdzony", zam
    assert zam["diff"] == []
    # Rozchód zrobił WZ przy wystawieniu — załadunek NIE może zdjąć drugi raz.
    fg = query_one("SELECT qty_available FROM finished_goods WHERE id='f1'")
    assert int(fg["qty_available"]) == 10


def test_niedowoz_wychodzi_jako_rozjazd(db):
    """Na aucie mniej, niż mówi dokument — biuro ma to zobaczyć, nie zgadywać."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10); _wyrob(qty=10); _paleta()
    _sztuki("p1", "f1", ile=7)                 # załadowano 7 z 10
    _wz_zamowienia(linie=[_linia_wz(qty=10)])

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam["wz_status"] == "rozjazd"
    assert zam["diff"], "rozjazd bez opisu różnicy jest bezużyteczny"


# ── Ścieżka 3: przypadki, które muszą zatrzymać załadunek ────────────────
def test_sztuki_bez_powiazania_z_wyrobem_blokuja_wydanie(db):
    """Dzień produkcji niezamknięty — nie wiadomo, z jakiej partii schodzi towar."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(); _wyrob(); _paleta()
    _sztuki("p1", None, ile=10)                # brak source_finished_goods_id

    with pytest.raises(Exception) as e:
        finalize_loading("v1", ["o1"], plate="KR 99999")
    assert "powiązania" in str(e.value) or "produkcj" in str(e.value).lower()


def test_za_malo_na_stanie_zatrzymuje_zaladunek(db):
    """Na aucie więcej sztuk, niż jest na stanie — magazyn zszedłby na minus."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10); _wyrob(qty=4); _paleta()
    _sztuki("p1", "f1", ile=10)

    with pytest.raises(Exception) as e:
        finalize_loading("v1", ["o1"], plate="KR 99999")
    assert "za mało na stanie" in str(e.value)


def test_paleta_nie_zaladowana_nie_jedzie(db):
    """Paleta bez skanu „załadowana" nie może trafić na dokument."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(); _wyrob()
    _paleta(status="created")                  # nikt jej nie zeskanował
    _sztuki("p1", "f1", ile=10)

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]
    assert zam.get("skipped"), "paleta bez skanu nie może wystawić dokumentu"
    assert not query_all("SELECT id FROM wz_documents WHERE source_id='o1'")


def test_pusta_paleta_nie_wystawia_dokumentu(db):
    """Skan palety bez zeskanowanych sztuk — dokładnie stan YALCIN/Z/4 na
    2026-09-09: palety rozpisane, ale ani jednej sztuki QR na nich."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(); _wyrob(); _paleta()         # paleta „loaded", ale pusta

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam.get("skipped") == "brak załadowanych sztuk"
    assert not query_all("SELECT id FROM wz_documents WHERE source_id='o1'")


def test_nieznany_pojazd_odrzucony(db):
    _firma(); _klient(); _receptura(); _zamowienie(); _wyrob()
    with pytest.raises(Exception) as e:
        finalize_loading("NIE-MA", ["o1"])
    assert "ojazd" in str(e.value)


# ── Załadunek BEZ skanowania pojedynczych sztuk ───────────────────────────
#
# Biuro (2026-09-09): „jeszcze nie skanujemy pojedynczych sztuk, nie mamy
# możliwości — system musi wierzyć, że zeskanowany karton jest spakowany
# zgodnie z zamówieniem, a partie brać od najstarszych z magazynu".
#
# Skan kartki na palecie JEST potwierdzeniem zawartości: co biuro rozpisało
# na tę paletę, to na niej jedzie. Partie dobiera ta sama reguła, co przy
# „Wystaw WZ" z zamówienia — najpierw towar ostemplowany tym zamówieniem,
# potem NAJSTARSZY.
def _pozycja_palety(pid="p1", line_id="o1-l1", qty=10, iid="pi1"):
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
            "VALUES (%s,%s,%s,%s)", (iid, pid, line_id, qty))


def _wyrob_z_data(gid, qty, produced, kg=30, order_no=None):
    """Wyrób gotowy z konkretną datą produkcji — do sprawdzenia kolejności."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, client_order_no, produced_date) "
        "VALUES (%s,%s,'r1','KIRMIZI','pt1','KEBAB UDO 100%%',%s,%s,%s,%s,0,"
        " 'c1','YBM Gastro GmbH',%s,%s)",
        (gid, f"{produced} 500", qty, kg, qty * kg, qty, order_no, produced))


def test_paleta_bez_sztuk_wystawia_wz_z_rozpisu(db):
    """Rozpisana paleta + skan = dokument. Bez tego jutrzejszy załadunek
    kończy się „brak załadowanych sztuk" i biuro nie ma papieru."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10, kg=30)
    _wyrob(qty=10, kg=30)
    _paleta()
    _pozycja_palety(qty=10)          # rozpis palety, ZERO sztuk QR

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam.get("skipped") is None, zam
    assert zam["wz_number"], "paleta z rozpisu nie wystawiła dokumentu"
    assert zam["wz_status"] == "potwierdzony"


def test_wz_z_rozpisu_zdejmuje_stan_i_zamyka_palete(db):
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10, kg=30); _wyrob(qty=10, kg=30); _paleta(); _pozycja_palety(qty=10)

    finalize_loading("v1", ["o1"], plate="KR 99999")

    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "shipped"


def test_partie_schodza_od_NAJSTARSZEJ(db):
    """„Partie brać od najstarszych z magazynu" — wprost z polecenia biura."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10, kg=30)
    _wyrob_z_data("f-nowa", qty=10, produced="2026-09-08")
    _wyrob_z_data("f-stara", qty=10, produced="2026-09-01")
    _paleta(); _pozycja_palety(qty=10)

    finalize_loading("v1", ["o1"], plate="KR 99999")

    stara = query_one("SELECT qty_available FROM finished_goods WHERE id='f-stara'")
    nowa = query_one("SELECT qty_available FROM finished_goods WHERE id='f-nowa'")
    assert int(stara["qty_available"]) == 0, "najstarsza partia miała zejść pierwsza"
    assert int(nowa["qty_available"]) == 10, "nowsza partia miała zostać na stanie"


def test_jada_TYLKO_zeskanowane_palety(db):
    """Paleta bez skanu zostaje w magazynie — dokument jej nie obejmuje."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=20, kg=30); _wyrob(qty=20, kg=30)
    _paleta("p1", nr=1, status="loaded"); _pozycja_palety("p1", qty=10, iid="pi1")
    _paleta("p2", nr=2, status="created"); _pozycja_palety("p2", qty=10, iid="pi2")

    finalize_loading("v1", ["o1"], plate="KR 99999")

    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (10, 10)


def test_kilka_palet_sumuje_sie_w_jeden_dokument(db):
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=20, kg=30); _wyrob(qty=20, kg=30)
    _paleta("p1", nr=1); _pozycja_palety("p1", qty=12, iid="pi1")
    _paleta("p2", nr=2); _pozycja_palety("p2", qty=8, iid="pi2")

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam["pallets"] == 2
    assert len(query_all("SELECT id FROM wz_documents WHERE source_id='o1'")) == 1
    fg = query_one("SELECT qty_shipped FROM finished_goods WHERE id='f1'")
    assert int(fg["qty_shipped"]) == 20


def test_za_malo_na_stanie_zatrzymuje_zaladunek_z_rozpisu(db):
    """Magazyn nie może zejść na minus tylko dlatego, że ktoś zeskanował paletę."""
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10, kg=30); _wyrob(qty=4, kg=30); _paleta(); _pozycja_palety(qty=10)

    with pytest.raises(Exception) as e:
        finalize_loading("v1", ["o1"], plate="KR 99999")
    assert "stanie" in str(e.value).lower()


def test_rozpis_jest_idempotentny(db):
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=10, kg=30); _wyrob(qty=10, kg=30); _paleta(); _pozycja_palety(qty=10)

    finalize_loading("v1", ["o1"], plate="KR 99999")
    finalize_loading("v1", ["o1"], plate="KR 99999")

    assert len(query_all("SELECT id FROM wz_documents WHERE source_id='o1'")) == 1
    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)


def test_sztuki_qr_maja_pierwszenstwo_nad_rozpisem(db):
    """Gdy sztuki JUŻ są skanowane, rozpis nie może ich dublować."""
    _przygotuj(qty=10, kg=30)        # 10 sztuk QR na palecie
    _pozycja_palety(qty=10)          # i rozpis na tę samą paletę

    finalize_loading("v1", ["o1"], plate="KR 99999")

    fg = query_one("SELECT qty_shipped FROM finished_goods WHERE id='f1'")
    assert int(fg["qty_shipped"]) == 10, "policzono dwa razy: sztuki i rozpis"


# ── Ścieżka 3: zamówienie z PODZIAŁEM na fakturę ──────────────────────────
#
# Podział daje DWA dokumenty na jedną wysyłkę: WM na całość (jedyny, który
# zdjął stan) i WZ klienta na część niefakturowaną. Auto wiezie całość, więc
# porównywać zawartość wolno tylko z WM — z częściowym WZ klienta każdy
# poprawny załadunek wychodziłby jako rozjazd. `ORDER BY created_at LIMIT 1`
# brało po prostu dokument, który powstał pierwszy
# (re-review Task 4, fix round 3, 2026-09-10).
def _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0, na_stanie=20):
    """Zamówienie z podziałem i dokumentami wystawionymi ŚCIEŻKĄ PRODUKCYJNĄ:
    `zapisz_podzial` → `wystaw_wz_wewnetrzny` → `wystaw_wz_klienta`.

    DLACZEGO NIE ręcznie sklejony JSON (tak było do 2026-09-11): poprzedni
    zasiew wpisywał w linie dokumentu `recipe_id`, którego kod produkcyjny
    NIGDY tam nie wpisywał — `build_goods_wz_lines` (linie WM) go gubił.
    Test sprawdzał więc własny fixture, nie funkcję, i świecił na zielono,
    podczas gdy KAŻDA podzielona wysyłka wychodziła przy załadunku jako
    „ROZJAZD z dokumentem WZ": klucz dokumentu miał puste `recipe_id`, klucz
    załadunku prawdziwe, więc nic się nie dopasowywało i każda pozycja
    dublowała się na dwie (doc 10/loaded 0 obok doc 0/loaded 10).

    Załadunek idzie ROZPISEM PALET, nie sztukami QR — tak pracuje ten zakład
    (na produkcji 0 z 59 sztuk QR leży na palecie) i tylko tak partia
    z dokumentu (`finished_goods.batch_no`) opisuje to samo, co partia
    z załadunku (`aggregate_picks` też bierze ją z wiersza magazynu).

    Na stanie leży WIĘCEJ, niż bierze zamówienie (20 szt. wobec 10): WM
    zdejmuje swoje 10, reszta zostaje, więc `picks_for_pallets` (warunek
    `qty_available > 0`) ma czym potwierdzić zawartość auta. Tak wygląda
    magazyn tego zakładu — partie po 60-120 szt. na kilkanaście sztuk
    zamówienia.
    """
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(qty=qty, kg=kg)
    _wyrob(qty=na_stanie, kg=kg)
    _paleta()
    _pozycja_palety(qty=qty)               # rozpis palety, ZERO sztuk QR
    zapisz_podzial("o1", cel_kg)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    # Kolejność w bazie ODWRÓCONA wobec kolejności wystawiania — celowo.
    # Produkcyjnie WM musi powstać pierwszy (`wystaw_wz_klienta` bez niego
    # odmawia), ale wtedy dawne, niefiltrowane `ORDER BY created_at LIMIT 1`
    # trafiałoby w WM tak samo jak dzisiejszy filtr po `split_scope` i test
    # nie odróżniałby starego kodu od nowego (uwaga z re-review rundy 3).
    # Cofamy więc sam ZEGAR na WZ klienta; linie dokumentów zostają takie,
    # jakie wystawił kod produkcyjny, i o to w tym zasiewie chodzi.
    execute("UPDATE wz_documents SET created_at = now() - interval '20 minutes' "
            "WHERE source_id='o1' AND split_scope='wz_klienta'")
    execute("UPDATE wz_documents SET created_at = now() - interval '10 minutes' "
            "WHERE source_id='o1' AND split_scope='calosc'")


def _wm(oid="o1"):
    return query_one(
        "SELECT id, number, loaded_at, loading_status, loading_diff FROM wz_documents "
        "WHERE source_id=%s AND split_scope='calosc'", (oid,))


def _wz_klienta_doc(oid="o1"):
    return query_one(
        "SELECT id, number, loaded_at, vehicle_plate, loading_status FROM wz_documents "
        "WHERE source_id=%s AND split_scope='wz_klienta'", (oid,))


def test_zaladunek_podzialu_weryfikuje_sie_z_dokumentem_NA_CALOSC(db):
    _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0)

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam["wz_number"].startswith("WM/"), "załadunek podpiął się pod zły dokument"
    assert zam["wz_status"] == "potwierdzony", (
        "poprawny załadunek uznany za rozjazd z dokumentem WM: " + repr(zam["diff"]))
    assert zam["diff"] == []


def test_zaladunek_podzialu_NIE_zdejmuje_stanu_drugi_raz(db):
    """Stan zszedł już przy wystawieniu WM — załadunek tylko potwierdza."""
    _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0)
    ruchow_przed = query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"]

    finalize_loading("v1", ["o1"], plate="KR 99999")

    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (10, 10)
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"] == ruchow_przed


def test_WZ_klienta_dostaje_numer_auta_i_godzine(db):
    """Ten papier jedzie z kierowcą — musi mieć na wydruku auto i godzinę,
    choć diffu (porównania z zawartością) nie dostaje, bo jest częściowy."""
    _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0)

    finalize_loading("v1", ["o1"], plate="KR 99999")

    wzk = _wz_klienta_doc()
    assert wzk["loaded_at"] is not None
    assert wzk["vehicle_plate"] == "KR 99999"
    assert not wzk["loading_status"], "częściowy WZ klienta nie może dostać statusu zgodności"


# ── Anulowanie kompletu PO załadunku ──────────────────────────────────────
#
# `anuluj_dokumenty_podzialu` pisze ruchy CANCEL i podnosi `qty_available`.
# Po `finalize_loading` towar leży już na naczepie — zwrot na stan opisywałby
# magazyn, którego nie ma. Do tej pory taka droga w ogóle nie istniała
# (`cancel_wz` odrzuca wszystko z `source_type != 'manual'`), więc to
# ekspozycja WNIESIONA przez tę gałąź (review końcowy, I2).
def test_anulowanie_kompletu_PO_ZALADUNKU_jest_odrzucone(db):
    _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0)
    finalize_loading("v1", ["o1"], plate="KR 99999")
    przed = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    ruchow_przed = query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"]

    with pytest.raises(Exception) as e:
        anuluj_dokumenty_podzialu("o1")

    # Odmowa ma nazwać POWÓD (załadunek) i pokazać WYJŚCIE (korekta stanu),
    # inaczej biuro zostaje z „nie da się" i wraca do ręcznego SQL-a.
    assert "załadunkiem" in str(e.value), e.value
    assert "korekt" in str(e.value).lower(), e.value
    po = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(po["qty_available"]), int(po["qty_shipped"])) == (
        int(przed["qty_available"]), int(przed["qty_shipped"])), "odmowa mimo to ruszyła stan"
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"] == ruchow_przed
    assert not query_all(
        "SELECT id FROM wz_documents WHERE source_id='o1' AND COALESCE(status,'')='anulowany'")


def test_anulowanie_kompletu_PRZED_zaladunkiem_dziala(db):
    """Druga strona tej samej bramki: dopóki auto nie odjechało, wycofanie
    kompletu jest jedyną drogą powrotną i musi działać."""
    _przygotuj_podzial(qty=10, kg=30, cel_kg=180.0)

    wynik = anuluj_dokumenty_podzialu("o1")

    assert len(wynik["documents"]) == 2
    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (20, 0)


def test_ANULOWANY_wz_nie_jest_kandydatem_przy_zaladunku(db):
    """Anulowanie zwróciło towar na stan — załadunek musi wystawić dokument
    na nowo, a nie podpiąć się pod papier, który już nic nie wydaje."""
    _przygotuj(qty=10, kg=30)
    _wz_zamowienia(linie=[_linia_wz(qty=10, kg=30)])
    execute("UPDATE wz_documents SET status='anulowany' WHERE id='w1'")

    zam = finalize_loading("v1", ["o1"], plate="KR 99999")["orders"][0]

    assert zam["wz_id"] != "w1", "podpięto załadunek pod anulowany dokument"
    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)
