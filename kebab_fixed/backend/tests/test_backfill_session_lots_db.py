"""Odtworzenie rozbicia wsadów dla sesji sprzed zapisu `mixing_session_lots`.

Źródłem są RUCHY OUT mięsa (realne kilogramy zdjęte ze stanu), a nie plan
masowania. Ruchy układają się w czasie i przypisują do sesji po znaczniku
zamknięcia. Sesję odtwarzamy TYLKO wtedy, gdy suma kg zgadza się z `kg_meat` —
inaczej karta ma pokazać uczciwą adnotację, a nie zmyślone rozbicie.
"""
from app.db import execute, query_all
from app.migrations import _backfill_mixing_session_lots
from app.utils.ids import cuid


def _wsad(numer, kg=5000):
    rb, ms = cuid(), cuid()
    execute("INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
            "VALUES (%s,%s,%s,'active')", (rb, numer, abs(hash(numer)) % 9000))
    execute("INSERT INTO meat_stock (id, lot_no, kg_available, kg_reserved, status, "
            "raw_batch_id, material_type_id, material_name) "
            "VALUES (%s,%s,%s,0,'AVAILABLE',%s,'mat-zs','Mięso z udka z/s')",
            (ms, numer, kg, rb))
    return ms


def _zlecenie():
    oid = cuid()
    execute("INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, "
            "planned_output_kg, status, plan_date, created_at) "
            "VALUES (%s,%s,'r-1','KIRMIZI',0,0,'done',current_date,now())",
            (oid, "MAS/BF/" + oid[:6]))
    return oid


def _sesja(order_id, batch_no, kg_meat, sekunda):
    sid = cuid()
    execute("INSERT INTO mixing_sessions (id, order_id, kg_meat, kg_output, batch_no, "
            "started_at, completed_at) "
            "VALUES (%s,%s,%s,%s,%s, now(), timestamptz '2026-08-13 10:00:00+00' "
            "+ (%s || ' seconds')::interval)",
            (sid, order_id, kg_meat, kg_meat, batch_no, sekunda))
    return sid


def _ruch(order_id, meat_stock_id, kg, sekunda):
    execute("INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type, "
            "source_type, source_id, created_at) "
            "VALUES (%s,'meat',%s,%s,'OUT','mixing',%s, timestamptz "
            "'2026-08-13 10:00:00+00' + (%s || ' seconds')::interval)",
            (cuid(), meat_stock_id, -abs(kg), order_id, sekunda))


def _lots(batch_no):
    return query_all(
        "SELECT msl.raw_batch_no, msl.kg FROM mixing_sessions s "
        "JOIN mixing_session_lots msl ON msl.session_id=s.id "
        "WHERE s.batch_no=%s ORDER BY msl.raw_batch_no", (batch_no,))


def test_odtwarza_sklad_partii_pp_z_ruchow(db):
    # Układ z produkcji: 200 kg z 55U, 2800 kg z 472, a PP z resztek obu
    a, b = _wsad("55U"), _wsad("472")
    order = _zlecenie()
    s1 = _sesja(order, "55U", 200, 1)
    s2 = _sesja(order, "472", 2800, 2)
    s3 = _sesja(order, "PPX", 200, 3)
    # Ruchy powstają PO wpisie sesji — tak jak w finish_mixing_session
    _ruch(order, a, 200, 1.2)          # → sesja 55U (zamknięta w 1. sekundzie)
    _ruch(order, b, 2800, 2.2)         # → sesja 472
    _ruch(order, a, 40, 3.2)           # → sesja PPX
    _ruch(order, b, 160, 3.3)          # → sesja PPX

    _backfill_mixing_session_lots()

    assert [(l["raw_batch_no"], float(l["kg"])) for l in _lots("55U")] == [("55U", 200.0)]
    assert [(l["raw_batch_no"], float(l["kg"])) for l in _lots("472")] == [("472", 2800.0)]
    # PP ma pełny skład co do kilograma — to jest odpowiedź dla weterynarii
    assert [(l["raw_batch_no"], float(l["kg"])) for l in _lots("PPX")] == [
        ("472", 160.0), ("55U", 40.0),
    ]


def test_nie_odtwarza_gdy_suma_sie_nie_zgadza(db):
    # Brakuje ruchu na 100 kg → nie zgadujemy, sesja zostaje bez rozbicia
    a = _wsad("900")
    order = _zlecenie()
    _sesja(order, "900X", 600, 1)
    _ruch(order, a, 500, 1.2)

    _backfill_mixing_session_lots()

    assert _lots("900X") == []


def test_nie_rusza_sesji_ktore_juz_maja_rozbicie(db):
    a = _wsad("910")
    order = _zlecenie()
    sid = _sesja(order, "910X", 300, 1)
    execute("INSERT INTO mixing_session_lots (id, session_id, meat_stock_id, raw_batch_no, kg) "
            "VALUES (%s,%s,%s,'910',%s)", (cuid(), sid, a, 300))
    _ruch(order, a, 300, 1.2)

    _backfill_mixing_session_lots()

    assert len(_lots("910X")) == 1      # bez duplikatu
