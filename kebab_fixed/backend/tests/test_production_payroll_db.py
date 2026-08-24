"""Płaca produkcji z FAKTYCZNYCH kilogramów pracownika.

Do tej pory dla roli produkcyjnej liczyło się `SUM(total_kg)` z sesji, w których
nazwisko było w tablicy `worker_names` — czyli KAŻDA osoba przy pozycji 700 kg
dostawała 700 kg. Błąd jeszcze nie wypalił (wszystkie sesje na produkcji mają po
jednej osobie), ale nowe stanowisko jest zbudowane pod kilka osób na pozycję.

Prawdziwe kilogramy pracownika to:
    układanie:  Σ (jego sztuki × kg_per_unit pozycji)
    foliowanie: kg wpisane na koniec dnia (production_wrapping)

Testy DB — bez TEST_DATABASE_URL skip."""
import json

import pytest

from app.db import execute
from app.services.production_wrapping_service import (
    day_wrapping, save_wrapping, split_evenly,
)
from app.services.workers_service import get_worker_days
from app.utils.ids import cuid


def _worker(wid, name, role="WORKER_PRODUCTION", rate=0.5):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,%s,%s,true) "
        # Nazwisko TEŻ aktualizujemy — stare źródło płac szuka po nazwisku,
        # więc pominięcie go dawało testy zależne od kolejności.
        "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, active=true",
        (wid, name, role, rate),
    )


def _plan(plan_id, plan_date, lines):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES (%s,%s,%s,'active')",
        (plan_id, f"PP/{plan_id}", plan_date),
    )
    for l in lines:
        execute(
            "INSERT INTO production_plan_lines "
            "(id, plan_id, qty, kg_per_unit, total_kg, qty_done, worker_entries) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb)",
            (l["id"], plan_id, l["qty"], l["kg"], l["qty"] * l["kg"],
             l.get("done", 0), json.dumps(l.get("entries", []))),
        )


def _wpis(wid, name, pieces):
    return {"workerId": wid, "workerName": name, "pieces": pieces, "addedAt": "10:00"}


# ── Układanie ────────────────────────────────────────────────────────────

def test_pracownik_dostaje_TYLKO_swoje_kilogramy(db):
    """Sedno sprawy: dwie osoby na pozycji 700 kg to 420 + 280, nie 700 + 700."""
    _worker("w1", "DAWID")
    _worker("w2", "DENYS")
    _plan("p1", "2026-08-25", [
        {"id": "l1", "qty": 20, "kg": 35, "done": 20,
         "entries": [_wpis("w1", "DAWID", 12), _wpis("w2", "DENYS", 8)]},
    ])

    d1 = get_worker_days("w1", "2026-08-25", "2026-08-25")
    d2 = get_worker_days("w2", "2026-08-25", "2026-08-25")
    assert [x["kgTotal"] for x in d1] == [420.0]   # 12 × 35
    assert [x["kgTotal"] for x in d2] == [280.0]   # 8 × 35
    assert d1[0]["kgTotal"] + d2[0]["kgTotal"] == 700.0


def test_sumuje_pozycje_o_roznych_wagach_sztuki(db):
    _worker("w1", "DAWID")
    _plan("p1", "2026-08-25", [
        {"id": "l1", "qty": 5,  "kg": 40, "done": 5,  "entries": [_wpis("w1", "DAWID", 5)]},
        {"id": "l2", "qty": 10, "kg": 20, "done": 10, "entries": [_wpis("w1", "DAWID", 10)]},
    ])
    assert get_worker_days("w1", "2026-08-25", "2026-08-25")[0]["kgTotal"] == 400.0


def test_dni_rozdzielone_po_dacie_planu(db):
    # `addedAt` we wpisie to sama godzina ("10:00") — dniem jest data PLANU.
    _worker("w1", "DAWID")
    _plan("p1", "2026-08-24", [{"id": "l1", "qty": 2, "kg": 10, "done": 2,
                                "entries": [_wpis("w1", "DAWID", 2)]}])
    _plan("p2", "2026-08-25", [{"id": "l2", "qty": 3, "kg": 10, "done": 3,
                                "entries": [_wpis("w1", "DAWID", 3)]}])
    dni = get_worker_days("w1", "2026-08-24", "2026-08-25")
    assert [(d["workDate"], d["kgTotal"]) for d in dni] == [
        ("2026-08-24", 20.0), ("2026-08-25", 30.0)]


def test_wpisy_tej_samej_osoby_na_jednej_pozycji_sumuja_sie(db):
    _worker("w1", "DAWID")
    _plan("p1", "2026-08-25", [
        {"id": "l1", "qty": 9, "kg": 10, "done": 9,
         "entries": [_wpis("w1", "DAWID", 4), _wpis("w1", "DAWID", 5)]},
    ])
    assert get_worker_days("w1", "2026-08-25", "2026-08-25")[0]["kgTotal"] == 90.0


