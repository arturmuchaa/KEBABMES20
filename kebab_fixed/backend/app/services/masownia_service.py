"""Panel masowania — mięso, pojemniki z przyprawami i wsady w masownicach.

Mięso dla panelu bierzemy z `meat_stock` (partia) i `meat_pallets` (fizyczna
paleta z ważenia zbiorczego). Pochodzenie partii nie ma znaczenia: mięso
z rozbioru i mięso kupione z zewnątrz (z/s, filet z mostka, indyk) leżą
w tej samej tabeli, więc zakup pokazuje się sam.
"""
import json
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute, cx_execute_returning, cx_query_one, execute, query_all, query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.masownia import (
    ChargeCreate, ChargeFinish, SpiceCartCreate, SpiceWeighDto,
)
from app.models.mixing import FinishMixingLotAlloc, FinishMixingSessionDto
from app.services import mixing_service
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _pallets() -> List[Dict[str, Any]]:
    """Palety z ważenia zbiorczego. Paleta ZDJĘTA nie istnieje dla hali."""
    rows = query_all(
        """
        SELECT p.id, p.pallet_no, p.kg_net, p.production_date, p.expiry_date
        FROM meat_pallets p
        WHERE p.deleted_at IS NULL
        ORDER BY p.production_date, p.pallet_no
        """
    )
    lots = query_all("SELECT pallet_id, lot_no, kg FROM meat_pallet_lots ORDER BY seq")
    by_pallet: Dict[str, List[Dict[str, Any]]] = {}
    for l in lots:
        by_pallet.setdefault(l["pallet_id"], []).append(
            {"lot_no": l["lot_no"], "kg": float(l["kg"] or 0)}
        )
    return [{
        "id": r["id"],
        "pallet_no": r["pallet_no"],
        "kg_net": float(r["kg_net"] or 0),
        "production_date": str(r["production_date"] or "")[:10],
        "expiry_date": str(r["expiry_date"] or "")[:10],
        "lots": by_pallet.get(r["id"], []),
    } for r in rows]


def _lots() -> List[Dict[str, Any]]:
    """Partie magazynu mięsa — niezależnie od tego, skąd przyszły.

    Partie w całości zarezerwowane ZOSTAJĄ na liście: biuro mogło zaplanować
    całą partię na jedno zlecenie (524: kg_available=0 przy kg_reserved=600),
    a panel musi ją pokazać. Co wolno wziąć, rozstrzyga bramka partii na
    ekranie, nie ten filtr.
    """
    rows = query_all(
        """
        SELECT id, lot_no, material_name, expiry_date, production_date,
               kg_available, COALESCE(kg_reserved, 0) AS kg_reserved
        FROM meat_stock
        WHERE COALESCE(status, 'AVAILABLE') <> 'USED'
          AND (kg_available > 0 OR COALESCE(kg_reserved, 0) > 0)
        ORDER BY expiry_date, lot_no
        """
    )
    return [{
        "meat_stock_id": r["id"],
        "lot_no": r["lot_no"],
        "material_name": r["material_name"] or "",
        "kg_free": round(float(r["kg_available"] or 0) - float(r["kg_reserved"] or 0), 3),
        "kg_reserved": float(r["kg_reserved"] or 0),
        "expiry_date": str(r["expiry_date"] or "")[:10],
        "production_date": str(r["production_date"] or "")[:10],
    } for r in rows]


def _taken() -> Dict[str, float]:
    """Ile kg zdjęły z palet wsady — żywe i już odebrane.

    Wsad anulowany oddaje paletę: jego kilogramy nie liczą się do pobrań.
    """
    rows = query_all(
        """
        SELECT cp.pallet_id, SUM(cp.kg) AS kg
        FROM mixing_charge_pallets cp
        JOIN mixing_charges c ON c.id = cp.charge_id AND c.status <> 'cancelled'
        WHERE cp.pallet_id IS NOT NULL
        GROUP BY cp.pallet_id
        """
    )
    return {r["pallet_id"]: float(r["kg"] or 0) for r in rows}


