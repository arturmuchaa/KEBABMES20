"""Tuleje schodzą ze stanu NA BIEŻĄCO, przy zapisie sztuk.

Hala chce widzieć magazyn zgodny z rzeczywistością w ciągu dnia, a nie dopiero
po potwierdzeniu biura. Jedna sztuka = jedna tuleja.

Najważniejszy warunek: `finish_day` NIE MOŻE zdjąć ich drugi raz.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.production import FinishDayDto, FinishDayEntry
from app.services.finished_goods_service import finish_day
from app.services.line_packaging_service import change_line_packaging
from app.services.production_plans_service import update_line_progress
from app.utils.ids import cuid


def _tuleja(pid, name, stan):
    execute(
        "INSERT INTO packaging (id, code, name, type, unit, kg_initial, kg_available, kg_used) "
        "VALUES (%s,%s,%s,'tuleja','szt',%s,%s,0)",
        (pid, name, name, stan, stan),
    )
    return pid


def _plan(packaging_id="t-metal", qty=20):
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status) "
            "VALUES ('p1','PP/1','2026-08-25','active')")
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty, kg_per_unit, total_kg, packaging_id, packaging_name, "
        " product_type_id, product_type_name, recipe_id, recipe_name, seasoned_batch_nos) "
        "VALUES ('l1','p1',%s,35,%s,%s,'METAL 65','pt1','KEBAB','r1','WROCŁAW',ARRAY['PP13'])",
        (qty, qty * 35, packaging_id),
    )


def _stan(pid):
    r = query_one("SELECT kg_available, kg_used FROM packaging WHERE id=%s", (pid,))
    return int(float(r["kg_available"])), int(float(r["kg_used"]))


def _wpis(pieces, wid="w1", name="DAWID"):
    return [{"workerId": wid, "workerName": name, "pieces": pieces, "addedAt": "10:00"}]


@pytest.fixture()
def tuleje(db):
    _tuleja("t-metal", "METAL 65", 100)
    _tuleja("t-karton", "KARTON 65", 50)
    _plan()


def test_zapis_sztuk_zdejmuje_tuleje_od_razu(tuleje):
    update_line_progress("p1", "l1", 5, "IN_PROGRESS", _wpis(5))

    assert _stan("t-metal") == (95, 5)


def test_kolejny_zapis_zdejmuje_TYLKO_przyrost(tuleje):
    update_line_progress("p1", "l1", 5, "IN_PROGRESS", _wpis(5))
    update_line_progress("p1", "l1", 12, "IN_PROGRESS", _wpis(12))

    assert _stan("t-metal") == (88, 12)


def test_korekta_w_dol_oddaje_tuleje(tuleje):
    update_line_progress("p1", "l1", 12, "IN_PROGRESS", _wpis(12))
    update_line_progress("p1", "l1", 8, "IN_PROGRESS", _wpis(8))

    assert _stan("t-metal") == (92, 8)


def test_brak_tulei_NIE_blokuje_zapisu_sztuk(db):
    """Hala zapisuje pracę, która fizycznie się wydarzyła."""
    _tuleja("t-metal", "METAL 65", 3)
    _plan()

    out = update_line_progress("p1", "l1", 10, "IN_PROGRESS", _wpis(10))

    assert out["qty_done"] == 10          # praca zapisana
    assert _stan("t-metal") == (0, 3)     # zeszło tyle, ile było
    assert query_one("SELECT packaging_used FROM production_plan_lines WHERE id='l1'")["packaging_used"] == 3


def test_pozycja_bez_tulei_nie_wybucha(db):
    _plan(packaging_id=None)
    assert update_line_progress("p1", "l1", 4, "IN_PROGRESS", _wpis(4))["qty_done"] == 4


# ── Najważniejsze: brak podwójnego zdjęcia ───────────────────────────────

def test_finish_day_NIE_zdejmuje_tulei_drugi_raz(tuleje):
    update_line_progress("p1", "l1", 20, "DONE", _wpis(20))
    assert _stan("t-metal") == (80, 20)

    finish_day(FinishDayDto(plan_id="p1", entries=[FinishDayEntry(
        plan_line_id="l1", qty=20, kg_per_unit=35, packaging_id="t-metal",
        product_type_id="pt1", product_type_name="KEBAB", recipe_id="r1",
        recipe_name="WROCŁAW", seasoned_batch_nos=["PP13"], worker_names=["DAWID"],
    )]))

    assert _stan("t-metal") == (80, 20)   # bez zmian — hala zdjęła je wcześniej


def test_finish_day_dobiera_reszte_gdy_hala_zapisala_mniej(tuleje):
    """Dzień częściowo prowadzony bez kiosku: 8 zdjętych na hali, 20 w wpisie."""
    update_line_progress("p1", "l1", 8, "IN_PROGRESS", _wpis(8))

    finish_day(FinishDayDto(plan_id="p1", entries=[FinishDayEntry(
        plan_line_id="l1", qty=20, kg_per_unit=35, packaging_id="t-metal",
        product_type_id="pt1", product_type_name="KEBAB", recipe_id="r1",
        recipe_name="WROCŁAW", seasoned_batch_nos=["PP13"], worker_names=["DAWID"],
    )]))

    assert _stan("t-metal") == (80, 20)   # 8 + dobrane 12


def test_dzien_bez_kiosku_dziala_jak_dotad(tuleje):
    """packaging_used = 0 → finish_day zdejmuje całość, jak przed zmianą."""
    finish_day(FinishDayDto(plan_id="p1", entries=[FinishDayEntry(
        plan_line_id="l1", qty=20, kg_per_unit=35, packaging_id="t-metal",
        product_type_id="pt1", product_type_name="KEBAB", recipe_id="r1",
        recipe_name="WROCŁAW", seasoned_batch_nos=["PP13"], worker_names=["DAWID"],
    )]))

    assert _stan("t-metal") == (80, 20)


# ── Zmiana tulei z poziomu hali ──────────────────────────────────────────

def test_zmiana_tulei_przenosi_juz_zdjete(tuleje):
    update_line_progress("p1", "l1", 10, "IN_PROGRESS", _wpis(10))
    assert _stan("t-metal") == (90, 10)

    change_line_packaging("p1", "l1", "t-karton")

    assert _stan("t-metal") == (100, 0)   # metalowe wróciły na magazyn
    assert _stan("t-karton") == (40, 10)  # kartonowe zeszły
    l = query_one("SELECT packaging_id, packaging_name, packaging_used "
                  "FROM production_plan_lines WHERE id='l1'")
    assert (l["packaging_id"], l["packaging_name"], l["packaging_used"]) == ("t-karton", "KARTON 65", 10)


def test_zmiana_przed_pierwsza_sztuka_niczego_nie_rusza(tuleje):
    change_line_packaging("p1", "l1", "t-karton")

    assert _stan("t-metal") == (100, 0)
    assert _stan("t-karton") == (50, 0)


def test_po_zmianie_kolejne_sztuki_ida_z_nowej_tulei(tuleje):
    update_line_progress("p1", "l1", 10, "IN_PROGRESS", _wpis(10))
    change_line_packaging("p1", "l1", "t-karton")
    update_line_progress("p1", "l1", 14, "IN_PROGRESS", _wpis(14))

    assert _stan("t-metal") == (100, 0)
    assert _stan("t-karton") == (36, 14)


def test_zmiana_na_nieistniejaca_tuleje_odrzucona(tuleje):
    with pytest.raises(HTTPException) as e:
        change_line_packaging("p1", "l1", "nie-ma-takiej")
    assert e.value.status_code == 404


def test_zmiana_na_te_sama_tuleje_jest_bezczynna(tuleje):
    update_line_progress("p1", "l1", 6, "IN_PROGRESS", _wpis(6))
    out = change_line_packaging("p1", "l1", "t-metal")

    assert out.get("unchanged") is True
    assert _stan("t-metal") == (94, 6)
