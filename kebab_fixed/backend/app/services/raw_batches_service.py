from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.raw_batches import RawBatchAdjust, RawBatchCreate, RawBatchUpdate
from app.services.container_ledger_service import book_assets
from app.services.container_partners_service import resolve_partner
from app.utils.batch_numbers import (
    format_reception_no,
    format_service_reception_no,
    parse_any_reception_no,
)
from app.utils.body import body_get
from app.utils.containers import ASSET_TYPES, containers_for_kg
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def _book_batch_containers(
    conn,
    batch_row: Dict,
    *,
    container_kg: Optional[float],
    containers_count: Optional[int],
    pallets_h1: int,
    pallets_other: int,
    pallets_other_kind: Optional[str] = None,
) -> Optional[int]:
    """Zapisuje nośniki na partii i księguje je na saldzie DOSTAWCY.

    Dostawa przyjeżdża w pojemnikach dostawcy → znak DODATNI (my winni).
    Liczba wpisana ręcznie ma pierwszeństwo przed wyliczeniem z kalibru —
    operator, który fizycznie policzył pojemniki, wie lepiej niż wzór.
    Ruch startuje jako NIEPOTWIERDZONY: liczy się do salda, ale trafia
    do sekcji „Do rozliczenia" na przegląd biura.
    """
    kg = float(batch_row.get("kg_received") or 0)
    containers = containers_count
    if containers is None:
        containers = containers_for_kg(kg, container_kg)
    h1 = int(pallets_h1 or 0)
    other = int(pallets_other or 0)
    # Rodzaj wybrany z listy („siatka E1", „europaleta"…) ma WŁASNE saldo —
    # bez wyboru ląduje w koszu „palety inne".
    other_asset = pallets_other_kind if pallets_other_kind in ASSET_TYPES else "pallet_other"

    cx_execute(
        conn,
        "UPDATE raw_batches SET container_kg=%s, containers_count=%s, "
        "pallets_h1=%s, pallets_other=%s, pallets_other_kind=%s WHERE id=%s",
        (container_kg, containers, h1, other, other_asset if other else None,
         batch_row["id"]))
    batch_row.update(container_kg=container_kg, containers_count=containers,
                     pallets_h1=h1, pallets_other=other,
                     pallets_other_kind=other_asset if other else None)

    supplier_id = batch_row.get("supplier_id")
    if not supplier_id or not (containers or h1 or other):
        return containers
    partner_id = resolve_partner(conn, "supplier", supplier_id)
    book_assets(
        conn, partner_id=partner_id, source_type="raw_batch", source_id=batch_row["id"],
        targets={"e2": containers or 0, "pallet_h1": h1, other_asset: other},
        movement_date=str(batch_row.get("received_date") or date.today())[:10],
        note=f"Przyjęcie {batch_row.get('internal_batch_no') or ''}".strip())
    return containers


def _unbook_batch_containers(conn, batch_row: Dict) -> None:
    """Anulowana partia nie może wisieć na saldzie pojemników dostawcy —
    doprowadza wszystkie nośniki tego przyjęcia do zera (append-only)."""
    supplier_id = batch_row.get("supplier_id")
    if not supplier_id:
        return
    partner_id = resolve_partner(conn, "supplier", supplier_id)
    book_assets(
        conn, partner_id=partner_id, source_type="raw_batch", source_id=batch_row["id"],
        targets={}, movement_date=str(batch_row.get("received_date") or date.today())[:10],
        note="Anulowanie przyjęcia")


#: Materiał, dla którego usługa ma sens — mięso powierzone przez klienta.
SERVICE_MATERIAL_ID = "mat-mieso-zs"


def normalize_storage_state(value: Optional[str]) -> str:
    """Stan surowca: 'chlodzony' albo 'mrozony', nic innego.

    Nieznana i pusta wartość czyta się jak chłodzony — tak jechały wszystkie
    dostawy, zanim stan w ogóle powstał (30.08.2026), i tak ma się zachować
    stara wersja formularza, która stanu nie przysyła.
    """
    return "mrozony" if value == "mrozony" else "chlodzony"


#: Sekwencje numerów przyjęcia: podstawowa i usługowa (rozłączne).
_SEQ_KEY = {False: "batch_seq", True: "service_batch_seq"}
_SEQ_START = {False: 171, True: 47}
#: Numer nadawany, gdy sekwencji jeszcze nie ma w bazie. Seria usługowa
#: startuje z 48U (ustalone z zakładem); podstawowa zachowuje się jak dotąd.
_SEQ_FIRST = {False: 1, True: 48}


def next_batch_number(is_service: bool = False) -> Dict[str, Any]:
    """Podpowiedź numeru porządkowego — TEGO SAMEGO, który nada zapis.

    Najpierw pula numerów zwolnionych anulowaniem, dopiero potem licznik —
    dokładnie w tej kolejności, co `create_batch_cx`. Podpowiedź czytająca sam
    licznik po anulowaniu pokazywała numer NASTĘPNY, a zapis nadawał zwolniony:
    operator przepisywał na kartkę i na etykietę pojemnika inny numer, niż
    dostawa miała w bazie (zgłoszone 21.08.2026 — „usunąłem dwa przyjęcia,
    a system je pomija i sugeruje kolejny").

    Podgląd, nie pobranie: MIN bez DELETE. Formularz odpytuje ten endpoint po
    każdym przeładowaniu listy, więc opróżnianie puli tutaj gubiłoby numer
    bez zapisania czegokolwiek.
    """
    svc = bool(is_service)
    wolny = query_one(
        "SELECT MIN(seq) AS seq FROM numery_zwolnione WHERE seria=%s", (_SEQ_KEY[svc],))
    if wolny and wolny.get("seq"):
        next_val = int(wolny["seq"])
    else:
        row = query_one("SELECT value FROM sequences WHERE key=%s", (_SEQ_KEY[svc],))
        next_val = int(row["value"]) + 1 if row else _SEQ_FIRST[svc]
    no = format_service_reception_no(next_val) if is_service else format_reception_no(next_val)
    return {
        "nextNo": no,
        "seq": next_val,
        "suggestedBatchNo": no,
        "suggestedSeq": next_val,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }


