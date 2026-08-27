"""Próg skanu na pozycji planu — co hala może jeszcze poprawić.

Sztuki wpisane przez operatora to deklaracja: wolno je dodać i odjąć nawet po
zamknięciu pozycji, bo pomyłka wychodzi zwykle na końcu. Skan jest momentem,
w którym sztuka wchodzi na magazyn wyrobu gotowego — od tej chwili `qty_done`
nie może zejść poniżej liczby zeskanowanych sztuk (zostaje `move-pieces`).

Drugi wątek: skan jest przypisany do KONKRETNEJ pozycji. Operator wybiera
pozycję i skanuje tylko ją; sztuka z innej pozycji musi odbić się z błędem,
zamiast po cichu zaliczyć się gdzie indziej.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.finished_units_service import (
    generate_units_from_plan_line, plan_scan_progress, scan_produced,
)
from app.services.production_plans_service import update_line_progress


def _seed_plan(plan_id="pp1", plan_date="2026-08-27"):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) VALUES (%s,%s,%s,'active')",
        (plan_id, "PP/1", plan_date),
    )


def _seed_line(line_id, plan_id="pp1", qty=20, qty_done=0, position=0, recipe_name="WROCŁAW"):
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, position, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        " product_type_id, batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES (%s,%s,%s,%s,%s,1.0,'r1',%s,'p1','{}'::jsonb,'364','[]'::jsonb,'PLANNED')",
        (line_id, plan_id, position, qty, qty_done, recipe_name),
    )


def _wpisy(pieces):
    return [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": pieces, "addedAt": "10:00"}]


def _qr(line_id, seq=1):
    return query_one(
        "SELECT qr_code FROM finished_units WHERE plan_line_id=%s AND qr_seq=%s",
        (line_id, seq),
    )["qr_code"]


# ── Postęp skanu per pozycja ──────────────────────────────────────────

def test_plan_scan_progress_liczy_sztuki_per_pozycja(db):
    _seed_plan()
    _seed_line("pl1", qty=3)
    _seed_line("pl2", qty=2, position=1)
    generate_units_from_plan_line("pl1")
    generate_units_from_plan_line("pl2")
    scan_produced(_qr("pl1", 1))

    postep = {p["planLineId"]: p for p in plan_scan_progress("pp1")}

    assert postep["pl1"]["total"] == 3
    assert postep["pl1"]["scanned"] == 1
    assert postep["pl2"]["total"] == 2
    assert postep["pl2"]["scanned"] == 0


def test_plan_scan_progress_pokazuje_pozycje_bez_wygenerowanych_sztuk(db):
    """Biuro nie wydrukowało jeszcze etykiet — pozycja ma być na liście z zerem,
    a nie zniknąć z panelu skanowania."""
    _seed_plan()
    _seed_line("pl1", qty=3)

    postep = plan_scan_progress("pp1")

    assert [(p["planLineId"], p["total"], p["scanned"]) for p in postep] == [("pl1", 0, 0)]


# ── Skan zamknięty na wybraną pozycję ─────────────────────────────────

def test_skan_sztuki_z_innej_pozycji_odbija_sie(db):
    _seed_plan()
    _seed_line("pl1", qty=2, position=0)
    _seed_line("pl2", qty=2, position=1, recipe_name="KIRMIZI")
    generate_units_from_plan_line("pl1")
    generate_units_from_plan_line("pl2")

    with pytest.raises(HTTPException) as e:
        scan_produced(_qr("pl2", 1), plan_line_id="pl1")

    assert e.value.status_code == 409
    # Operator musi wiedzieć, DOKĄD ta sztuka należy — inaczej szuka po omacku.
    assert "2" in str(e.value.detail)
    assert "KIRMIZI" in str(e.value.detail)
    # Odbita sztuka NIE weszła na magazyn.
    assert query_one("SELECT status FROM finished_units WHERE plan_line_id='pl2' AND qr_seq=1")["status"] == "planned"


def test_skan_wlasnej_pozycji_przechodzi_i_oddaje_jej_id(db):
    _seed_plan()
    _seed_line("pl1", qty=2)
    generate_units_from_plan_line("pl1")

    wynik = scan_produced(_qr("pl1", 1), plan_line_id="pl1")

    assert wynik["planLineId"] == "pl1"
    assert wynik["done"] == 1 and wynik["total"] == 2


def test_skan_bez_wskazania_pozycji_dziala_jak_dotad(db):
    """Mobilne skanowanie (`/mobile/produkcja`) nie zna pozycji — nie wolno go zepsuć."""
    _seed_plan()
    _seed_line("pl1", qty=2)
    generate_units_from_plan_line("pl1")

    wynik = scan_produced(_qr("pl1", 1))

    assert wynik["done"] == 1


# ── Próg: qty_done nie schodzi poniżej zeskanowanych ──────────────────

def test_odjecie_sztuk_bez_skanu_przechodzi(db):
    _seed_plan()
    _seed_line("pl1", qty=20, qty_done=12)

    wynik = update_line_progress("pp1", "pl1", 8, "IN_PROGRESS", _wpisy(8))

    assert wynik["qty_done"] == 8


def test_odjecie_do_poziomu_zeskanowanych_przechodzi(db):
    _seed_plan()
    _seed_line("pl1", qty=20, qty_done=12)
    generate_units_from_plan_line("pl1")
    for i in (1, 2, 3):
        scan_produced(_qr("pl1", i))

    wynik = update_line_progress("pp1", "pl1", 3, "IN_PROGRESS", _wpisy(3))

    assert wynik["qty_done"] == 3


def test_zejscie_ponizej_zeskanowanych_odbija_sie(db):
    _seed_plan()
    _seed_line("pl1", qty=20, qty_done=12)
    generate_units_from_plan_line("pl1")
    for i in (1, 2, 3):
        scan_produced(_qr("pl1", i))

    with pytest.raises(HTTPException) as e:
        update_line_progress("pp1", "pl1", 2, "IN_PROGRESS", _wpisy(2))

    assert e.value.status_code == 409
    assert "3" in str(e.value.detail)
    # Postęp został nietknięty — odrzucony zapis nie może częściowo wejść.
    assert query_one("SELECT qty_done FROM production_plan_lines WHERE id='pl1'")["qty_done"] == 12


def test_dopisanie_sztuk_na_zeskanowanej_pozycji_przechodzi(db):
    """Skan blokuje TYLKO schodzenie w dół — dopisanie brakującej sztuki wolno."""
    _seed_plan()
    _seed_line("pl1", qty=20, qty_done=5)
    generate_units_from_plan_line("pl1")
    for i in (1, 2, 3, 4, 5):
        scan_produced(_qr("pl1", i))

    wynik = update_line_progress("pp1", "pl1", 7, "IN_PROGRESS", _wpisy(7))

    assert wynik["qty_done"] == 7
