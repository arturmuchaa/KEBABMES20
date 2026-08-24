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
import json
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute, cx_execute_returning, cx_query_all, query_all, query_one, transaction,
)
from app.logging_config import get_logger
from app.models.meat_pallets import MeatPalletCreate, MeatPalletUpdate
from app.utils.ids import cuid, next_dated_no

logger = get_logger(__name__)

#: Dopuszczalna różnica sumy składu i wagi palety — zaokrąglenia po 0,1 kg.
SKLAD_TOL_KG = 0.05
#: Ten sam luz przy limicie partii — waga podaje 0,1 kg, składy się dodają.
BULK_TOL_KG = 0.05


def validate_bulk_lots(lots, pozostalo_by_lot, tol: float = BULK_TOL_KG):
    """Czy paleta mieści się w tym, co partie jeszcze mają do wydania.

    `lots` – pary (numer partii, kg); `pozostalo_by_lot` – ile z danej partii
    zostało (None albo brak klucza = partia spoza magazynu mięsa, czyli brak
    wiedzy, a nie zero kilogramów — nie blokujemy).

    Kilogramy sumujemy PO NUMERZE partii: bez tego operator obszedłby limit,
    wpisując tę samą partię w dwóch wierszach po połowie.

    Czysta funkcja — testy bez DB.
    """
    razem: Dict[str, float] = {}
    for lot_no, kg in lots:
        razem[lot_no] = razem.get(lot_no, 0.0) + float(kg)

    for lot_no, kg in razem.items():
        left = pozostalo_by_lot.get(lot_no)
        if left is None:
            continue
        if kg > float(left) + tol:
            return (
                f"Z partii {lot_no} zostało {max(0.0, float(left)):.1f} kg mięsa, "
                f"a paleta bierze {kg:.1f} kg. Resztę wskaż z kolejnej partii."
            )
    return None


def _pozostalo_by_lot(conn, lot_nos, exclude_pallet_id: str = "") -> Dict[str, Any]:
    """Ile mięsa z każdej partii można jeszcze wydać na palety.

    Limit = ile partia DAŁA na rozbiorze (`meat_stock.kg_initial`), licznik =
    suma tego, co już z niej zeszło na paletach. Świadomie NIE bierzemy
    `kg_available`: ono spada przy masowaniu, a mięso zmasowane pojechało na
    masownię właśnie na palecie — odejmowalibyśmy je drugi raz.

    Wiersze partii blokujemy na czas transakcji, żeby dwie palety zapisywane
    równolegle nie przepchnęły się obie przez ten sam limit.
    """
    nos = sorted({str(n).strip() for n in lot_nos if str(n).strip()})
    if not nos:
        return {}
    cx_query_all(
        conn, "SELECT id FROM meat_stock WHERE lot_no = ANY(%s) ORDER BY id FOR UPDATE", (nos,)
    )
    dala = cx_query_all(
        conn,
        "SELECT lot_no, SUM(kg_initial) AS kg FROM meat_stock "
        "WHERE lot_no = ANY(%s) GROUP BY lot_no",
        (nos,),
    )
    # Przy KOREKCIE poprawiana paleta musi wypaść z licznika: inaczej jej
    # własne kilogramy liczyłyby się drugi raz i zmiana 218 -> 200 wyglądałaby
    # na przekroczenie limitu partii.
    juz = cx_query_all(
        conn,
        "SELECT lot_no, SUM(kg) AS kg FROM meat_pallet_lots "
        "WHERE lot_no = ANY(%s) AND (%s = '' OR pallet_id <> %s) GROUP BY lot_no",
        (nos, exclude_pallet_id, exclude_pallet_id),
    )
    wydano = {r["lot_no"]: float(r["kg"] or 0) for r in juz}
    out = {
        r["lot_no"]: round(float(r["kg"] or 0) - wydano.get(r["lot_no"], 0.0), 3)
        for r in dala
    }

    # Partia, która ISTNIEJE jako ćwiartka, ale nie ma lotu mięsa, to nie
    # „brak wiedzy" — to partia, z której nikt jeszcze nic nie zważył, więc
    # mięsa fizycznie nie ma. 24.08.2026 paleta 100 kg zapisała się na partię
    # 505 z nietkniętą ćwiartką właśnie dlatego, że brak lotu przepuszczaliśmy.
    #
    # Numer spoza ćwiartek (mięso z zewnątrz, stare dane) ZOSTAJE brakiem
    # wiedzy i dalej nie jest blokowany — inaczej zatrzymalibyśmy legalne
    # ważenia, których system nie zna.
    brakujace = [n for n in nos if n not in out]
    if brakujace:
        znane = cx_query_all(
            conn,
            "SELECT internal_batch_no FROM raw_batches WHERE internal_batch_no = ANY(%s)",
            (brakujace,),
        )
        for r in znane:
            out[r["internal_batch_no"]] = 0.0

    return out


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
        # Strażnik partii: paleta nie może wziąć więcej mięsa, niż partia dała.
        # Bez tego z partii o wydajności 2 353 kg dało się zważyć 10 ton —
        # ważenie zbiorcze nie rusza stanu, więc nic tego nie pilnowało.
        blad = validate_bulk_lots(
            [(l.lot_no.strip(), float(l.kg)) for l in dto.lots],
            _pozostalo_by_lot(conn, [l.lot_no for l in dto.lots]),
        )
        if blad:
            raise HTTPException(400, blad)

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


