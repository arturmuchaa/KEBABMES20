"""Ważenie zbiorcze mięsa — zapis skompletowanej palety / wózka.

Po rozbiorze mięso jedzie do masowni w tym, co akurat stoi pod ręką, i nikt
nie wie, ile na palecie jest ani z jakich partii. Hala buduje więc równe
palety (100/200/400/600/800 kg), a ten serwis zapisuje ICH OPIS i pozwala
wydrukować etykietę.

ŻADNYCH RUCHÓW MAGAZYNOWYCH. Mięso jest na stanie od chwili rozbioru —
zaksięgowanie go tutaj drugi raz byłoby podwójnym przyjęciem. Dlatego nie
ruszamy `meat_stock`, `kg_reserved` ani `stock_movements`; test regresyjny
`test_paleta_NIE_rusza_stanu_magazynowego` tego pilnuje.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.meat_pallets import MeatPalletCreate
from app.utils.ids import cuid, next_dated_no

logger = get_logger(__name__)

#: Dopuszczalna różnica sumy składu i wagi palety — zaokrąglenia po 0,1 kg.
SKLAD_TOL_KG = 0.05


def _lots_of(pallet_id: str) -> List[Dict[str, Any]]:
    return query_all(
        "SELECT lot_no, kg, seq FROM meat_pallet_lots WHERE pallet_id=%s ORDER BY seq",
        (pallet_id,),
    )


def create_pallet(dto: MeatPalletCreate) -> Dict[str, Any]:
    """Zapisz paletę i jej skład. Numer nadaje backend (PAL/dd/mm/rr)."""
    if not dto.lots:
        raise HTTPException(400, "Paleta bez składu partii — etykieta nie powiedziałaby masowni nic")

    suma = round(sum(float(l.kg) for l in dto.lots), 3)
    if abs(suma - float(dto.kg_net)) > SKLAD_TOL_KG:
        raise HTTPException(
            400,
            f"Suma składu ({suma:.1f} kg) nie zgadza się z wagą palety "
            f"({float(dto.kg_net):.1f} kg)",
        )

    day = (dto.production_date or "")[:10]
    with transaction() as conn:
        pallet_no = next_dated_no(conn, "PAL", day)
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO meat_pallets
                (id, pallet_no, target_kg, stack_kg, kg_net, containers,
                 carrier_label, carrier_kg, operator, production_date, expiry_date)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(), pallet_no, float(dto.target_kg),
                float(dto.stack_kg) if dto.stack_kg is not None else None,
                float(dto.kg_net), int(dto.containers), dto.carrier_label or "",
                float(dto.carrier_kg), dto.operator or "", day,
                dto.expiry_date or None,
            ),
        )
        for i, lot in enumerate(dto.lots):
            cx_execute(
                conn,
                "INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) "
                "VALUES (%s,%s,%s,%s,%s)",
                (cuid(), row["id"], lot.lot_no.strip(), float(lot.kg), i),
            )

    logger.info("meat_pallet.created", extra={
        "pallet_no": pallet_no, "kg": float(dto.kg_net), "lots": len(dto.lots),
    })
    out = dict(row)
    out["lots"] = _lots_of(row["id"])
    return out


def get_pallet(pallet_no: str) -> Dict[str, Any]:
    """Paleta po numerze — do dodruku zgubionej etykiety i kontroli na masowni."""
    row = query_one("SELECT * FROM meat_pallets WHERE pallet_no=%s", (pallet_no,))
    if not row:
        raise HTTPException(404, "Nie ma takiej palety")
    out = dict(row)
    out["lots"] = _lots_of(row["id"])
    return out


def list_pallets(day: str = "") -> List[Dict[str, Any]]:
    """Palety dnia produkcyjnego (domyślnie wszystkie, najnowsze pierwsze)."""
    rows = query_all(
        "SELECT * FROM meat_pallets WHERE (%s = '' OR production_date = %s::date) "
        "ORDER BY created_at DESC LIMIT 200",
        (day, day or None),
    ) if day else query_all(
        "SELECT * FROM meat_pallets ORDER BY created_at DESC LIMIT 200"
    )
    out = []
    for r in rows:
        rec = dict(r)
        rec["lots"] = _lots_of(r["id"])
        out.append(rec)
    return out
