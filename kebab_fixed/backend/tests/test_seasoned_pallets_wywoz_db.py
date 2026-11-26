"""Wywóz palety mięsa przyprawionego na halę — skan z blokadą (plan A, zad. 3).

Właściciel 26.11.2026: „kierownik skanuje, co bierze na halę, i system go
puszcza albo nie, w zależności od tego, co robi z planu".
"""
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import seasoned_pallets_service as sp
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")

DZIS = datetime.now(ZoneInfo("Europe/Warsaw")).date()


def partia(batch_no="724", recipe_id="r-kirmizi", kg=598.0):
    sm = cuid()
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced, "
        "kg_available, kg_used, status, created_at) "
        "VALUES (%s,%s,%s,'KIRMIZI',%s,%s,0,'available',now())",
        (sm, batch_no, recipe_id, kg, kg))
    return sm


def paleta(sm, batch_no="724", recipe_id="r-kirmizi", kg=598.0, nr=None):
    pid = cuid()
    execute(
        "INSERT INTO seasoned_pallets (id, pallet_no, seasoned_meat_id, batch_no, recipe_id, "
        "recipe_name, kg_weighed, status) VALUES (%s,%s,%s,%s,%s,'KIRMIZI',%s,'in_cold')",
        (pid, nr or abs(hash(pid)) % 100000, sm, batch_no, recipe_id, kg))
    return pid


def plan(dzien=DZIS, gate=True, status="active"):
    pid = cuid()
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status, pallet_gate) "
        "VALUES (%s,%s,%s,%s,%s)",
        (pid, f"PP/{pid[:6]}", dzien.isoformat(), status, gate))
    return pid


def linia(plan_id, sm, batch_no="724", recipe_id="r-kirmizi", qty=20, kg=40):
    lid = cuid()
    execute(
        "INSERT INTO production_plan_lines (id, plan_id, qty, kg_per_unit, total_kg, "
        "recipe_id, recipe_name, seasoned_batch_id, seasoned_batch_no, seasoned_batch_nos, "
        "batch_allocation) VALUES (%s,%s,%s,%s,%s,%s,'KIRMIZI',%s,%s,%s,'{}')",
        (lid, plan_id, qty, kg, qty * kg, recipe_id, sm, batch_no, [batch_no]))
    return lid


def kod(pid):
    return "SP|" + pid


def test_paleta_z_planu_wyjezdza():
    sm = partia(); p = paleta(sm); pl = plan(); linia(pl, sm)
    out = sp.take_pallet(kod(p), "Kierownik")
    assert out["ok"] and out["planId"] == pl and out["batchNo"] == "724"
    assert out["lines"][0]["label"] == "20 × 40 kg KIRMIZI"
    row = query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (p,))
    assert row["status"] == "on_hall" and row["taken_plan_id"] == pl
    assert row["taken_by"] == "Kierownik" and row["taken_at"] is not None


def test_paleta_spoza_planu_blokada():
    sm = partia(); pl = plan(); linia(pl, sm)
    inna = paleta(partia("725"), batch_no="725")
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(inna))
    assert e.value.status_code == 409
    assert "nie jest w planie na dziś" in e.value.detail
    assert "725" in e.value.detail
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (inna,))["status"] == "in_cold"


def test_plan_na_jutro_blokuje():
    sm = partia(); p = paleta(sm); linia(plan(dzien=DZIS + timedelta(days=1)), sm)
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(p))
    assert e.value.status_code == 409


def test_plan_bez_gate_blokuje():
    sm = partia(); p = paleta(sm); linia(plan(gate=False), sm)
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(p))
    assert e.value.status_code == 409


def test_szkic_planu_nie_wpuszcza():
    sm = partia(); p = paleta(sm); linia(plan(status="draft"), sm)
    with pytest.raises(HTTPException):
        sp.take_pallet(kod(p))


def test_ten_sam_numer_partii_innej_receptury_blokuje():
    """Ta sama partia surowca w dwóch recepturach daje ten sam numer."""
    sm = partia(); pl = plan(); linia(pl, sm)
    beyaz = paleta(partia(recipe_id="r-beyaz"), recipe_id="r-beyaz")
    with pytest.raises(HTTPException):
        sp.take_pallet(kod(beyaz))


