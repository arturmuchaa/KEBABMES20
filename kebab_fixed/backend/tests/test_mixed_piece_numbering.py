"""Sztuka złożona z resztek kilku partii — jak ją numerujemy.

Przy planie na maksymalne wykorzystanie mięsa ostatnia sztuka bywa składana
z resztek kilku partii. MIXED_PIECE_NUMBERING decyduje, jaki numer dostaje:

  "joined" (domyślnie) — numer ŁĄCZONY z realnych partii, np. "471/472";
                         widać, z czego sztuka jest, bez zbiorczego PM
  "pm"                 — jeden zbiorczy PM{n} (pilnuje go
                         test_compute_allocation_mixed.py)
  "off"                — takich sztuk nie składamy; resztka zostaje w partii
"""
import pytest

import app.services.production_plans_service as svc
from app.models.production import PlanLineCreate
from app.services.production_plans_service import (
    MIXED_KEY,
    _allocate_components,
    _allocation_kg_per_batch,
    _check_plan_shortfalls,
    _compute_allocation,
)


def _locked(rows):
    return {r["id"]: dict(r) for r in rows}


def _pool(*rows):
    return [dict(r) for r in rows]


@pytest.fixture
def tryb_off(monkeypatch):
    monkeypatch.setattr(svc, "MIXED_PIECE_NUMBERING", "off")


def test_domyslnie_numer_laczony():
    assert svc.MIXED_PIECE_NUMBERING == "joined"


# ── Tryb domyślny: numer łączony ──────────────────────────────────────

def test_sztuka_z_resztek_dostaje_numer_obu_partii():
    # 1 kg z 346 + 19 kg z 347 = sztuka 20 kg → numer "346/347", NIE PM
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 19.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert MIXED_KEY not in alloc
    assert alloc["346/347"]["pieces"] == 1
    assert alloc["346/347"]["kg"] == 20.0
    assert alloc["346/347"]["parts"]["346"] == {"kg": 1.0, "batch_id": "a"}
    assert alloc["346/347"]["parts"]["347"] == {"kg": 19.0, "batch_id": "b"}
    # rezerwacje schodzą z OBU partii źródłowych
    assert _allocation_kg_per_batch(alloc) == {"a": 1.0, "b": 19.0}
    # numer trafia do lineage pozycji (seasoned_batch_nos)
    assert "346/347" in nos


