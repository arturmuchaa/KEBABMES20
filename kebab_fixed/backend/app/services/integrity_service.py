"""Kontrola spójności danych magazynowych.

Formalny zapis reguł, które w audycie 2026-09-07 wykryły realne anomalie
(partia 440: 7 kg zaksięgowane dwukrotnie; raw 452 i 466: rozbieżność
przyjęcia; duplikat numeru ANUL WZ/9/09/26).

KLUCZOWA ZASADA: każdy magazyn ma WŁASNĄ regułę spójności.
Zastosowanie jednej uniwersalnej reguły "stan = suma ruchów" dało w audycie
8 fałszywych alarmów na 4 realne problemy, bo:
  * produkty uboczne nie mają ruchu IN przy powstaniu,
  * mięso marynowane jest przeksięgowywane między lotami,
  * składniki mają pozycje sprzed uruchomienia księgi (2026-07-07),
  * partie przyjęte bez rozbioru mają natychmiastowy reception_transfer.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.db import query_one
from app.logging_config import get_logger
from app.utils.ids import now_iso

logger = get_logger(__name__)

# (nazwa, opis dla biura, SQL zwracający liczbę naruszeń)
CHECKS: List[tuple] = [
    (
        "meat_bez_ujemnych",
        "Partie mięsa nie mogą mieć ujemnego stanu ani ujemnego zużycia.",
        "SELECT count(*) AS n FROM meat_stock WHERE kg_available < -0.001"
        " OR kg_used < -0.001 OR kg_reserved < -0.001",
    ),
    (
        "raw_bez_ujemnych",
        "Partie surowca nie mogą mieć ujemnego stanu.",
        "SELECT count(*) AS n FROM raw_batches WHERE kg_available < -0.001",
    ),
    (
        "seasoned_bez_ujemnych",
        "Mięso marynowane nie może mieć ujemnego stanu ani zużycia.",
        "SELECT count(*) AS n FROM seasoned_meat"
        " WHERE kg_available < -0.001 OR kg_used < -0.001",
    ),
    (
        "seasoned_bilans",
        "Dla marynowanego musi zachodzić: wyprodukowano - zużyto = dostępne.",
        "SELECT count(*) AS n FROM seasoned_meat WHERE abs(COALESCE(kg_produced,0)"
        " - COALESCE(kg_used,0) - COALESCE(kg_available,0)) >= 0.01",
    ),
    (
        "byproduct_bez_ujemnych",
        "Loty produktów ubocznych nie mogą mieć ujemnej masy.",
        "SELECT count(*) AS n FROM byproduct_lots WHERE kg < -0.001",
    ),
    (
        "fg_bez_ujemnych",
        "Wyroby gotowe nie mogą mieć ujemnej liczby sztuk.",
        "SELECT count(*) AS n FROM finished_goods"
        " WHERE qty_available < 0 OR qty_shipped < 0",
    ),
    (
        "ingredient_bez_ujemnych",
        "Składniki nie mogą mieć ujemnego stanu.",
        "SELECT count(*) AS n FROM ingredient_stock WHERE qty_available < -0.001",
    ),
    (
        "wz_status_ze_slownika",
        "Dokument WZ może mieć wyłącznie status 'wstepny' albo 'anulowany'.",
        "SELECT count(*) AS n FROM wz_documents"
        " WHERE status NOT IN ('wstepny','anulowany')",
    ),
    (
        "brak_osieroconych_ruchow_wz",
        "Każdy ruch magazynowy z WZ musi wskazywać istniejący dokument.",
        "SELECT count(*) AS n FROM stock_movements sm WHERE sm.source_type='wz'"
        " AND NOT EXISTS (SELECT 1 FROM wz_documents w WHERE w.id=sm.source_id)",
    ),
    (
        "brak_duplikatow_lotow",
        "Numer partii mięsa musi być unikalny.",
        "SELECT count(*) AS n FROM (SELECT lot_no FROM meat_stock"
        " GROUP BY lot_no HAVING count(*)>1) x",
    ),
    (
        "rezerwacja_nie_przekracza_stanu",
        "Rezerwacja partii mięsa nie może przekraczać jej stanu. Nadmiar oznacza"
        " zlecenie mieszania, które trzyma mięso wydane już przez WZ - blokuje"
        " partię, choć fizycznie nic tam nie ma.",
        "SELECT count(*) AS n FROM meat_stock"
        " WHERE COALESCE(kg_reserved,0) > kg_available + 0.001",
    ),
    (
        "znaki_ruchow_poprawne",
        "Rozchód musi być ujemny, a przychód dodatni. Sprawdzane od 2026-09-07,"
        " bo istnieje 1 zapis historyczny (partia 431), którego obecny kod"
        " nie może już powtórzyć.",
        "SELECT count(*) AS n FROM stock_movements"
        " WHERE ((movement_type='OUT' AND qty > 0) OR (movement_type='IN' AND qty < 0))"
        "   AND created_at > '2026-09-07'::timestamptz",
    ),
]


def run_integrity_checks() -> Dict[str, Any]:
    """Uruchom wszystkie kontrole i zwróć raport.

    Pojedyncza kontrola, która się wywali (np. po zmianie schematu), nie
    przerywa raportu: jest oznaczana jako błąd i widoczna dla biura.
    """
    checks: List[Dict[str, Any]] = []
    total = 0

    for name, description, sql in CHECKS:
        try:
            row = query_one(sql)
            n = int((row or {}).get("n") or 0)
            checks.append({
                "name": name,
                "description": description,
                "violations": n,
                "ok": n == 0,
            })
            total += n
        except Exception as exc:  # pragma: no cover
            logger.exception("integrity.check_failed", extra={"check": name})
            checks.append({
                "name": name,
                "description": description,
                "violations": -1,
                "ok": False,
                "error": str(exc)[:200],
            })
            total += 1

    ok = total == 0
    if not ok:
        logger.warning(
            "integrity.violations",
            extra={"total": total,
                   "failed": [c["name"] for c in checks if not c["ok"]]},
        )

    return {
        "ok": ok,
        "totalViolations": total,
        "checkedAt": now_iso(),
        "checks": checks,
    }
