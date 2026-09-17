"""Panel masowania — mięso, pojemniki z przyprawami i wsady w masownicach.

Mięso dla panelu bierzemy z `meat_stock` (partia) i `meat_pallets` (fizyczna
paleta z ważenia zbiorczego). Pochodzenie partii nie ma znaczenia: mięso
z rozbioru i mięso kupione z zewnątrz (z/s, filet z mostka, indyk) leżą
w tej samej tabeli, więc zakup pokazuje się sam.
"""
from typing import Any, Dict, List

from app.db import query_all
from app.logging_config import get_logger

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
