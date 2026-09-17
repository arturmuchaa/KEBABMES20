"""Wsad w masownicy: załadunek zdejmuje paletę, odbiór księguje istniejącą ścieżką."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto, SpiceCartCreate
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/17/09/26", "r1", meat_kg),
    )
    return oid


def _partia(lot_no, kg=1000.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-09-17", "2026-10-01"),
    )
    return ms_id


def test_zaladunek_tworzy_wsad_i_zajmuje_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(
        orderId=oid, machineId=3, waterL=108,
        meat=[ChargeMeatDto(palletId=None, lotNo="511", meatStockId=ms, kg=600)]))
    assert ch["status"] == "mixing" and float(ch["kg_meat"]) == 600.0
    assert [c["machine_id"] for c in svc.list_charges()] == [3]


def test_druga_maszyna_nie_bierze_wsadu_gdy_juz_masuje():
    oid, ms = _zlecenie(), _partia("511")
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
            ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert "masownica" in str(e.value.detail).lower()


def test_wsad_zapisuje_sklad_miesny():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    sklad = query_all("SELECT lot_no, kg FROM mixing_charge_pallets WHERE charge_id=%s", (ch["id"],))
    assert [(s["lot_no"], float(s["kg"])) for s in sklad] == [("511", 200.0)]


def test_zaladunek_wsypuje_pojemnik():
    oid, ms = _zlecenie(), _partia("511")
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, cartId=cart["id"], meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert query_one("SELECT status FROM mixing_spice_carts WHERE id=%s", (cart["id"],))["status"] == "dumped"
    # Wsypany pojemnik nie rezerwuje już kilogramów — robi to wsad.
    assert svc.kg_prepared_of(oid) == 0.0


def test_zaladunek_bez_miesa_jest_odrzucany():
    oid = _zlecenie()
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[]))
    assert "mięs" in str(e.value.detail).lower()


def test_wsad_z_jednej_partii_nosi_jej_numer():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert ch["batch_no"] == "511"


def test_wsad_z_dwoch_partii_nie_zgaduje_numeru_partii():
    # Numer PP nadaje backend przy odbiorze (seasoned_batch_no_from_raw) —
    # panel nie może go wymyślić, bo licznik PP jest wspólny dla całego MES.
    oid = _zlecenie()
    a, b = _partia("511"), _partia("512")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=a, kg=100),
        ChargeMeatDto(lotNo="512", meatStockId=b, kg=100)]))
    assert ch["batch_no"] == ""


def test_odbior_zamyka_wsad_i_zwalnia_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert out["status"] == "done" and out["session_id"]
    assert svc.list_charges() == []


def test_odbior_ksieguje_zuzycie_miesa_przez_istniejaca_sciezke():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    stan = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", (ms,))
    assert float(stan["kg_used"]) == 200.0
    assert float(stan["kg_available"]) == 800.0


def test_odbior_zapisuje_sesje_na_wlasciwej_masownicy():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    sesja = query_one("SELECT machine_id FROM mixing_sessions WHERE id=%s", (out["session_id"],))
    assert sesja["machine_id"] == 3


def test_odbior_drugi_raz_nie_ksieguje_ponownie():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    with pytest.raises(HTTPException):
        svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert float(query_one("SELECT kg_used FROM meat_stock WHERE id=%s", (ms,))["kg_used"]) == 200.0


def test_odbior_zapisuje_kilogramy_z_paleciaka():
    # Księgowanie liczy wyrób z RECEPTURY; bez tej kolumny odczyt operatora
    # znikałby, a to on jest fizyką, którą biuro uzgadnia z teorią.
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    zapis = query_one("SELECT kg_output FROM mixing_charges WHERE id=%s", (ch["id"],))
    assert float(zapis["kg_output"]) == 232.5


def test_wsad_ponad_maksimum_masownicy_jest_odrzucany():
    # Dwojka bierze 200 kg standardu i najwyzej 250. Panel blokuje to na
    # ekranie, ale straznik musi stac TU: ekran jest jednym z klientow API,
    # a przepelniona masownica nie miesza rowno.
    oid, ms = _zlecenie(meat_kg=2000), _partia("511", kg=2000)
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=2, meat=[
            ChargeMeatDto(lotNo="511", meatStockId=ms, kg=260)]))
    assert "250" in str(e.value.detail)
    assert svc.list_charges() == []


def test_wsad_w_granicy_masownicy_przechodzi():
    oid, ms = _zlecenie(meat_kg=2000), _partia("511", kg=2000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=2, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=250)]))
    assert float(ch["kg_meat"]) == 250.0


def test_trojka_bierze_do_700_kg():
    oid, ms = _zlecenie(meat_kg=2000), _partia("511", kg=2000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=700)]))
    assert float(ch["kg_meat"]) == 700.0


def test_trojka_odrzuca_ponad_700_kg():
    oid, ms = _zlecenie(meat_kg=2000), _partia("511", kg=2000)
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=3, meat=[
            ChargeMeatDto(lotNo="511", meatStockId=ms, kg=750)]))
    assert "700" in str(e.value.detail)


def test_wsad_bez_pojemnika_zapisuje_przyprawy_wazone_przy_maszynie():
    # Gdy przyprawy nie czekaja w pojemniku, operator wazy je PRZY MASZYNIE —
    # i te odczyty musza zostac, tak samo jak te z pojemnika. Wczesniej panel
    # kazal dodac tylko wode i przyprawy nie zostawialy sladu.
    from app.models.masownia import SpiceWeighDto
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, waterL=36, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)], spices=[
        SpiceWeighDto(seq=0, name="BERG SERHAT", unit="kg", qty=3.5, weighed=3.51, manual=False)]))
    zapis = query_one("SELECT spices FROM mixing_charges WHERE id=%s", (ch["id"],))
    import json as _json
    sp = zapis["spices"] if isinstance(zapis["spices"], list) else _json.loads(zapis["spices"])
    assert [s["name"] for s in sp] == ["BERG SERHAT"]
    assert sp[0]["weighed"] == 3.51


def test_wsad_z_pojemnika_nie_potrzebuje_przypraw_w_zadaniu():
    oid, ms = _zlecenie(), _partia("511")
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, cartId=cart["id"], meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert ch["id"]


def _paleta_z_miesem(pallet_no, kg, lot_no, ms_id):
    from app.db import execute as _ex
    pid = cuid()
    _ex("INSERT INTO meat_pallets (id, pallet_no, target_kg, kg_net, containers, "
        "production_date, expiry_date) VALUES (%s,%s,%s,%s,0,'2026-09-17','2026-10-01')",
        (pid, pallet_no, kg, kg))
    _ex("INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) VALUES (%s,%s,%s,%s,0)",
        (cuid(), pid, lot_no, kg))
    return pid


def test_paleta_wzieta_w_calosci_znika_po_odbiorze():
    # „Palety juz wymieszane i przekazane do miesa przyprawionego maja znikac" —
    # operator ma widziec tylko to, po co pojedzie wozkiem.
    oid, ms = _zlecenie(), _partia("511")
    pid = _paleta_z_miesem("PAL/Z/1", 200, "511", ms)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(palletId=pid, lotNo="511", meatStockId=ms, kg=200)]))
    assert query_one("SELECT consumed_at FROM meat_pallets WHERE id=%s", (pid,))["consumed_at"] is None
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232))
    assert query_one("SELECT consumed_at FROM meat_pallets WHERE id=%s", (pid,))["consumed_at"] is not None
    assert [p["id"] for p in svc.list_meat()["pallets"]] == []


def test_paleta_napoczeta_zostaje_na_magazynie():
    # Z palety 200 kg zeszlo 120 — reszta dalej czeka i musi byc widoczna.
    oid, ms = _zlecenie(), _partia("511")
    pid = _paleta_z_miesem("PAL/Z/2", 200, "511", ms)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(palletId=pid, lotNo="511", meatStockId=ms, kg=120)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=140))
    assert query_one("SELECT consumed_at FROM meat_pallets WHERE id=%s", (pid,))["consumed_at"] is None
    assert [p["id"] for p in svc.list_meat()["pallets"]] == [pid]


def test_wsad_da_sie_anulowac_gdy_zaladowano_nie_to():
    # Operator pomylil maszyne albo zlecenie — musi miec jak cofnac zaladunek.
    # Bez tego wsad stoi w maszynie do konca swiata i trzyma mieso.
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    pid = _paleta_z_miesem("PAL/A/1", 200, "511", ms)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(palletId=pid, lotNo="511", meatStockId=ms, kg=200)]))
    svc.cancel_charge(ch["id"], "pomylka maszyny")
    assert svc.list_charges() == []
    # Mieso i paleta wracaja do puli panelu.
    assert svc.list_meat()["lots"][0]["kg_free"] == 1000.0
    assert [p["id"] for p in svc.list_meat()["pallets"]] == [pid]


def test_anulowany_wsad_nie_ksieguje_sie_przy_odbiorze():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.cancel_charge(ch["id"], "pomylka")
    with pytest.raises(HTTPException):
        svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232))


def test_masownica_zwalnia_sie_po_anulowaniu_wsadu():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.cancel_charge(ch["id"], "pomylka")
    drugi = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert drugi["status"] == "mixing"
