"""Pakowanie na kiosku magazynu — routing sztuki do właściwego kartonu.

Spec §5.3: aktywny karton to DOMYSŁ, nie zamek. Trzy ścieżki:
pasuje do aktywnego → tam; pasuje do innego otwartego → tam (i ekran mówi
który); nie pasuje do żadnego → brak zapisu. Plus sedno całego projektu:
sztuka klienta A NIE może wejść do kartonu klienta B.

Daty względne (kebab-fixture-daty-wzgledne) — pula dzieli się po dniach.
"""
from datetime import date, timedelta

import pytest

from app.db import execute, query_one
from app.models.production import StockCartonCreate
from app.services.magazyn_pakowanie_service import (
    kolejnosc_kandydatow, podsumowanie_kafli, pula_do_spakowania,
    skanuj_sztuke, stan_pakowania,
)
from app.services.stock_cartons_service import create_stock_carton
from app.utils.ids import now_iso
from app.utils.unit_codes import unit_qr

DZIS = date.today()


def _dzien(n: int) -> str:
    return (DZIS - timedelta(days=n)).isoformat()


def _receptury():
    execute("INSERT INTO recipes (id, name) VALUES ('r1','KIRMIZI'), ('r2','YAPRAK') "
            "ON CONFLICT (id) DO NOTHING")


def _sztuka(uid, *, client="YALCIN", recipe="r1", ptype="p1", tuleja="METAL 80",
            kg=15.0, status="produced", produced=None):
    execute(
        "INSERT INTO finished_units (id, qr_code, status, recipe_id, product_type_id, "
        " tuleja, weight_kg, client_name, batch_no, produced_date, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'200926 1',%s,%s)",
        (uid, unit_qr(uid), status, recipe, ptype, tuleja, kg, client,
         produced or _dzien(1), now_iso()),
    )


def _karton(client, qty=3, recipe="r1", kg=15.0, client_id=None):
    return create_stock_carton(StockCartonCreate(
        client_id=client_id or client.lower(), client_name=client,
        recipe_id=recipe, recipe_name="KIRMIZI" if recipe == "r1" else "YAPRAK",
        product_type_id="p1", product_type_name="UDO 100%",
        packaging_id="t80", packaging_name="METAL 80", qty=qty, kg_per_unit=kg))


def _paleta(oid, client, qty=2, recipe="r1", kg=15.0, carton_no=900):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (id) DO NOTHING", (client.lower(), client, client, client))
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
            " created_at, status, delivery_date) VALUES (%s,%s,%s,%s,%s,now(),'confirmed',%s)",
            (oid, f"{client}/Z/1", client.lower(), client, _dzien(2), DZIS.isoformat()))
    execute("INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, "
            " product_type_id, qty, kg_per_unit, total_kg) VALUES (%s,%s,%s,'KIRMIZI','p1',%s,%s,%s)",
            (f"{oid}-l1", oid, recipe, qty, kg, qty * kg))
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, notes, status, carton_no) "
            "VALUES (%s,%s,1,'','created',%s)", (f"{oid}-p1", oid, carton_no))
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
            "VALUES (%s,%s,%s,%s)", (f"{oid}-i1", f"{oid}-p1", f"{oid}-l1", qty))
    return f"{oid}-p1"


# ── Trzy ścieżki §5.3 ─────────────────────────────────────────────────────

def test_sztuka_do_aktywnego_kartonu(db):
    _receptury()
    k = _karton("YALCIN")
    _sztuka("u1")
    w = skanuj_sztuke(unit_qr("u1"), k["id"])
    assert w["result"] == "ACTIVE"
    assert w["container"]["id"] == k["id"]
    assert w["container"]["packedQty"] == 1
    assert query_one("SELECT carton_id FROM finished_units WHERE id='u1'")["carton_id"] == k["id"]


def test_sztuka_innego_klienta_idzie_do_JEGO_kartonu(db):
    """Sedno projektu: wózek mieszany, sztuka DEM'S przy kartonie YALCIN."""
    _receptury()
    yalcin = _karton("YALCIN")
    dems = _karton("DEMS")
    _sztuka("u1", client="DEMS")
    w = skanuj_sztuke(unit_qr("u1"), yalcin["id"])
    assert w["result"] == "OTHER"
    assert w["container"]["id"] == dems["id"]
    assert query_one("SELECT carton_id FROM finished_units WHERE id='u1'")["carton_id"] == dems["id"]
    assert int(query_one("SELECT packed_qty FROM stock_cartons WHERE id=%s",
                         (yalcin["id"],))["packed_qty"]) == 0


