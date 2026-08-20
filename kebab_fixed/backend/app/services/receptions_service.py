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
                    execute, query_all, query_one, transaction)
from app.logging_config import get_logger
from app.models.raw_batches import RawBatchCreate
from app.models.receptions import ReceptionCreate, ReceptionGroupIn, ReceptionUpdate
from app.services.hdi_scan_store import (attach_bytes, find_original, save_original,
                                          take_temp)
from app.services.hdi_scan_render import caption_for, prepare_scan
from app.services.raw_batches_service import (_batch_used_reason_cx, _cancel_batch_cx,
                                              apply_group_cx, create_batch_cx,
                                              retarget_material_cx)
from app.services.raw_batches_service import cancel_reception as raw_batches_cancel_reception
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
    # Najpierw numer ZWOLNIONY anulowaniem dokumentu — seria przyjęć ma być
    # ciągła, bo biuro czyta ją jako listę dostaw i drukuje na karcie 1.1.1
    # (19.08.2026 anulowana próba zostawiła widoczną przerwę 27/08 → 29/08).
    odzyskany = cx_query_one(
        conn,
        "DELETE FROM numery_zwolnione WHERE seria=%s AND seq = ("
        "  SELECT MIN(seq) FROM numery_zwolnione WHERE seria=%s) RETURNING seq",
        (_seq_key(period, is_service), _seq_key(period, is_service)),
    )
    if odzyskany and odzyskany.get("seq"):
        seq = int(odzyskany["seq"])
        return format_delivery_no(seq, day, is_service), seq, period

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


def _assert_group_unchanged_cx(conn, batch_row: Dict, g, *,
                               material_type_id: str = "") -> Optional[str]:
    """Zamrożoną pozycję wolno przysłać TYLKO bez zmian.

    Backend porównuje wartości sam — nie ufa temu, że front wyszarzył wiersz.
    Zwraca powód zamrożenia (albo None), żeby pętla wiedziała, czy pozycję
    pominąć: przepuszczenie jej przez `apply_group_cx` przeksięgowałoby
    nośniki i przepisało datę mimo braku zmian.
    """
    reason = _batch_used_reason_cx(conn, batch_row["id"], for_cancel=True)
    if not reason:
        return None
    numer = batch_row.get("internal_batch_no") or batch_row["id"]
    if abs(float(g.kg_received) - float(batch_row["kg_received"] or 0)) > 0.001:
        raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można zmienić wagi")
    if (g.internal_batch_no or numer) != numer:
        raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można zmienić numeru")
    if material_type_id and material_type_id != (batch_row.get("material_type_id") or ""):
        raise HTTPException(
            409, f"Numer {numer} jest już w użyciu — nie można zmienić rodzaju surowca")
    return reason


def _replace_supplier_lines_cx(conn, reception_id: str, g, *,
                               batch_id: str = "") -> None:
    """Pozycje HDI tego numeru porządkowego zapisane od nowa.

    Kasujemy i wstawiamy zamiast diffować wiersz po wierszu: pozycje HDI nie
    mają własnej tożsamości (operator dokłada, usuwa i przestawia je w locie),
    a jedyne, co się liczy, to końcowa lista i jej kolejność (`seq`).
    """
    bid = batch_id or g.batch_id
    cx_execute(
        conn, "DELETE FROM reception_supplier_batches WHERE raw_batch_id=%s",
        (bid,))
    # Lp liczy się PRZEZ CAŁY dokument, nie od nowa w każdym numerze
    # porządkowym: to kolumna z HDI dostawcy i po niej biuro odnajduje pozycję
    # na papierze (opis wypalany na skanie wymienia właśnie te numery).
    ost = cx_query_one(
        conn, "SELECT COALESCE(MAX(seq),0) AS m FROM reception_supplier_batches "
              "WHERE reception_id=%s", (reception_id,))
    seq = int((ost or {}).get("m") or 0) + 1
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
            (cuid(), reception_id, bid, b.supplier_batch_no.strip(),
             float(b.kg) if b.kg else None, b.slaughter_date or None,
             b.expiry_date or None, seq),
        )
        seq += 1