def update_pallet(pallet_no: str, dto: MeatPalletUpdate, subject: str = "") -> Dict[str, Any]:
    """Korekta palety z biura: waga netto, pojemniki i skład partii.

    POWÓD ISTNIENIA: 24.08.2026 cztery palety trzeba było poprawić ręcznie
    w bazie produkcyjnej — trzy razy zła partia (ekran podpowiadał najstarszy
    lot z puli), raz brak liczby pojemników (218 kg zamiast 200, bo tara E2
    nie została odjęta). Pomyłka na dokumencie identyfikowalności nie może
    wymagać dostępu do bazy.

    Zapisujemy stan SPRZED zmiany razem z powodem — bez tego korekta jest
    nieodróżnialna od zmyślenia. Walidacje te same co przy zapisie: suma
    składu równa wadze palety i limit wydajności partii, z tą różnicą, że
    poprawiana paleta wypada z licznika własnych kilogramów.
    """
    powod = (dto.reason or "").strip()
    if not powod:
        raise HTTPException(400, "Podaj powód korekty — bez niego nie wiadomo, co się stało")

    suma = round(sum(float(l.kg) for l in dto.lots), 3)
    if abs(suma - float(dto.kg_net)) > SKLAD_TOL_KG:
        raise HTTPException(
            400,
            f"Suma składu ({suma:.1f} kg) nie zgadza się z wagą palety "
            f"({float(dto.kg_net):.1f} kg)",
        )

    with transaction() as conn:
        row = cx_query_all(
            conn, "SELECT * FROM meat_pallets WHERE pallet_no=%s FOR UPDATE", (pallet_no,)
        )
        if not row:
            raise HTTPException(404, "Nie ma takiej palety")
        pallet = dict(row[0])
        przed = cx_query_all(
            conn,
            "SELECT lot_no, kg FROM meat_pallet_lots WHERE pallet_id=%s ORDER BY seq",
            (pallet["id"],),
        )

        blad = validate_bulk_lots(
            [(l.lot_no.strip(), float(l.kg)) for l in dto.lots],
            _pozostalo_by_lot(
                conn,
                [l.lot_no for l in dto.lots] + [r["lot_no"] for r in przed],
                exclude_pallet_id=pallet["id"],
            ),
        )
        if blad:
            raise HTTPException(400, blad)

        cx_execute(
            conn,
            "INSERT INTO meat_pallet_corrections (id, pallet_id, by_subject, reason, changes) "
            "VALUES (%s,%s,%s,%s,%s::jsonb)",
            (cuid(), pallet["id"], subject, powod, json.dumps({
                "before": {
                    "kg_net":     float(pallet["kg_net"]),
                    "containers": int(pallet["containers"] or 0),
                    "lots": [{"lot_no": r["lot_no"], "kg": float(r["kg"])} for r in przed],
                },
                "after": {
                    "kg_net":     float(dto.kg_net),
                    "containers": int(dto.containers),
                    "lots": [{"lot_no": l.lot_no.strip(), "kg": float(l.kg)} for l in dto.lots],
                },
            })),
        )

        cx_execute(
            conn,
            "UPDATE meat_pallets SET kg_net=%s, containers=%s WHERE id=%s",
            (float(dto.kg_net), int(dto.containers), pallet["id"]),
        )
        cx_execute(conn, "DELETE FROM meat_pallet_lots WHERE pallet_id=%s", (pallet["id"],))
        for seq, l in enumerate(dto.lots, start=1):
            cx_execute(
                conn,
                "INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) "
                "VALUES (%s,%s,%s,%s,%s)",
                (cuid(), pallet["id"], l.lot_no.strip(), float(l.kg), seq),
            )

    logger.info("meat_pallet_corrected", extra={"pallet": pallet_no, "by": subject})
    return get_pallet(pallet_no)


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