def test_sztuka_z_trzech_resztek_niesie_trzy_numery():
    # przypadek z produkcji 13.08: 16,2 + 8,5 + 5,3 kg = sztuka 30 kg
    locked = _locked([
        {"id": "a", "batch_no": "471", "kg_available": 16.2, "kg_reserved": 0},
        {"id": "b", "batch_no": "472", "kg_available": 8.5, "kg_reserved": 0},
        {"id": "c", "batch_no": "PP12", "kg_available": 7.7, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=30, recipe_id="r",
                          seasoned_batch_ids=["a", "b", "c"])
    _, alloc, _, _ = _compute_allocation(None, line, 30.0, locked)
    assert alloc["471/472/PP12"]["pieces"] == 1
    kg = _allocation_kg_per_batch(alloc)
    assert kg["a"] == 16.2 and kg["b"] == 8.5
    assert round(kg["c"], 3) == 5.3          # z PP12 tylko dopełnienie
    # migawka puli MUSI zejść też o kg sztuki łączonej — inaczej kolejna
    # pozycja planu liczy się na zawyżonym stanie i dostaje fałszywe 409
    assert locked["c"]["kg_reserved"] == 5.3  # 2,4 kg zostaje wolne


def test_maksymalne_wykorzystanie_zamyka_sie_bez_bledu():
    # BEYAZ AFIYET 13.08: 1486,2 + 1238,5 + 247,7 kg, sztuka 30 kg.
    # Samych całych sztuk wychodzi 98 — 99. powstaje z resztek. Resztka
    # każdej partii jest zużywana OD RAZU, więc zamiast jednej sztuki
    # z trzech partii mamy dwie, każda z dwóch: "471/472" i "472/PP12".
    locked = _locked([
        {"id": "a", "batch_no": "471", "kg_available": 1486.2, "kg_reserved": 0},
        {"id": "b", "batch_no": "472", "kg_available": 1238.5, "kg_reserved": 0},
        {"id": "c", "batch_no": "PP12", "kg_available": 247.7, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=99, kg_per_unit=30, recipe_id="r",
                          recipe_name="BEYAZ AFIYET",
                          seasoned_batch_ids=["a", "b", "c"])
    assert _check_plan_shortfalls(None, [line], _locked([
        {"id": "a", "batch_no": "471", "kg_available": 1486.2, "kg_reserved": 0},
        {"id": "b", "batch_no": "472", "kg_available": 1238.5, "kg_reserved": 0},
        {"id": "c", "batch_no": "PP12", "kg_available": 247.7, "kg_reserved": 0},
    ])) == []
    _, alloc, _, _ = _compute_allocation(None, line, 2970.0, locked)
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 99
    assert MIXED_KEY not in alloc
    assert alloc["471"]["pieces"] == 49
    assert alloc["472"]["pieces"] == 40
    assert alloc["PP12"]["pieces"] == 8
    assert alloc["471/472"]["pieces"] == 1
    assert alloc["472/PP12"]["pieces"] == 1
    # cały plan zarezerwowany co do kilograma (2970 z 2972,4 kg puli)
    assert round(sum(locked[b]["kg_reserved"] for b in "abc"), 1) == 2970.0


def test_czysty_podzial_nie_tworzy_kubelka_laczonego():
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 120.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 360.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=24, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 480.0, locked)
    assert set(alloc) == {"346", "347"}
    assert alloc["346"]["pieces"] == 6
    assert alloc["347"]["pieces"] == 18


def test_dwie_rozne_kombinacje_to_dwa_numery():
    # 3 szt × 20 kg z partii 10 / 15 / 35 kg:
    #   346(10)+347(10) → "346/347", potem 347(5)+348(15) → "347/348"
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 10.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 15.0, "kg_reserved": 0},
        {"id": "c", "batch_no": "348", "kg_available": 35.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=3, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b", "c"])
    _, alloc, _, _ = _compute_allocation(None, line, 60.0, locked)
    assert alloc["346/347"]["pieces"] == 1
    assert alloc["347/348"]["pieces"] == 1
    assert alloc["348"]["pieces"] == 1
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 3


def test_niedobor_gdy_nawet_resztki_nie_zlozy_sztuki():
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 5.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          recipe_name="Kebab", seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 0
    assert len(_check_plan_shortfalls(None, [line], locked)) == 1


def test_pozycje_planu_dziela_pule_po_kolei():
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 100.0, "kg_reserved": 0},
    ])
    lines = [
        PlanLineCreate(qty=2, kg_per_unit=40, recipe_id="r",
                       recipe_name="Kebab", seasoned_batch_ids=["a"]),
        PlanLineCreate(qty=2, kg_per_unit=40, recipe_id="r",
                       recipe_name="Kebab", seasoned_batch_ids=["a"]),
    ]
    assert len(_check_plan_shortfalls(None, lines, locked)) == 1


# ── Kebab komponentowy (70/30) ────────────────────────────────────────

def test_komponent_z_dwoch_partii_daje_numer_wszystkich_zrodel():
    comps = [{"materialTypeId": "udo", "pct": 70}, {"materialTypeId": "filet", "pct": 30}]
    pools = [
        _pool({"bid": "u1", "b_no": "355", "free": 40.0},
              {"bid": "u2", "b_no": "357", "free": 300.0}),
        _pool({"bid": "f1", "b_no": "356", "free": 300.0}),
    ]
    alloc = _allocate_components(1, 100.0, comps, pools)
    assert MIXED_KEY not in alloc
    assert alloc["355/357/356"]["pieces"] == 1


def test_komponent_czysty_bez_zmian():
    comps = [{"materialTypeId": "udo", "pct": 70}, {"materialTypeId": "filet", "pct": 30}]
    pools = [
        _pool({"bid": "u1", "b_no": "355", "free": 140.0}),
        _pool({"bid": "f1", "b_no": "356", "free": 60.0}),
    ]
    alloc = _allocate_components(2, 100.0, comps, pools)
    assert alloc["355/356"]["pieces"] == 2


# ── Tryb "off": resztka zostaje w partii ──────────────────────────────

def test_off_nie_sklada_sztuki_z_resztek(tryb_off):
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 19.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    _, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 0
    assert _allocation_kg_per_batch(alloc) == {}


def test_off_liczy_niedobor_w_calych_sztukach(tryb_off):
    # 2 × 30 kg = 60 kg wolnego, ale ani jednej sztuki 40 kg
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 30.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 30.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=40, recipe_id="r",
                          recipe_name="Kebab", seasoned_batch_ids=["a", "b"])
    assert len(_check_plan_shortfalls(None, [line], locked)) == 1
