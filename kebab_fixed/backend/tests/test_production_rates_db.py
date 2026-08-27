"""Uczenie tempa przy zamknięciu dnia przez halę.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.services.production_plans_service import tablet_finish, tablet_reopen
from app.services.production_rates_service import current_rates, learn_from_plan


def _dzien():
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, position, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        " product_type_id, batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES ('pl1','pp1',0,20,10,40.0,'r1','WROCLAW','p1','{}'::jsonb,'364','[]'::jsonb,'IN_PROGRESS')"
    )
    # Trzy zapisy co 30 min, po 2 osoby: pierwszy ustawia zegar, dwa kolejne
    # dają po 1 rbh i po 200 kg -> 400 kg / 2 rbh = 200 kg/rbh.
    for i, minuty in enumerate((0, 30, 60)):
        execute(
            "INSERT INTO production_work_events "
            "(id, plan_id, plan_line_id, recipe_id, recipe_name, kg_per_unit, "
            " pieces_delta, worker_id, worker_name, crew_size, at) "
            "VALUES (%s,'pp1','pl1','r1','WROCLAW',40.0,5,'w1','A',2, "
            "        timestamptz '2026-08-27 06:00:00+00' + (%s || ' minutes')::interval)",
            (f"e{i}", minuty),
        )


def test_zamkniecie_dnia_zostawia_probke_tempa(db):
    _dzien()
    tablet_finish("pp1", [])

    p = query_all("SELECT * FROM production_rate_samples WHERE plan_id='pp1'")
    assert len(p) == 1
    assert p[0]["recipe_id"] == "r1"
    assert float(p[0]["kg"]) == 400.0
    assert float(p[0]["person_hours"]) == 2.0


def test_cofniecie_i_ponowne_zamkniecie_NIE_liczy_dnia_dwa_razy(db):
    _dzien()
    tablet_finish("pp1", [])
    tablet_reopen("pp1")
    tablet_finish("pp1", [])

    p = query_all("SELECT kg, person_hours FROM production_rate_samples WHERE plan_id='pp1'")
    assert len(p) == 1
    assert float(p[0]["kg"]) == 400.0


def test_dzien_bez_zdarzen_nie_zostawia_probki(db):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp2','PP/2','2026-08-26','active')"
    )
    learn_from_plan("pp2")

    assert query_all("SELECT 1 FROM production_rate_samples WHERE plan_id='pp2'") == []


def test_blad_uczenia_nie_blokuje_zamkniecia_dnia(db, monkeypatch):
    """Hala nie może zostać z niezamkniętym dniem przez statystykę."""
    _dzien()
    import app.services.production_rates_service as rates

    def wybuch(_):
        raise RuntimeError("baza padla")

    monkeypatch.setattr(rates, "learn_from_plan", wybuch)
    wynik = tablet_finish("pp1", [])

    assert wynik["ok"] is True


def _probka(plan_id, recipe_id, kg, rbh, data="2026-08-27"):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES (%s,%s,%s,'done') ON CONFLICT (id) DO NOTHING",
        (plan_id, f"PP/{plan_id}", data),
    )
    execute(
        "INSERT INTO production_rate_samples (plan_id, recipe_id, plan_date, kg, person_hours) "
        "VALUES (%s,%s,%s,%s,%s)",
        (plan_id, recipe_id, data, kg, rbh),
    )


def test_bez_probek_tempo_stoi_na_ziarnie(db):
    from app.migrations import run_migrations
    run_migrations()
    r = current_rates()
    assert r["seed"] == 120.0
    assert r["global"] == 120.0
    assert r["byRecipe"] == {}


def test_jedna_probka_ciagnie_tempo_w_swoja_strone_ale_nie_do_konca(db):
    from app.migrations import run_migrations
    run_migrations()
    _probka("p1", "r1", 360.0, 2.0)          # 180 kg/rbh
    r = current_rates()
    assert r["global"] == 140.0              # (1x180 + 2x120)/3
    assert 140.0 < r["byRecipe"]["r1"] <= 180.0


def test_probki_starsze_niz_okno_odpadaja(db):
    from app.migrations import run_migrations
    run_migrations()
    _probka("p1", "r1", 360.0, 2.0, data="2026-01-01")
    r = current_rates()
    assert r["global"] == 120.0
    assert r["byRecipe"] == {}