def update_reception(reception_id: str, dto: ReceptionUpdate) -> Dict[str, Any]:
    """Zapis CAŁEGO dokumentu dostawy po edycji.

    Wszystko w jednej transakcji: dokument zapisany w połowie rozjeżdża księgę
    i saldo pojemników bez śladu, dlaczego.

    UWAGA — praca w toku (plan `docs/superpowers/plans/2026-08-14-edycja-przyjecia.md`):
    na razie zapisuje sam NAGŁÓWEK dokumentu. Pozycje (aktualizacja, dołożenie,
    zdjęcie numeru, zmiana rodzaju surowca) dochodzą w kolejnych zadaniach planu
    i dopiero wtedy front dostanie ekran edycji. Endpoint nie jest jeszcze
    podpięty do żadnego przycisku.
    """
    rec = query_one("SELECT * FROM receptions WHERE id=%s", (reception_id,))
    if not rec:
        raise HTTPException(404, "Nie ma takiego przyjęcia")

    day = (dto.received_date or "")[:10] or str(rec["received_date"])[:10]

    with transaction() as conn:
        cx_execute(
            conn,
            "UPDATE receptions SET received_date=%s, document_no=%s, hdi_no=%s, notes=%s "
            "WHERE id=%s",
            (day, dto.document_no or "", dto.hdi_no or "", dto.notes or "", reception_id),
        )

        istniejace = {
            b["id"]: b for b in cx_query_all(
                conn, "SELECT * FROM raw_batches WHERE reception_id=%s "
                      "AND COALESCE(status,'') <> 'cancelled'", (reception_id,))
        }
        for g in dto.groups:
            if not g.batch_id:
                # Pozycja dołożona przy edycji — powstaje tak samo jak przy
                # rejestrowaniu dostawy, żeby dostała numer z sekwencji, lot
                # magazynu mięsa i zaksięgowane nośniki.
                numery_nowej = [b.supplier_batch_no.strip() for b in g.supplier_batches
                                if (b.supplier_batch_no or "").strip()]
                nowa = create_batch_cx(conn, RawBatchCreate.model_validate({
                    "internalBatchNo": g.internal_batch_no or "",
                    "materialTypeId": dto.material_type_id or "",
                    "supplierId": rec["supplier_id"],
                    "supplierBatchNo": ", ".join(numery_nowej),
                    "slaughterDate": g.slaughter_date or "",
                    "receivedDate": day,
                    "expiryDate": g.expiry_date or "",
                    "kgReceived": g.kg_received,
                    "pricePerKg": dto.price_per_kg,
                    "invoiceNo": dto.document_no or "",
                    "notes": dto.notes or "",
                    "containerKg": g.container_kg,
                    "containersCount": g.containers_count,
                    "palletsH1": g.pallets_h1,
                    "palletsOther": g.pallets_other,
                    "palletsOtherKind": g.pallets_other_kind,
                    "isService": bool(rec.get("is_service")),
                }), reception_id=reception_id)
                _replace_supplier_lines_cx(conn, reception_id, g, batch_id=nowa["id"])
                continue
            if g.batch_id not in istniejace:
                raise HTTPException(400, f"Pozycja {g.batch_id} nie należy do tej dostawy")
            if _assert_group_unchanged_cx(conn, istniejace[g.batch_id], g,
                                          material_type_id=dto.material_type_id):
                continue          # zamrożona i bez zmian — nie ruszamy jej wcale
            # Rodzaj surowca decyduje, GDZIE leżą kilogramy, więc przenosimy je
            # przed zapisem wagi — inaczej apply_group_cx pisałby stan w miejsce,
            # z którego zaraz by go zabrano.
            if dto.material_type_id:
                retarget_material_cx(conn, g.batch_id, dto.material_type_id)
            numery = [b.supplier_batch_no.strip() for b in g.supplier_batches
                      if (b.supplier_batch_no or "").strip()]
            apply_group_cx(
                conn, g.batch_id,
                kg=g.kg_received, price_per_kg=dto.price_per_kg,
                supplier_batch_no=", ".join(numery),
                slaughter_date=g.slaughter_date or _earliest(
                    [b.slaughter_date for b in g.supplier_batches]),
                expiry_date=g.expiry_date or _earliest(
                    [b.expiry_date for b in g.supplier_batches]),
                received_date=day, document_no=dto.document_no or "",
                notes=dto.notes or "",
                container_kg=g.container_kg, containers_count=g.containers_count,
                pallets_h1=g.pallets_h1, pallets_other=g.pallets_other,
                pallets_other_kind=g.pallets_other_kind)
            _replace_supplier_lines_cx(conn, reception_id, g)

        # Numer, którego formularz nie odesłał, operator zdjął z dokumentu.
        # Anulujemy go tą samą drogą co ręczne anulowanie: wiersz zostaje
        # w historii ze znacznikiem ANUL-, a numer wraca do puli.
        przyslane = {g.batch_id for g in dto.groups if g.batch_id}
        for bid, brow in istniejace.items():
            if bid in przyslane:
                continue
            powod = _batch_used_reason_cx(conn, bid, for_cancel=True)
            if powod:
                numer = brow.get("internal_batch_no") or bid
                raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można go zdjąć")
            _cancel_batch_cx(conn, bid)

    # Opis wypalony na skanie wymienia numery porządkowe i wagi — po edycji
    # dokumentu musi za nimi pójść, inaczej skan mówi co innego niż system
    # (19 i 20.08.2026). Dostawy bez zachowanego oryginału zostają bez zmian.
    przelicz_opis_skanu(reception_id)

    out = get_reception(reception_id)
    out["warnings"] = []
    logger.info("reception.updated", extra={"reception_no": rec.get("reception_no")})
    return out


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
    # Powód, dla którego pozycji nie wolno już ruszyć — formularz edycji
    # wyszarza po nim wiersz. Liczymy go TYM SAMYM warunkiem, którego pilnuje
    # zapis: druga definicja „ruszonej" pozycji rozjechałaby się z pierwszą
    # i operator dostawałby 409 na polu, które wyglądało na edytowalne.
    if batches:
        with transaction() as conn:
            for b in batches:
                b["frozen_reason"] = (
                    _batch_used_reason_cx(conn, b["id"], for_cancel=True) or "")
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


