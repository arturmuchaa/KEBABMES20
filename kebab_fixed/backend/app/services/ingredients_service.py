from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.ingredients import IngredientCreate
from app.utils.batch_numbers import delivery_period, format_ddfip_no, parse_ddfip_no
from app.utils.body import body_get
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_ingredients() -> List[Dict]:
    return query_all("SELECT * FROM ingredients WHERE active = true ORDER BY name")


def ingredient_stock() -> List[Dict]:
    return query_all(
        """
        SELECT
            i.*,
            COALESCE(SUM(s.qty_available), 0) AS qty_available_total,
            MAX(COALESCE(s.received_date, s.created_at::date)) AS last_receipt_at
        FROM ingredients i
        LEFT JOIN ingredient_stock s ON s.ingredient_id = i.id
        GROUP BY i.id
        ORDER BY i.name
        """
    )


def create_ingredient(dto: IngredientCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO ingredients
                (id, code, name, unit, is_unlimited, category, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (cuid(), dto.code, dto.name, dto.unit, dto.is_unlimited,
             getattr(dto, "category", None) or "other", now_iso()),
        )
    logger.info("ingredient.created", extra={"ingredient_id": row["id"]})
    return row


def deactivate_ingredient(ingredient_id: str) -> None:
    with transaction() as conn:
        cx_execute(
            conn, "UPDATE ingredients SET active=false WHERE id=%s", (ingredient_id,)
        )
    logger.info("ingredient.deactivated", extra={"ingredient_id": ingredient_id})


def list_ingredient_receipts() -> List[Dict]:
    return query_all(
        """
        SELECT
            s.*,
            i.name AS ingredient_name,
            i.unit
        FROM ingredient_stock s
        LEFT JOIN ingredients i ON i.id = s.ingredient_id
        ORDER BY COALESCE(s.received_date, s.created_at::date) DESC, s.created_at DESC
        """
    )


def create_ingredient_receipt(body: Dict[str, Any]) -> Dict:
    ingredient_id = body_get(body, "ingredient_id")
    qty = float(body_get(body, "qty", 0) or 0)
    stock_id = cuid()
    with transaction() as conn:
        cx_execute_returning(
            conn,
            """
            INSERT INTO ingredient_stock
                (id, ingredient_id, qty_available, qty_initial,
                 expiry_date, batch_no, supplier_id, price_per_unit,
                 invoice_no, received_date, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                stock_id,
                ingredient_id,
                qty,
                qty,
                body_get(body, "expiry_date") or None,
                body_get(body, "batch_no") or None,
                body_get(body, "supplier_id") or None,
                body_get(body, "price_per_unit", 0) or 0,
                body_get(body, "invoice_no") or None,
                body_get(body, "received_date") or None,
                body_get(body, "notes") or None,
                now_iso(),
            ),
        )
        row = cx_query_one(
            conn,
            """
            SELECT
                s.*,
                i.name AS ingredient_name,
                i.unit
            FROM ingredient_stock s
            LEFT JOIN ingredients i ON i.id = s.ingredient_id
            WHERE s.id = %s
            """,
            (stock_id,),
        )
        if qty > 0:
            create_stock_movement(
                conn,
                product_type="ingredient",
                batch_id=stock_id,
                qty=qty,
                movement_type="IN",
                source_type="ingredient_receipt",
                source_id=stock_id,
            )
    assert row is not None
    logger.info(
        "ingredient.receipt.created",
        extra={"stock_id": stock_id, "ingredient_id": ingredient_id, "qty": qty},
    )
    return row


# ─── Przyjęcie DDFiP: przyprawy, dodatki, opakowania (instrukcja 1.3 oPRP) ───
#
# Odpowiednik `receptions_service` dla artykułów pomocniczych. Księga prowadzi
# je OSOBNO od surowca pochodzenia zwierzęcego: własna instrukcja 1.3, własna
# karta 1.3.1 i własna seria numerów „DF/1/08".
#
# Jedna rzecz zachowuje się inaczej niż przy mięsie: dostawę ODRZUCONĄ też się
# rejestruje. Instrukcja 1.3 — „Pomimo braku fizycznego przyjęcia artykułów
# pomocniczych oraz środków spożywczych należy takie zdarzenie zarejestrować
# w karcie przyjęcia, gdyż posłużyć ono może w przyszłości do oceny dostawców".
# Dlatego dokument z `decision='N'` zapisuje się normalnie, tyle że NIE tworzy
# ani lotów, ani ruchów magazynowych.

#: Oceny cząstkowe z instrukcji 1.3 (kolumny f, g karty 1.3.1).
CHECK_VALUES = ("bz", "N")
#: Kwalifikacja całej dostawy (kolumna i): K = przyjęta, N = odmowa.
DECISIONS = ("K", "N")


def _ddfip_seq_key(period: str) -> str:
    return f"ddfip_no:{period}"


def next_ddfip_number(when: Optional[str] = None) -> Dict[str, Any]:
    """Podpowiedź numeru na dany dzień — PODGLĄD, bez rezerwacji.

    Numer nadaje dopiero zapis, więc dwa stanowiska otwarte naraz nie wystawią
    dwóch dokumentów o tym samym numerze (pilnuje tego indeks unikalny).
    """
    day = (when or "")[:10] or date.today().isoformat()
    period = delivery_period(day)
    row = query_one("SELECT value FROM sequences WHERE key=%s", (_ddfip_seq_key(period),))
    nxt = int(row["value"]) + 1 if row else 1
    return {
        "nextNo": format_ddfip_no(nxt, day),
        "seq": nxt,
        "period": period,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }


def _allocate_ddfip_no_cx(conn, day: str, custom: str) -> tuple[str, int, str]:
    """Numer wpisany ręcznie albo kolejny z sekwencji miesiąca.

    Numer ręczny podciąga sekwencję do max(dotychczasowa, podana) — inaczej
    kolejny auto-numer cofnąłby się pod już wystawiony dokument. Ta sama
    zasada, co przy numerze przyjęcia surowca.
    """
    period = delivery_period(day)
    try:
        parsed = parse_ddfip_no(custom)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    if parsed is not None:
        seq, month = parsed
        if month != int(day[5:7]):
            raise HTTPException(
                400,
                f"Numer DF/{seq}/{month:02d} wskazuje miesiąc {month:02d}, a data "
                f"dostawy {day} jest z miesiąca {day[5:7]}. Popraw numer albo datę.")
        no = format_ddfip_no(seq, day)
        if cx_query_one(conn,
                        "SELECT 1 FROM ingredient_receptions "
                        "WHERE reception_period=%s AND reception_seq=%s", (period, seq)):
            raise HTTPException(409, f"Przyjęcie {no} już istnieje w tym miesiącu")
        cx_execute(
            conn,
            "INSERT INTO sequences (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = GREATEST(sequences.value, EXCLUDED.value)",
            (_ddfip_seq_key(period), seq),
        )
        return no, seq, period

    row = cx_execute_returning(
        conn,
        """INSERT INTO sequences (key, value) VALUES (%s, 1)
           ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
           RETURNING value""",
        (_ddfip_seq_key(period),),
    )
    seq = int(row["value"])
    return format_ddfip_no(seq, day), seq, period


def create_ingredient_reception(dto) -> Dict[str, Any]:
    """Rejestracja dostawy DDFiP — jeden wiersz karty 1.3.1."""
    day = (dto.received_date or "")[:10] or date.today().isoformat()

    decyzja = (dto.decision or "K").strip().upper()
    if decyzja not in DECISIONS:
        raise HTTPException(400, "Ocena dostawy to K (przyjęta) albo N (odmowa)")
    for pole, wartosc in (("wizualna", dto.visual_check), ("zgodności", dto.compliance_check)):
        if (wartosc or "").strip() not in CHECK_VALUES:
            raise HTTPException(400, f"Ocena {pole}: dopuszczalne 'bz' albo 'N'")

    # Odrzucona dostawa TEŻ musi powiedzieć, czego dotyczyła — bez asortymentu
    # wpis jest bezużyteczny do oceny dostawcy, po którą instrukcja każe go robić.
    if not dto.lines:
        raise HTTPException(400, "Dostawa musi mieć co najmniej jedną pozycję")

    with transaction() as conn:
        sup = cx_query_one(conn, "SELECT * FROM suppliers WHERE id=%s", (dto.supplier_id,))
        if not sup:
            raise HTTPException(
                400, "Dostawca spoza kartoteki — instrukcja 1.3 wymaga dostawcy "
                     "z listy zakwalifikowanych podmiotów")

        skladniki: Dict[str, Dict] = {}
        for line in dto.lines:
            if line.ingredient_id in skladniki:
                continue
            row = cx_query_one(conn, "SELECT id, name, unit FROM ingredients WHERE id=%s",
                               (line.ingredient_id,))
            if not row:
                raise HTTPException(400, f"Nieznany składnik {line.ingredient_id}")
            skladniki[line.ingredient_id] = row

        # Kolumna (c) karty: nazwy bez powtórzeń, w kolejności wpisania.
        # Dwie partie tej samej przyprawy to nadal JEDEN asortyment.
        assortment = ", ".join(skladniki[i]["name"] for i in
                               dict.fromkeys(l.ingredient_id for l in dto.lines))

        no, seq, period = _allocate_ddfip_no_cx(conn, day, dto.reception_no)
        rec_id = cuid()
        reception = cx_execute_returning(
            conn,
            """INSERT INTO ingredient_receptions
                 (id, reception_no, reception_seq, reception_period, received_date,
                  supplier_id, supplier_name, assortment, document_no,
                  visual_check, compliance_check, notes, decision,
                  done_by, checked_by, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               RETURNING *""",
            (rec_id, no, seq, period, day, dto.supplier_id, sup.get("name") or "",
             assortment, dto.document_no or "", dto.visual_check, dto.compliance_check,
             dto.notes or "", decyzja, dto.done_by or "", dto.checked_by or "", now_iso()),
        )

        lines_out: List[Dict] = []
        # Odmowa nie tworzy ŻADNEGO lotu ani ruchu: towar fizycznie nie wjechał
        # do zakładu, więc magazyn nie ma prawa o nim wiedzieć.
        if decyzja == "K":
            for line in dto.lines:
                skl = skladniki[line.ingredient_id]
                stock_id = cuid()
                cx_execute(
                    conn,
                    """INSERT INTO ingredient_stock
                         (id, ingredient_id, ingredient_name, qty_available, qty_initial,
                          expiry_date, batch_no, supplier_id, price_per_unit,
                          invoice_no, received_date, notes, reception_id, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (stock_id, line.ingredient_id, skl["name"], line.qty, line.qty,
                     line.expiry_date or None, line.batch_no or None, dto.supplier_id,
                     line.price_per_unit, dto.document_no or None, day, "", rec_id,
                     now_iso()),
                )
                create_stock_movement(
                    conn,
                    product_type="ingredient",
                    batch_id=stock_id,
                    qty=float(line.qty),
                    movement_type="IN",
                    source_type="ingredient_reception",
                    source_id=rec_id,
                )
                lines_out.append({"id": stock_id, "ingredient_id": line.ingredient_id,
                                  "ingredient_name": skl["name"], "unit": skl.get("unit"),
                                  "qty": float(line.qty), "batch_no": line.batch_no})

    logger.info("ingredient_reception.created",
                extra={"reception_no": no, "decision": decyzja, "lines": len(dto.lines)})
    return {"reception": reception, "lines": lines_out}


def get_ingredient_reception(reception_id: str) -> Dict:
    """Jeden dokument z pozycjami — pod druk etykiet i podgląd z rejestru."""
    rec = query_one("SELECT * FROM ingredient_receptions WHERE id=%s", (reception_id,))
    if not rec:
        raise HTTPException(404, "Nie ma takiego przyjęcia")
    rec["lines"] = query_all(
        """SELECT s.id, s.ingredient_id, s.qty_initial AS qty, s.batch_no,
                  s.expiry_date, s.price_per_unit,
                  COALESCE(s.ingredient_name, i.name) AS ingredient_name, i.unit
           FROM ingredient_stock s
           LEFT JOIN ingredients i ON i.id = s.ingredient_id
           WHERE s.reception_id=%s ORDER BY s.created_at""",
        (reception_id,))
    return rec


def list_ingredient_receptions(date_from: Optional[str] = None,
                               date_to: Optional[str] = None) -> List[Dict]:
    """Rejestr dostaw DDFiP — źródło karty 1.3.1.

    Najnowsze na górze (biuro szuka ostatniej dostawy), a wydruk karty i tak
    porządkuje wiersze po swojemu.
    """
    where, params = [], []
    if date_from:
        where.append("received_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("received_date <= %s")
        params.append(date_to)
    sql = "SELECT * FROM ingredient_receptions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY received_date DESC NULLS LAST, reception_seq DESC"
    recepcje = query_all(sql, tuple(params))
    if not recepcje:
        return []

    pozycje = query_all(
        """SELECT s.id, s.reception_id, s.ingredient_id, s.qty_initial AS qty,
                  s.batch_no, s.expiry_date, s.price_per_unit,
                  COALESCE(s.ingredient_name, i.name) AS ingredient_name, i.unit
           FROM ingredient_stock s
           LEFT JOIN ingredients i ON i.id = s.ingredient_id
           WHERE s.reception_id = ANY(%s)
           ORDER BY s.created_at""",
        ([r["id"] for r in recepcje],),
    )
    wg_dokumentu: Dict[str, List[Dict]] = {}
    for p in pozycje:
        wg_dokumentu.setdefault(p["reception_id"], []).append(p)
    for r in recepcje:
        r["lines"] = wg_dokumentu.get(r["id"], [])
    return recepcje