def list_meat() -> Dict[str, Any]:
    """Mięso pod kafelki panelu: palety, partie i pobrania wsadów."""
    return {"pallets": _pallets(), "lots": _lots(), "taken": _taken()}


# ── Pojemniki z przyprawami ────────────────────────────────────────────────
#
# Masownica chodzi 50 minut. Operator ładuje trzy maszyny i ma przestój, więc
# w tym czasie odważa przyprawy na 1-2 następne rundy do ponumerowanych
# pojemników. Numer pojemnika jest CAŁĄ tożsamością odważonych przypraw:
# papierowa etykieta na mokrym pojemniku odpada, a pomyłka dwóch pojemników
# tej samej receptury o różnym wsadzie jest po zamknięciu pokrywy niewykrywalna.


def _cart_out(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    ing = out.get("ingredients")
    out["ingredients"] = json.loads(ing) if isinstance(ing, str) else (ing or [])
    out["kg_target"] = float(out.get("kg_target") or 0)
    return out


def list_carts() -> List[Dict[str, Any]]:
    """Pojemniki, które stoją odważone i czekają na maszynę."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id AS order_recipe_id
        FROM mixing_spice_carts c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'prepared'
        ORDER BY c.cart_no
        """
    )
    return [_cart_out(r) for r in rows]


def kg_prepared_of(order_id: str) -> float:
    """Kilogramy zlecenia zajęte przez stojące pojemniki."""
    row = query_one(
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(float((row or {}).get("kg") or 0), 3)


def _kg_left_cx(conn, order_id: str) -> float:
    """Ile kg zlecenia nie jest jeszcze rozpisane.

    Plan − zrobione − to, co stoi w maszynach − to, co czeka w pojemnikach.
    """
    o = cx_query_one(
        conn, "SELECT meat_kg, kg_done FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
    )
    if not o:
        raise HTTPException(404, "Zlecenie nie znalezione")
    w_maszynach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_meat),0) AS kg FROM mixing_charges "
        "WHERE order_id=%s AND status='mixing'",
        (order_id,),
    )
    w_pojemnikach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(
        float(o["meat_kg"] or 0)
        - float(o["kg_done"] or 0)
        - float((w_maszynach or {}).get("kg") or 0)
        - float((w_pojemnikach or {}).get("kg") or 0),
        3,
    )


