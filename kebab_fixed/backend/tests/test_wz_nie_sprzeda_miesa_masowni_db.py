"""Biuro nie sprzeda mięsa, które hala wzięła już do masowania.

POWÓD ISTNIENIA (17.09.2026, słowa właściciela): „nie może być sytuacji, że
wsadzone do masownicy 600 kg, a biuro nagle wystawia z tego mięsa WZ".

Mięso zważone zbiorczo na palety jest przeznaczone do masowania, a mięso
stojące w masownicy fizycznie już nie istnieje jako surowiec — księgowanie
zejdzie z niego dopiero przy odbiorze, więc przez 50 minut cyklu magazyn
pokazuje je jako wolne. Bez tej bramki WZ zdjąłby je drugi raz.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.masownia import ChargeCreate, ChargeMeatDto
from app.services import masownia_service as mas
from app.services.wz_service import kg_zablokowane_dla_masowni
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _partia(lot_no="511", kg=1000.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-09-17", "2026-10-01"))
    return ms_id


def _paleta(pallet_no, kg, lot_no):
    pid = cuid()
    execute("INSERT INTO meat_pallets (id, pallet_no, target_kg, kg_net, containers, "
            "production_date, expiry_date) VALUES (%s,%s,%s,%s,0,'2026-09-17','2026-10-01')",
            (pid, pallet_no, kg, kg))
    execute("INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) VALUES (%s,%s,%s,%s,0)",
            (cuid(), pid, lot_no, kg))
    return pid


def _zlecenie():
    oid = cuid()
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
            "VALUES (%s,'MAS/T/1','r1',1000,0,'confirmed')", (oid,))
    return oid


def test_wolne_mieso_nie_jest_zablokowane():
    ms = _partia(kg=1000)
    assert kg_zablokowane_dla_masowni(ms) == 0.0


def test_mieso_zwazone_na_palete_jest_zablokowane():
    # Paleta = mięso przygotowane do masowania. Nie idzie na sprzedaż.
    ms = _partia(kg=1000)
    _paleta("PAL/T/1", 200, "511")
    assert kg_zablokowane_dla_masowni(ms) == 200.0


def test_mieso_w_masownicy_jest_zablokowane():
    ms = _partia(kg=1000)
    oid = _zlecenie()
    # Trojka bierze do 700 kg — 600 miesci sie w limicie maszyny.
    mas.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=600)]))
    assert kg_zablokowane_dla_masowni(ms) == 600.0


def test_paleta_wzieta_do_masownicy_liczy_sie_RAZ():
    # 200 kg palety poszlo do maszyny — to wciaz te same 200 kg, nie 400.
    ms = _partia(kg=1000)
    pid = _paleta("PAL/T/2", 200, "511")
    oid = _zlecenie()
    mas.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(palletId=pid, lotNo="511", meatStockId=ms, kg=200)]))
    assert kg_zablokowane_dla_masowni(ms) == 200.0


def test_paleta_zuzyta_juz_nie_blokuje():
    # Po odbiorze mieso zeszlo ze stanu — nie ma czego blokowac.
    ms = _partia(kg=1000)
    pid = _paleta("PAL/T/3", 200, "511")
    oid = _zlecenie()
    ch = mas.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(palletId=pid, lotNo="511", meatStockId=ms, kg=200)]))
    from app.models.masownia import ChargeFinish
    mas.start_charge(ch["id"])  # maszyna musi ruszyć, zanim będzie co odbierać
    mas.finish_charge(ch["id"], ChargeFinish(kgOutput=232))
    assert kg_zablokowane_dla_masowni(ms) == 0.0


def test_WZ_odbija_mieso_stojace_w_masownicy():
    # Pelna sciezka wydania: 1000 kg partii, 600 w masownicy → wolno wydac 400.
    from app.services.wz_service import create_manual_wz
    ms = _partia(kg=1000)
    oid = _zlecenie()
    mas.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=600)]))

    klient = cuid()
    execute("INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s)", (klient, "TSTWZ", "ODBIORCA TEST", "TEST"))

    with pytest.raises(HTTPException) as e:
        create_manual_wz(
            {"clientId": klient},
            [{"stock_type": "meat", "stock_id": ms, "qty": 500,
              "name": "Mięso z/s", "unit": "kg"}],
            valued=False, issued_date="2026-09-17",
        )
    assert "masowni" in str(e.value.detail).lower()
    # Stan nietkniety — nic nie zeszlo.
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE id=%s", (ms,))["kg_available"]) == 1000.0