def test_sztuka_bez_miejsca_nie_jest_zapisywana(db):
    _receptury()
    k = _karton("YALCIN")
    _sztuka("u1", client="BULLI")
    w = skanuj_sztuke(unit_qr("u1"), k["id"])
    assert w["result"] == "NO_PLACE"
    assert "BULLI" in w["unit"]
    r = query_one("SELECT carton_id, pallet_id, status FROM finished_units WHERE id='u1'")
    assert r["carton_id"] is None and r["pallet_id"] is None and r["status"] == "produced"


def test_inna_waga_tego_samego_klienta_nie_wchodzi(db):
    _receptury()
    k = _karton("YALCIN", kg=15.0)
    _sztuka("u1", kg=10.0)
    assert skanuj_sztuke(unit_qr("u1"), k["id"])["result"] == "NO_PLACE"


def test_pelny_karton_przelewa_do_nastepnego_tego_klienta(db):
    _receptury()
    k1 = _karton("YALCIN", qty=1)
    _sztuka("u1"); _sztuka("u2")
    assert skanuj_sztuke(unit_qr("u1"), k1["id"])["full"] is True
    # Drugi karton o tym samym składzie wolno założyć dopiero po spakowaniu pierwszego.
    k2 = _karton("YALCIN", qty=1)
    w = skanuj_sztuke(unit_qr("u2"), k1["id"])
    assert w["result"] == "ACTIVE"          # aktywny zamknięty → nie wołamy „inny karton"
    assert w["activeClosed"] is True
    assert w["container"]["id"] == k2["id"]


def test_ta_sama_sztuka_drugi_raz_to_ALREADY(db):
    _receptury()
    k = _karton("YALCIN")
    _sztuka("u1")
    skanuj_sztuke(unit_qr("u1"), k["id"])
    w = skanuj_sztuke(unit_qr("u1"), k["id"])
    assert w["result"] == "ALREADY"
    assert w["sameCarton"] is True
    assert w["where"] == w["where"].strip() and w["where"]
    assert int(query_one("SELECT packed_qty FROM stock_cartons WHERE id=%s",
                         (k["id"],))["packed_qty"]) == 1


def test_niewyprodukowana_i_nieznana(db):
    _receptury()
    _karton("YALCIN")
    _sztuka("u1", status="planned")
    assert skanuj_sztuke(unit_qr("u1"))["result"] == "NOT_PRODUCED"
    assert skanuj_sztuke("PAL|cos|1")["result"] == "INVALID"
    assert skanuj_sztuke(unit_qr("brak"))["result"] == "INVALID"


def test_bez_aktywnego_pierwszy_pasujacy_staje_sie_aktywnym(db):
    _receptury()
    k = _karton("YALCIN")
    _sztuka("u1")
    w = skanuj_sztuke(unit_qr("u1"), None)
    assert w["result"] == "ACTIVE" and w["container"]["id"] == k["id"]


# ── Palety zamówień to też „otwarte kartony" ──────────────────────────────

def test_sztuka_trafia_na_palete_zamowienia_klienta(db):
    _receptury()
    k = _karton("DEMS")
    pid = _paleta("o1", "YALCIN")
    _sztuka("u1")
    w = skanuj_sztuke(unit_qr("u1"), k["id"])
    assert w["result"] == "OTHER"
    assert w["container"]["kind"] == "order" and w["container"]["id"] == pid
    assert query_one("SELECT pallet_id FROM finished_units WHERE id='u1'")["pallet_id"] == pid


def test_aktywny_wygrywa_z_innym_pasujacym(db):
    """Dwa kartony tego samego klienta i składu: sztuka idzie do AKTYWNEGO,
    nawet gdy drugi ma niższy numer."""
    _receptury()
    pid = _paleta("o1", "YALCIN", carton_no=1)
    k = _karton("YALCIN")
    _sztuka("u1")
    w = skanuj_sztuke(unit_qr("u1"), k["id"])
    assert w["result"] == "ACTIVE" and w["container"]["id"] == k["id"]
    assert pid  # paleta dalej pusta
    assert query_one("SELECT COUNT(*) AS n FROM finished_units WHERE pallet_id=%s",
                     (pid,))["n"] == 0


# ── Pula „do spakowania" ──────────────────────────────────────────────────

