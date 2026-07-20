"""Testy INTEGRACYJNE finish_mixing_session (prawdziwy SQL na bazie testowej).

Pokrywają najważniejszą ścieżkę masowania end-to-end: zakończenie sesji →
powstanie partii przyprawionego + odpis meat_stock + ruch magazynowy OUT,
oraz REGRESJĘ rozdzielenia partii (różne receptury z tej samej partii surowca
= osobne partie przyprawionego — bug naprawiony 2026-06-16).

Wymaga TEST_DATABASE_URL (patrz conftest). Bez niej testy są pomijane.
"""
from app.db import transaction, query_one, query_all, execute
from app.models.mixing import FinishMixingSessionDto, FinishMixingLotAlloc
from app.services.mixing_service import finish_mixing_session


# ── Seed helpers ────────────────────────────────────────────────────────
def _seed_raw_batch(rb_id, seq):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
        "VALUES (%s,%s,%s,'active')",
        (rb_id, f"RB-{rb_id}", seq),
    )


def _seed_stock(ms_id, lot_no, kg_available, raw_batch_id,
                material_type_id="mat-A", material_name="Łopatka"):
    execute(
        "INSERT INTO meat_stock "
        "(id, lot_no, kg_available, kg_reserved, status, raw_batch_id, material_type_id, material_name) "
        "VALUES (%s,%s,%s,0,'AVAILABLE',%s,%s,%s)",
        (ms_id, lot_no, kg_available, raw_batch_id, material_type_id, material_name),
    )


def _seed_order(order_id, recipe_id, recipe_name, meat_kg=200, machine_id=1):
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, status, machine_id) "
        "VALUES (%s,%s,%s,%s,%s,'in_progress',%s)",
        (order_id, f"MAS/{order_id}", recipe_id, recipe_name, meat_kg, machine_id),
    )


def _finish(order_id, ms_id, kg):
    dto = FinishMixingSessionDto(
        kg_actual=kg, batch_no="",
        lot_allocations=[FinishMixingLotAlloc(meat_lot_id=ms_id, kg=kg)],
    )
    return finish_mixing_session(order_id, dto)


# ── Testy ───────────────────────────────────────────────────────────────
def test_finish_creates_seasoned_and_consumes_meat(db):
    _seed_raw_batch("rb364", 364)
    _seed_stock("ms1", "LOT-1", 1000, "rb364")
    _seed_order("o1", "r-gold2", "Gold2", meat_kg=200)

    _finish("o1", "ms1", 200)

    # partia przyprawionego powstała
    sm = query_one("SELECT * FROM seasoned_meat WHERE recipe_id=%s", ("r-gold2",))
    assert sm is not None
    assert sm["batch_no"] == "364"               # wsad surowca
    assert float(sm["kg_produced"]) == 200.0     # brak składników → uzysk = mięso
    assert float(sm["kg_available"]) == 200.0
    assert sm["production_day"] is not None

    # mięso odpisane
    ms = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", ("ms1",))
    assert float(ms["kg_available"]) == 800.0
    assert float(ms["kg_used"]) == 200.0

    # ruch magazynowy OUT na mięsie (OUT zapisywany ze znakiem ujemnym)
    mv = query_one(
        "SELECT qty FROM stock_movements "
        "WHERE product_type='meat' AND batch_id=%s AND movement_type='OUT' AND source_id=%s",
        ("ms1", "o1"),
    )
    assert mv is not None and float(mv["qty"]) == -200.0


def test_different_recipes_same_raw_batch_stay_separate(db):
    # REGRESJA: Gold2 i GoldKebab z tej samej partii surowca 364 = DWIE partie.
    _seed_raw_batch("rb364", 364)
    _seed_stock("ms1", "LOT-1", 1000, "rb364")
    _seed_stock("ms2", "LOT-2", 1000, "rb364")
    _seed_order("o1", "r-gold2", "Gold2", meat_kg=200)
    _seed_order("o2", "r-gk", "GoldKebab", meat_kg=150)

    _finish("o1", "ms1", 200)
    _finish("o2", "ms2", 150)

    rows = query_all("SELECT recipe_id, kg_produced FROM seasoned_meat WHERE batch_no=%s ORDER BY recipe_id", ("364",))
    assert len(rows) == 2, "różne receptury z tego samego wsadu muszą być osobnymi partiami"
    by_recipe = {r["recipe_id"]: float(r["kg_produced"]) for r in rows}
    assert by_recipe == {"r-gk": 150.0, "r-gold2": 200.0}


def test_same_recipe_same_batch_same_day_merges(db):
    # Ten sam produkt + wsad + dzień = JEDNA partia, kg sumowane (np. 2 maszyny).
    _seed_raw_batch("rb364", 364)
    _seed_stock("ms1", "LOT-1", 1000, "rb364")
    _seed_stock("ms2", "LOT-2", 1000, "rb364")
    _seed_order("o1", "r-gold2", "Gold2", meat_kg=200)
    _seed_order("o2", "r-gold2", "Gold2", meat_kg=200)

    _finish("o1", "ms1", 200)
    _finish("o2", "ms2", 200)

    rows = query_all("SELECT kg_produced, kg_available FROM seasoned_meat WHERE batch_no=%s", ("364",))
    assert len(rows) == 1, "ten sam recept+wsad+dzień ma się scalić w jedną partię"
    assert float(rows[0]["kg_produced"]) == 400.0
    assert float(rows[0]["kg_available"]) == 400.0


def test_finish_zaleglego_planu_datuje_partie_na_dzien_planu(db):
    """Biuro potwierdza niedzielne masowanie w poniedziałek (prod 2026-07-20):
    partia i termin ważności muszą iść od DNIA PLANU, nie od chwili zapisu."""
    from datetime import date, timedelta

    plan_day = date.today() - timedelta(days=1)
    _seed_raw_batch("rb419", 419)
    _seed_stock("msPast", "419", 5000, "rb419")
    _seed_order("oPast", "r-past", "BEYAZ", meat_kg=400)
    execute("UPDATE mixing_orders SET plan_date=%s WHERE id='oPast'", (plan_day,))

    _finish("oPast", "msPast", 400)

    sm = query_one("SELECT * FROM seasoned_meat WHERE recipe_id='r-past'")
    assert str(sm["production_day"]) == plan_day.isoformat()
    assert str(sm["expiry_date"]) == (plan_day + timedelta(days=5)).isoformat()
