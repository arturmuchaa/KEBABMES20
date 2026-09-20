"""Załadunek na kilku skanerach naraz — baza jest jedynym źródłem prawdy.

Właściciel (20.09.2026): „urządzenie A realizuje zamówienie, urządzenie B nadal
widzi je jako rozpoczęte — w produkcji to niedopuszczalne".

Przyczyna, którą te testy przybijają do ziemi: lista zamówień pojazdu i ich
kolejność żyły w `localStorage` TELEFONU, a serwer był dociągany wyłącznie jako
SUMA (`dociagnijZSerwera` dodawał brakujące, nigdy nie odejmował). Zamówienie
zamknięte na urządzeniu A nie miało żadnej drogi, żeby zniknąć z ekranu B.

Drugi wątek: `pallets_service.scan` czytał status palety POZA transakcją
i dopiero potem pisał — dwa skanery przechodziły walidację równocześnie.
Na produkcji to jeszcze nie wystrzeliło (par skanów <5 s: 0), ale wystrzeli.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json
import threading

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import pallets_service, vehicle_loading_service
from app.services.loading_service import finalize_loading


# ── Zasiew ────────────────────────────────────────────────────────────────
def _pojazd(vid="v1", nazwa="SOLÓWKA", plate="KR 12345"):
    execute("INSERT INTO vehicles (id, name, plate, active) VALUES (%s,%s,%s,true) "
            "ON CONFLICT (id) DO NOTHING", (vid, nazwa, plate))
    return vid


def _slowniki():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('c1','YAL','YBM Gastro GmbH','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt1','KEBAB UDO 100%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r1','KIRMIZI','pt1') "
            "ON CONFLICT (id) DO NOTHING")


def _zamowienie(oid="o1", order_no="YALCIN/Z/4/09/26", status="confirmed", qty=10, kg=30):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,%s,'c1','YBM Gastro GmbH','2026-09-18',"
        " '2026-09-18 08:00:00+00',%s)", (oid, order_no, status))
    execute(
        "INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, qty, "
        " kg_per_unit, total_kg) VALUES (%s,%s,'r1','pt1',%s,%s,%s)",
        (f"{oid}-l1", oid, qty, kg, qty * kg))
    return oid


def _paleta(pid, oid="o1", nr=1, status="created", vid=None, qty=5):
    execute(
        "INSERT INTO order_pallets (id, order_id, pallet_no, notes, status, "
        " loaded_vehicle_id) VALUES (%s,%s,%s,'',%s,%s)", (pid, oid, nr, status, vid))
    execute(
        "INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
        "VALUES (%s,%s,%s,%s)", (f"{pid}-i1", pid, f"{oid}-l1", qty))
    return pid


def _wyrob(gid="f1", qty=10, kg=30):
    """Towar NA STANIE — bez niego `finalize_loading` pomija zamówienie
    („brak załadowanych sztuk") i słusznie nie zdejmuje go z auta."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " client_id, client_name, produced_date) "
        "VALUES (%s,'180926 500','r1','KIRMIZI','pt1','KEBAB UDO 100%%',%s,%s,%s,%s,0,"
        " 'c1','YBM Gastro GmbH','2026-09-18')", (gid, qty, kg, qty * kg, qty))
    return gid


def _firma():
    execute("INSERT INTO app_settings (key, value) VALUES ('company', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"name": "F.H.U.P. MAREK KSIĘŻYC", "city": "Rudawa",
                         "address": "ul. Księżyca 83", "postalCode": "32-064",
                         "nip": "1234567890"}),))


def _baza_jednego_auta():
    _pojazd(); _slowniki(); _zamowienie()
    _paleta("p1", nr=1); _paleta("p2", nr=2)


