"""Duplikowanie receptury.

Właściciel 24.09.2026: „dodaj możliwość duplikowania receptury — np. KIRMIZI
daję duplikuj i pojawia się KIRMIZI(1)". Receptury różnią się często jednym
składnikiem, a przepisywanie kilkunastu przypraw ręcznie to proszenie się
o literówkę w gramaturze.
"""
import pytest
from fastapi import HTTPException

from app.db import execute
from app.utils.ids import now_iso
from app.models.recipes import RecipeCreate, RecipeComponentDto, RecipeIngredientDto
from app.services import recipes_service as svc

pytestmark = pytest.mark.usefixtures("db")


def _skladniki():
    """Prawdziwe wiersze `ingredients` — `recipe_ingredients.ingredient_id`
    ma klucz obcy, więc wymyślone identyfikatory nie przejdą zapisu."""
    for iid, nazwa, jedn in [("ing-sol", "SÓL", "kg"), ("ing-woda", "WODA", "l")]:
        execute("INSERT INTO ingredients (id, code, name, unit, is_unlimited, "
                "active, created_at) VALUES (%s,%s,%s,%s,false,true,%s) "
                "ON CONFLICT (id) DO NOTHING", (iid, iid.upper(), nazwa, jedn, now_iso()))


def _kirmizi(nazwa="KIRMIZI"):
    _skladniki()
    return svc.create_recipe(RecipeCreate(
        name=nazwa,
        shelfLifeDays=7,
        mixingMinutes=35,
        notes="mieszać wolno",
        ingredients=[
            RecipeIngredientDto(ingredientId="ing-sol", ingredientName="SÓL", unit="kg", qtyPer100kg=1.8),
            RecipeIngredientDto(ingredientId="ing-woda", ingredientName="WODA", unit="l", qtyPer100kg=8.0),
        ],
    ))


def test_duplikat_dostaje_nazwe_z_jedynka():
    r = _kirmizi()

    kopia = svc.duplicate_recipe(r["id"])

    assert kopia["name"] == "KIRMIZI(1)"


def test_drugi_duplikat_dostaje_kolejny_numer():
    """Dwa razy „duplikuj" na tej samej recepturze nie mogą dać dwóch
    receptur o identycznej nazwie — biuro nie odróżniłoby ich na liście."""
    r = _kirmizi()
    svc.duplicate_recipe(r["id"])

    assert svc.duplicate_recipe(r["id"])["name"] == "KIRMIZI(2)"


def test_duplikat_duplikatu_nie_zagniezdza_nawiasow():
    """„KIRMIZI(1)(1)" po kilku kopiach robi się nieczytelne — numerujemy
    od nazwy bazowej."""
    r = _kirmizi()
    kopia = svc.duplicate_recipe(r["id"])

    assert svc.duplicate_recipe(kopia["id"])["name"] == "KIRMIZI(2)"


def test_duplikat_kopiuje_skladniki_z_kolejnoscia():
    """Sens funkcji: nie przepisywać przypraw ręcznie. Kolejność jest
    znacząca — woda ZAWSZE ostatnia (patrz plan masowania)."""
    r = _kirmizi()

    kopia = svc.duplicate_recipe(r["id"])

    assert [(i["ingredient_name"], float(i["qty_per_100kg"])) for i in kopia["ingredients"]] == [
        ("SÓL", 1.8), ("WODA", 8.0),
    ]


def test_duplikat_kopiuje_pozostale_pola():
    r = _kirmizi()

    kopia = svc.duplicate_recipe(r["id"])

    assert kopia["mixing_minutes"] == 35
    assert kopia["shelf_life_days"] == 7
    assert kopia["notes"] == "mieszać wolno"
    assert float(kopia["total_output_per_100kg"]) == pytest.approx(109.8)


def test_duplikat_kopiuje_sklad_komponentowy():
    """Kebab komponentowy 70/30: skład produkcyjny jest źródłem prawdy dla
    produkcji, więc kopia bez niego byłaby inną recepturą."""
    r = svc.create_recipe(RecipeCreate(name="MIX", components=[
        RecipeComponentDto(materialName="UDO", pct=70),
        RecipeComponentDto(materialName="PIERŚ", pct=30),
    ]))

    kopia = svc.duplicate_recipe(r["id"])

    assert [(c["materialName"], c["pct"]) for c in kopia["components"]] == [
        ("UDO", 70.0), ("PIERŚ", 30.0),
    ]


def test_duplikat_NIE_przejmuje_kodu_oryginalu():
    """`recipes.code` ma unikalny indeks — skopiowany kod wywaliłby zapis
    albo, gorzej, wskazywał w katalogu wyrobów dwie różne receptury."""
    r = _kirmizi()
    execute("UPDATE recipes SET code='KIR' WHERE id=%s", (r["id"],))

    kopia = svc.duplicate_recipe(r["id"])

    assert not (kopia.get("code") or "")


def test_duplikat_jest_OSOBNA_receptura():
    """Edycja kopii nie może ruszyć oryginału — inaczej „duplikuj" byłoby
    tylko myląca nazwą dla „edytuj"."""
    r = _kirmizi()
    kopia = svc.duplicate_recipe(r["id"])

    svc.update_recipe(kopia["id"], RecipeCreate(name="KIRMIZI OSTRY", mixingMinutes=50))

    assert svc.get_recipe(r["id"])["name"] == "KIRMIZI"
    assert svc.get_recipe(r["id"])["mixing_minutes"] == 35


def test_duplikat_jest_aktywny_i_widoczny_na_liscie():
    r = _kirmizi()

    svc.duplicate_recipe(r["id"])

    assert "KIRMIZI(1)" in {x["name"] for x in svc.list_recipes()}


def test_duplikowanie_nieznanej_receptury_odmawia():
    with pytest.raises(HTTPException) as e:
        svc.duplicate_recipe("nie-ma-takiej")
    assert e.value.status_code == 404
