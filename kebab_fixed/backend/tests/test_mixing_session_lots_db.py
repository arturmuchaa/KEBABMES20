"""Rozbicie wsadów NA SESJĘ masowania — skład partii przyprawionego.

Operator wpisuje je przy potwierdzaniu masowania, ale dotąd ginęło: ruch
zużycia mięsa niesie tylko numer ZLECENIA, więc gdy jedno zlecenie rodziło
kilka partii (600 kg z wsadu 440, 600 kg z 441, 118 kg z resztek obu),
nie dało się powiedzieć, ile kilogramów poszło do której. Bez tego karta
2.5.1 nie odpowiada na pytanie weterynarii, skąd wzięła się partia PP.
"""
from app.db import execute, query_all, query_one
from app.models.mixing import FinishMixingLotAlloc, FinishMixingSessionDto
from app.services.mixing_service import finish_mixing_session
from app.utils.ids import cuid


def _wsad(numer, seq, kg):
    rb_id, ms_id = cuid(), cuid()
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
        "VALUES (%s,%s,%s,'active')",
        (rb_id, numer, seq),
    )
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_available, kg_reserved, status, "
        "raw_batch_id, material_type_id, material_name) "
        "VALUES (%s,%s,%s,%s,'AVAILABLE',%s,'mat-zs','Mięso z udka z/s')",
        (ms_id, numer, kg, kg, rb_id),
    )
    return ms_id


def _zlecenie(lots):
    order_id = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, "
        "planned_output_kg, status, plan_date, created_at) "
        "VALUES (%s,%s,'r-1','KIRMIZI',%s,%s,'in_machine',current_date,now())",
        (order_id, "MAS/TEST/" + order_id[:6], sum(k for _, k in lots), sum(k for _, k in lots)),
    )
    for ms_id, kg in lots:
        execute(
            "INSERT INTO mixing_order_lots (id, order_id, meat_stock_id, kg_planned) "
            "VALUES (%s,%s,%s,%s)",
            (cuid(), order_id, ms_id, kg),
        )
    return order_id


def _sesja(order_id, allocs, kg_meat, kg_output):
    finish_mixing_session(order_id, FinishMixingSessionDto(
        kg_actual=kg_output,
        lot_allocations=[FinishMixingLotAlloc(meat_lot_id=m, kg=k) for m, k in allocs],
    ))


def _lots_partii(batch_no):
    return query_all(
        """
        SELECT msl.raw_batch_no, msl.kg
        FROM mixing_sessions s
        JOIN mixing_session_lots msl ON msl.session_id = s.id
        WHERE s.batch_no = %s ORDER BY msl.raw_batch_no
        """,
        (batch_no,),
    )


def test_partia_z_jednego_wsadu_ma_zapisany_sklad(db):
    ms = _wsad("440", 440, 1000)
    order = _zlecenie([(ms, 600)])
    _sesja(order, [(ms, 600)], 600, 740)

    lots = _lots_partii("440")
    assert [(l["raw_batch_no"], float(l["kg"])) for l in lots] == [("440", 600.0)]


def test_partia_PP_ma_sklad_co_do_kilograma(db):
    # Scenariusz z karty papierowej: PP z resztek dwóch wsadów
    a = _wsad("440", 440, 1000)
    b = _wsad("441", 441, 1000)
    order = _zlecenie([(a, 60), (b, 58)])
    _sesja(order, [(a, 60), (b, 58)], 118, 145)

    sesja = query_one(
        "SELECT batch_no FROM mixing_sessions WHERE order_id=%s", (order,)
    )
    lots = _lots_partii(sesja["batch_no"])
    assert [(l["raw_batch_no"], float(l["kg"])) for l in lots] == [
        ("440", 60.0), ("441", 58.0),
    ]
    # dwa wsady → partia łączona, nie numer jednego z nich
    assert sesja["batch_no"] not in ("440", "441")


def test_kazda_sesja_ma_wlasne_rozbicie(db):
    # Jedno zlecenie, dwie sesje — dotąd obie dostawały skład CAŁEGO zlecenia
    a = _wsad("470", 470, 2000)
    b = _wsad("471", 471, 2000)
    order = _zlecenie([(a, 600), (b, 600)])
    _sesja(order, [(a, 600)], 600, 740)
    _sesja(order, [(b, 600)], 600, 740)

    assert [(l["raw_batch_no"], float(l["kg"])) for l in _lots_partii("470")] == [("470", 600.0)]
    assert [(l["raw_batch_no"], float(l["kg"])) for l in _lots_partii("471")] == [("471", 600.0)]