# ── 1. Wybór zamówień na auto jest WSPÓLNY ────────────────────────────────
def test_wybor_zamowienia_widzi_drugie_urzadzenie(db):
    """A dopisuje zamówienie na auto — B widzi je BEZ żadnego skanu.

    Do 20.09.2026 zamówienie wybrane, ale jeszcze nieskanowane, nie istniało
    dla nikogo poza telefonem, który je wybrał.
    """
    _baza_jednego_auta()

    vehicle_loading_service.add_order("v1", "o1")          # urządzenie A

    stan = vehicle_loading_service.vehicle_state("v1")      # urządzenie B
    assert [o["id"] for o in stan["orders"]] == ["o1"]
    assert stan["totals"]["total_pallets"] == 2
    assert stan["totals"]["loaded_pallets"] == 0


def test_dopisanie_dwa_razy_nie_dubluje(db):
    """Dwa urządzenia dopisują to samo zamówienie — constraint, nie wyścig."""
    _baza_jednego_auta()

    vehicle_loading_service.add_order("v1", "o1")
    vehicle_loading_service.add_order("v1", "o1")

    assert len(vehicle_loading_service.vehicle_state("v1")["orders"]) == 1


def test_kolejnosc_zaladunku_jest_wspolna(db):
    """Kolejność ustawiona na A obowiązuje na B — też była tylko w telefonie."""
    _baza_jednego_auta()
    _zamowienie("o2", "DEMS/Z/9/09/26")
    _paleta("p3", oid="o2", nr=1)
    vehicle_loading_service.add_order("v1", "o1")
    vehicle_loading_service.add_order("v1", "o2")

    vehicle_loading_service.reorder("v1", ["o2", "o1"])

    stan = vehicle_loading_service.vehicle_state("v1")
    assert [o["id"] for o in stan["orders"]] == ["o2", "o1"]


def test_zdjecie_zamowienia_znika_u_wszystkich(db):
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")

    vehicle_loading_service.remove_order("v1", "o1")

    assert vehicle_loading_service.vehicle_state("v1")["orders"] == []


