"""Przyjęcie surowca jako dokument całej dostawy.

Trzy poziomy numeracji (opis w `app/utils/batch_numbers.py`):

    PRZYJĘCIE 1/08/2026 — 10 000 kg, KOKO, WZ-12345
    ├── NUMER PORZĄDKOWY 471 — 6 000 kg
    │     └── partie dostawcy A001 … A005
    └── NUMER PORZĄDKOWY 472 — 4 000 kg
          └── partie dostawcy A006 … A008

Dotąd numeru przyjęcia nie było: biuro rejestrowało 471 i 472 osobno i nic
ich nie łączyło, choć fizycznie to jedno auto i jeden komplet dokumentów.
Karta HACCP 1.1.1 ma na ten numer osobną kolumnę (a).
"""
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import (cx_execute, cx_execute_returning, cx_query_all, cx_query_one,
                    query_all, query_one, transaction)
from app.logging_config import get_logger
from app.models.raw_batches import RawBatchCreate
from app.models.receptions import ReceptionCreate, ReceptionGroupIn
from app.services.hdi_scan_store import attach_bytes, take_temp
from app.services.hdi_scan_render import caption_for, prepare_scan
from app.services.raw_batches_service import create_batch_cx
from app.utils.batch_numbers import delivery_period, format_delivery_no, parse_delivery_no
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

#: Tolerancja kontroli „suma partii dostawcy = kg numeru porządkowego".
#: To arytmetyka na wpisanych liczbach, nie pomiar — luz tylko na grosze kg.
SUM_TOLERANCE_KG = 0.01


def _seq_key(period: str, is_service: bool = False) -> str:
    """Osobna sekwencja dla przyjęć NA USŁUGĘ — własna seria „1/08U"."""
    return f"reception_no:{period}{':U' if is_service else ''}"


def _today_iso() -> str:
    return date.today().isoformat()


def next_delivery_number(when: Optional[str] = None,
                         is_service: bool = False) -> Dict[str, Any]:
    """Podpowiedź numeru przyjęcia dla podanego dnia (bez rezerwacji)."""
    day = (when or "")[:10] or _today_iso()
    period = delivery_period(day)
    row = query_one("SELECT value FROM sequences WHERE key=%s",
                    (_seq_key(period, is_service),))
    nxt = int(row["value"]) + 1 if row else 1
    return {
        "nextNo": format_delivery_no(nxt, day, is_service),
        "seq": nxt,
        "period": period,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }


def _allocate_no_cx(conn, day: str, custom: str,
                    is_service: bool = False) -> tuple[str, int, str]:
    """Numer przyjęcia: wpisany ręcznie albo kolejny z sekwencji miesiąca.

    Numer ręczny synchronizuje sekwencję do max(dotychczasowa, podana), żeby
    kolejne auto-numery nie cofnęły się pod już wystawiony dokument — ta sama
    zasada, co przy numerach porządkowych.
    """
    parsed = parse_delivery_no(custom)
    if parsed is not None:
        seq, month, wpisana_usluga = parsed
        # Litera „U" w numerze musi zgadzać się z tym, czy dostawa jest na
        # usługę — inaczej dokument trafiłby do serii innej, niż mówi jego
        # własny numer (i pod inne numery porządkowe).
        if wpisana_usluga != is_service:
            raise HTTPException(
                400,
                f"Numer {custom} należy do serii "
                f"{'usługowej' if wpisana_usluga else 'zwykłej'}, a przyjęcie jest "
                f"{'na usługę' if is_service else 'zwykłe'}. Popraw numer albo znacznik usługi.")
        # Numer nie niesie już roku, więc rok bierzemy z DATY DOSTAWY.
        # Miesiąc musi się z nią zgadzać — inaczej dokument wylądowałby
        # w innym miesiącu, niż mówi jego własny numer.
        if month != int(day[5:7]):
            raise HTTPException(
                400,
                f"Numer {custom} wskazuje miesiąc {month:02d}, a data dostawy "
                f"{day} jest z miesiąca {day[5:7]}. Popraw numer albo datę.")
        period = delivery_period(day)
        no = format_delivery_no(seq, day, is_service)
        if cx_query_one(
                conn,
                "SELECT 1 FROM receptions WHERE reception_period=%s AND reception_seq=%s "
                "AND COALESCE(is_service,false)=%s",
                (period, seq, is_service)):
            raise HTTPException(409, f"Przyjęcie {no} już istnieje w tym miesiącu")
        cx_execute(
            conn,
            "INSERT INTO sequences (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = GREATEST(sequences.value, EXCLUDED.value)",
            (_seq_key(period, is_service), seq),
        )
        return no, seq, period

    period = delivery_period(day)
    row = cx_query_one(
        conn,
        "INSERT INTO sequences (key, value) VALUES (%s, 1) "
        "ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value",
        (_seq_key(period, is_service),),
    )
    seq = int(row["value"])
    return format_delivery_no(seq, day, is_service), seq, period


