from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.packaging import PackagingReceive
from app.utils.ids import cuid, now_iso
from app.utils.stock_codes import (
    kod_tulei, kod_z_licznika, normalizuj_kod, prefiks_opakowania,
)
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_packaging() -> List[Dict]:
    return query_all("SELECT * FROM packaging WHERE kg_available > 0 ORDER BY name")


def list_all_packaging() -> List[Dict]:
    return query_all("SELECT * FROM packaging ORDER BY created_at DESC")


def _nadaj_kod_cx(conn, code: str, name: str, packaging_type: str) -> str:
    """Kod nowej pozycji magazynu: podany przez biuro albo wyliczony.

    Kod podany wygrywa — biuro zna swoje oznaczenia lepiej niż reguła. Kod
    zajęty odrzucamy WPROST, zamiast pozwolić na drugą pozycję o tym samym
    numerze; dokładnie to zdarzyło się przy PAK-001…004, tyle że po cichu,
    bo nie było wtedy indeksu unikalnego.
    """
    reczny = normalizuj_kod(code)
    if reczny:
        if cx_query_one(conn, "SELECT id FROM packaging WHERE code = %s", (reczny,)):
            raise HTTPException(400, f"Kod {reczny} jest już zajęty przez inną pozycję")
        return reczny

    # Tuleja bierze kod z nazwy; przy kolizji (np. drugi „METAL 65CM")
    # schodzimy na licznik, żeby zapis się nie wywrócił.
    kod = kod_tulei(name)
    if kod and not cx_query_one(conn, "SELECT id FROM packaging WHERE code = %s", (kod,)):
        return kod

    prefiks = prefiks_opakowania(packaging_type)
    for _ in range(200):
        # Licznik podbijamy na TEJ SAMEJ transakcji (jak numer DDFiP), a nie
        # przez `next_seq`, które bierze osobne połączenie z puli i commituje
        # niezależnie — przy wycofaniu zapisu numer byłby spalony.
        row = cx_execute_returning(
            conn,
            """INSERT INTO sequences (key, value) VALUES (%s, 1)
               ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
               RETURNING value""",
            (f"packaging_code:{prefiks}",),
        )
        kandydat = kod_z_licznika(prefiks, int(row["value"]))
        if not cx_query_one(conn, "SELECT id FROM packaging WHERE code = %s", (kandydat,)):
            return kandydat
    raise HTTPException(500, "Nie udało się nadać kodu pozycji magazynu")


def receive_packaging_cx(
    conn,
    *,
    name: str,
    qty: float,
    packaging_type: str = "opakowanie",
    unit: str = "szt",
    code: str = "",
    supplier_id: str = "",
    expiry_date: str = "",
    notes: str = "",
    source_type: str = "supplier",
    source_id: str = "",
) -> Dict:
    """Dokłada opakowania do magazynu w JUŻ OTWARTEJ transakcji.

    Wydzielone z `receive_packaging`, bo tę samą regułę potrzebuje przyjęcie
    DDFiP (karta 1.3.1) — a dostawa folii i tulei ma wejść na magazyn tym
    samym torem co dostawa wpisana z okienka magazynu, inaczej ten sam towar
    liczyłby się dwa razy albo wcale.

    Magazyn opakowań NIE jest lotowy: pozycja o tej samej nazwie się DOKŁADA
    (scalanie po `LOWER(name)`). Ślad po konkretnej dostawie zostaje w ruchu
    magazynowym (`source_type`/`source_id`), a przy DDFiP dodatkowo w wierszu
    dokumentu — patrz `ingredient_reception_packaging`.
    """
    istnieje = cx_query_one(
        conn,
        "SELECT * FROM packaging WHERE LOWER(name) = LOWER(%s) FOR UPDATE",
        (name,),
    )
    if istnieje:
        cx_execute(
            conn,
            """
            UPDATE packaging
            SET kg_available = kg_available + %s,
                kg_initial = kg_initial + %s
            WHERE id = %s
            """,
            (qty, qty, istnieje["id"]),
        )
        row = cx_query_one(conn, "SELECT * FROM packaging WHERE id = %s", (istnieje["id"],))
        tryb = "topup"
    else:
        kod = _nadaj_kod_cx(conn, code, name, packaging_type)
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO packaging
                (id, code, name, type, unit, kg_initial, kg_available, kg_used,
                 supplier_id, expiry_date, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                kod,
                name,
                packaging_type,
                unit,
                qty,
                qty,
                supplier_id or None,
                expiry_date or None,
                notes,
                now_iso(),
            ),
        )
        tryb = "new"

    if float(qty or 0) > 0:
        create_stock_movement(
            conn,
            product_type="packaging",
            batch_id=row["id"],
            qty=float(qty),
            movement_type="IN",
            source_type=source_type,
            source_id=source_id or supplier_id or row["id"],
        )

    logger.info(
        "packaging.received",
        extra={"packaging_id": row["id"], "qty": qty, "mode": tryb},
    )
    return row  # type: ignore[return-value]


def receive_packaging(dto: PackagingReceive) -> Dict:
    with transaction() as conn:
        return receive_packaging_cx(
            conn,
            name=dto.name,
            qty=dto.qty,
            packaging_type=dto.type,
            unit=dto.unit,
            supplier_id=dto.supplier_id,
            expiry_date=dto.expiry_date,
            notes=dto.notes,
            code=dto.code,
        )


def use_packaging(packaging_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    qty = float(body.get("qty", 0) or 0)
    if qty <= 0:
        raise HTTPException(400, "Ilość musi być większa od zera")
    with transaction() as conn:
        pkg = cx_query_one(
            conn,
            "SELECT kg_available FROM packaging WHERE id=%s FOR UPDATE",
            (packaging_id,),
        )
        if not pkg:
            raise HTTPException(404, "Opakowanie nie znalezione")
        if float(pkg["kg_available"] or 0) + 0.01 < qty:
            raise HTTPException(
                400,
                f"Niewystarczająca ilość opakowań: dostępne "
                f"{float(pkg['kg_available'])}, wymagane {qty}",
            )
        cx_execute(
            conn,
            """
            UPDATE packaging
            SET kg_available = kg_available - %s,
                kg_used = kg_used + %s
            WHERE id = %s
            """,
            (qty, qty, packaging_id),
        )
        # Manualne zużycie (poza finish_day) też musi mieć ślad audytu.
        create_stock_movement(
            conn,
            product_type="packaging",
            batch_id=packaging_id,
            qty=qty,
            movement_type="OUT",
            source_type="manual",
            source_id=packaging_id,
        )
    logger.info("packaging.used", extra={"packaging_id": packaging_id, "qty": qty})
    return {"ok": True}