# ── 2. Zakończenie załadunku zdejmuje zamówienie WSZYSTKIM ────────────────
def test_zakonczenie_zaladunku_zdejmuje_zamowienie_wszystkim(db):
    """SEDNO ZGŁOSZENIA: A kończy załadunek → B nie ma już czego realizować."""
    _baza_jednego_auta()
    _firma(); _wyrob()
    vehicle_loading_service.add_order("v1", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")
    pallets_service.scan("PAL|o1|2", "loaded", vehicle_id="v1")

    finalize_loading("v1", ["o1"], plate="KR 99999")        # urządzenie A

    stan = vehicle_loading_service.vehicle_state("v1")      # urządzenie B
    assert stan["orders"] == [], "zamówienie zostało na ekranie drugiego skanera"


# ── 3. Jednoznaczny wynik skanu ───────────────────────────────────────────
def test_skan_zwraca_SUCCESS(db):
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")

    wynik = pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    assert wynik["result"] == "SUCCESS"


def test_drugi_skan_tej_samej_palety_to_ALREADY_SCANNED(db):
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    wynik = pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    assert wynik["result"] == "ALREADY_SCANNED"
    # i nie zalicza się drugi raz
    assert query_one("SELECT count(*) c FROM pallet_scans WHERE action='loaded'")["c"] == 1


def test_paleta_spoza_auta_to_WRONG_ORDER(db):
    """Przynależność palety do auta pilnuje BACKEND, nie React.

    Do teraz sprawdzał to wyłącznie front (`selectedIds.includes(...)`), więc
    drugi skaner — z inną listą w localStorage — przepuszczał paletę obcego
    zamówienia na auto.
    """
    _baza_jednego_auta()
    _zamowienie("o2", "DEMS/Z/9/09/26")
    _paleta("p9", oid="o2", nr=1)
    vehicle_loading_service.add_order("v1", "o1")           # o2 NIE jest na aucie

    with pytest.raises(HTTPException) as exc:
        pallets_service.scan("PAL|o2|1", "loaded", vehicle_id="v1")

    assert exc.value.detail["code"] == "WRONG_ORDER"
    assert query_one("SELECT status FROM order_pallets WHERE id='p9'")["status"] == "created"


def test_paleta_juz_wyslana_to_ALREADY_COMPLETED(db):
    _baza_jednego_auta()
    execute("UPDATE order_pallets SET status='shipped' WHERE id='p1'")
    vehicle_loading_service.add_order("v1", "o1")

    with pytest.raises(HTTPException) as exc:
        pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    assert exc.value.detail["code"] == "ALREADY_COMPLETED"


def test_nieistniejaca_paleta_to_INVALID(db):
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")

    with pytest.raises(HTTPException) as exc:
        pallets_service.scan("PAL|o1|77", "loaded", vehicle_id="v1")

    assert exc.value.detail["code"] == "INVALID"


# ── 4. Atomowość — dwa skanery, jedna paleta ──────────────────────────────
def test_rownoczesny_skan_z_dwoch_urzadzen_zalicza_raz(db):
    """TEST 5 ze zgłoszenia: A i B skanują tę samą paletę praktycznie naraz.

    Odczyt statusu był POZA transakcją, więc oba wątki przechodziły walidację
    i oba pisały — wygrywał ostatni, a `pallet_scans` dostawał dwa wiersze.
    """
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")

    start = threading.Barrier(2)
    wyniki: list = []
    zamek = threading.Lock()

    def skanuj(vid: str):
        start.wait(timeout=10)
        try:
            r = pallets_service.scan("PAL|o1|1", "loaded", vehicle_id=vid)
            with zamek:
                wyniki.append(r["result"])
        except HTTPException as e:
            with zamek:
                wyniki.append(e.detail["code"] if isinstance(e.detail, dict) else "ERROR")

    # DWA URZĄDZENIA, JEDNO AUTO — dokładnie scenariusz ze zgłoszenia.
    watki = [threading.Thread(target=skanuj, args=("v1",)) for _ in range(2)]
    for w in watki:
        w.start()
    for w in watki:
        w.join(timeout=20)

    assert sorted(wyniki) == ["ALREADY_SCANNED", "SUCCESS"], f"otrzymano {wyniki}"
    wiersze = query_all("SELECT id FROM pallet_scans WHERE action='loaded'")
    assert len(wiersze) == 1, "paleta zaliczona dwa razy"


# ── 5. Lista aktywnych = tylko to, co wymaga działania ────────────────────
def test_lista_aktywnych_pomija_zrealizowane_i_anulowane(db):
    """Na produkcji 20.09.2026: 24 zamówienia na liście skanera, 17 `done`.

    `active_orders_for_loading` było JEDYNYM miejscem w MES bez filtra
    `status NOT IN ('done','cancelled')`.
    """
    _pojazd(); _slowniki()
    _zamowienie("o1", "AKTYWNE/Z/1/09/26", status="confirmed")
    _paleta("p1", oid="o1", nr=1)
    _zamowienie("o2", "ZROBIONE/Z/2/09/26", status="done")
    _paleta("p2", oid="o2", nr=1)
    _zamowienie("o3", "ANULOWANE/Z/3/09/26", status="cancelled")
    _paleta("p3", oid="o3", nr=1)

    aktywne = [o["order_no"] for o in pallets_service.active_orders_for_loading()]

    assert aktywne == ["AKTYWNE/Z/1/09/26"]


def test_historia_pokazuje_zrealizowane_osobno(db):
    """Historia istnieje, ale jako osobny widok — nie zaśmieca panelu."""
    _pojazd(); _slowniki()
    _zamowienie("o1", "AKTYWNE/Z/1/09/26", status="confirmed")
    _paleta("p1", oid="o1", nr=1)
    _zamowienie("o2", "ZROBIONE/Z/2/09/26", status="done")
    _paleta("p2", oid="o2", nr=1)

    historia = [o["order_no"] for o in pallets_service.active_orders_for_loading(include_done=True)]

    assert "ZROBIONE/Z/2/09/26" in historia


# ── 6. Migawka stanu auta jest SPÓJNA (jeden odczyt, nie N+1) ─────────────
def test_migawka_auta_zawiera_palety_i_sumy(db):
    """Front nie może składać stanu z N osobnych odpowiedzi — rwie się."""
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    stan = vehicle_loading_service.vehicle_state("v1")

    zam = stan["orders"][0]
    assert zam["order_no"] == "YALCIN/Z/4/09/26"
    assert [p["pallet_no"] for p in zam["pallets"]] == [1, 2]
    assert zam["totals"]["loaded_pallets"] == 1
    assert zam["totals"]["total_pallets"] == 2
    assert stan["vehicle"]["id"] == "v1"


def test_cofniecie_skanu_wraca_do_wszystkich(db):
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    pallets_service.scan("PAL|o1|1", "undo")

    stan = vehicle_loading_service.vehicle_state("v1")
    assert stan["orders"][0]["totals"]["loaded_pallets"] == 0


def test_zrealizowanego_zamowienia_nie_da_sie_wciagnac_na_auto(db):
    """Widok „Historia" pokazuje zrealizowane — ale wciągnąć ich nie wolno.

    `done` znaczy, że wszystkie pozycje są wydane, więc nie ma czego ładować.
    """
    _pojazd(); _slowniki()
    _zamowienie("o9", "ZROBIONE/Z/9/09/26", status="done")
    _paleta("p9", oid="o9", nr=1)

    with pytest.raises(HTTPException) as exc:
        vehicle_loading_service.add_order("v1", "o9")

    assert exc.value.status_code == 409
    assert vehicle_loading_service.vehicle_state("v1")["orders"] == []


def test_zamowienie_bez_palet_nie_wywraca_migawki(db):
    """Biuro jeszcze nie rozpisało palet — ekran ma to przeżyć.

    Pusta lista w `ANY(%s)` bez rzutowania typu wywracała psycopg2.
    """
    _pojazd(); _slowniki()
    _zamowienie("o7", "BEZPALET/Z/7/09/26")

    vehicle_loading_service.add_order("v1", "o7")

    stan = vehicle_loading_service.vehicle_state("v1")
    assert stan["orders"][0]["pallets"] == []
    assert stan["totals"]["total_pallets"] == 0


def test_nie_zdejmiesz_zamowienia_z_paletami_na_aucie(db):
    """Zdjęcie zamówienia zostawiłoby załadowane palety w powietrzu."""
    _baza_jednego_auta()
    vehicle_loading_service.add_order("v1", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    with pytest.raises(HTTPException) as exc:
        vehicle_loading_service.remove_order("v1", "o1")

    assert exc.value.status_code == 409
    assert len(vehicle_loading_service.vehicle_state("v1")["orders"]) == 1


def test_paleta_z_innego_auta_nie_udaje_powtorzonego_skanu(db):
    """Zamówienie dzielone na dwa auta: paleta wzięta na złe auto.

    Zanim powstał kod ON_OTHER_VEHICLE, backend mówił „ALREADY_SCANNED"
    (bo status faktycznie był już `loaded`), więc operator drugiego samochodu
    szedł dalej przekonany, że paleta mu się zaliczyła — a ona jechała
    gdzie indziej i u niego nigdy się nie pokazała.
    """
    _baza_jednego_auta()
    _pojazd("v2", "SOLÓWKA 2", "KR 22222")
    vehicle_loading_service.add_order("v1", "o1")
    vehicle_loading_service.add_order("v2", "o1")
    pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v1")

    with pytest.raises(HTTPException) as exc:
        pallets_service.scan("PAL|o1|1", "loaded", vehicle_id="v2")

    assert exc.value.detail["code"] == "ON_OTHER_VEHICLE"
    # Komunikat nazywa auto, na którym paleta NAPRAWDĘ stoi — nazwę bierzemy
    # z bazy, bo `vehicles` nie jest czyszczone między plikami testowymi
    # i `ON CONFLICT DO NOTHING` mógł zachować nazwę z wcześniejszego zasiewu.
    nazwa_v1 = query_one("SELECT name FROM vehicles WHERE id='v1'")["name"]
    assert nazwa_v1 in exc.value.detail["message"]
    # Paleta ZOSTAJE na pierwszym aucie.
    assert query_one(
        "SELECT loaded_vehicle_id v FROM order_pallets WHERE id='p1'")["v"] == "v1"