#: Anulowane dokumenty odkładamy poza serię — numer ma wrócić do puli, a ślad
#: zostać. Przesunięcie o 9000 nie koliduje z żadną realną numeracją miesiąca.
_POZA_SERIA = 9000


def cancel_reception_document(reception_id: str) -> Dict[str, Any]:
    """Anuluj CAŁY dokument dostawy i ZWOLNIJ jego numer.

    Anulowana rejestracja to korekta naszej pomyłki przy wpisywaniu, a nie
    zdarzenie przy rampie: nie ma prawa zjadać numeru w serii, którą biuro
    czyta jako listę dostaw (19.08.2026 zostawiła widoczną przerwę między
    27/08 a 29/08). Wiersz zostaje w historii ze znacznikiem „ANUL", żeby dało
    się odtworzyć, co się wydarzyło.
    """
    rec = query_one("SELECT * FROM receptions WHERE id=%s", (reception_id,))
    if not rec:
        raise HTTPException(404, "Nie ma takiego przyjęcia")

    out = raw_batches_cancel_reception(reception_id)

    seq = int(rec["reception_seq"] or 0)
    if seq < _POZA_SERIA:
        execute(
            "UPDATE receptions SET reception_seq=%s, reception_no=%s WHERE id=%s",
            (seq + _POZA_SERIA, f"ANUL {rec['reception_no']}", reception_id))
        execute(
            "INSERT INTO numery_zwolnione (seria, seq) VALUES (%s,%s) "
            "ON CONFLICT (seria, seq) DO NOTHING",
            (_seq_key(rec["reception_period"], bool(rec.get("is_service"))), seq))
        logger.info("reception.cancelled", extra={"reception_no": rec["reception_no"]})
    return {**out, "reception_no": rec["reception_no"]}


def _store_scan(reception_id: str, reception_no: str, batches, data: bytes,
                suffix: str) -> Optional[str]:
    """Skan → archiwum: prostujemy do pionu i drukujemy opis nad dokumentem.

    Opis zastępuje to, co dotąd dopisywano długopisem („472" w rogu skanu
    z 12.08): do jakich numerów porządkowych trafiła ta dostawa.
    """
    # Oryginał zostaje OBOK wersji opisanej: opis jest wypalony w pliku,
    # a numer dokumentu bywa poprawiany. Bez oryginału jedynym wyjściem było
    # ponowne skanowanie papieru (19 i 20.08.2026 dwa razy z rzędu).
    save_original(data, suffix, reception_id)
    gotowe, suf = prepare_scan(data, suffix, caption_for(reception_no, batches))
    return attach_bytes(gotowe, suf, reception_id)


def przelicz_opis_skanu(reception_id: str) -> bool:
    """Odtwórz opis na skanie z AKTUALNEGO stanu dokumentu.

    Wołane po zmianie, która rusza opis: numer przyjęcia, numery porządkowe
    albo wagi. Zwraca False, gdy nie ma z czego odtworzyć (dostawy sprzed
    zachowywania oryginałów) — wtedy trzeba przeskanować papier ponownie
    i trzeba to powiedzieć wprost, a nie udawać sukces.
    """
    zrodlo = find_original(reception_id)
    if not zrodlo:
        return False
    rec = query_one("SELECT reception_no FROM receptions WHERE id=%s", (reception_id,))
    if not rec:
        return False
    # Z pozycjami HDI — opis wymienia, które Lp weszły do którego numeru.
    batches = query_all(
        "SELECT id, internal_batch_no, kg_received, status FROM raw_batches "
        "WHERE reception_id=%s ORDER BY internal_batch_seq", (reception_id,))
    po_partii: Dict[str, List[Dict]] = {}
    for l in query_all(
            "SELECT raw_batch_id, seq FROM reception_supplier_batches "
            "WHERE reception_id=%s ORDER BY seq", (reception_id,)):
        po_partii.setdefault(l["raw_batch_id"] or "", []).append({"seq": l["seq"]})
    for b in batches:
        b["supplier_batches"] = po_partii.get(b["id"], [])
    gotowe, suf = prepare_scan(
        zrodlo.read_bytes(), zrodlo.suffix.replace(".orig", ""),
        caption_for(rec["reception_no"], batches))
    nazwa = attach_bytes(gotowe, suf, reception_id)
    if not nazwa:
        return False
    execute("UPDATE receptions SET hdi_scan=%s WHERE id=%s", (nazwa, reception_id))
    logger.info("hdi_scan.opis_przeliczony", extra={"reception": reception_id})
    return True


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
