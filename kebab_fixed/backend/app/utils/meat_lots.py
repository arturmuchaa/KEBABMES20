"""Rodzaje mięsa z rozbioru i numeracja ich lotów.

Wspólne dla rozbioru (tworzy loty) i dokumentów (czyta je po numerze), bo
numer lotu b/s NIE jest numerem partii ćwiartki: `meat_stock.lot_no` ma
unikat i ON CONFLICT dolicza kg, więc mięso b/s musi mieć własny numer
(„440-BS"), inaczej wpadłoby do lotu z/s tej samej partii.

Skutek uboczny, przez który ten moduł powstał: kod stemplujący na WZ daty
uboju/ważności szukał partii po numerze lotu i dla „440-BS" nie znajdował
nic — dokument wychodził bez daty uboju i ważności (prod 2026-07-28, WZ/38).
Każde miejsce, które z numeru lotu wnioskuje o partii ćwiartki, MUSI iść
przez `raw_batch_no_from_lot`.
"""
from typing import Dict, Tuple

#: rodzaj → (material_type_id, nazwa na dokumenty, sufiks numeru lotu)
MEAT_TYPES: Dict[str, Tuple[str, str, str]] = {
    "zs": ("mat-mieso-zs", "Mięso z/s", ""),
    "bs": ("mat-mieso-bs", "Mięso b/s", "-BS"),
}


def raw_batch_no_from_lot(lot_no: str) -> str:
    """Numer partii ćwiartki, z której powstał lot mięsa („440-BS" → „440")."""
    s = str(lot_no or "")
    for _, _, suffix in MEAT_TYPES.values():
        if suffix and s.endswith(suffix):
            return s[: -len(suffix)]
    return s