def test_pula_po_dniach_najstarsze_pierwsze_i_znika_po_spakowaniu(db):
    _receptury()
    k = _karton("YALCIN", qty=5)
    _sztuka("u1", produced=_dzien(1)); _sztuka("u2", produced=_dzien(1))
    _sztuka("u3", produced=_dzien(4), client="DEMS", recipe="r2", kg=25.0)
    pula = pula_do_spakowania()
    assert [p["producedDate"] for p in pula] == [_dzien(4), _dzien(1)]
    assert pula[0]["recipeName"] == "YAPRAK" and pula[0]["qty"] == 1
    assert pula[1]["qty"] == 2

    skanuj_sztuke(unit_qr("u1"), k["id"])
    assert sum(p["qty"] for p in pula_do_spakowania()) == 2

    kafle = podsumowanie_kafli(DZIS)
    assert kafle["kartony"]["zalegle"] == 1          # sztuka sprzed 4 dni
    assert kafle["kartony"]["sztukDoSpakowania"] == 2


def test_stan_pakowania_niesie_kartony_z_pozycjami(db):
    _receptury()
    _karton("YALCIN", qty=4)
    _paleta("o1", "DEMS", qty=2)
    s = stan_pakowania()
    assert len(s["kontenery"]) == 2
    rodzaje = sorted(k["kind"] for k in s["kontenery"])
    assert rodzaje == ["order", "stock"]
    for k in s["kontenery"]:
        assert k["lines"] and k["lines"][0]["kgPerUnit"] == 15.0
        assert "product_type_id" not in k["lines"][0]   # pola routingu nie wychodzą


def test_wydanie_na_dzis_liczy_kilogramy_z_terminow(db):
    _paleta("o1", "YALCIN", qty=4, kg=15.0)
    w = podsumowanie_kafli(DZIS)["wydanie"]
    assert w["zamowien"] == 1 and w["kg"] == pytest.approx(60.0)


# ── Czysta kolejność ──────────────────────────────────────────────────────

def test_kolejnosc_kandydatow_czysta():
    unit = {"client_name": "YALCIN", "recipe_id": "r1", "product_type_id": "p1",
            "tuleja": "T", "weight_kg": 15}
    ln = [{"recipe_id": "r1", "product_type_id": "p1", "packaging_name": "T",
           "kg_per_unit": 15, "target_qty": 5, "packed_qty": 0}]
    kont = [
        {"id": "mag", "kind": "stock", "clientName": "na magazyn", "cartonNoInt": 1, "lines": ln},
        {"id": "yal", "kind": "stock", "clientName": "YALCIN", "cartonNoInt": 7, "lines": ln},
        {"id": "dem", "kind": "stock", "clientName": "DEMS", "cartonNoInt": 2, "lines": ln},
    ]
    # Bez aktywnego: najpierw imienny karton klienta, potem „na magazyn".
    assert [k["id"] for k in kolejnosc_kandydatow(unit, kont, None)] == ["yal", "mag"]
    # Aktywny „na magazyn" wygrywa z imiennym.
    assert [k["id"] for k in kolejnosc_kandydatow(unit, kont, "mag")] == ["mag", "yal"]


def test_podglad_kafli_niesie_dni_klientow_i_mroznie(db):
    _receptury()
    _paleta("o1", "YALCIN", qty=4, kg=15.0)
    execute("UPDATE order_pallets SET status='cold_storage' WHERE id='o1-p1'")
    _sztuka("u1", produced=_dzien(5)); _sztuka("u2", produced=_dzien(1))
    k = podsumowanie_kafli(DZIS)
    assert [d["zalegle"] for d in k["kartony"]["dni"]] == [True, False]
    assert k["wydanie"]["lista"] == [{"klient": "YALCIN", "kg": 60.0}]
    assert k["mroznia"] == {"palet": 1, "lista": [{"klient": "YALCIN", "palet": 1}]}


# Właściciel 25.09.2026: pełny karton ma się zrobić zielony z poleceniem
# „zeskanuj i wjedź do mroźni" — nie może po prostu zniknąć z ekranu.
def test_pelna_paleta_czeka_na_mroznie_do_skanu(db):
    _receptury()
    pid = _paleta("o1", "YALCIN", qty=1)
    _sztuka("u1")
    w = skanuj_sztuke(unit_qr("u1"), pid)
    assert w["full"] is True
    s = stan_pakowania()
    assert [k["id"] for k in s["kontenery"]] == []
    assert [k["id"] for k in s["spakowane"]] == [pid]
    assert s["spakowane"][0]["packedQty"] == 1
    execute("UPDATE order_pallets SET status='cold_storage' WHERE id=%s", (pid,))
    assert stan_pakowania()["spakowane"] == []


