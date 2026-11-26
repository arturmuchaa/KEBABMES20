"""Poprawki po końcowym przeglądzie gałęzi (plan A, 26.11.2026)."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto
from app.services import masownia_service as mas
from app.services import production_plans_service as pps
from app.services import seasoned_pallets_service as sp
from app.services.finished_units_service import generate_units_from_plan_line, scan_produced
from app.utils.ids import cuid
from tests.test_seasoned_pallets_wywoz_db import kod, linia, paleta, partia, plan

pytestmark = pytest.mark.usefixtures("db")


def _skanuj_wszystkie(lid):
    for u in query_all("SELECT id FROM finished_units WHERE plan_line_id=%s", (lid,)):
        scan_produced("U|" + u["id"])


def _zamknij_dzien(pl, lid, qty, kg=40, batch="724"):
    pps.tablet_finish(pl, [{
        "planLineId": lid, "qty": qty, "workerNames": ["Jan"], "kgPerUnit": kg,
        "recipeId": "r-kirmizi", "recipeName": "KIRMIZI", "seasonedBatchNos": [batch],
    }])


def _dzien_na_palecie(sm, p, pl, sztuk=14, zwrot=24.0):
    lid = linia(pl, sm, qty=sztuk)
    generate_units_from_plan_line(lid)
    sp.take_pallet(kod(p), plan_id=pl)
    _skanuj_wszystkie(lid)
    sp.return_pallet(kod(p), zwrot)
    _zamknij_dzien(pl, lid, sztuk)
    return lid


# C1 — korekta względna, nie „suma palet w chłodni”

def test_zuzycie_poza_paletami_nie_wraca_jako_widmo():
    sm = partia(kg=1200)
    a = paleta(sm, kg=600); paleta(sm, kg=600)
    execute("UPDATE seasoned_meat SET kg_available=800 WHERE id=%s", (sm,))  # 400 kg zeszło planem bez blokady
    pl = plan()
    _dzien_na_palecie(sm, a, pl)
    pps.office_confirm(pl)
    # 800 − 560 (finish_day) − strata 16 (600 − 560 − 24)
    assert float(query_one("SELECT kg_available FROM seasoned_meat WHERE id=%s", (sm,))["kg_available"]) == 224.0
    [b] = sp.plan_balance(pl)
    assert b["kgLoss"] == 16.0


def test_paleta_tej_partii_na_hali_w_innym_planie_nie_zamyka_partii():
    sm = partia(kg=1198)
    a = paleta(sm, kg=598); b = paleta(sm, kg=600)
    p1, p2 = plan(), plan()
    linia(p2, sm)
    _dzien_na_palecie(sm, a, p1)
    sp.take_pallet(kod(b), plan_id=p2)
    pps.office_confirm(p1)
    row = query_one("SELECT kg_available, status FROM seasoned_meat WHERE id=%s", (sm,))
    assert row["status"] != "closed"
    assert float(row["kg_available"]) == 624.0  # 1198 − 560 − 14


# I1 — błąd bilansu nie zostawia planu bez wyjścia

def test_blad_bilansu_zwracany_i_ponowny_bilans():
    sm = partia(kg=598); p = paleta(sm, kg=598); pl = plan()
    _dzien_na_palecie(sm, p, pl)
    execute("UPDATE seasoned_meat SET kg_reserved=500 WHERE id=%s", (sm,))
    out = pps.office_confirm(pl)
    assert "zarezerwowane" in out["balanceError"]
    assert query_one("SELECT status FROM production_plans WHERE id=%s", (pl,))["status"] == "done"
    execute("UPDATE seasoned_meat SET kg_reserved=0 WHERE id=%s", (sm,))
    wynik = pps.settle_balance(pl)
    assert wynik[0]["kgLoss"] == 14.0
    with pytest.raises(HTTPException):
        pps.settle_balance(pl)  # drugi raz — bilans już jest


# I2 — wpisy hali ponad zeskanowane sztuki

def test_wpisy_ponad_zeskanowane_blokuja_potwierdzenie():
    sm = partia(); p = paleta(sm); pl = plan()
    lid = linia(pl, sm, qty=16)
    generate_units_from_plan_line(lid)
    sp.take_pallet(kod(p), plan_id=pl)
    for u in query_all("SELECT id FROM finished_units WHERE plan_line_id=%s LIMIT 14", (lid,)):
        scan_produced("U|" + u["id"])
    sp.return_pallet(kod(p), 0)
    _zamknij_dzien(pl, lid, 16)
    with pytest.raises(HTTPException) as e:
        pps.office_confirm(pl)
    assert e.value.status_code == 409 and "zeskanowano 14" in e.value.detail


# I3 — sztuka: partia i receptura

def test_sztuka_innej_receptury_o_tym_samym_numerze_odbija():
    kir = partia(); bey = partia(recipe_id="r-beyaz")
    pk = paleta(kir); paleta(bey, recipe_id="r-beyaz")
    pl = plan()
    linia(pl, kir)
    lid_b = linia(pl, bey, recipe_id="r-beyaz", qty=2)
    sp.take_pallet(kod(pk), plan_id=pl)
    generate_units_from_plan_line(lid_b)
    u = query_one("SELECT id FROM finished_units WHERE plan_line_id=%s LIMIT 1", (lid_b,))
    with pytest.raises(HTTPException) as e:
        scan_produced("U|" + u["id"])
    assert e.value.status_code == 409


# I4 — plan wskazany przez tablet

def test_wywoz_do_planu_z_tabletu():
    sm = partia(); p = paleta(sm)
    p1, p2 = plan(), plan()
    linia(p1, sm); linia(p2, sm)
    out = sp.take_pallet(kod(p), plan_id=p2)
    assert out["planId"] == p2


# I5 — po zamknięciu dnia przez tablet nic nie wyjeżdża

def test_wywoz_po_zamknieciu_dnia_blokuje():
    sm = partia(); p = paleta(sm); pl = plan(); linia(pl, sm)
    execute("UPDATE production_plans SET tablet_finished_at=now() WHERE id=%s", (pl,))
    with pytest.raises(HTTPException):
        sp.take_pallet(kod(p))


# I6 — dzień produkcyjny jak na tablecie (przed 04:00 = poprzedni dzień)

def test_dzien_produkcyjny_przed_czwarta_to_wczoraj():
    tz = ZoneInfo("Europe/Warsaw")
    assert sp.production_day(datetime(2026, 11, 27, 2, 30, tzinfo=tz)) == "2026-11-26"
    assert sp.production_day(datetime(2026, 11, 27, 4, 0, tzinfo=tz)) == "2026-11-27"


# I7 — odbiór bez palety dostaje ją przy liście dnia

def test_lista_dnia_dokłada_brakujaca_palete():
    oid = cuid()
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
            "VALUES (%s,'MAS/26/11/26','r1',1000,0,'confirmed')", (oid,))
    ms = cuid()
    execute("INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, kg_reserved, "
            "production_date, expiry_date) VALUES (%s,'511','Mięso',1000,1000,0,'2026-11-25','2026-12-05')", (ms,))
    ch = mas.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    mas.start_charge(ch["id"])
    mas.finish_charge(ch["id"], ChargeFinish(kgOutput=240))
    execute("DELETE FROM seasoned_pallets")  # symulacja nieudanego założenia palety
    [dzis] = mas.list_charges_today()
    assert dzis["pallet_qr"]
    assert query_one("SELECT kg_weighed FROM seasoned_pallets WHERE charge_id=%s", (ch["id"],))


# I8 — backfill: paleta na każdy odbiór, gdy partia nietknięta

def test_backfill_paleta_na_kazdy_odbior_nietknietej_partii():
    from app.migrations import _backfill_seasoned_pallets
    sm = partia("800", kg=1200)
    oid = cuid()
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
            "VALUES (%s,'MAS/25/11/26','r-kirmizi',960,960,'done')", (oid,))
    for nr, kg in [(71, 600), (72, 600)]:
        execute("INSERT INTO mixing_charges (id, order_id, machine_id, batch_no, kg_meat, status, "
                "out_pallet_no, kg_output, finished_at) VALUES (%s,%s,1,'800',480,'done',%s,%s, now() - interval '1 day')",
                (cuid(), oid, nr, kg))
    _backfill_seasoned_pallets()
    rows = query_all("SELECT pallet_no, kg_weighed FROM seasoned_pallets WHERE seasoned_meat_id=%s ORDER BY pallet_no", (sm,))
    assert [(r["pallet_no"], float(r["kg_weighed"])) for r in rows] == [(71, 600.0), (72, 600.0)]


def test_ponowny_skan_palety_do_tego_samego_planu_jest_ok():
    sm = partia(); p = paleta(sm); pl = plan(); linia(pl, sm)
    sp.take_pallet(kod(p), plan_id=pl)
    out = sp.take_pallet(kod(p), plan_id=pl)
    assert out["ok"] and out.get("again") is True