def list_all_batches() -> List[Dict]:
    # Numer przyjęcia dołączony tym samym joinem co w `list_batches`: karta 2.1.1
    # ma rubrykę „Numer przyjęcia surowców do rozbioru", a raport HACCP czyta
    # partie właśnie z tego endpointu.
    return query_all(
        "SELECT b.*, r.reception_no "
        "FROM raw_batches b LEFT JOIN receptions r ON r.id = b.reception_id "
        "ORDER BY b.internal_batch_seq ASC"
    )


def list_batches(active_only: bool, limit: int) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 1000))
    # Numer przyjęcia dołączony do listy: bez niego ekran dostaw nie pokazuje,
    # że 470 i 471 przyjechały jednym autem pod jednym dokumentem.
    sql = (
        "SELECT b.*, s.display_name AS supplier_display_name, r.reception_no, "
        "NULLIF(r.hdi_scan, '') IS NOT NULL AS reception_has_scan "
        "FROM raw_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id "
        "LEFT JOIN receptions r ON r.id = b.reception_id"
    )
    params: list = []
    if active_only:
        sql += " WHERE b.status = 'active'"
    sql += " ORDER BY b.internal_batch_seq ASC LIMIT %s"
    params.append(limit)
    return {"data": query_all(sql, params), "total": None}


def create_batch(dto: RawBatchCreate) -> Dict:
    """Tworzy nową partię surowca (jeden numer porządkowy).

    Ścieżka pojedyncza: partia dopina się do przyjęcia z tego dnia i od tego
    dostawcy, a gdy takiego nie ma — zakłada nowe. Rejestracja CAŁEJ dostawy
    naraz (jeden numer przyjęcia → kilka numerów porządkowych) idzie przez
    `receptions_service.create_reception`.
    """
    from app.services.receptions_service import find_or_create_reception_cx

    with transaction() as conn:
        reception_id = find_or_create_reception_cx(
            conn,
            received_date=dto.received_date,
            supplier_id=dto.supplier_id,
            document_no=dto.invoice_no or "",
        )
        row = create_batch_cx(conn, dto, reception_id=reception_id)

    logger.info(
        "raw_batch.created",
        extra={
            "batch_id": row["id"],
            "internal_batch_no": row["internal_batch_no"],
            "kg_received": dto.kg_received,
            "supplier_id": dto.supplier_id,
        },
    )
    return row