def test_pelny_karton_magazynowy_zielony_do_mrozni_potem_znika(db):
    """Właściciel 25.09.2026: po zakończeniu zielony, po wjeździe do mroźni
    znika z widoku pakowania i jest widoczny w mroźni."""
    from app.services.magazyn_pakowanie_service import (
        kartony_w_mrozni, wstaw_karton_do_mrozni)
    _receptury()
    k = _karton("YALCIN", qty=1)
    _sztuka("u1")
    assert wstaw_karton_do_mrozni(f"SCARTON|{k['id']}")["result"] == "NOT_FULL"
    skanuj_sztuke(unit_qr("u1"), k["id"])
    assert [x["id"] for x in stan_pakowania()["spakowane"]] == [k["id"]]

    assert wstaw_karton_do_mrozni(f"SCARTON|{k['id']}")["result"] == "SUCCESS"
    assert stan_pakowania()["spakowane"] == []
    assert [x["id"] for x in kartony_w_mrozni()] == [k["id"]]
    assert kartony_w_mrozni()[0]["kg"] == 15.0
    assert wstaw_karton_do_mrozni(f"SCARTON|{k['id']}")["result"] == "ALREADY_SCANNED"
    assert podsumowanie_kafli(DZIS)["mroznia"]["palet"] == 1


def test_kafel_liczy_kartony_do_spakowania_i_do_dokonczenia(db):
    _receptury()
    k1 = _karton("YALCIN", qty=3)
    _karton("DEMS", qty=2)
    _paleta("o1", "TRUVA", qty=2)
    _sztuka("u1")
    skanuj_sztuke(unit_qr("u1"), k1["id"])
    kart = podsumowanie_kafli(DZIS)["kartony"]
    assert kart["doSpakowania"] == 2          # DEMS + paleta TRUVA, nietknięte
    assert kart["doDokonczenia"] == 1         # YALCIN 1/3
    assert kart["zaczete"][0]["klient"] == "YALCIN"
    assert kart["zaczete"][0]["packedQty"] == 1


# Hala 25.09.2026: karton ZAGROS 40×20 kg, dziś wyprodukowane 40×20 kg — panel
# „nie pasuje do tego kartonu". W kartotece klient ma name „OKAYTEKIN KG"
# i display_name „ZAGROS": sztuka niosła pełną nazwę, zamówienie skróconą,
# a porównanie szło po NAPISIE. Klient to tożsamość z kartoteki, nie tekst.
def _klient_z_dwiema_nazwami(cid, nazwa, wyswietlana):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name",
            (cid, cid.upper(), nazwa, wyswietlana))


def test_sztuka_z_pelna_nazwa_firmy_wchodzi_na_palete_skrotu(db):
    _receptury()
    _klient_z_dwiema_nazwami("zagros", "OKAYTEKIN KG", "ZAGROS")
    pid = _paleta("o1", "ZAGROS", qty=40, kg=20.0)   # client_id='zagros'
    _sztuka("u1", client="OKAYTEKIN KG", kg=20.0)
    w = skanuj_sztuke(unit_qr("u1"), pid)
    assert w["result"] == "ACTIVE", w
    assert query_one("SELECT pallet_id FROM finished_units WHERE id='u1'")["pallet_id"] == pid


def test_sztuka_z_pelna_nazwa_wchodzi_do_kartonu_magazynowego(db):
    _receptury()
    _klient_z_dwiema_nazwami("nazar", "YAZGI KG", "NAZAR")
    k = _karton("NAZAR", qty=4, kg=15.0, client_id="nazar")
    _sztuka("u1", client="YAZGI KG")
    assert skanuj_sztuke(unit_qr("u1"), k["id"])["result"] == "ACTIVE"


def test_inny_klient_dalej_odbity(db):
    _receptury()
    _klient_z_dwiema_nazwami("zagros", "OKAYTEKIN KG", "ZAGROS")
    _klient_z_dwiema_nazwami("nazar", "YAZGI KG", "NAZAR")
    pid = _paleta("o1", "ZAGROS", qty=40, kg=20.0)
    _sztuka("u1", client="YAZGI KG", kg=20.0)
    assert skanuj_sztuke(unit_qr("u1"), pid)["result"] == "NO_PLACE"


def test_pakowanie_z_telefonu_tez_rozumie_dwie_nazwy(db):
    """Ta sama reguła na ścieżce telefonu (`pack_unit_into_pallet`)."""
    from app.services.pallets_service import pack_unit_into_pallet
    _receptury()
    _klient_z_dwiema_nazwami("zagros", "OKAYTEKIN KG", "ZAGROS")
    pid = _paleta("o1", "ZAGROS", qty=40, kg=20.0)
    _sztuka("u1", client="OKAYTEKIN KG", kg=20.0)
    assert pack_unit_into_pallet(pid, unit_qr("u1"))["ok"] is True
