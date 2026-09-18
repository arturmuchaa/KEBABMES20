"""Czas masowania zapisany w recepturze.

Właściciel 18.09.2026: „standard to 50 minut, ale są receptury np. YAPRAK,
które są na pół godziny — chcę definiować czas w recepturze, a masownica ma
go pobierać". Panel masowni czyta go z WSADU (kopia zrobiona przy załadunku),
więc tu pilnujemy tylko źródła: receptury.
"""
import pytest

from app.models.recipes import RecipeCreate
from app.services import recipes_service as svc

pytestmark = pytest.mark.usefixtures("db")


def test_receptura_zapamietuje_czas_masowania():
    r = svc.create_recipe(RecipeCreate(name="YAPRAK", mixingMinutes=30))
    assert r["mixing_minutes"] == 30
    assert svc.get_recipe(r["id"])["mixing_minutes"] == 30


def test_receptura_bez_czasu_zostaje_pusta():
    """NULL, nie 50 — inaczej nie da się odróżnić „ustawione" od „nigdy nie
    ruszane", a zmiana standardu w panelu ominęłaby stare receptury."""
    r = svc.create_recipe(RecipeCreate(name="STANDARD"))
    assert r["mixing_minutes"] is None


def test_zero_minut_nie_przechodzi():
    """„0 minut" znaczyłoby dla panelu wsad gotowy do odbioru w chwili startu."""
    r = svc.create_recipe(RecipeCreate(name="ZERO", mixingMinutes=0))
    assert r["mixing_minutes"] is None


def test_edycja_receptury_zmienia_czas():
    r = svc.create_recipe(RecipeCreate(name="YAPRAK", mixingMinutes=30))
    svc.update_recipe(r["id"], RecipeCreate(name="YAPRAK", mixingMinutes=35))
    assert svc.get_recipe(r["id"])["mixing_minutes"] == 35


def test_czas_wraca_z_listy_receptur():
    """Panel masowni i biuro czytają listę — bez tego pola czas byłby niewidoczny."""
    svc.create_recipe(RecipeCreate(name="YAPRAK", mixingMinutes=30))
    lista = {r["name"]: r for r in svc.list_recipes()}
    assert lista["YAPRAK"]["mixing_minutes"] == 30