def test_drugi_skan_tej_samej_palety_do_tego_planu_ok():
    """Dubel skanera albo druga paleta fizyczna jednego wpisu — nie blokada."""
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    assert sp.take_pallet(kod(p))["again"] is False
    assert sp.take_pallet(kod(p))["again"] is True


def test_skan_palety_wywiezionej_do_innego_planu_blokuje():
    sm = partia(); p = paleta(sm); p1, p2 = plan(), plan()
    linia(p1, sm); linia(p2, sm)
    sp.take_pallet(kod(p), plan_id=p1)
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(p), plan_id=p2)
    assert e.value.status_code == 409 and "już wyjechała" in e.value.detail


def test_zuzyta_paleta():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    execute("UPDATE seasoned_pallets SET status='closed' WHERE id=%s", (p,))
    with pytest.raises(HTTPException) as e:
        sp.take_pallet(kod(p))
    assert e.value.status_code == 409 and "zużyta" in e.value.detail


def test_nieznany_kod():
    with pytest.raises(HTTPException) as e:
        sp.take_pallet("SP|0000000000000000ffff")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        sp.take_pallet("U|0000000000000000ffff")
    assert e.value.status_code == 404


def test_kod_ze_skanera_z_innym_znakiem_i_capslock():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    assert sp.take_pallet("sp-" + p.upper())["ok"]


def test_dwie_palety_tej_samej_partii_obie_wyjezdzaja():
    sm = partia(kg=1200); a = paleta(sm, kg=600); b = paleta(sm, kg=600); linia(plan(), sm, qty=30)
    assert sp.take_pallet(kod(a))["ok"] and sp.take_pallet(kod(b))["ok"]


def test_jawne_przypisanie_wygrywa():
    sm = partia(kg=1200); a = paleta(sm, kg=600); b = paleta(sm, kg=600)
    lid = linia(plan(), sm)
    execute("INSERT INTO plan_line_pallets (plan_line_id, pallet_id) VALUES (%s,%s)", (lid, a))
    assert sp.take_pallet(kod(a))["ok"]
    with pytest.raises(HTTPException):
        sp.take_pallet(kod(b))


def test_partia_z_alokacji_planu():
    """Plan rozpisany na partie trzyma je w batch_allocation."""
    sm = partia(); p = paleta(sm); pl = plan()
    lid = linia(pl, partia("999"), batch_no="999")
    execute("UPDATE production_plan_lines SET batch_allocation=%s::jsonb WHERE id=%s",
            ('{"724": {"pieces": 10, "kg": 400, "batch_id": "%s"}}' % sm, lid))
    assert sp.take_pallet(kod(p))["ok"]


def test_rownolegly_skan_przechodzi_raz():
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    wyniki = []

    def skan():
        try:
            wyniki.append("again" if sp.take_pallet(kod(p))["again"] else "ok")
        except HTTPException as e:
            wyniki.append(e.status_code)

    watki = [threading.Thread(target=skan) for _ in range(4)]
    for w in watki: w.start()
    for w in watki: w.join()
    # Dokładnie jeden skan wywozi; reszta to wyścig (409) albo ponowny skan
    # już wywiezionej palety do tego samego planu.
    assert wyniki.count("ok") == 1
    assert all(w in ("ok", "again", 409) for w in wyniki)
    assert query_one("SELECT status FROM seasoned_pallets WHERE id=%s", (p,))["status"] == "on_hall"


def test_trasa_take_i_lista():
    from app.main import app
    sm = partia(); p = paleta(sm); linia(plan(), sm)
    paths = {r.path for r in app.routes}
    assert "/api/seasoned-pallets/take" in paths and "/api/seasoned-pallets" in paths
    out = sp.take_pallet(kod(p))
    assert out["ok"]
    rows = query_one("SELECT count(*) AS n FROM seasoned_pallets WHERE status='on_hall'")
    assert rows["n"] == 1
    assert sp.pallet_out(query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (p,)))["qr"] == kod(p)
