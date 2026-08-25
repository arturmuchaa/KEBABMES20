"""Przeniesienie sztuk z pracownika A na pracownika B.

Operator liczy w rękawicy i na jednym ekranie: pomyłka „nie ta osoba" wychodzi
zwykle dopiero pod koniec pozycji, czasem po jej zamknięciu. Kilogramy
pracownika idą prosto do wypłaty (stawka × kg), więc musi to dać się poprawić
na hali, bez telefonu do biura.

Co się NIE zmienia przy przeniesieniu: `qty_done` pozycji i `packaging_used`.
Przenosimy PRZYPISANIE pracy, nie samą pracę — sztuki są zrobione, tuleje
zeszły, zmienia się tylko to, komu je liczymy.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.production_plans_service import move_line_pieces, update_line_progress


def _plan(qty=20, status="active", office_confirmed=False, tablet_finished=False):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status, tablet_finished_at, "
        " office_confirmed_at) VALUES ('p1','PP/1','2026-08-25',%s,%s,%s)",
        (status, "2026-08-25 15:00" if tablet_finished else None,
         "2026-08-25 16:00" if office_confirmed else None),
    )
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty, kg_per_unit, total_kg, packaging_id, packaging_name, "
        " product_type_id, product_type_name, recipe_id, recipe_name, seasoned_batch_nos) "
        "VALUES ('l1','p1',%s,35,%s,NULL,'METAL 65','pt1','KEBAB','r1','WROCŁAW',ARRAY['PP13'])",
        (qty, qty * 35),
    )


def _wpisy(*pary):
    return [{"workerId": w, "workerName": n, "pieces": p, "addedAt": "10:00"} for w, n, p in pary]


def _linia():
    return query_one("SELECT qty_done, line_status, packaging_used, worker_entries "
                     "FROM production_plan_lines WHERE id='l1'")


def _po_osobie():
    return {e["workerId"]: e["pieces"] for e in (_linia()["worker_entries"] or [])}


@pytest.fixture()
def pozycja(db):
    _plan()
    update_line_progress("p1", "l1", 12, "IN_PROGRESS",
                         _wpisy(("w1", "DAWID", 9), ("w2", "DENYS", 3)))


def test_przenosi_sztuki_miedzy_ludzmi(pozycja):
    move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN")

    assert _po_osobie() == {"w1": 5, "w2": 7}


def test_praca_zostaje_na_pozycji(pozycja):
    """Przenosimy przypisanie, nie sztuki: postęp i tuleje bez zmian."""
    przed = _linia()
    move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN")
    po = _linia()

    assert (po["qty_done"], po["packaging_used"]) == (przed["qty_done"], przed["packaging_used"])
    assert sum(_po_osobie().values()) == 12


def test_osoba_bez_wpisu_dostaje_swoj(pozycja):
    move_line_pieces("p1", "l1", "w1", "w3", 2, by="MARCIN", to_worker_name="OLEH")

    wpis = [e for e in _linia()["worker_entries"] if e["workerId"] == "w3"][0]
    assert (wpis["pieces"], wpis["workerName"]) == (2, "OLEH")


def test_oddanie_wszystkiego_kasuje_wpis(pozycja):
    """Zero sztuk to nie jest wpis — inaczej statystyki zmiany pokazują widmo."""
    move_line_pieces("p1", "l1", "w2", "w1", 3, by="MARCIN")

    assert _po_osobie() == {"w1": 12}


def test_nie_przeniesiesz_wiecej_niz_ma(pozycja):
    with pytest.raises(HTTPException) as e:
        move_line_pieces("p1", "l1", "w2", "w1", 4, by="MARCIN")
    assert e.value.status_code == 400
    assert _po_osobie() == {"w1": 9, "w2": 3}      # nic nie ruszone


def test_zero_i_liczby_ujemne_odrzucone(pozycja):
    for ile in (0, -3):
        with pytest.raises(HTTPException) as e:
            move_line_pieces("p1", "l1", "w1", "w2", ile, by="MARCIN")
        assert e.value.status_code == 400


def test_osoba_bez_sztuk_na_tej_pozycji(pozycja):
    with pytest.raises(HTTPException) as e:
        move_line_pieces("p1", "l1", "w9", "w1", 1, by="MARCIN")
    assert e.value.status_code == 400


def test_na_samego_siebie_nic_nie_robi(pozycja):
    out = move_line_pieces("p1", "l1", "w1", "w1", 3, by="MARCIN")

    assert out.get("unchanged") is True
    assert _po_osobie() == {"w1": 9, "w2": 3}


# ── Kiedy wolno poprawiać ────────────────────────────────────────────────

def test_dziala_po_zamknieciu_pozycji(db):
    """Pomyłka wychodzi zwykle dopiero, gdy pozycja jest gotowa."""
    _plan(qty=10)
    update_line_progress("p1", "l1", 10, "DONE", _wpisy(("w1", "DAWID", 10)))

    move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN", to_worker_name="DENYS")

    l = _linia()
    assert (l["qty_done"], l["line_status"]) == (10, "DONE")
    assert _po_osobie() == {"w1": 6, "w2": 4}


def test_dziala_po_wyslaniu_dnia_do_biura(db):
    """Dzień czeka na potwierdzenie — biuro jeszcze nic nie zaksięgowało."""
    _plan(qty=10, tablet_finished=True)
    update_line_progress("p1", "l1", 10, "DONE", _wpisy(("w1", "DAWID", 10)))

    move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN")

    assert _po_osobie() == {"w1": 6, "w2": 4}


def test_po_potwierdzeniu_biura_hala_juz_nie_poprawia(db):
    """Po potwierdzeniu powstał wyrób gotowy i dzień idzie do rozliczeń."""
    _plan(qty=10)
    update_line_progress("p1", "l1", 10, "DONE", _wpisy(("w1", "DAWID", 10)))
    execute("UPDATE production_plans SET office_confirmed_at=now(), status='done' WHERE id='p1'")

    with pytest.raises(HTTPException) as e:
        move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN")
    assert e.value.status_code == 409
    assert _po_osobie() == {"w1": 10}


# ── Ślad ─────────────────────────────────────────────────────────────────

def test_zostaje_slad_kto_i_kiedy_przeniosl(pozycja):
    move_line_pieces("p1", "l1", "w1", "w2", 4, by="MARCIN")

    ruchy = query_all("SELECT * FROM production_worker_moves WHERE plan_line_id='l1'")
    assert len(ruchy) == 1
    assert (ruchy[0]["from_worker_id"], ruchy[0]["to_worker_id"],
            ruchy[0]["pieces"], ruchy[0]["moved_by"]) == ("w1", "w2", 4, "MARCIN")


def test_odrzucone_przeniesienie_nie_zostawia_sladu(pozycja):
    with pytest.raises(HTTPException):
        move_line_pieces("p1", "l1", "w2", "w1", 99, by="MARCIN")

    assert query_all("SELECT id FROM production_worker_moves") == []
