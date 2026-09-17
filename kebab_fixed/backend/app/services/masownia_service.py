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
    cx_execute, cx_execute_returning, cx_query_one, query_all, query_one, transaction,
)
from app.logging_config import get_logger
from app.models.masownia import SpiceCartCreate, SpiceWeighDto
from app.utils.ids import cuid

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
