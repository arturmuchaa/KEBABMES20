"""Materiały dnia produkcyjnego — folia stretch do kosztów.

`packaging.kg_used` to licznik NARASTAJĄCY: nie odpowie na pytanie „ile folii
poszło 25.08". Do kosztów potrzebny zapis per dzień, który przeżyje zamknięcie
planu (koszt liczy się po fakcie, czasem po tygodniu).

Zwrot jest ruchem magazynowym w drugą stronę — inaczej stan folii rozjeżdżałby
się z fizycznym i trzeba by go ratować inwentaryzacją.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.day_materials_service import (
    day_materials, return_material, take_material,
)
from app.utils.ids import cuid


@pytest.fixture()
def folia(db):
    """Kartoteka folii stretch — jednostka „rolka", 100 rolek na magazynie."""
    pid = cuid()
    execute(
        "INSERT INTO packaging (id, code, name, type, unit, kg_initial, kg_available, kg_used) "
        "VALUES (%s, 'FOLIA-STRETCH', 'Folia stretch', 'FOLIA', 'rolka', 100, 100, 0)",
        (pid,),
    )
    return pid


def _stan(pid):
    r = query_one("SELECT kg_available, kg_used FROM packaging WHERE id=%s", (pid,))
    return float(r["kg_available"]), float(r["kg_used"])


def test_pobranie_zdejmuje_stan_od_razu(folia):
    take_material("2026-08-25", folia, 40, "MARCIN")

    assert _stan(folia) == (60.0, 40.0)


def test_dokladka_w_ciagu_dnia_sumuje_sie(folia):
    take_material("2026-08-25", folia, 40, "MARCIN")
    take_material("2026-08-25", folia, 20, "MARCIN")

    dzien = day_materials("2026-08-25")
    poz = [p for p in dzien if p["packaging_id"] == folia][0]
    assert poz["pobrane"] == 60.0
    assert poz["zuzyte"] == 60.0


def test_zwrot_oddaje_na_magazyn_i_zdejmuje_z_zuzycia(folia):
    take_material("2026-08-25", folia, 60, "MARCIN")
    return_material("2026-08-25", folia, 5, "MARCIN")

    assert _stan(folia) == (45.0, 55.0)
    poz = [p for p in day_materials("2026-08-25") if p["packaging_id"] == folia][0]
    assert (poz["pobrane"], poz["zwrocone"], poz["zuzyte"]) == (60.0, 5.0, 55.0)


def test_zwrot_wiekszy_niz_pobrano_odrzucony(folia):
    take_material("2026-08-25", folia, 60, "MARCIN")

    with pytest.raises(HTTPException) as e:
        return_material("2026-08-25", folia, 61, "MARCIN")
    assert e.value.status_code == 400
    # Stan nietknięty — zwrot z powietrza podniósłby magazyn.
    assert _stan(folia) == (40.0, 60.0)


def test_zwrot_nie_moze_siegnac_po_pobranie_z_innego_dnia(folia):
    take_material("2026-08-24", folia, 50, "MARCIN")
    take_material("2026-08-25", folia, 10, "MARCIN")

    with pytest.raises(HTTPException):
        return_material("2026-08-25", folia, 11, "MARCIN")


def test_zuzycie_liczone_per_dzien_a_nie_narastajaco(folia):
    take_material("2026-08-24", folia, 30, "MARCIN")
    take_material("2026-08-25", folia, 10, "MARCIN")

    wczoraj = [p for p in day_materials("2026-08-24") if p["packaging_id"] == folia][0]
    dzis    = [p for p in day_materials("2026-08-25") if p["packaging_id"] == folia][0]
    assert wczoraj["zuzyte"] == 30.0
    assert dzis["zuzyte"] == 10.0
    # kg_used jest narastające i właśnie dlatego nie nadaje się do kosztu dnia.
    assert _stan(folia)[1] == 40.0


def test_pobranie_ponad_stan_odrzucone(folia):
    with pytest.raises(HTTPException) as e:
        take_material("2026-08-25", folia, 101, "MARCIN")
    assert e.value.status_code == 400
    assert _stan(folia) == (100.0, 0.0)


def test_kazdy_ruch_zostawia_slad_w_stock_movements(folia):
    take_material("2026-08-25", folia, 40, "MARCIN")
    return_material("2026-08-25", folia, 5, "MARCIN")

    ruchy = query_all(
        "SELECT movement_type, qty FROM stock_movements "
        "WHERE product_type='packaging' AND batch_id=%s ORDER BY created_at",
        (folia,),
    )
    assert [(r["movement_type"], float(r["qty"])) for r in ruchy] == [("OUT", -40.0), ("IN", 5.0)]


def test_zapis_dnia_przezywa_zamkniecie_planu(folia):
    """Koszt liczy się po fakcie — historia nie może wisieć na aktywnym planie."""
    take_material("2026-08-25", folia, 40, "MARCIN")
    return_material("2026-08-25", folia, 5, "MARCIN")

    wiersze = query_all(
        "SELECT kind, qty FROM production_day_materials WHERE work_date=%s AND packaging_id=%s "
        "ORDER BY created_at",
        ("2026-08-25", folia),
    )
    assert [(w["kind"], float(w["qty"])) for w in wiersze] == [("pobranie", 40.0), ("zwrot", 5.0)]


def test_dzien_bez_ruchow_jest_pusty(db):
    assert day_materials("2026-01-01") == []


def test_zero_i_ujemne_odrzucone(folia):
    for zla in (0, -5):
        with pytest.raises(HTTPException):
            take_material("2026-08-25", folia, zla, "MARCIN")
        with pytest.raises(HTTPException):
            return_material("2026-08-25", folia, zla, "MARCIN")