def create_batch_cx(
    conn, dto: RawBatchCreate, *, reception_id: Optional[str] = None
) -> Dict:
    """Partia surowca WEWNĄTRZ istniejącej transakcji.

    Wydzielone z `create_batch`, bo jedna dostawa tworzy kilka partii i albo
    powstają wszystkie, albo żadna — inaczej po błędzie w trzeciej grupie
    zostałyby dwie osierocone partie bez dokumentu przyjęcia.

    Numer porządkowy (`internal_batch_no`) — dwie ROZŁĄCZNE serie:
      - podstawowa: goły numer, np. „344" (`batch_seq`),
      - usługowa:   numer z sufiksem U, np. „48U" (`service_batch_seq`) —
        mięso powierzone przez klienta, z którego robimy kebab na jego
        zlecenie. Towar jest cudzy, więc idzie własną numeracją, ale leży
        w tym samym magazynie i normalnie się go masuje.

    Numer podany ręcznie (np. „344" albo „48U") wygrywa i synchronizuje
    SWOJĄ sekwencję do max(dotychczasowa, podana), żeby kolejne auto-numery
    były wyższe. Brak numeru = kolejny z właściwej sekwencji.
    """
    try:
        custom_seq, no_is_service = parse_any_reception_no(dto.internal_batch_no)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    # Sufiks U we wpisanym numerze też włącza usługę — operator nie musi
    # pamiętać o przełączniku, gdy przepisuje numer z kartki.
    is_service = bool(dto.is_service or no_is_service)
    if is_service and (dto.material_type_id or "") != SERVICE_MATERIAL_ID:
        raise HTTPException(
            400, "Przyjęcie na usługę dotyczy wyłącznie mięsa z/s")

    seq_key = _SEQ_KEY[is_service]
    fmt = format_service_reception_no if is_service else format_reception_no
    custom_no = fmt(custom_seq) if custom_seq is not None else ""

    if custom_seq is not None:
        # sprawdź unikalność
        existing = cx_query_one(
            conn,
            "SELECT 1 FROM raw_batches WHERE internal_batch_no=%s",
            (custom_no,),
        )
        if existing:
            raise HTTPException(409, f"Partia {custom_no} już istnieje")
        seq = custom_seq
        internal_no = custom_no
        # zsynchronizuj sequences żeby kolejne auto-numery były wyższe
        cx_execute(
            conn,
            """
            INSERT INTO sequences (key, value) VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = GREATEST(sequences.value, EXCLUDED.value)
            """,
            (seq_key, custom_seq),
        )
    else:
        # auto-numerowanie: kolejny z właściwej sekwencji. Wartość przy
        # pierwszym użyciu bierzemy z _SEQ_FIRST, bo seed z migracji może
        # nie istnieć (świeża baza, baza testowa po TRUNCATE sequences).
        # Najpierw bierzemy numer ZWOLNIONY anulowaniem — seria ma być ciągła
        # (decyzja właściciela 20.08.2026). Rejestr, a nie szukanie dziur
        # w historii: wolno użyć tylko numeru, który MY zwolniliśmy. Dawne
        # dziury po ręcznych porządkach (416, 448-450) zostają nietknięte,
        # bo sierpniowa dostawa z numerem z lipca rozjechałaby chronologię
        # listy i FEFO, które przy równych datach rozstrzyga po numerze.
        odzyskany = cx_query_one(
            conn,
            "DELETE FROM numery_zwolnione WHERE seria=%s AND seq = ("
            "  SELECT MIN(seq) FROM numery_zwolnione WHERE seria=%s) RETURNING seq",
            (seq_key, seq_key),
        )
        if odzyskany and odzyskany.get("seq"):
            seq = int(odzyskany["seq"])
            internal_no = fmt(seq)
        else:
            row = cx_query_one(
                conn,
                """
                INSERT INTO sequences (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
                RETURNING value
                """,
                (seq_key, _SEQ_FIRST[is_service]),
            )
            seq = int(row["value"])
            internal_no = fmt(seq)

    sup = cx_query_one(
        conn, "SELECT * FROM suppliers WHERE id = %s", (dto.supplier_id,)
    )
    # Rodzaj surowca — domyślnie ćwiartka (jedyny wymagający rozbioru)
    mat = None
    if dto.material_type_id:
        mat = cx_query_one(
            conn, "SELECT * FROM raw_material_types WHERE id=%s",
            (dto.material_type_id,),
        )
    if not mat:
        mat = cx_query_one(
            conn, "SELECT * FROM raw_material_types WHERE id='mat-cwiartka'"
        )
    mat_id = mat["id"] if mat else ""
    mat_name = mat["name"] if mat else ""
    requires_deboning = bool(mat["requires_deboning"]) if mat else True

    row = cx_execute_returning(
        conn,
        """
        INSERT INTO raw_batches
        (id, internal_batch_no, internal_batch_seq, supplier_id, supplier_name,
         supplier_batch_no, slaughter_date, received_date, kg_received,
         kg_available, price_per_kg, expiry_date, status, notes,
         invoice_no, material_type_id, material_name, is_service,
         storage_state, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            cuid(),
            internal_no,
            seq,
            dto.supplier_id,
            sup["name"] if sup else "",
            dto.supplier_batch_no,
            dto.slaughter_date or None,
            dto.received_date or None,
            dto.kg_received,
            dto.kg_received,
            dto.price_per_kg,
            dto.expiry_date or None,
            dto.notes,
            dto.invoice_no or None,
            mat_id,
            mat_name,
            is_service,
            normalize_storage_state(getattr(dto, "storage_state", None)),
            now_iso(),
        ),
    )

    # Audit: każde przyjęcie surowca = IN movement (product_type="raw").
    if float(dto.kg_received or 0) > 0:
        create_stock_movement(
            conn,
            product_type="raw",
            batch_id=row["id"],
            qty=float(dto.kg_received),
            movement_type="IN",
            source_type="supplier",
            source_id=dto.supplier_id or row["id"],
        )

    # Saldo pojemników: dostawa przyjeżdża w nośnikach dostawcy.
    _book_batch_containers(
        conn, row,
        container_kg=dto.container_kg,
        containers_count=dto.containers_count,
        pallets_h1=dto.pallets_h1,
        pallets_other=dto.pallets_other,
        pallets_other_kind=dto.pallets_other_kind,
    )

    # Surowiec bez rozbioru (filet, indyk…): od razu trafia na magazyn
    # mięsa jako lot do masowania — odpowiednik "natychmiastowego rozbioru
    # 1:1". Partia przyjęcia zostaje zapisem traceability (kg_available=0,
    # stan żyje w meat_stock pod tym samym numerem partii).
    if not requires_deboning and float(dto.kg_received or 0) > 0:
        kg = float(dto.kg_received)
        cx_execute(
            conn,
            "UPDATE raw_batches SET kg_available=0 WHERE id=%s",
            (row["id"],),
        )
        row["kg_available"] = 0
        create_stock_movement(
            conn,
            product_type="raw",
            batch_id=row["id"],
            qty=kg,
            movement_type="OUT",
            source_type="reception_transfer",
            source_id=row["id"],
        )
        _create_reception_lot_cx(conn, row, {"id": mat_id, "name": mat_name}, kg)

    if reception_id:
        cx_execute(conn, "UPDATE raw_batches SET reception_id=%s WHERE id=%s",
                   (reception_id, row["id"]))
        row["reception_id"] = reception_id

    return row


def _create_reception_lot_cx(conn, batch_row: Dict, mat: Dict, kg: float) -> None:
    """Lot magazynu mięsa dla dostawy BEZ rozbioru (filet, mięso z/s).

    Wydzielone z `create_batch`, bo tę samą wstawkę robi zmiana rodzaju
    surowca przy edycji dokumentu — dwie kopie rozjechałyby się przy pierwszej
    zmianie kolumn albo źródła ruchu.

    Numer lotu = numer porządkowy dostawy: magazyn mięsa, picker WZ i plan
    masowania szukają dostawy właśnie po nim.
    """
    lot_no = batch_row["internal_batch_no"]
    cx_execute(
        conn,
        """
        INSERT INTO meat_stock
            (id, lot_no, raw_batch_id, raw_batch_no, kg_initial,
             kg_available, production_date, expiry_date, status,
             material_type_id, material_name, storage_state, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,COALESCE(%s::date, CURRENT_DATE),%s,'AVAILABLE',%s,%s,%s,%s)
        """,
        (
            cuid(), lot_no, batch_row["id"], lot_no, kg, kg,
            batch_row.get("received_date") or None,
            batch_row.get("expiry_date") or None,
            mat.get("id") or "", mat.get("name") or "",
            # Blok mrożony zostaje mrożony także w magazynie — to on decyduje,
            # czy lot leży w pom. 3 (+3 °C), czy w pom. 6 (−18 °C).
            normalize_storage_state(batch_row.get("storage_state")),
            now_iso(),
        ),
    )
    ms_row = cx_query_one(conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (lot_no,))
    create_stock_movement(
        conn,
        product_type="meat",
        batch_id=ms_row["id"] if ms_row else lot_no,
        qty=kg,
        movement_type="IN",
        source_type="reception",
        source_id=batch_row["id"],
    )


def retarget_material_cx(conn, batch_id: str, material_type_id: str) -> None:
    """Zmiana rodzaju surowca na NIETKNIĘTEJ dostawie.

    Dotąd nie było na to ścieżki i jedynym wyjściem było anulowanie dostawy
    i wpisanie jej od nowa — z nowym numerem, drugim dokumentem i skanem
    opisanym starym numerem (prod 2026-08-19: dwa dokumenty KOKO na jedną
    dostawę i anulowana przez pomyłkę SZUMERA).

    Trzy przypadki, każdy z ruchem domykającym księgę — nigdy cichy UPDATE:
      filet ↔ mięso z/s  — kilogramy zostają w locie, zmienia się rodzaj,
      filet/z-s → ćwiartka — lot znika, kilogramy wracają na dostawę,
      ćwiartka → filet/z-s — powstaje lot, dostawa schodzi do zera.
    """
    b = cx_query_one(conn, "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE", (batch_id,))
    if not b or (b.get("material_type_id") or "") == material_type_id:
        return
    mat = cx_query_one(
        conn, "SELECT id, name, requires_deboning FROM raw_material_types WHERE id=%s",
        (material_type_id,))
    if not mat:
        raise HTTPException(400, "Nieznany rodzaj surowca")
    stary = cx_query_one(
        conn, "SELECT requires_deboning FROM raw_material_types WHERE id=%s",
        (b.get("material_type_id") or "",))
    bylo_z_rozbiorem = bool(stary["requires_deboning"]) if stary else True
    ma_rozbior = bool(mat["requires_deboning"])
    kg = float(b.get("kg_received") or 0)

    cx_execute(
        conn, "UPDATE raw_batches SET material_type_id=%s, material_name=%s WHERE id=%s",
        (mat["id"], mat["name"], batch_id))

    if bylo_z_rozbiorem == ma_rozbior:
        if not ma_rozbior:      # filet ↔ mięso z/s — lot zostaje, zmienia rodzaj
            cx_execute(
                conn,
                "UPDATE meat_stock SET material_type_id=%s, material_name=%s "
                f"WHERE raw_batch_id=%s AND {_UNTOUCHED_RECEPTION_LOT}",
                (mat["id"], mat["name"], batch_id))
        return

    if ma_rozbior:              # filet/z-s → ćwiartka: lot znika, kg wracają
        _cancel_reception_lots_cx(conn, batch_id)
        create_stock_movement(
            conn, product_type="raw", batch_id=batch_id, qty=kg,
            movement_type="IN", source_type="reception_edit", source_id=batch_id)
        cx_execute(conn, "UPDATE raw_batches SET kg_available=%s WHERE id=%s", (kg, batch_id))
        return

    # ćwiartka → filet/z-s: kg schodzą z dostawy do nowego lotu
    create_stock_movement(
        conn, product_type="raw", batch_id=batch_id, qty=kg,
        movement_type="OUT", source_type="reception_edit", source_id=batch_id)
    cx_execute(conn, "UPDATE raw_batches SET kg_available=0 WHERE id=%s", (batch_id,))
    _create_reception_lot_cx(conn, b, mat, kg)


def _wymaga_rozbioru_cx(conn, batch_id: str) -> bool:
    """Czy surowiec tej partii idzie przez rozbiór (ćwiartka), czy prosto na
    magazyn mięsa (filet, mięso z/s). Brak rodzaju = ćwiartka, jak przy
    tworzeniu partii."""
    row = cx_query_one(
        conn,
        "SELECT COALESCE(t.requires_deboning, true) AS wymaga "
        "FROM raw_batches b LEFT JOIN raw_material_types t ON t.id = b.material_type_id "
        "WHERE b.id=%s",
        (batch_id,),
    )
    return bool(row["wymaga"]) if row else True


def apply_group_cx(conn, batch_id: str, *, kg: float, price_per_kg: float,
                   supplier_batch_no: str, slaughter_date: str, expiry_date: str,
                   received_date: str, document_no: str, notes: str,
                   container_kg, containers_count, pallets_h1: int,
                   pallets_other: int, pallets_other_kind) -> Dict:
    """Zapis JEDNEJ pozycji dokumentu po edycji (ćwiartka).

    Stan idzie razem z wagą: dla ćwiartki kilogramy żyją na dostawie, więc
    korekta wagi zmienia i `kg_received`, i `kg_available`. Partia ruszona tu
    nie dociera — filtruje ją strażnik w `update_reception`.
    """
    # Gdzie mieszka stan, zależy od rodzaju surowca: ćwiartka trzyma kilogramy
    # na dostawie, a filet i mięso z/s idą przy przyjęciu prosto do meat_stock
    # i na dostawie zostaje zero. Wpisanie tam wagi zrobiłoby z jednej dostawy
    # dwa stany naraz — w magazynie surowca i w magazynie mięsa.
    z_rozbiorem = _wymaga_rozbioru_cx(conn, batch_id)
    if z_rozbiorem:
        # Korekta wagi ćwiartki musi zostawić ślad w księdze. Bez ruchu stan
        # dostawy schodziłby cicho, a kartoteka partii pokazywałaby przyjęcie
        # 4800 kg przy stanie 4650 kg — liczbę bez wyjaśnienia, dokładnie jak
        # duch 415 (prod 2026-07-16). Ruch idzie PRZED zmianą stanu, bo
        # create_stock_movement waliduje żywy stan partii.
        stare = cx_query_one(
            conn, "SELECT kg_received FROM raw_batches WHERE id=%s FOR UPDATE",
            (batch_id,),
        )
        delta = round(float(kg) - float((stare or {}).get("kg_received") or 0), 3)
        if abs(delta) >= 0.001:
            create_stock_movement(
                conn, product_type="raw", batch_id=batch_id, qty=abs(delta),
                movement_type="IN" if delta > 0 else "OUT",
                source_type="reception_edit", source_id=batch_id,
            )
    row = cx_execute_returning(
        conn,
        """
        UPDATE raw_batches
        SET kg_received=%s, kg_available=%s, price_per_kg=%s, supplier_batch_no=%s,
            slaughter_date=%s, expiry_date=%s, received_date=%s, invoice_no=%s, notes=%s
        WHERE id=%s RETURNING *
        """,
        (kg, kg if z_rozbiorem else 0, price_per_kg, supplier_batch_no,
         slaughter_date or None, expiry_date or None, received_date or None,
         document_no, notes, batch_id),
    )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    if not z_rozbiorem:
        resize_reception_lot_cx(conn, batch_id, kg)
    # Nośniki księgują się RÓŻNICOWO, więc przy edycji to wywołanie jest
    # obowiązkowe — pominięte zostawia dostawcę z fantomowym saldem pojemników.
    _book_batch_containers(
        conn, row, container_kg=container_kg, containers_count=containers_count,
        pallets_h1=pallets_h1, pallets_other=pallets_other,
        pallets_other_kind=pallets_other_kind)
    return row


def batch_history(batch_id: str) -> List[Dict]:
    return query_all(
        "SELECT * FROM raw_batch_history WHERE batch_id=%s ORDER BY created_at DESC",
        (batch_id,),
    )


#: Lot magazynu mięsa, który powstał PRZY SAMYM PRZYJĘCIU (filet, mięso z/s —
#: create_batch przerzuca całość dostawy do meat_stock) i z którego nic jeszcze
#: nie zeszło. Lot z rozbioru ma deboning_session_id, więc tu nie wpada.
_UNTOUCHED_RECEPTION_LOT = (
    "deboning_session_id IS NULL"
    " AND COALESCE(kg_used,0) = 0 AND COALESCE(kg_reserved,0) = 0"
    " AND COALESCE(kg_in_process,0) = 0"
    " AND COALESCE(kg_available,0) >= COALESCE(kg_initial,0)"
)


def resize_reception_lot_cx(conn, batch_id: str, kg_new: float) -> None:
    """Dociągnij lot przyjęcia (filet / mięso z/s) do skorygowanej wagi.

    Bez tego edycja takiej dostawy rozjeżdżała dostawę z magazynem mięsa —
    dlatego dotąd była w ogóle zablokowana. Różnicę księguje ruch, żeby
    kartoteka lotu tłumaczyła, skąd wzięła się nowa liczba.
    """
    lot = cx_query_one(
        conn,
        "SELECT id, kg_initial, kg_available FROM meat_stock "
        f"WHERE raw_batch_id=%s AND {_UNTOUCHED_RECEPTION_LOT} FOR UPDATE",
        (batch_id,),
    )
    if not lot:
        return
    delta = round(float(kg_new) - float(lot["kg_available"] or 0), 3)
    if abs(delta) < 0.001:
        return
    # Ruch PRZED zmianą stanu — create_stock_movement waliduje żywy stan lotu.
    create_stock_movement(
        conn, product_type="meat", batch_id=lot["id"], qty=abs(delta),
        movement_type="IN" if delta > 0 else "OUT",
        source_type="reception_edit", source_id=batch_id,
    )
    cx_execute(
        conn, "UPDATE meat_stock SET kg_initial=%s, kg_available=%s WHERE id=%s",
        (kg_new, kg_new, lot["id"]),
    )


def _batch_used_reason_cx(conn, batch_id: str, for_cancel: bool = False) -> str | None:
    """Zwraca powód, dla którego partii NIE wolno edytować/usuwać (albo None).
    Partia „ruszona": status used/cancelled, albo są wpisy rozbioru / mięso /
    uboczne z tej partii. Chroni traceability przed edycją rozliczonej ćwiartki.

    `for_cancel=True` łagodzi JEDEN warunek: własny, nietknięty lot przyjęcia
    (filet / mięso z/s) nie liczy się jako użycie partii. Bez tego takiej
    dostawy NIE DAŁO SIĘ anulować nigdy — miała wpis w meat_stock już w
    sekundzie przyjęcia, więc dostawa wpisana pod złym rodzajem zostawała w
    systemie na zawsze (prod 2026-08-14). Edycji to nie dotyczy: `update_batch`
    nie rusza lotu i rozjechałby kilogramy między dostawą a magazynem.
    """
    st = cx_query_one(conn, "SELECT status FROM raw_batches WHERE id=%s", (batch_id,))
    if not st:
        return "not_found"
    status = (st.get("status") or "").lower()
    if status in ("used", "cancelled"):
        return f"Partia ma status {status} — operacja niedozwolona"
    for table, label in (
        ("deboning_entries", "rozbiorze"),
        ("meat_stock", "magazynie mięsa"),
        ("batch_byproducts", "ważeniu ubocznych"),
    ):
        sql = f"SELECT 1 FROM {table} WHERE raw_batch_id=%s LIMIT 1"
        if table == "meat_stock" and for_cancel:
            sql = (
                "SELECT 1 FROM meat_stock WHERE raw_batch_id=%s"
                f" AND NOT ({_UNTOUCHED_RECEPTION_LOT}) LIMIT 1"
            )
        r = cx_query_one(conn, sql, (batch_id,))
        if r:
            return f"Partia jest już użyta w {label} — operacja niedozwolona"
    return None


def _cancel_reception_lots_cx(conn, batch_id: str) -> None:
    """Zdejmij z magazynu mięsa lot(y) utworzone przy przyjęciu tej dostawy.

    Filet i mięso z/s nie mają rozbioru — całość dostawy leży w meat_stock.
    Bez tego anulowanie zerowało tylko dostawę (i tak pustą), a kilogramy
    zostawały duchem w magazynie mięsa, pickerze WZ i planie masowania.

    Ruch domykający idzie PRZED zerowaniem lotu: create_stock_movement(OUT,
    meat) waliduje żywy stan i przy kg_available=0 odrzuciłby własny ruch.
    """
    lots = query_all(
        "SELECT id, kg_available FROM meat_stock WHERE raw_batch_id=%s "
        f"AND {_UNTOUCHED_RECEPTION_LOT}",
        (batch_id,),
    )
    for lot in lots:
        kg = float(lot.get("kg_available") or 0)
        if kg > 0:
            create_stock_movement(
                conn, product_type="meat", batch_id=lot["id"], qty=kg,
                movement_type="OUT", source_type="cancellation", source_id=batch_id,
            )
        # Numer lotu WRACA DO PULI razem z numerem partii. `meat_stock.lot_no`
        # ma UNIQUE, a lot powstaje już przy przyjęciu dostawy bez rozbioru —
        # bez tego ponowne przyjęcie pod tym samym numerem wywalało się na
        # bazie („duplicate key … meat_stock_lot_no_key”), mimo że okno
        # anulowania obiecuje operatorowi zwolnienie numeru (prod 2026-08-19:
        # anulowane przez pomyłkę mięso z/s 4700 kg, biuro nie mogło wpisać go
        # z powrotem). Znacznik ANUL-<id> nigdy nie koliduje z gołym numerem,
        # a historia lotu zostaje — tak samo jak przy partii.
        cx_execute(
            conn,
            "UPDATE meat_stock SET kg_available=0, status='CANCELLED', "
            "lot_no='ANUL-' || id WHERE id=%s",
            (lot["id"],),
        )


def _cancel_batch_cx(conn, batch_id: str) -> Dict:
    """Anulowanie JEDNEJ partii wewnątrz istniejącej transakcji.

    Wydzielone z `cancel_batch`, żeby anulowanie całego dokumentu dostawy szło
    jedną transakcją — inaczej blokada na trzecim numerze zostawiłaby dwa
    pierwsze anulowane, a dokument w połowie wycofany.
    """
    reason = _batch_used_reason_cx(conn, batch_id, for_cancel=True)
    if reason == "not_found":
        raise HTTPException(404, "Partia nie znaleziona")
    if reason:
        raise HTTPException(409, reason)
    # Zerowanie stanu: anulowana dostawa nie może trzymać kg — duch 415
        # (2026-07-16) wisiał z 5010 kg na magazynie surowca i w pickerze WZ.
        #
        # Numer WRACA DO PULI (prod 2026-07-20: usunięto 423 i nie dało się
        # przyjąć pod tym numerem — „Partia 423 już istnieje"). Kolumna ma
        # UNIQUE, a numer jest w systemie kluczem ludzkim (traceability i WZ
        # szukają dostawy po nim), więc zamiast dopuszczać duplikaty
        # zwalniamy numer: wiersz zostaje do historii ze znacznikiem ANUL-<id>
        # (nigdy nie koliduje z gołym numerem), a pierwotny numer czyta się
        # z internal_batch_seq.
        # Ruch domykający księgę: bez niego anulowana partia miała w
        # stock_movements samo przyjęcie IN i kartoteka pokazywała ducha
        # (audyt 2026-07-22: ANUL-* z +5010/+7005 kg w księdze przy stanie 0).
    cur = cx_query_one(
        conn, "SELECT kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
        (batch_id,),
    )
    kg_left = float((cur or {}).get("kg_available") or 0)
    if kg_left > 0:
        create_stock_movement(
            conn, product_type="raw", batch_id=batch_id, qty=kg_left,
            movement_type="OUT", source_type="cancellation", source_id=batch_id,
        )
    # Dostawa bez rozbioru trzyma kilogramy w locie magazynu mięsa, nie tutaj.
    _cancel_reception_lots_cx(conn, batch_id)
    row = cx_execute_returning(
        conn,
        "UPDATE raw_batches SET status='cancelled', kg_available=0, "
        "internal_batch_no='ANUL-' || id WHERE id=%s RETURNING *",
        (batch_id,),
    )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    _unbook_batch_containers(conn, row)
    # Numer wraca do puli: anulowana partia nosi już „ANUL-<id>", więc numer
    # jest wolny, ale bez tego wpisu kolejne przyjęcie i tak wzięłoby następny
    # z licznika i zostawałaby dziura.
    seq_key = _SEQ_KEY[bool(row.get("is_service"))]
    cx_execute(
        conn,
        "INSERT INTO numery_zwolnione (seria, seq) VALUES (%s,%s) "
        "ON CONFLICT (seria, seq) DO NOTHING",
        (seq_key, int(row.get("internal_batch_seq") or 0)),
    )
    logger.info("raw_batch.cancelled", extra={"batch_id": batch_id})
    return row


def cancel_batch(batch_id: str) -> Dict:
    """Anuluj JEDEN numer porządkowy (przycisk „Anuluj przyjęcie" w wierszu).

    Razem z ostatnim numerem porządkowym z serii schodzi też dokument dostawy —
    w jednej transakcji, żeby awaria nie zostawiła dokumentu bez pozycji, ale
    z numerem. Import lokalny, bo `receptions_service` importuje ten moduł.
    """
    from app.services.receptions_service import zwolnij_dokument_bez_pozycji_cx
    with transaction() as conn:
        row = _cancel_batch_cx(conn, batch_id)
        zwolnij_dokument_bez_pozycji_cx(conn, row.get("reception_id"))
        return row


def cancel_reception(reception_id: str) -> Dict:
    """Anuluj CAŁY dokument dostawy — wszystkie numery porządkowe naraz.

    Wszystko albo nic: jeśli choć jeden numer jest już ruszony (rozbiór,
    masowanie, WZ), nie anulujemy niczego i mówimy, który to numer. Dostawa
    wycofana w połowie byłaby gorsza niż niewycofana — księga i saldo
    pojemników rozjechałyby się bez śladu, dlaczego.
    """
    with transaction() as conn:
        rows = query_all(
            "SELECT id, internal_batch_no FROM raw_batches "
            "WHERE reception_id=%s AND COALESCE(status,'') <> 'cancelled' "
            "ORDER BY internal_batch_seq",
            (reception_id,),
        )
        if not rows:
            raise HTTPException(404, "Przyjęcie nie ma partii do anulowania")
        cancelled = [_cancel_batch_cx(conn, r["id"]) for r in rows]
    logger.info(
        "reception.cancelled",
        extra={"reception_id": reception_id, "batches": len(cancelled)},
    )
    return {"cancelled": len(cancelled), "batches": cancelled}


def adjust_batch_stock(batch_id: str, dto: RawBatchAdjust) -> Dict:
    """Korekta stanu partii po przeliczeniu fizycznym (inwentaryzacja).

    Liczba pojemników ćwiartki nigdzie nie jest liczona — wychodzi z kg/kaliber
    (`containers_for_kg`, HMI dzieli tak samo). Gdy hala przeliczy stos i wyjdzie
    inaczej, to hala ma rację: kilogramy są wyliczone, pojemniki policzone.

    Rusza tylko `kg_available`. `kg_received` zostaje przy dostawie z faktury —
    nadwyżkę/niedobór rozlicza się z dostawcą osobno, a nie przez ciche
    przepisanie przyjęcia.
    """
    with transaction() as conn:
        row = cx_query_one(
            conn,
            "SELECT id, internal_batch_no, kg_available, container_kg "
            "FROM raw_batches WHERE id=%s FOR UPDATE", (batch_id,))
        if not row:
            raise HTTPException(404, "Partia nie znaleziona")

        if dto.containers is not None:
            container_kg = float(row.get("container_kg") or 0)
            if container_kg <= 0:
                raise HTTPException(
                    400, "Partia niekalibrowana — korektę podaj w kilogramach")
            delta = float(dto.containers) * container_kg
        else:
            delta = float(dto.kg or 0)

        if abs(delta) < 0.001:
            raise HTTPException(400, "Korekta zerowa")

        before = float(row.get("kg_available") or 0)
        after = before + delta
        if after < -0.001:
            raise HTTPException(
                400, f"Korekta {delta:+.3f} kg zeszłaby poniżej zera "
                     f"(stan {before:.3f} kg)")

        # Ruch PRZED zmianą stanu — kolejność jak w całym module, żeby rejestr
        # ruchów nigdy nie był „za" stanem partii.
        create_stock_movement(
            conn, product_type="raw", batch_id=batch_id, qty=abs(delta),
            movement_type="ADJUST", source_type="inventory", source_id=batch_id)
        cx_execute(
            conn,
            "UPDATE raw_batches SET kg_available=%s WHERE id=%s", (after, batch_id))

    logger.info("raw_batch.stock_adjusted", extra={
        "batch_id": batch_id, "batch_no": row.get("internal_batch_no"),
        "delta_kg": delta, "kg_before": before, "kg_after": after,
        "adjust_reason": dto.reason,
    })
    return {"id": batch_id, "kgAvailable": after, "deltaKg": delta,
            "reason": dto.reason}


def update_batch(batch_id: str, dto: RawBatchUpdate) -> Dict:
    with transaction() as conn:
        reason = _batch_used_reason_cx(conn, batch_id)
        if reason == "not_found":
            raise HTTPException(404, "Partia nie znaleziona")
        if reason:
            raise HTTPException(409, reason)
        kg_received = float(dto.kg_received)
        before = cx_query_one(
            conn,
            "SELECT container_kg, containers_count, pallets_h1, pallets_other "
            "FROM raw_batches WHERE id=%s", (batch_id,)) or {}
        row = cx_execute_returning(
            conn,
            """
            UPDATE raw_batches
            SET supplier_batch_no=%s, slaughter_date=%s, received_date=%s,
                kg_received=%s, kg_available=%s, price_per_kg=%s,
                expiry_date=%s, notes=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.supplier_batch_no,
                dto.slaughter_date or None,
                dto.received_date or None,
                kg_received,
                kg_received,
                float(dto.price_per_kg),
                dto.expiry_date or None,
                dto.notes,
                batch_id,
            ),
        )
        if row:
            # Pola nośników nieprzysłane (None) zachowują wartość z bazy —
            # formularz edycji partii ich nie wysyła, a „brak pola = zero"
            # kasowałby saldo dostawcy przy zwykłej korekcie ceny.
            #
            # Liczba pojemników jest wyjątkiem: gdy operator jej nie nadpisał,
            # zeruje się ją, żeby zmiana kg przeliczyła ją z kalibru na nowo
            # (inaczej stara liczba zamroziłaby się mimo innej masy).
            prev_kg = before.get("container_kg")
            container_kg = dto.container_kg if dto.container_kg is not None else (
                float(prev_kg) if prev_kg is not None else None)
            containers_count = dto.containers_count
            if containers_count is None and container_kg is None:
                containers_count = before.get("containers_count")
            _book_batch_containers(
                conn, row,
                container_kg=container_kg,
                containers_count=containers_count,
                pallets_h1=(dto.pallets_h1 if dto.pallets_h1 is not None
                            else int(before.get("pallets_h1") or 0)),
                pallets_other=(dto.pallets_other if dto.pallets_other is not None
                               else int(before.get("pallets_other") or 0)),
                pallets_other_kind=(dto.pallets_other_kind
                                    or before.get("pallets_other_kind")),
            )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    logger.info("raw_batch.updated", extra={"batch_id": batch_id})
    return row