def _insert_reception_cx(conn, *, day: str, supplier_id: str, supplier_name: str,
                         document_no: str, notes: str, custom_no: str = "",
                         hdi_no: str = "", doc_kg=None, doc_containers=None,
                         is_service: bool = False) -> Dict:
    no, seq, period = _allocate_no_cx(conn, day, custom_no, is_service)
    return cx_execute_returning(
        conn,
        """
        INSERT INTO receptions
            (id, reception_no, reception_seq, reception_period, received_date,
             supplier_id, supplier_name, document_no, hdi_no, doc_kg,
             doc_containers, notes, is_service, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
        """,
        (cuid(), no, seq, period, day, supplier_id, supplier_name or "",
         document_no or "", hdi_no or "", doc_kg, doc_containers,
         notes or "", bool(is_service), now_iso()),
    )


def find_or_create_reception_cx(conn, *, received_date: str, supplier_id: str,
                                document_no: str = "") -> str:
    """Dokument dostawy dla ścieżki POJEDYNCZEJ partii.

    Jedna dostawa = (dzień, dostawca): druga partia rejestrowana tego samego
    dnia od tego samego dostawcy dopina się do istniejącego dokumentu zamiast
    zakładać nowy. Dzięki temu partia nigdy nie zostaje bez numeru przyjęcia,
    także gdy operator rejestruje ją starą drogą.
    """
    day = (received_date or "")[:10] or _today_iso()
    found = cx_query_one(
        conn,
        "SELECT id FROM receptions WHERE received_date=%s::date "
        "AND COALESCE(supplier_id,'')=COALESCE(%s,'') ORDER BY reception_seq LIMIT 1",
        (day, supplier_id),
    )
    if found:
        return found["id"]
    sup = cx_query_one(conn, "SELECT name FROM suppliers WHERE id=%s", (supplier_id,))
    row = _insert_reception_cx(
        conn, day=day, supplier_id=supplier_id,
        supplier_name=sup["name"] if sup else "", document_no=document_no, notes="")
    return row["id"]


def _validate_groups(groups: List[ReceptionGroupIn]) -> List[str]:
    """Kontrole z modelu dostawy. Zwraca OSTRZEŻENIA; błędy rzuca jako 400.

    Blokuje tylko rozjazd arytmetyczny (suma partii dostawcy ≠ kg numeru
    porządkowego) — to zawsze literówka. Podzielona partia dostawcy jest
    ostrzeżeniem, nie blokadą: dostawa musi wejść do systemu o szóstej rano,
    a anomalia ma być WIDOCZNA, nie nieusuwalna.
    """
    if not groups:
        raise HTTPException(400, "Przyjęcie musi mieć co najmniej jeden numer porządkowy")

    for i, g in enumerate(groups, 1):
        known = [b for b in g.supplier_batches if float(b.kg or 0) > 0]
        if not known:
            continue
        total = sum(float(b.kg) for b in known)
        if abs(total - float(g.kg_received)) > SUM_TOLERANCE_KG:
            raise HTTPException(
                400,
                f"Numer porządkowy {i}: partie dostawcy dają {total:g} kg, "
                f"a w pozycji wpisano {float(g.kg_received):g} kg")

    seen: Dict[str, int] = {}
    warnings: List[str] = []
    for i, g in enumerate(groups, 1):
        for b in g.supplier_batches:
            no = (b.supplier_batch_no or "").strip()
            if not no:
                continue
            if no in seen and seen[no] != i:
                warnings.append(
                    f"Partia dostawcy {no} rozdzielona między numer porządkowy "
                    f"{seen[no]} i {i} — jedna partia dostawcy powinna trafić w całości "
                    f"do jednego numeru")
            seen.setdefault(no, i)
    return warnings


def _earliest(values: List[str]) -> str:
    """Najwcześniejsza data z pozycji HDI — FEFO liczy się od najkrótszej."""
    dates = sorted(v[:10] for v in values if v)
    return dates[0] if dates else ""


