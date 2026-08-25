"""Skan QR gotowej sztuki wprowadza ją NA MAGAZYN wyrobu gotowego.

Do tej pory wyrób gotowy powstawał dopiero po potwierdzeniu dnia przez biuro.
Hala skanuje kebaby w trakcie i po pozycji — i od razu chce widzieć je na
magazynie (pakowanie i wydanie pracują na tym stanie jeszcze tego samego dnia).

Najważniejszy warunek, ten sam co przy tulejach: `finish_day` NIE MOŻE
dopisać tych sztuk drugi raz. Zeskanowane wchodzą przy skanie, a przy
potwierdzeniu biura dopisuje się WYŁĄCZNIE reszta.

Mięso przyprawione konsumuje się nadal RAZ, przy potwierdzeniu dnia — skan
nie rusza masowni.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest

from app.db import execute, query_all, query_one
from app.models.production import FinishDayDto, FinishDayEntry
from app.services.finished_goods_service import finish_day
from app.services.finished_units_service import generate_units_from_plan_line, scan_produced


def _plan(qty=4, allocation=None):
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status) "
            "VALUES ('p1','PP/1','2026-08-25','active')")
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty, kg_per_unit, total_kg, packaging_id, packaging_name, "
        " product_type_id, product_type_name, recipe_id, recipe_name, "
        " seasoned_batch_nos, client_name, batch_allocation) "
        "VALUES ('l1','p1',%s,35,%s,NULL,'METAL 65','pt1','KEBAB','r1','WROCŁAW',"
        " ARRAY['344'],'Bulli sp. z o.o.',%s::jsonb)",
        (qty, qty * 35, allocation or "{}"),
    )


def _kody():
    return [u["qr_code"] for u in query_all(
        "SELECT qr_code FROM finished_units WHERE plan_line_id='l1' ORDER BY qr_seq")]


def _wpis(qty):
    return FinishDayEntry(
        plan_line_id="l1", qty=qty, kg_per_unit=35, packaging_id="",
        product_type_id="pt1", product_type_name="KEBAB", recipe_id="r1",
        recipe_name="WROCŁAW", client_name="Bulli sp. z o.o.",
        seasoned_batch_nos=["344"], worker_names=["DAWID"],
    )


def _magazyn():
    return query_all("SELECT id, batch_no, qty, total_kg, qty_available FROM finished_goods "
                     "ORDER BY batch_no")


def _sztuk_na_magazynie():
    return sum(int(r["qty"]) for r in _magazyn())


@pytest.fixture()
def sztuki(db):
    _plan()
    generate_units_from_plan_line("l1")


def test_skan_wprowadza_sztuke_na_magazyn(sztuki):
    scan_produced(_kody()[0])

    mag = _magazyn()
    assert len(mag) == 1
    assert (int(mag[0]["qty"]), float(mag[0]["total_kg"])) == (1, 35.0)
    assert float(mag[0]["qty_available"]) == 1


def test_kolejne_skany_dokladaja_do_tego_samego_wiersza(sztuki):
    for kod in _kody()[:3]:
        scan_produced(kod)

    mag = _magazyn()
    assert len(mag) == 1
    assert (int(mag[0]["qty"]), float(mag[0]["total_kg"])) == (3, 105.0)


def test_kazdy_skan_zostawia_ruch_magazynowy(sztuki):
    scan_produced(_kody()[0])

    ruchy = query_all("SELECT movement_type, qty FROM stock_movements "
                      "WHERE product_type='finished_goods'")
    assert len(ruchy) == 1
    assert (ruchy[0]["movement_type"], float(ruchy[0]["qty"])) == ("IN", 35.0)


def test_sztuka_wie_na_ktorym_wyrobie_siedzi(sztuki):
    scan_produced(_kody()[0])

    u = query_one("SELECT source_finished_goods_id, stock_booked_at FROM finished_units "
                  "WHERE qr_seq=1 AND plan_line_id='l1'")
    assert u["source_finished_goods_id"] == _magazyn()[0]["id"]
    assert u["stock_booked_at"] is not None


def test_dubel_skanu_nie_dokłada_drugi_raz(sztuki):
    from fastapi import HTTPException
    kod = _kody()[0]
    scan_produced(kod)
    with pytest.raises(HTTPException) as e:
        scan_produced(kod)

    assert e.value.status_code == 409
    assert _sztuk_na_magazynie() == 1


# ── Sedno: brak podwójnego wprowadzenia ──────────────────────────────────

def test_finish_day_dopisuje_TYLKO_niezeskanowane(sztuki):
    for kod in _kody()[:3]:
        scan_produced(kod)
    assert _sztuk_na_magazynie() == 3

    finish_day(FinishDayDto(plan_id="p1", entries=[_wpis(4)]))

    assert _sztuk_na_magazynie() == 4       # 3 ze skanów + 1 dopisana


def test_wszystko_zeskanowane_finish_day_nic_nie_dokłada(sztuki):
    for kod in _kody():
        scan_produced(kod)
    assert _sztuk_na_magazynie() == 4

    finish_day(FinishDayDto(plan_id="p1", entries=[_wpis(4)]))

    assert _sztuk_na_magazynie() == 4


def test_dzien_bez_skanowania_dziala_jak_dotad(sztuki):
    finish_day(FinishDayDto(plan_id="p1", entries=[_wpis(4)]))

    assert _sztuk_na_magazynie() == 4


def test_mieso_przyprawione_schodzi_RAZ_mimo_skanow(db):
    """Skan nie rusza masowni — mięso konsumuje potwierdzenie dnia."""
    _plan()
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, kg_produced, "
        " kg_available, kg_reserved, kg_used, status) "
        "VALUES ('sm1','344','r1',500,500,0,0,'available')"
    )
    generate_units_from_plan_line("l1")
    for kod in _kody()[:2]:
        scan_produced(kod)

    po_skanach = query_one("SELECT kg_available, kg_used FROM seasoned_meat WHERE id='sm1'")
    assert (float(po_skanach["kg_available"]), float(po_skanach["kg_used"])) == (500.0, 0.0)

    finish_day(FinishDayDto(plan_id="p1", entries=[_wpis(4)]))

    po_dniu = query_one("SELECT kg_available, kg_used FROM seasoned_meat WHERE id='sm1'")
    assert (float(po_dniu["kg_available"]), float(po_dniu["kg_used"])) == (360.0, 140.0)


def test_rozbicie_na_partie_odejmuje_zeskanowane_z_WLASCIWEJ_partii(db):
    """Dwie partie na pozycji: skan z partii 344 nie może zjeść puli partii 355."""
    _plan(qty=4, allocation='{"344": {"pieces": 2}, "355": {"pieces": 2}}')
    generate_units_from_plan_line("l1")
    z344 = [u["qr_code"] for u in query_all(
        "SELECT qr_code FROM finished_units WHERE plan_line_id='l1' AND batch_no='344' ORDER BY qr_seq")]
    scan_produced(z344[0])

    finish_day(FinishDayDto(plan_id="p1", entries=[_wpis(4)]))

    po_partii = {r["batch_no"][-3:]: int(r["qty"]) for r in _magazyn()}
    assert po_partii == {"344": 2, "355": 2}
    assert _sztuk_na_magazynie() == 4
