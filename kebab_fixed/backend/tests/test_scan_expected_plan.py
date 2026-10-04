"""Skan z głównego ekranu HMI — strażnik oczekiwanego planu, BEZ bazy.

Hala skanuje różne pozycje na przemian, bez wybierania pozycji. Etykieta
wskazuje pozycję, a HMI podaje `expected_plan_id` — plan widoczny w chwili
skanu. Obcy plan, zdjęta pozycja i zamknięty / wysłany do biura plan muszą
odbić się ZANIM ruszy sztuka albo magazyn.

Baza jest podmieniona na atrapę rozpoznającą zapytania po treści SQL; każda
zmiana (UPDATE sztuki, księgowanie) jest zapisywana, więc odmowa „bez
zapisu" jest sprawdzana wprost. Wersja na prawdziwej bazie:
`test_line_scan_guard_db.py`.
"""
from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from app.services import finished_units_service as svc
from app.services import unit_stock_service

UNIT = "a1b2c3d4e5f60718293a"
KOD = f"U|{UNIT}"


class Atrapa:
    def __init__(self, *, status="planned", line_plan="p1", plan=None, linia=True, plan_line="l1"):
        self.unit = {"id": UNIT, "status": status, "plan_line_id": plan_line,
                     "client_name": "Bulli", "batch_no": "344", "weight_kg": 35}
        self.line_plan = line_plan
        self.linia = linia
        self.plan = plan if plan is not None else {
            "id": "p1", "status": "active", "tablet_finished_at": None, "office_confirmed_at": None,
        }
        self.zapisy = []
        self.zapytania = []

    def query_one(self, conn, sql, params=()):
        self.zapytania.append(sql)
        s = " ".join(sql.split())
        if s.startswith("SELECT * FROM finished_units"):
            return dict(self.unit)
        if "row_number()" in s:
            return {"lp": 2, "recipe_name": "KIRMIZI"}
        if "FROM production_plan_lines" in s:
            if not self.linia:
                return None
            if "AND plan_id=%s" in s and params[1] != self.line_plan:
                return None
            return {"id": params[0], "plan_id": self.line_plan,
                    "recipe_name": "WROCŁAW", "product_type_name": "KEBAB"}
        if "FROM production_plans" in s:
            if "FOR UPDATE" in s:
                return dict(self.plan) if self.plan else None
            return {"plan_no": "PP/9", "plan_date": "2026-10-02"}
        if "count(*)" in s:
            return {"done": 1, "total": 4}
        raise AssertionError(f"nieoczekiwane zapytanie: {s}")

    def execute(self, conn, sql, params=()):
        self.zapisy.append(("sql", " ".join(sql.split())))

    def book(self, conn, unit):
        self.zapisy.append(("book", unit["id"]))
        return "g1"


@pytest.fixture()
def atrapa(monkeypatch):
    def zrob(**kw):
        a = Atrapa(**kw)

        @contextmanager
        def tx():
            yield object()

        monkeypatch.setattr(svc, "transaction", tx)
        monkeypatch.setattr(svc, "cx_query_one", a.query_one)
        monkeypatch.setattr(svc, "cx_execute", a.execute)
        monkeypatch.setattr(unit_stock_service, "book_scanned_unit", a.book)
        return a
    return zrob


def _odmowa(**kw):
    with pytest.raises(HTTPException) as e:
        svc.scan_produced(KOD, expected_plan_id="p1", **kw)
    return e.value


def test_wlasny_plan_przechodzi_i_oddaje_autorytatywne_dane(atrapa):
    a = atrapa()
    w = svc.scan_produced(KOD, expected_plan_id="p1")
    assert w["planId"] == "p1" and w["planLineId"] == "l1"
    assert w["recipeName"] == "WROCŁAW" and w["productTypeName"] == "KEBAB"
    assert (w["clientName"], w["batchNo"], w["weightKg"]) == ("Bulli", "344", 35.0)
    assert (w["done"], w["total"], w["onStock"]) == (1, 4, True)
    assert ("book", UNIT) in a.zapisy
    # Plan zablokowany w tej samej transakcji, PO sztuce (kolejność jak w księgowaniu).
    blokady = [q for q in a.zapytania if "FOR UPDATE" in q]
    assert "finished_units" in blokady[0] and "production_plans" in blokady[1]


def test_druga_linia_tego_samego_planu_przechodzi(atrapa):
    atrapa(plan_line="l2")
    assert svc.scan_produced(KOD, expected_plan_id="p1")["planLineId"] == "l2"


def test_draft_przechodzi(atrapa):
    atrapa(plan={"id": "p1", "status": "draft", "tablet_finished_at": None, "office_confirmed_at": None})
    assert svc.scan_produced(KOD, expected_plan_id="p1")["ok"] is True


def test_obcy_plan_odbija_sie_bez_zapisu(atrapa):
    a = atrapa(line_plan="p2")
    e = _odmowa()
    assert e.status_code == 409 and "innego planu" in e.detail and "PP/9" in e.detail
    assert a.zapisy == []


def test_usunieta_pozycja_odbija_sie_bez_zapisu(atrapa):
    a = atrapa(linia=False)
    e = _odmowa()
    assert e.status_code == 409 and "nie ma już w planie" in e.detail
    assert a.zapisy == []


def test_sztuka_bez_pozycji_odbija_sie_bez_zapisu(atrapa):
    a = atrapa(plan_line=None)
    assert _odmowa().status_code == 409
    assert a.zapisy == []


@pytest.mark.parametrize("plan", [
    {"id": "p1", "status": "done", "tablet_finished_at": None, "office_confirmed_at": None},
    {"id": "p1", "status": "cancelled", "tablet_finished_at": None, "office_confirmed_at": None},
    {"id": "p1", "status": "active", "tablet_finished_at": None, "office_confirmed_at": "2026-10-03T15:00"},
    {"id": "p1", "status": "active", "tablet_finished_at": "2026-10-03T14:00", "office_confirmed_at": None},
])
def test_zamkniety_lub_wyslany_plan_odbija_sie_bez_zapisu(atrapa, plan):
    a = atrapa(plan=plan)
    e = _odmowa()
    assert e.status_code == 409
    assert a.zapisy == []


def test_dubel_nie_nalicza_drugi_raz(atrapa):
    a = atrapa(status="produced")
    e = _odmowa()
    assert e.status_code == 409 and "już zeskanowana" in e.detail
    assert a.zapisy == []


def test_bez_expected_plan_zachowanie_dotychczasowe(atrapa):
    """Mobile: brak strażnika planu — nawet plan wysłany do biura jak dotąd."""
    a = atrapa(plan={"id": "p1", "status": "active", "tablet_finished_at": "2026-10-03T14:00",
                     "office_confirmed_at": None})
    w = svc.scan_produced(KOD)
    assert w["ok"] is True and w["planId"] == "p1"
    assert not any("production_plans" in q and "FOR UPDATE" in q for q in a.zapytania)


def test_legacy_plan_line_guard_nadal_dziala(atrapa):
    a = atrapa(plan_line="l2")
    with pytest.raises(HTTPException) as e:
        svc.scan_produced(KOD, plan_line_id="l1")
    assert e.value.status_code == 409
    assert a.zapisy == []