def test_dzien_bez_rozbicia_liczy_sie_ze_starego_zrodla(db):
    """Furtka dla wyrobu dodanego RĘCZNIE z biura (`create_finished_goods`).

    Ta droga nadal istnieje i nie zapisuje sztuk per osoba, więc bez tej furtki
    ludzie z takiego dnia straciliby kilogramy. Nie chodzi o historię — dane
    sprzed wdrożenia są prototypowe (potwierdzone przez właściciela 24.08.2026).
    """
    _worker("w1", "ABY")
    goods = cuid()
    execute(
        "INSERT INTO finished_goods (id, batch_no, qty, total_kg, produced_date) "
        "VALUES (%s,'K/1',10,500,'2026-07-15')", (goods,))
    execute(
        "INSERT INTO finished_goods_sessions "
        "(id, goods_id, plan_line_id, qty, total_kg, worker_names, added_at) "
        "VALUES (%s,%s,'stara-linia',10,500,ARRAY['ABY'],'2026-07-15T10:00:00+02')",
        (cuid(),  goods))

    dni = get_worker_days("w1", "2026-07-15", "2026-07-15")
    assert [(d["workDate"], d["kgTotal"]) for d in dni] == [("2026-07-15", 500.0)]


def test_dzien_z_rozbiciem_NIE_dublowany_ze_starego_zrodla(db):
    """Gdy dzień ma rozbicie per osoba, sesje tego dnia się nie doliczają."""
    _worker("w1", "DAWID")
    _plan("p1", "2026-08-25", [{"id": "l1", "qty": 10, "kg": 35, "done": 10,
                                "entries": [_wpis("w1", "DAWID", 10)]}])
    goods = cuid()
    execute("INSERT INTO finished_goods (id, batch_no, qty, total_kg, produced_date) "
            "VALUES (%s,'K/2',10,350,'2026-08-25')", (goods,))
    execute("INSERT INTO finished_goods_sessions "
            "(id, goods_id, plan_line_id, qty, total_kg, worker_names, added_at) "
            "VALUES (%s,%s,'l1',10,350,ARRAY['DAWID'],'2026-08-25T10:00:00+02')",
            (cuid(), goods))

    dni = get_worker_days("w1", "2026-08-25", "2026-08-25")
    assert [d["kgTotal"] for d in dni] == [350.0]


# ── Foliowanie ───────────────────────────────────────────────────────────

def test_foliowanie_wchodzi_do_kilogramow_dnia(db):
    _worker("w3", "VLAD")
    save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": 4000}], "MARCIN")

    assert get_worker_days("w3", "2026-08-25", "2026-08-25")[0]["kgTotal"] == 4000.0


def test_ukladanie_i_foliowanie_sumuja_sie_dla_jednej_osoby(db):
    _worker("w1", "DAWID")
    _plan("p1", "2026-08-25", [{"id": "l1", "qty": 2, "kg": 35, "done": 2,
                                "entries": [_wpis("w1", "DAWID", 2)]}])
    save_wrapping("2026-08-25", [{"workerId": "w1", "workerName": "DAWID", "kg": 100}], "MARCIN")

    assert get_worker_days("w1", "2026-08-25", "2026-08-25")[0]["kgTotal"] == 170.0


def test_ponowny_zapis_nadpisuje_zamiast_dopisywac(db):
    """Poprawka ma być poprawką, nie drugim wpisem."""
    _worker("w3", "VLAD")
    save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": 4000}], "MARCIN")
    save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": 3500}], "MARCIN")

    assert [w["kg"] for w in day_wrapping("2026-08-25")] == [3500.0]
    assert get_worker_days("w3", "2026-08-25", "2026-08-25")[0]["kgTotal"] == 3500.0


def test_zapis_zerem_usuwa_wpis(db):
    _worker("w3", "VLAD")
    save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": 4000}], "MARCIN")
    save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": 0}], "MARCIN")

    assert day_wrapping("2026-08-25") == []


def test_kilku_foliowczykow_w_jednym_zapisie(db):
    _worker("w3", "VLAD")
    _worker("w4", "ADAM")
    save_wrapping("2026-08-25", [
        {"workerId": "w3", "workerName": "VLAD", "kg": 4000},
        {"workerId": "w4", "workerName": "ADAM", "kg": 4000},
    ], "MARCIN")

    assert sorted(w["kg"] for w in day_wrapping("2026-08-25")) == [4000.0, 4000.0]


def test_ujemne_kilogramy_odrzucone(db):
    _worker("w3", "VLAD")
    with pytest.raises(Exception):
        save_wrapping("2026-08-25", [{"workerId": "w3", "workerName": "VLAD", "kg": -1}], "MARCIN")


# ── Podział po równo ─────────────────────────────────────────────────────

def test_podzial_na_dwoch_daje_po_polowie():
    assert split_evenly(8000, 2) == [4000.0, 4000.0]


def test_podzial_na_trzech_sumuje_sie_co_do_kilograma():
    """33,3% × 3 nie daje całości — reszta idzie do pierwszego, nie znika."""
    czesci = split_evenly(1000, 3)
    assert sum(czesci) == 1000.0
    assert czesci == [333.34, 333.33, 333.33]


def test_podzial_zera_i_braku_ludzi_nie_wybucha():
    assert split_evenly(0, 2) == [0.0, 0.0]
    assert split_evenly(1000, 0) == []