def create_cart(dto: SpiceCartCreate) -> Dict[str, Any]:
    """Załóż pojemnik: przyprawy odważone z wyprzedzeniem na wskazany wsad.

    Pojemnik REZERWUJE kilogramy zlecenia — bez tego operator rozpisałby dwa
    razy to samo, a maszyny stoją 50 minut i pomyłka wychodzi za późno.
    """
    with transaction() as conn:
        zajety = cx_query_one(
            conn,
            "SELECT cart_no FROM mixing_spice_carts WHERE cart_no=%s AND status='prepared'",
            (dto.cart_no,),
        )
        if zajety:
            raise HTTPException(
                409, f"Pojemnik {dto.cart_no} jest już zajęty — wsyp go albo anuluj"
            )

        zostalo = _kg_left_cx(conn, dto.order_id)
        if dto.kg_target > zostalo + 0.001:
            raise HTTPException(
                400,
                f"W zleceniu zostało {max(0.0, zostalo):.0f} kg, a pojemnik bierze "
                f"{dto.kg_target:.0f} kg",
            )
        recipe = cx_query_one(
            conn, "SELECT recipe_id FROM mixing_orders WHERE id=%s", (dto.order_id,)
        )
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_spice_carts (id, cart_no, order_id, recipe_id, kg_target, status)
            VALUES (%s,%s,%s,%s,%s,'prepared') RETURNING *
            """,
            (cuid(), dto.cart_no, dto.order_id,
             (recipe or {}).get("recipe_id") or "", dto.kg_target),
        )
    logger.info("masownia.cart.created", extra={
        "cart_no": dto.cart_no, "order": dto.order_id, "kg": dto.kg_target,
    })
    return _cart_out(row)


def weigh_ingredient(cart_id: str, dto: SpiceWeighDto) -> Dict[str, Any]:
    """Zapisz odważony składnik.

    Kolejny odczyt tej samej pozycji nadpisuje poprzedni: operator poprawia
    dosypaną szczyptę, a nie dopisuje drugiego wiersza tego samego składnika.
    """
    with transaction() as conn:
        row = cx_query_one(
            conn, "SELECT * FROM mixing_spice_carts WHERE id=%s FOR UPDATE", (cart_id,)
        )
        if not row:
            raise HTTPException(404, "Nie ma takiego pojemnika")
        ing = row.get("ingredients")
        lista = json.loads(ing) if isinstance(ing, str) else list(ing or [])
        wpis = {
            "seq": dto.seq, "name": dto.name, "unit": dto.unit,
            "qty": dto.qty, "weighed": dto.weighed, "manual": dto.manual,
        }
        lista = [x for x in lista if int(x.get("seq", -1)) != dto.seq] + [wpis]
        lista.sort(key=lambda x: int(x.get("seq", 0)))
        out = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET ingredients=%s WHERE id=%s RETURNING *",
            (json.dumps(lista, ensure_ascii=False), cart_id),
        )
    return _cart_out(out)


def cancel_cart(cart_id: str) -> Dict[str, Any]:
    """Anuluj pojemnik — zwalnia numer i oddaje kilogramy zleceniu."""
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET status='cancelled' WHERE id=%s AND status='prepared' "
            "RETURNING *",
            (cart_id,),
        )
    if not row:
        raise HTTPException(404, "Nie ma takiego pojemnika albo już go wsypano")
    return _cart_out(row)


# ── Wsad w masownicy ───────────────────────────────────────────────────────
#
# Wsad powstaje w chwili ZAŁADOWANIA, nie przy odbiorze: paleta musi zniknąć
# z ekranu od razu, inaczej dwa wsady wzięłyby tę samą. Księgowanie (ruchy
# magazynowe, seasoned_meat, kg_done, numer partii przyprawionej) zostaje
# w `mixing_service.finish_mixing_session` — to najgorętsza ścieżka modułu
# i nie ma powodu jej przepisywać.


def list_charges() -> List[Dict[str, Any]]:
    """Wsady stojące w masownicach."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id, o.recipe_name
        FROM mixing_charges c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'mixing'
        ORDER BY c.machine_id
        """
    )
    out = []
    for r in rows:
        row = dict(r)
        row["kg_meat"] = float(row.get("kg_meat") or 0)
        row["water_l"] = float(row.get("water_l") or 0)
        row["meat"] = query_all(
            "SELECT pallet_id, lot_no, meat_stock_id, kg FROM mixing_charge_pallets "
            "WHERE charge_id=%s",
            (r["id"],),
        )
        out.append(row)
    return out


def _batch_no_of(lot_nos: List[str]) -> str:
    """Numer partii przyprawionej, o ile da się go podać BEZ zgadywania.

    Jeden wsad surowca → partia nosi jego numer (511 zostaje 511). Dwa i więcej
    → numer PP nadaje backend przy odbiorze (`seasoned_batch_no_from_raw`),
    bo licznik PP jest wspólny dla całego MES; panel zwraca wtedy pusty numer.
    """
    rozne = sorted({l for l in lot_nos if l})
    return rozne[0] if len(rozne) == 1 else ""


def load_charge(dto: ChargeCreate) -> Dict[str, Any]:
    """Załaduj masownicę: pojemnik z przyprawami + mięso + woda."""
    kg_meat = round(sum(float(m.kg) for m in dto.meat), 3)
    if kg_meat <= 0:
        raise HTTPException(400, "Wsad bez mięsa — wskaż palety albo partię")

    batch_no = _batch_no_of([m.lot_no for m in dto.meat])

    with transaction() as conn:
        zajeta = cx_query_one(
            conn,
            "SELECT machine_id FROM mixing_charges WHERE machine_id=%s AND status='mixing'",
            (dto.machine_id,),
        )
        if zajeta:
            raise HTTPException(409, f"Masownica {dto.machine_id} jest zajęta")

        charge = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_charges
                (id, order_id, machine_id, cart_id, kg_meat, water_l, batch_no, status, started_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'mixing',%s) RETURNING *
            """,
            (cuid(), dto.order_id, dto.machine_id, dto.cart_id, kg_meat,
             dto.water_l, batch_no, now_iso()),
        )
        for m in dto.meat:
            cx_execute(
                conn,
                "INSERT INTO mixing_charge_pallets "
                "(id, charge_id, pallet_id, lot_no, meat_stock_id, kg) VALUES (%s,%s,%s,%s,%s,%s)",
                (cuid(), charge["id"], m.pallet_id, m.lot_no, m.meat_stock_id or None, float(m.kg)),
            )
        if dto.cart_id:
            cx_execute(
                conn,
                "UPDATE mixing_spice_carts SET status='dumped', dumped_at=%s, charge_id=%s "
                "WHERE id=%s AND status='prepared'",
                (now_iso(), charge["id"], dto.cart_id),
            )
        # Zlecenie rusza i pamięta, na której maszynie stoi — stąd bierze ją
        # sesja zapisywana przy odbiorze.
        cx_execute(
            conn,
            "UPDATE mixing_orders SET status='in_progress', machine_id=%s, "
            "started_at=COALESCE(started_at,%s) WHERE id=%s AND status IN "
            "('planned','confirmed','in_progress')",
            (dto.machine_id, now_iso(), dto.order_id),
        )

    logger.info("masownia.charge.loaded", extra={
        "machine": dto.machine_id, "kg": kg_meat, "batch": batch_no,
    })
    out = dict(charge)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    out["water_l"] = float(out.get("water_l") or 0)
    return out


