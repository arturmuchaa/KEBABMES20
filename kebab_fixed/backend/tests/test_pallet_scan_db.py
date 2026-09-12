"""Skan kartki palety — jakie przejścia statusu są dozwolone.

Biuro (2026-09-09, dzień przed załadunkiem YALCIN/Z/4): „w skanerze paleta nie
ma statusu created i nie mogę dać na storage, czy to nie zablokuje załadunku
samochodu, jeżeli nie jest na mroźni?".

Zablokowałoby. Reguła przejść wymagała statusu `packed` przed mroźnią i mroźni
przed autem, a `packed` powstaje WYŁĄCZNIE przy skanowaniu pojedynczych sztuk —
ścieżki, której zakład nie używa („nie mamy możliwości", 2026-09-09). Wszystkie
66 palet na produkcji stało w statusie `created`, więc każdy skan kończyłby się
błędem 409.

Dwie reguły, które z tego wynikają:
  * paleta ROZPISANA (`created`) jedzie do mroźni i na auto — skan kartki jest
    potwierdzeniem, że karton jest spakowany zgodnie z zamówieniem;
  * MROŹNIA JEST OPCJONALNA — towar bywa ładowany prosto z hali, zwłaszcza gdy
    kierowca wyjeżdża w nocy.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import pytest

from app.db import execute, query_one
from app.services import pallets_service


def _zamowienie(oid="o1", nr="YALCIN/Z/4/09/26"):
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('c1','YAL','YBM Gastro GmbH','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
            " created_at, status) VALUES (%s,%s,'c1','YBM Gastro GmbH','2026-09-08',"
            " '2026-09-08 08:00:00+00','confirmed')", (oid, nr))
    return oid


def _paleta(pid="p1", oid="o1", nr=1, status="created"):
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, notes, status) "
            "VALUES (%s,%s,%s,'',%s)", (pid, oid, nr, status))
    return pid


def _pojazd(vid="v1"):
    execute("INSERT INTO vehicles (id, name, plate, active) "
            "VALUES (%s,'Chłodnia 1','KR 12345',true) ON CONFLICT (id) DO NOTHING", (vid,))
    return vid


def _status(pid="p1"):
    return query_one("SELECT status FROM order_pallets WHERE id=%s", (pid,))["status"]


KOD = "PAL|o1|1"


class TestRozpisanaPaletaJedzie:
    """Paleta w statusie `created` — stan, w jakim są WSZYSTKIE palety zakładu."""

    def test_rozpisana_paleta_wchodzi_do_mrozni(self, db):
        _zamowienie(); _paleta()
        pallets_service.scan(KOD, "cold_storage")
        assert _status() == "cold_storage"

    def test_rozpisana_paleta_idzie_PROSTO_na_auto(self, db):
        """Mroźnia jest opcjonalna — nocny wyjazd nie czeka na nią."""
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        assert _status() == "loaded"

    def test_paleta_z_mrozni_dalej_wchodzi_na_auto(self, db):
        _zamowienie(); _paleta(status="cold_storage"); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        assert _status() == "loaded"

    def test_paleta_spakowana_sztukami_tez_dziala(self, db):
        """Gdy zakład wróci do skanowania sztuk, ścieżka `packed` ma nadal działać."""
        _zamowienie(); _paleta(status="packed"); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        assert _status() == "loaded"


class TestCoNadalJestZabronione:
    def test_wyslanej_palety_nie_laduje_sie_drugi_raz(self, db):
        _zamowienie(); _paleta(status="shipped"); _pojazd()
        with pytest.raises(Exception) as e:
            pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        assert "shipped" in str(e.value)

    def test_zaladowanej_palety_nie_cofa_sie_do_mrozni(self, db):
        """Cofnięcie statusu to korekta dla biura, nie skan na hali."""
        _zamowienie(); _paleta(status="loaded")
        with pytest.raises(Exception) as e:
            pallets_service.scan(KOD, "cold_storage")
        assert "loaded" in str(e.value)

    def test_nieistniejaca_paleta_daje_czytelny_blad(self, db):
        _zamowienie()
        with pytest.raises(Exception) as e:
            pallets_service.scan("PAL|o1|99", "loaded")
        assert "99" in str(e.value)

    def test_nieaktywny_pojazd_jest_odrzucany(self, db):
        _zamowienie(); _paleta()
        execute("INSERT INTO vehicles (id, name, plate, active) "
                "VALUES ('v9','Złomek','KR 00000',false) ON CONFLICT (id) DO NOTHING")
        with pytest.raises(Exception) as e:
            pallets_service.scan(KOD, "loaded", vehicle_id="v9")
        assert "nieaktywny" in str(e.value).lower()


class TestPowtorzonySkan:
    def test_drugi_skan_tej_samej_akcji_nie_jest_bledem(self, db):
        """Magazynier skanuje kartkę dwa razy — to nie powód do alarmu."""
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        assert _status() == "loaded"

    def test_skan_zapisuje_slad_kto_i_czym(self, db):
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "loaded", operator="MAGAZYNIER", vehicle_id="v1")
        slad = query_one(
            "SELECT action, operator, vehicle_id FROM pallet_scans WHERE pallet_id='p1'")
        assert (slad["action"], slad["operator"], slad["vehicle_id"]) == (
            "loaded", "MAGAZYNIER", "v1")


class TestCofniecieSkanu:
    """Biuro (2026-09-09): „zeskanowałem palety na samochód przez przypadek,
    a chciałem na mroźnię (…) czy możesz cofnąć i w razie pomyłki dać też
    »wróć paletę«, jeżeli źle załadowana".

    Pomyłka przy skanowaniu jest normalna — magazynier trzyma telefon w jednej
    ręce, a paletę w drugiej. Cofnięcie musi być w skanerze, nie w bazie.
    """

    def test_cofa_zaladowana_palete_do_stanu_przed_skanem(self, db):
        _zamowienie(); _paleta(status="created"); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        pallets_service.scan(KOD, "undo")
        assert _status() == "created"

    def test_cofniecie_zdejmuje_palete_z_samochodu(self, db):
        """Inaczej paleta wisi na aucie, z którego ją zdjęto."""
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        pallets_service.scan(KOD, "undo")
        p = query_one("SELECT loaded_at, loaded_vehicle_id FROM order_pallets WHERE id='p1'")
        assert p["loaded_at"] is None and p["loaded_vehicle_id"] is None

    def test_cofa_z_mrozni_do_stanu_przed_skanem(self, db):
        _zamowienie(); _paleta()
        pallets_service.scan(KOD, "cold_storage")
        pallets_service.scan(KOD, "undo")
        assert _status() == "created"
        assert query_one("SELECT cold_storage_at FROM order_pallets WHERE id='p1'")["cold_storage_at"] is None

    def test_cofniecie_zaladunku_wraca_do_mrozni_gdy_tam_byla(self, db):
        """Paleta, która przeszła przez mroźnię, wraca DO MROŹNI, nie do hali."""
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "cold_storage")
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        pallets_service.scan(KOD, "undo")
        assert _status() == "cold_storage"

    def test_cofniecie_zostawia_slad(self, db):
        """Kontrola musi widzieć, że ktoś cofnął skan."""
        _zamowienie(); _paleta(); _pojazd()
        pallets_service.scan(KOD, "loaded", vehicle_id="v1")
        pallets_service.scan(KOD, "undo", operator="MAGAZYNIER")
        slad = query_one(
            "SELECT action, operator FROM pallet_scans WHERE pallet_id='p1' "
            "AND action='undo'")
        assert slad is not None and slad["operator"] == "MAGAZYNIER"

    def test_nie_cofa_palety_ktora_nigdy_nie_byla_skanowana(self, db):
        _zamowienie(); _paleta(status="created")
        with pytest.raises(Exception) as e:
            pallets_service.scan(KOD, "undo")
        assert "nie ma czego cofać" in str(e.value).lower() or "created" in str(e.value)

    def test_NIE_cofa_palety_juz_wyslanej(self, db):
        """Po wystawieniu dokumentu towar zszedł ze stanu — cofnięcie skanem
        rozjechałoby magazyn z papierem. To robota dla biura."""
        _zamowienie(); _paleta(status="shipped")
        with pytest.raises(Exception) as e:
            pallets_service.scan(KOD, "undo")
        assert "wysłan" in str(e.value).lower() or "shipped" in str(e.value)


# ── Co stoi na TYM aucie — wspólna prawda dla wszystkich telefonów ────
#
# Biuro (12.09.2026): „na biuro pokazuje wybrane zamówienia na samochodzie,
# a z telefonu, że nie ma wybranych". Przyczyna: lista zamówień pojazdu
# siedziała w `localStorage` TEGO telefonu, więc drugi skaner widział pustkę.
# Skan zawsze szedł na serwer — brakowało pytania o to, co serwer już wie.
def _pojazd_i_zamowienie(vid="v1", oid="o1", nr="Z/1/09/26"):
    execute("INSERT INTO vehicles (id, name, plate, active) "
            "VALUES (%s,'Dostawczy','KR 12345',true) "
            "ON CONFLICT (id) DO NOTHING", (vid,))
    execute("INSERT INTO client_orders (id, order_no, client_name, order_date, status) "
            "VALUES (%s,%s,'ODBIORCA','2026-09-12','confirmed')", (oid, nr))


def _paleta_na_aucie(pid, oid, nr, vid):
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, status, "
            " loaded_vehicle_id, loaded_at) VALUES (%s,%s,%s,'loaded',%s,now())",
            (pid, oid, nr, vid))


def test_auto_oddaje_zamowienia_ktore_na_nim_stoja(db):
    from app.services.pallets_service import orders_on_vehicle
    _pojazd_i_zamowienie()
    _paleta_na_aucie("p1", "o1", 1, "v1")

    wynik = orders_on_vehicle("v1")

    assert [r["id"] for r in wynik] == ["o1"]
    assert wynik[0]["loaded_pallets"] == 1


def test_paleta_z_INNEGO_auta_nie_wchodzi(db):
    from app.services.pallets_service import orders_on_vehicle
    _pojazd_i_zamowienie()
    execute("INSERT INTO vehicles (id, name, plate, active) "
            "VALUES ('v2','Chlodnia','KR 99999',true) ON CONFLICT (id) DO NOTHING")
    _paleta_na_aucie("p1", "o1", 1, "v2")

    assert orders_on_vehicle("v1") == []


def test_paleta_w_mrozni_nie_jest_na_aucie(db):
    from app.services.pallets_service import orders_on_vehicle
    _pojazd_i_zamowienie()
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, status, cold_storage_at) "
            "VALUES ('p1','o1',1,'cold_storage',now())")

    assert orders_on_vehicle("v1") == []


def test_cofniecie_palety_zdejmuje_zamowienie_z_auta(db):
    """To jest cały sens synchronizacji: osoba B cofa, osoba C od razu widzi."""
    from app.services.pallets_service import orders_on_vehicle, scan
    _pojazd_i_zamowienie()
    _paleta_na_aucie("p1", "o1", 1, "v1")
    assert len(orders_on_vehicle("v1")) == 1

    scan(KOD, "undo", operator="magazyn")

    assert orders_on_vehicle("v1") == []