def list_meat_stock(include_reserved: bool = False) -> Dict[str, Any]:
    # include_reserved: planer dnia masowania potrzebuje TAKŻE partii w całości
    # zarezerwowanych (kg_free=0) — edycja planu oddaje własne rezerwacje do
    # puli (front liczy pulę dnia = kg_free + rezerwacje wczytanego planu).
    cond = (
        "((m.kg_available - COALESCE(m.kg_reserved, 0)) > 0 "
        "OR COALESCE(m.kg_reserved, 0) > 0)"
        if include_reserved
        else "(m.kg_available - COALESCE(m.kg_reserved, 0)) > 0"
    )
    return {
        "data": query_all(
            f"""
            SELECT m.*,
                   (m.kg_available - COALESCE(m.kg_reserved, 0)) AS kg_free,
                   -- Ile z partii można jeszcze wydać na paletę ważenia
                   -- zbiorczego: wydajność partii minus to, co już z niej
                   -- zeszło. NIE kg_available — ono spada przy masowaniu,
                   -- a mięso zmasowane pojechało tam właśnie na palecie.
                   GREATEST(0, m.kg_initial - COALESCE(pal.kg, 0)) AS kg_bulk_free,
                   b.internal_batch_no, b.supplier_name,
                   s.display_name AS supplier_display_name,
                   -- Ubój i przyjęcie ćwiartki jadą na etykietę palety
                   -- ważenia zbiorczego (układ z 24.08.2026).
                   b.slaughter_date as batch_slaughter_date,
                   b.received_date  as batch_received_date
            FROM meat_stock m
            LEFT JOIN (
                -- Palety ZDJĘTE nie zajmują kilogramów partii: pomyłkowa
                -- paleta blokowałaby mięso, które fizycznie leży w chłodni.
                SELECT l.lot_no, SUM(l.kg) AS kg
                FROM meat_pallet_lots l
                JOIN meat_pallets p ON p.id = l.pallet_id AND p.deleted_at IS NULL
                GROUP BY l.lot_no
            ) pal ON pal.lot_no = m.lot_no
            LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
            LEFT JOIN suppliers s ON s.id = b.supplier_id
            WHERE {cond}
            ORDER BY m.expiry_date ASC, m.lot_no ASC
            """
        )
    }
