"""Sztuki mieszane (PM) WYŁĄCZONE — jedna sztuka = jedna partia mięsa.

Na magazynie przyprawionym leży mięso z gotowymi partiami, więc wyrób ma
dostać numer JEDNEJ z nich. Resztka poniżej masy sztuki zostaje w partii
(uzgadnia ją korekta przyprawionego), a brakujące sztuki planista pokrywa
dołożeniem kolejnej partii.

Zachowanie z PM (gdy ALLOW_MIXED_PIECES=True) pilnuje
test_compute_allocation_mixed.py — przełącznik ma pozostać działający.
"""
import app.services.production_plans_service as svc
from app.models.production import PlanLineCreate
from app.services.production_plans_service import (
    MIXED_KEY,
    _allocation_kg_per_batch,
    _allocate_components,
    _check_plan_shortfalls,
    _compute_allocation,
)


def _locked(rows):
    return {r["id"]: dict(r) for r in rows}


def test_pm_wylaczone_domyslnie():
    assert svc.ALLOW_MIXED_PIECES is False


def test_resztki_dwoch_partii_nie_skladaja_sztuki():
    # 1 kg + 19 kg = 20 kg, ale żadna partia nie ma całych 20 kg na sztukę
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 19.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert MIXED_KEY not in alloc
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 0
    # nic nie rezerwujemy — mięso zostaje w magazynie
    assert _allocation_kg_per_batch(alloc) == {}


def test_resztka_zostaje_w_partii_sztuki_ida_z_pelnej():
    # 20 szt × 20 kg; 346 = resztka 15 kg (0 szt), 347 = 385 kg (19 szt)
    # → 19 sztuk, jedna nieprzydzielona; 15 kg resztki NIETKNIĘTE
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 15.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 385.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=20, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 400.0, locked)
    assert MIXED_KEY not in alloc
    assert alloc["346"]["pieces"] == 0
    assert alloc["347"]["pieces"] == 19
    assert _allocation_kg_per_batch(alloc) == {"b": 380.0}
    # snapshot puli zmniejszony tylko o realnie zarezerwowane kg
    assert locked["a"]["kg_reserved"] == 0
    assert locked["b"]["kg_reserved"] == 380.0


def test_czysty_podzial_bez_zmian():
    # bez resztek zachowanie identyczne jak z PM
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 120.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 360.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=24, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 480.0, locked)
    assert MIXED_KEY not in alloc
    assert alloc["346"]["pieces"] == 6
    assert alloc["347"]["pieces"] == 18


def test_resztka_pp1_nie_wchodzi_do_sztuki():
    # PP1 ma 30 kg przy sztuce 40 kg → PP1 zostaje nietknięte,
    # wszystkie 20 sztuk idzie z 349 (wcześniej: 1 sztuka mieszana PP1+349)
    locked = _locked([
        {"id": "pp", "batch_no": "PP1", "kg_available": 30.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "349", "kg_available": 900.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=20, kg_per_unit=40, recipe_id="r",
                          seasoned_batch_ids=["pp", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 800.0, locked)
    assert MIXED_KEY not in alloc
    assert alloc["PP1"]["pieces"] == 0
    assert alloc["349"]["pieces"] == 20
    assert _allocation_kg_per_batch(alloc) == {"b": 800.0}


def test_przelacznik_przywraca_sztuki_mieszane(monkeypatch):
    monkeypatch.setattr(svc, "ALLOW_MIXED_PIECES", True)
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 19.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert alloc[MIXED_KEY]["pieces"] == 1


# ── Walidacja niedoborów liczy SZTUKI, nie same kilogramy ─────────────

def test_niedobor_gdy_kg_starcza_ale_zadna_partia_nie_da_calej_sztuki():
    # 2 × 30 kg = 60 kg wolnego przy sztuce 40 kg → ANI JEDNEJ sztuki
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 30.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 30.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=40, recipe_id="r",
                          recipe_name="Kebab", seasoned_batch_ids=["a", "b"])
    errs = _check_plan_shortfalls(None, [line], locked)
    assert len(errs) == 1
    assert "brakuje" in errs[0]


def test_brak_niedoboru_gdy_partia_pokrywa_sztuki():
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 251.7, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=6, kg_per_unit=40, recipe_id="r",
                          recipe_name="Kebab", seasoned_batch_ids=["a"])
    assert _check_plan_shortfalls(None, [line], locked) == []


def test_pozycje_planu_dziela_pule_po_kolei():
    # 100 kg wolne, dwie pozycje po 2 szt × 40 kg → druga jest krótka
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 100.0, "kg_reserved": 0},
    ])
    lines = [
        PlanLineCreate(qty=2, kg_per_unit=40, recipe_id="r",
                       recipe_name="Kebab", seasoned_batch_ids=["a"]),
        PlanLineCreate(qty=2, kg_per_unit=40, recipe_id="r",
                       recipe_name="Kebab", seasoned_batch_ids=["a"]),
    ]
    errs = _check_plan_shortfalls(None, lines, locked)
    assert len(errs) == 1


# ── Kebab komponentowy (70/30) — udział komponentu z JEDNEJ partii ────

def _pool(*rows):
    return [dict(r) for r in rows]


def test_komponent_bierze_udzial_z_jednej_partii():
    comps = [{"materialTypeId": "udo", "pct": 70}, {"materialTypeId": "filet", "pct": 30}]
    pools = [
        _pool({"bid": "u1", "b_no": "355", "free": 140.0}),
        _pool({"bid": "f1", "b_no": "356", "free": 60.0}),
    ]
    alloc = _allocate_components(2, 100.0, comps, pools)
    assert MIXED_KEY not in alloc
    assert alloc["355/356"]["pieces"] == 2


def test_komponent_nie_dosztukowuje_z_drugiej_partii():
    # udo: 70 kg potrzebne na sztukę, partie 40 + 40 → sztuki NIE da się złożyć
    comps = [{"materialTypeId": "udo", "pct": 70}, {"materialTypeId": "filet", "pct": 30}]
    pools = [
        _pool({"bid": "u1", "b_no": "355", "free": 40.0},
              {"bid": "u2", "b_no": "357", "free": 40.0}),
        _pool({"bid": "f1", "b_no": "356", "free": 300.0}),
    ]
    alloc = _allocate_components(1, 100.0, comps, pools)
    assert MIXED_KEY not in alloc
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 0
    # pule nietknięte — nic nie zarezerwowano
    assert pools[0][0]["free"] == 40.0
    assert pools[1][0]["free"] == 300.0


def test_komponent_przechodzi_na_kolejna_partie_gdy_pierwsza_za_mala():
    comps = [{"materialTypeId": "udo", "pct": 70}, {"materialTypeId": "filet", "pct": 30}]
    pools = [
        _pool({"bid": "u1", "b_no": "355", "free": 40.0},
              {"bid": "u2", "b_no": "357", "free": 140.0}),
        _pool({"bid": "f1", "b_no": "356", "free": 300.0}),
    ]
    alloc = _allocate_components(1, 100.0, comps, pools)
    assert alloc["357/356"]["pieces"] == 1
    assert pools[0][0]["free"] == 40.0     # 355 nietknięte
    assert pools[0][1]["free"] == 70.0