def finish_charge(charge_id: str, dto: ChargeFinish) -> Dict[str, Any]:
    """Odbiór z masownicy: kg z paleciaka → księgowanie istniejącą ścieżką.

    Wsad zamykamy PRZED księgowaniem: `UPDATE ... WHERE status='mixing'` jest
    bramką na dwa równoległe odbiory tego samego wsadu. Gdyby księgowanie szło
    pierwsze, dwa dotknięcia zdjęłyby mięso ze stanu dwa razy.
    """
    charge = query_one("SELECT * FROM mixing_charges WHERE id=%s", (charge_id,))
    if not charge:
        raise HTTPException(404, "Nie ma takiego wsadu")

    with transaction() as conn:
        zamkniety = cx_execute_returning(
            conn,
            "UPDATE mixing_charges SET status='done', finished_at=%s "
            "WHERE id=%s AND status='mixing' RETURNING *",
            (now_iso(), charge_id),
        )
    if not zamkniety:
        raise HTTPException(409, "Ten wsad jest już odebrany")

    sklad = query_all(
        "SELECT meat_stock_id, kg FROM mixing_charge_pallets WHERE charge_id=%s", (charge_id,)
    )
    try:
        mixing_service.finish_mixing_session(
            charge["order_id"],
            FinishMixingSessionDto(
                kgActual=float(charge["kg_meat"] or 0),
                batchNo=charge["batch_no"] or "",
                lotAllocations=[
                    FinishMixingLotAlloc(meatLotId=s["meat_stock_id"] or "", kg=float(s["kg"] or 0))
                    for s in sklad
                ],
            ),
        )
    except Exception:
        # Księgowanie padło — wsad wraca na maszynę, żeby operator mógł
        # spróbować jeszcze raz zamiast zostać z pustym ekranem i mięsem
        # nieodpisanym ze stanu.
        execute(
            "UPDATE mixing_charges SET status='mixing', finished_at=NULL WHERE id=%s",
            (charge_id,),
        )
        raise

    sesja = query_one(
        "SELECT id FROM mixing_sessions WHERE order_id=%s ORDER BY completed_at DESC LIMIT 1",
        (charge["order_id"],),
    )
    session_id = (sesja or {}).get("id") or ""
    execute("UPDATE mixing_charges SET session_id=%s WHERE id=%s", (session_id, charge_id))

    logger.info("masownia.charge.finished", extra={
        "machine": charge["machine_id"], "kg_output": dto.kg_output,
    })
    out = dict(zamkniety)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    out["water_l"] = float(out.get("water_l") or 0)
    out["session_id"] = session_id
    return out