def create_reception(dto: ReceptionCreate) -> Dict[str, Any]:
    """Rejestruje CAŁĄ dostawę: jeden dokument + tyle partii, ile grup.

    Wszystko w jednej transakcji — po błędzie w trzeciej grupie nie mogą
    zostać dwie partie z surowcem, którego fizycznie nie przyjęto.
    """
    warnings = _validate_groups(dto.groups)
    day = (dto.received_date or "")[:10] or _today_iso()

    with transaction() as conn:
        sup = cx_query_one(conn, "SELECT name FROM suppliers WHERE id=%s", (dto.supplier_id,))
        reception = _insert_reception_cx(
            conn, day=day, supplier_id=dto.supplier_id,
            supplier_name=sup["name"] if sup else "", document_no=dto.document_no,
            notes=dto.notes, custom_no=dto.reception_no, hdi_no=dto.hdi_no,
            doc_kg=dto.doc_kg, doc_containers=dto.doc_containers,
            is_service=dto.is_service)

        batches: List[Dict] = []
        seq = 0
        for g in dto.groups:
            numbers = [b.supplier_batch_no.strip() for b in g.supplier_batches
                       if (b.supplier_batch_no or "").strip()]
            batch = create_batch_cx(conn, RawBatchCreate.model_validate({
                "internalBatchNo": g.internal_batch_no or "",
                "materialTypeId": dto.material_type_id or "",
                "supplierId": dto.supplier_id,
                # Numery dostawcy zostają też na partii: czyta je WZ, HDI
                # i traceability, które nie wiedzą nic o dokumencie przyjęcia.
                "supplierBatchNo": ", ".join(numbers),
                "slaughterDate": g.slaughter_date or _earliest(
                    [b.slaughter_date for b in g.supplier_batches]),
                "receivedDate": day,
                "expiryDate": g.expiry_date or _earliest(
                    [b.expiry_date for b in g.supplier_batches]),
                "kgReceived": g.kg_received,
                "pricePerKg": dto.price_per_kg,
                "invoiceNo": dto.document_no or "",
                "notes": dto.notes or "",
                "containerKg": g.container_kg,
                "containersCount": g.containers_count,
                "palletsH1": g.pallets_h1,
                "palletsOther": g.pallets_other,
                "palletsOtherKind": g.pallets_other_kind,
                "isService": dto.is_service,
            }), reception_id=reception["id"])
            batches.append(batch)

            for b in g.supplier_batches:
                if not (b.supplier_batch_no or "").strip():
                    continue
                cx_execute(
                    conn,
                    """
                    INSERT INTO reception_supplier_batches
                        (id, reception_id, raw_batch_id, supplier_batch_no,
                         kg, slaughter_date, expiry_date, seq)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (cuid(), reception["id"], batch["id"], b.supplier_batch_no.strip(),
                     float(b.kg) if b.kg else None, b.slaughter_date or None,
                     b.expiry_date or None, seq),
                )
                seq += 1

    # Skan HDI staje się załącznikiem DOPIERO teraz: dopóki operator nie
    # zapisał przyjęcia, mógł zrezygnować, a porzucone próby nie mają po co
    # trafiać do archiwum dokumentów.
    if dto.hdi_scan_id:
        wzięty = take_temp(dto.hdi_scan_id)
        nazwa = _store_scan(reception["id"], reception["reception_no"], batches,
                            *wzięty) if wzięty else None
        if nazwa:
            from app.db import execute as _execute
            _execute("UPDATE receptions SET hdi_scan=%s WHERE id=%s", (nazwa, reception["id"]))
            reception["hdi_scan"] = nazwa

    logger.info("reception.created", extra={
        "reception_no": reception["reception_no"],
        "groups": len(batches),
        "kg_total": sum(float(b["kg_received"]) for b in batches),
    })
    return {"reception": reception, "batches": batches, "warnings": warnings}


def _attach_details(rec: Dict) -> Dict:
    """Dokument + numery porządkowe + partie dostawcy pod każdym z nich.

    Dokłada też mięso z rozbioru: karta 1.1.1/2 ma kolumnę „Mięso [kg]",
    którą do tej pory zostawialiśmy pustą, bo w chwili przyjęcia jest jeszcze
    nieznana. Na wydruku miesięcznym rozbiór jest już zrobiony, więc liczba
    jest — i to ta sama, którą liczy reszta systemu (tylko wpisy `complete`,
    storna i wpisy w trakcie ważenia nie wchodzą).
    """
    batches = query_all(
        "SELECT b.*, COALESCE(rt.requires_deboning, true) AS requires_deboning "
        "FROM raw_batches b LEFT JOIN raw_material_types rt ON rt.id = b.material_type_id "
        "WHERE b.reception_id=%s ORDER BY b.internal_batch_seq",
        (rec["id"],))
    lines = query_all(
        "SELECT * FROM reception_supplier_batches WHERE reception_id=%s ORDER BY seq",
        (rec["id"],))
    meat = {r["raw_batch_id"]: float(r["kg"] or 0) for r in query_all(
        "SELECT de.raw_batch_id, COALESCE(SUM(de.kg_meat), 0) AS kg "
        "FROM deboning_entries de JOIN raw_batches b ON b.id = de.raw_batch_id "
        "WHERE b.reception_id = %s AND COALESCE(de.status, 'complete') = 'complete' "
        "GROUP BY de.raw_batch_id", (rec["id"],))}
    by_batch: Dict[str, List[Dict]] = {}
    for l in lines:
        by_batch.setdefault(l["raw_batch_id"] or "", []).append(l)
    for b in batches:
        b["supplier_batches"] = by_batch.get(b["id"], [])
        # Surowiec BEZ rozbioru (filet, mięso z/s) sam jest mięsem — cała
        # dostawa idzie prosto na magazyn mięsa, więc kolumna „Mięso [kg]"
        # to jej waga. Liczenie z rozbioru dawałoby tu zero i wyglądało jak
        # partia nieprzerobiona.
        b["kg_meat"] = (float(b["kg_received"] or 0) if not b["requires_deboning"]
                        else meat.get(b["id"], 0.0))
    rec["batches"] = batches
    # Anulowana rejestracja to korekta NASZEJ pomyłki, nie dostawa — nie może
    # podbijać wagi dokumentu (7/08/2026 pokazywało 20 010 kg zamiast 10 005).
    rec["kg_total"] = sum(float(b["kg_received"] or 0) for b in batches
                          if b.get("status") != "cancelled")
    return rec


def get_reception(reception_id: str) -> Dict:
    rec = query_one("SELECT * FROM receptions WHERE id=%s OR reception_no=%s",
                    (reception_id, reception_id))
    if not rec:
        raise HTTPException(404, "Nie ma takiego przyjęcia")
    return _attach_details(rec)


def _store_scan(reception_id: str, reception_no: str, batches, data: bytes,
                suffix: str) -> Optional[str]:
    """Skan → archiwum: prostujemy do pionu i drukujemy opis nad dokumentem.

    Opis zastępuje to, co dotąd dopisywano długopisem („472" w rogu skanu
    z 12.08): do jakich numerów porządkowych trafiła ta dostawa.
    """
    gotowe, suf = prepare_scan(data, suffix, caption_for(reception_no, batches))
    return attach_bytes(gotowe, suf, reception_id)


def attach_scan(reception_id: str, data: bytes, filename: str) -> Dict:
    """Dopina skan HDI do przyjęcia JUŻ ZAPISANEGO.

    Bez tego dostawa raz zapisana bez dokumentu zostawała bez niego na
    zawsze — a przy kontroli trzeba pokazać, NA PODSTAWIE CZEGO przyjęto
    surowiec. Dotyczy to także wszystkich dostaw sprzed archiwum skanów.

    Podmiana istniejącego załącznika jest dozwolona (operator wgrał nie ten
    dokument), ale zostaje w logu — to zmiana w dokumentacji kontrolnej.
    """
    rec = get_reception(reception_id)          # 404, gdy nie ma takiej dostawy
    if not data:
        raise HTTPException(400, "Pusty plik — nie ma czego zapisać")

    from pathlib import Path

    poprzedni = rec.get("hdi_scan") or ""
    nazwa = _store_scan(rec["id"], rec.get("reception_no") or "",
                        rec.get("batches") or [], data, Path(filename or "").suffix)
    if not nazwa:
        raise HTTPException(500, "Nie udało się zapisać skanu na serwerze")

    from app.db import execute as _execute
    _execute("UPDATE receptions SET hdi_scan=%s WHERE id=%s", (nazwa, rec["id"]))
    logger.info("hdi_scan.attached_late",
                extra={"reception": rec["id"], "replaced": bool(poprzedni)})
    return {"reception_id": rec["id"], "hdi_scan": nazwa, "replaced": bool(poprzedni)}


def list_receptions(*, date_from: str = "", date_to: str = "", limit: int = 200) -> List[Dict]:
    """Dokumenty przyjęcia w oknie dat — źródło rejestru 1.1.1."""
    sql = "SELECT * FROM receptions WHERE 1=1"
    params: List[Any] = []
    if date_from:
        sql += " AND received_date >= %s::date"
        params.append(date_from[:10])
    if date_to:
        sql += " AND received_date <= %s::date"
        params.append(date_to[:10])
    sql += " ORDER BY received_date DESC, reception_seq DESC LIMIT %s"
    params.append(max(1, min(int(limit), 1000)))
    return [_attach_details(r) for r in query_all(sql, params)]
