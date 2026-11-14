"""Receptury w PROTRIMA (13.11.2026): użycie, wycofanie z blokadą, przywrócenie.

Stary MES miał `deactivate` bez przycisku i bez żadnej kontroli — receptura
z otwartego zamówienia albo zaplanowanego masowania znikała z list wyboru,
a panel masowni dalej jej potrzebował. Teraz serwer odmawia (409) i podaje
powód, a lista receptur pokazuje „gdzie użyta" z tego samego źródła.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.recipes import RecipeCreate
from app.services import recipes_service as svc


def _receptura(rid="r1", nazwa="KIRMIZI"):
    execute("INSERT INTO recipes (id, name, active, created_at) VALUES (%s,%s,true,now())", (rid, nazwa))
    return rid


def _zamowienie(oid="o1", status="confirmed", rid="r1", kg=300):
    execute("INSERT INTO client_orders (id, order_no, client_name, order_date, delivery_date, created_at, status) "
            "VALUES (%s,%s,'VATAN','2026-11-13','2026-11-15',now(),%s)", (oid, f"Z/{oid}", status))
    execute("INSERT INTO client_order_lines (id, order_id, recipe_id, recipe_name, qty, kg_per_unit, total_kg) "
            "VALUES (%s,%s,%s,'KIRMIZI',10,%s,%s)", (f"{oid}-l1", oid, rid, kg / 10, kg))


def _masowanie(mid="m1", status="planned", rid="r1"):
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, status) "
            "VALUES (%s,%s,%s,'KIRMIZI',500,%s)", (mid, f"M/{mid}", rid, status))


def test_wycofanie_wolnej_receptury_i_przywrocenie(db):
    _receptura()
    svc.deactivate_recipe("r1")
    assert [r["id"] for r in svc.list_recipes()] == []
    assert [r["id"] for r in svc.list_recipes(archived=True)] == ["r1"]

    back = svc.activate_recipe("r1")
    assert back["active"] is True
    assert [r["id"] for r in svc.list_recipes()] == ["r1"]
    assert svc.list_recipes(archived=True) == []


def test_nie_wycofa_receptury_z_otwartego_zamowienia(db):
    _receptura(); _zamowienie()
    with pytest.raises(HTTPException) as e:
        svc.deactivate_recipe("r1")
    assert e.value.status_code == 409
    assert "Z/o1" in e.value.detail
    assert query_one("SELECT active FROM recipes WHERE id='r1'")["active"] is True


def test_nie_wycofa_receptury_z_niedokonczonym_masowaniem(db):
    _receptura(); _masowanie(status="in_progress")
    with pytest.raises(HTTPException) as e:
        svc.deactivate_recipe("r1")
    assert e.value.status_code == 409
    assert "masowania (1)" in e.value.detail


def test_zamkniete_zamowienie_i_zrobione_masowanie_nie_blokuja(db):
    _receptura(); _zamowienie(status="done"); _zamowienie("o2", status="cancelled"); _masowanie(status="done")
    svc.deactivate_recipe("r1")
    assert query_one("SELECT active FROM recipes WHERE id='r1'")["active"] is False


def test_wycofanie_nieistniejacej_404(db):
    with pytest.raises(HTTPException) as e:
        svc.deactivate_recipe("brak")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        svc.activate_recipe("brak")
    assert e.value.status_code == 404


def test_uzycie_zbiorcze_i_szczegoly(db):
    _receptura(); _receptura("r2", "BEYAZ")
    _zamowienie(kg=300); _zamowienie("o2", kg=120); _zamowienie("o3", status="done", kg=999)
    _masowanie(); _masowanie("m2", status="done")
    execute("INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced, kg_available, created_at) "
            "VALUES ('s1','131126 M1','r1','KIRMIZI',620,410.5,'2026-11-13 07:00+00'), "
            "('s2','121126 M9','r1','KIRMIZI',300,0,'2026-11-12 07:00+00')")

    u = {x["recipeId"]: x for x in svc.recipes_usage()}
    assert u["r1"]["openOrders"] == 2
    assert u["r1"]["openOrdersKg"] == 420
    assert u["r1"]["plannedMixing"] == 1
    assert u["r1"]["seasonedKg"] == 410.5
    assert u["r1"]["lastMixedAt"].startswith("2026-11-13")
    assert u["r2"] == {**u["r2"], "openOrders": 0, "plannedMixing": 0, "seasonedKg": 0, "lastMixedAt": None}

    d = svc.recipe_usage("r1")
    assert [z["orderNo"] for z in d["orders"]] == ["Z/o1", "Z/o2"]
    assert [m["orderNo"] for m in d["mixing"]] == ["M/m1"]
    assert d["mixing"][0]["planDate"] is None                 # bez dnia planu — nie udaje daty utworzenia
    assert [p["batchNo"] for p in d["seasoned"]] == ["131126 M1"]
    assert len(d["blockers"]) == 2


def test_edycja_zachowuje_kolejnosc_skladnikow(db):
    """Kolejność = technologia (woda zawsze ostatnia) — zapis musi ją zachować 1:1."""
    execute("INSERT INTO ingredients (id, name, unit, is_unlimited, active) VALUES "
            "('i1','VAN HESS','kg',false,true), ('i2','WODA','l',true,true)")
    _receptura()
    dto = RecipeCreate(name="KIRMIZI", shelfLifeDays=364, ingredients=[
        {"ingredientId": "i1", "qtyPer100kg": 4.5}, {"ingredientId": "i2", "qtyPer100kg": 20}])
    r = svc.update_recipe("r1", dto)
    assert [i["ingredient_id"] for i in r["ingredients"]] == ["i1", "i2"]
    assert float(r["total_output_per_100kg"]) == 124.5
    assert r["shelf_life_days"] == 364


def test_gdzie_uzyta_pokazuje_dzien_planu_nie_date_utworzenia(db):
    """Przegląd UI 14.11: zlecenia z września miały w „Gdzie użyta” datę utworzenia 13.11."""
    _receptura(); _masowanie("m1"); _masowanie("m2")
    execute("UPDATE mixing_orders SET plan_date='2026-09-19', created_at='2026-11-13 07:00+00' WHERE id='m1'")
    execute("UPDATE mixing_orders SET plan_date='2026-11-15', created_at='2026-11-01 07:00+00' WHERE id='m2'")
    d = svc.recipe_usage("r1")
    assert [(m["orderNo"], m["planDate"][:10]) for m in d["mixing"]] == [("M/m1", "2026-09-19"), ("M/m2", "2026-11-15")]
