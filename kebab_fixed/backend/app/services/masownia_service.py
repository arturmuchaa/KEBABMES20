"""Panel masowania — mięso, pojemniki z przyprawami i wsady w masownicach.

Mięso dla panelu bierzemy z `meat_stock` (partia) i `meat_pallets` (fizyczna
paleta z ważenia zbiorczego). Pochodzenie partii nie ma znaczenia: mięso
z rozbioru i mięso kupione z zewnątrz (z/s, filet z mostka, indyk) leżą
w tej samej tabeli, więc zakup pokazuje się sam.
"""
import json
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute, cx_execute_returning, cx_query_one, execute, query_all, query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.masownia import (
    ChargeCreate, ChargeFinish, SpiceCartCreate, SpiceWeighDto,
)
from app.models.mixing import FinishMixingLotAlloc, FinishMixingSessionDto
from app.services import mixing_service
from app.utils.batch_numbers import combined_batch_no
from app.utils.ids import cuid, next_seq, now_iso

logger = get_logger(__name__)


def _pallets() -> List[Dict[str, Any]]:
    """Palety z ważenia zbiorczego, które JESZCZE LEŻĄ na magazynie surowca.

    Odpadają dwie grupy: zdjęte ręcznie (pomyłka zapisu) i ZUŻYTE — takie,
    których mięso zostało wymieszane i przeszło w przyprawione. Operator ma
    przed sobą to, po co może pojechać wózkiem, a nie historię ważeń.
    """
    rows = query_all(
        """
        SELECT p.id, p.pallet_no, p.kg_net, p.production_date, p.expiry_date
        FROM meat_pallets p
        WHERE p.deleted_at IS NULL AND p.consumed_at IS NULL
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


def _w_masownicach() -> Dict[str, float]:
    """Kilogramy partii, które STOJĄ w masownicach i jeszcze nie zeszły ze stanu.

    Księgowanie idzie dopiero przy odbiorze (`finish_mixing_session`), więc
    między załadunkiem a odbiorem — czyli przez 50 minut cyklu — `meat_stock`
    nadal pokazuje to mięso jako wolne. Bez tego odjęcia panel oferowałby ten
    sam surowiec drugi raz, a paleta zdjęta z ekranu wracałaby jako „luźne kg
    partii" na kafelku paleciaka.

    Wsady ODEBRANE są tu świadomie pominięte: ich kilogramy zdjął już odbiór,
    a odjęcie ich po raz drugi zaniżyłoby magazyn o cały wsad.
    """
    rows = query_all(
        """
        SELECT cp.meat_stock_id, SUM(cp.kg) AS kg
        FROM mixing_charge_pallets cp
        JOIN mixing_charges c ON c.id = cp.charge_id AND c.status = 'mixing'
        WHERE cp.meat_stock_id IS NOT NULL
        GROUP BY cp.meat_stock_id
        """
    )
    return {r["meat_stock_id"]: float(r["kg"] or 0) for r in rows}


def _rezerwacje_zlecen() -> Dict[str, Dict[str, float]]:
    """Ile kg której partii trzyma które zlecenie: meat_stock_id → {order_id: kg}.

    Panel oddaje do puli WŁASNĄ rezerwację ładowanego zlecenia. Bez tego biuro
    przypisuje partię do zlecenia, a operator jej nie widzi — partia 563 miała
    858 kg na stanie, 1200 kg rezerwacji i pokazywała zero.
    """
    rows = query_all(
        """
        SELECT l.meat_stock_id, l.order_id, SUM(l.kg_planned) AS kg
        FROM mixing_order_lots l
        JOIN mixing_orders o ON o.id = l.order_id
        WHERE o.status IN ('planned', 'confirmed', 'in_progress')
          AND l.meat_stock_id IS NOT NULL AND l.kg_planned > 0
        GROUP BY l.meat_stock_id, l.order_id
        """
    )
    out: Dict[str, Dict[str, float]] = {}
    for r in rows:
        out.setdefault(r["meat_stock_id"], {})[r["order_id"]] = float(r["kg"] or 0)
    return out


def _lots() -> List[Dict[str, Any]]:
    """Partie magazynu mięsa — niezależnie od tego, skąd przyszły.

    Partie w całości zarezerwowane ZOSTAJĄ na liście: biuro mogło zaplanować
    całą partię na jedno zlecenie (524: kg_available=0 przy kg_reserved=600),
    a panel musi ją pokazać. Co wolno wziąć, rozstrzyga bramka partii na
    ekranie, nie ten filtr.
    """
    rows = query_all(
        """
        SELECT id, lot_no, material_name, material_type_id, expiry_date, production_date,
               kg_available, COALESCE(kg_reserved, 0) AS kg_reserved
        FROM meat_stock
        WHERE COALESCE(status, 'AVAILABLE') <> 'USED'
          AND (kg_available > 0 OR COALESCE(kg_reserved, 0) > 0)
        ORDER BY expiry_date, lot_no
        """
    )
    w_maszynach = _w_masownicach()
    rezerwacje = _rezerwacje_zlecen()
    return [{
        "meat_stock_id": r["id"],
        "lot_no": r["lot_no"],
        "material_name": r["material_name"] or "",
        "material_type_id": r["material_type_id"] or "",
        "kg_free": max(0.0, round(
            float(r["kg_available"] or 0)
            - float(r["kg_reserved"] or 0)
            - w_maszynach.get(r["id"], 0.0), 3)),
        "kg_in_machine": w_maszynach.get(r["id"], 0.0),
        "reserved_by_order": rezerwacje.get(r["id"], {}),
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


# ── Pojemniki z przyprawami ────────────────────────────────────────────────
#
# Masownica chodzi 50 minut. Operator ładuje trzy maszyny i ma przestój, więc
# w tym czasie odważa przyprawy na 1-2 następne rundy do ponumerowanych
# pojemników. Numer pojemnika jest CAŁĄ tożsamością odważonych przypraw:
# papierowa etykieta na mokrym pojemniku odpada, a pomyłka dwóch pojemników
# tej samej receptury o różnym wsadzie jest po zamknięciu pokrywy niewykrywalna.


def _cart_out(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    ing = out.get("ingredients")
    out["ingredients"] = json.loads(ing) if isinstance(ing, str) else (ing or [])
    out["kg_target"] = float(out.get("kg_target") or 0)
    return out


def list_carts() -> List[Dict[str, Any]]:
    """Pojemniki, które stoją odważone i czekają na maszynę."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id AS order_recipe_id
        FROM mixing_spice_carts c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'prepared'
        ORDER BY c.cart_no
        """
    )
    return [_cart_out(r) for r in rows]


def kg_prepared_of(order_id: str) -> float:
    """Kilogramy zlecenia zajęte przez stojące pojemniki."""
    row = query_one(
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(float((row or {}).get("kg") or 0), 3)


def _kg_left_cx(conn, order_id: str) -> float:
    """Ile kg zlecenia nie jest jeszcze rozpisane.

    Plan − zrobione − to, co stoi w maszynach − to, co czeka w pojemnikach.
    """
    o = cx_query_one(
        conn, "SELECT meat_kg, kg_done FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
    )
    if not o:
        raise HTTPException(404, "Zlecenie nie znalezione")
    w_maszynach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_meat),0) AS kg FROM mixing_charges "
        "WHERE order_id=%s AND status='mixing'",
        (order_id,),
    )
    w_pojemnikach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(
        float(o["meat_kg"] or 0)
        - float(o["kg_done"] or 0)
        - float((w_maszynach or {}).get("kg") or 0)
        - float((w_pojemnikach or {}).get("kg") or 0),
        3,
    )


def create_cart(dto: SpiceCartCreate) -> Dict[str, Any]:
    """Załóż pojemnik: przyprawy odważone z wyprzedzeniem na wskazany wsad.

    Pojemnik REZERWUJE kilogramy zlecenia — bez tego operator rozpisałby dwa
    razy to samo, a maszyny stoją 50 minut i pomyłka wychodzi za późno.
    """
    with transaction() as conn:
        zajety = cx_query_one(
            conn,
            "SELECT cart_no FROM mixing_spice_carts WHERE cart_no=%s AND status='prepared'",
            (dto.cart_no,),
        )
        if zajety:
            raise HTTPException(
                409, f"Pojemnik {dto.cart_no} jest już zajęty — wsyp go albo anuluj"
            )

        zostalo = _kg_left_cx(conn, dto.order_id)
        if dto.kg_target > zostalo + 0.001:
            raise HTTPException(
                400,
                f"W zleceniu zostało {max(0.0, zostalo):.0f} kg, a pojemnik bierze "
                f"{dto.kg_target:.0f} kg",
            )
        recipe = cx_query_one(
            conn, "SELECT recipe_id FROM mixing_orders WHERE id=%s", (dto.order_id,)
        )
        skladniki = [{
            "seq": i.seq, "name": i.name, "unit": i.unit,
            "qty": i.qty, "weighed": i.weighed, "manual": i.manual,
        } for i in sorted(dto.ingredients, key=lambda x: x.seq)]
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_spice_carts
                (id, cart_no, order_id, recipe_id, kg_target, status, ingredients)
            VALUES (%s,%s,%s,%s,%s,'prepared',%s) RETURNING *
            """,
            (cuid(), dto.cart_no, dto.order_id,
             (recipe or {}).get("recipe_id") or "", dto.kg_target,
             json.dumps(skladniki, ensure_ascii=False)),
        )
    logger.info("masownia.cart.created", extra={
        "cart_no": dto.cart_no, "order": dto.order_id, "kg": dto.kg_target,
    })
    return _cart_out(row)


def weigh_ingredient(cart_id: str, dto: SpiceWeighDto) -> Dict[str, Any]:
    """Zapisz odważony składnik.

    Kolejny odczyt tej samej pozycji nadpisuje poprzedni: operator poprawia
    dosypaną szczyptę, a nie dopisuje drugiego wiersza tego samego składnika.
    """
    with transaction() as conn:
        row = cx_query_one(
            conn, "SELECT * FROM mixing_spice_carts WHERE id=%s FOR UPDATE", (cart_id,)
        )
        if not row:
            raise HTTPException(404, "Nie ma takiego pojemnika")
        ing = row.get("ingredients")
        lista = json.loads(ing) if isinstance(ing, str) else list(ing or [])
        wpis = {
            "seq": dto.seq, "name": dto.name, "unit": dto.unit,
            "qty": dto.qty, "weighed": dto.weighed, "manual": dto.manual,
        }
        lista = [x for x in lista if int(x.get("seq", -1)) != dto.seq] + [wpis]
        lista.sort(key=lambda x: int(x.get("seq", 0)))
        out = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET ingredients=%s WHERE id=%s RETURNING *",
            (json.dumps(lista, ensure_ascii=False), cart_id),
        )
    return _cart_out(out)


def cancel_cart(cart_id: str) -> Dict[str, Any]:
    """Anuluj pojemnik — zwalnia numer i oddaje kilogramy zleceniu."""
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET status='cancelled' WHERE id=%s AND status='prepared' "
            "RETURNING *",
            (cart_id,),
        )
    if not row:
        raise HTTPException(404, "Nie ma takiego pojemnika albo już go wsypano")
    return _cart_out(row)


#: Masownice hali: wsad STANDARDOWY → granica, powyżej której maszyna już nie
#: miesza równo. Panel pilnuje tego na ekranie, ale strażnik musi stać także
#: tutaj: ekran jest jednym z klientów API, a przepełnienie wychodzi dopiero
#: po 50 minutach cyklu — wtedy jest za późno.
MASOWNICE_MAX_KG = {1: 250, 2: 250, 3: 700}


# ── Wsad w masownicy ───────────────────────────────────────────────────────
#
# Wsad powstaje w chwili ZAŁADOWANIA, nie przy odbiorze: paleta musi zniknąć
# z ekranu od razu, inaczej dwa wsady wzięłyby tę samą. Księgowanie (ruchy
# magazynowe, seasoned_meat, kg_done, numer partii przyprawionej) zostaje
# w `mixing_service.finish_mixing_session` — to najgorętsza ścieżka modułu
# i nie ma powodu jej przepisywać.


def list_charges() -> List[Dict[str, Any]]:
    """Wsady stojące w masownicach."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id, o.recipe_name
        FROM mixing_charges c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'mixing'
        ORDER BY c.machine_id
        """
    )
    out = []
    for r in rows:
        row = dict(r)
        row["kg_meat"] = float(row.get("kg_meat") or 0)
        row["water_l"] = float(row.get("water_l") or 0)
        row["meat"] = query_all(
            "SELECT pallet_id, lot_no, meat_stock_id, kg FROM mixing_charge_pallets "
            "WHERE charge_id=%s",
            (r["id"],),
        )
        out.append(row)
    return out


def nastepny_pp() -> str:
    """PODGLĄD kolejnego numeru partii łączonej — BEZ zużywania licznika.

    Panel pokazuje go operatorowi, zanim ten wciśnie „Załaduj". Gdyby w tym
    czasie ktoś nadał PP gdzie indziej (biuro, seasoned_meat_service), wsad
    dostanie następny wolny — dlatego to podgląd, a numer obowiązujący wraca
    z `load_charge`.
    """
    row = query_one("SELECT value FROM sequences WHERE key='pp_seq'")
    return combined_batch_no(int(row["value"]) + 1 if row else 1)


def _batch_no_of(lot_nos: List[str]) -> str:
    """Numer partii przyprawionej NADAWANY PRZY ZAŁADUNKU.

    Jeden wsad surowca → partia nosi jego numer (511 zostaje 511). Dwa i więcej
    → wsad dostaje kolejny numer PP z licznika `pp_seq` — wspólnego dla całego
    MES — i nosi go od startu maszyny (decyzja właściciela 18.09.2026: „chcę,
    żeby system nadawał partię łączoną NA WEJŚCIU").

    Wcześniej numer powstawał dopiero przy odbiorze, więc przez 50 minut wsad
    stał w masownicy bez tożsamości: operator nie miał czego zapisać na kartce
    ani czym nazwać palety. `finish_mixing_session` bierze numer z wsadu, jeśli
    ten go ma (`if not batch_no`), więc przy odbiorze nic już się nie nadaje.

    Anulowanie wsadu numer SPALA — tak jak numer partii spalony przez anulowane
    przyjęcie. Odwracanie licznika byłoby groźniejsze niż dziura w numeracji.
    """
    rozne = sorted({l for l in lot_nos if l})
    if len(rozne) == 1:
        return rozne[0]
    if len(rozne) > 1:
        return combined_batch_no(next_seq("pp_seq"))
    return ""


def _minuty_cyklu(conn, order_id: str) -> Any:
    """Minuty masowania z receptury zlecenia — KOPIOWANE na wsad.

    Czas jest cechą receptury (YAPRAK 30 min, standard 50), ale wsad niesie
    własną kopię: receptura poprawiona w biurze w trakcie cyklu nie ma prawa
    przesunąć maszyny, która już chodzi. None = panel liczy standardowe 50.
    """
    row = cx_query_one(
        conn,
        "SELECT r.mixing_minutes FROM mixing_orders o "
        "LEFT JOIN recipes r ON r.id = o.recipe_id WHERE o.id=%s",
        (order_id,),
    )
    m = (row or {}).get("mixing_minutes")
    return int(m) if m is not None and int(m) > 0 else None


def load_charge(dto: ChargeCreate) -> Dict[str, Any]:
    """Załaduj masownicę: pojemnik z przyprawami + mięso + woda."""
    kg_meat = round(sum(float(m.kg) for m in dto.meat), 3)
    if kg_meat <= 0:
        raise HTTPException(400, "Wsad bez mięsa — wskaż palety albo partię")

    limit = MASOWNICE_MAX_KG.get(int(dto.machine_id))
    if limit is None:
        raise HTTPException(400, f"Nie ma masownicy {dto.machine_id}")
    if kg_meat > limit + 0.001:
        raise HTTPException(
            400,
            f"Masownica {dto.machine_id} nie weźmie {kg_meat:.0f} kg — "
            f"najwyżej {limit} kg. Zdejmij {kg_meat - limit:.0f} kg.",
        )

    batch_no = _batch_no_of([m.lot_no for m in dto.meat])

    with transaction() as conn:
        zajeta = cx_query_one(
            conn,
            "SELECT machine_id FROM mixing_charges WHERE machine_id=%s AND status='mixing'",
            (dto.machine_id,),
        )
        if zajeta:
            raise HTTPException(409, f"Masownica {dto.machine_id} jest zajęta")

        charge = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_charges
                (id, order_id, machine_id, cart_id, kg_meat, water_l, batch_no,
                 mix_minutes, status, started_at, spices)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'mixing',%s,%s) RETURNING *
            """,
            (cuid(), dto.order_id, dto.machine_id, dto.cart_id, kg_meat,
             dto.water_l, batch_no, _minuty_cyklu(conn, dto.order_id), now_iso(),
             json.dumps([{
                 "seq": i.seq, "name": i.name, "unit": i.unit,
                 "qty": i.qty, "weighed": i.weighed, "manual": i.manual,
             } for i in sorted(dto.spices, key=lambda x: x.seq)], ensure_ascii=False)),
        )
        for m in dto.meat:
            cx_execute(
                conn,
                "INSERT INTO mixing_charge_pallets "
                "(id, charge_id, pallet_id, lot_no, meat_stock_id, kg) VALUES (%s,%s,%s,%s,%s,%s)",
                (cuid(), charge["id"], m.pallet_id, m.lot_no, m.meat_stock_id or None, float(m.kg)),
            )
        if dto.cart_id:
            cx_execute(
                conn,
                "UPDATE mixing_spice_carts SET status='dumped', dumped_at=%s, charge_id=%s "
                "WHERE id=%s AND status='prepared'",
                (now_iso(), charge["id"], dto.cart_id),
            )
        # Zlecenie rusza i pamięta, na której maszynie stoi — stąd bierze ją
        # sesja zapisywana przy odbiorze.
        cx_execute(
            conn,
            "UPDATE mixing_orders SET status='in_progress', machine_id=%s, "
            "started_at=COALESCE(started_at,%s) WHERE id=%s AND status IN "
            "('planned','confirmed','in_progress')",
            (dto.machine_id, now_iso(), dto.order_id),
        )

    logger.info("masownia.charge.loaded", extra={
        "machine": dto.machine_id, "kg": kg_meat, "batch": batch_no,
    })
    out = dict(charge)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    out["water_l"] = float(out.get("water_l") or 0)
    return out


def cancel_charge(charge_id: str, reason: str = "") -> Dict[str, Any]:
    """Cofnij ZAŁADUNEK — operator pomylił maszynę albo zlecenie.

    Bez tej ścieżki wsad stoi w masownicy do końca świata: zajmuje maszynę,
    trzyma paletę zdjętą z ekranu i blokuje kilogramy zlecenia. Nic tu nie
    księgujemy, bo załadunek niczego nie zaksięgował — księgowanie idzie
    dopiero przy odbiorze.
    """
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_charges SET status='cancelled', finished_at=%s "
            "WHERE id=%s AND status='mixing' RETURNING *",
            (now_iso(), charge_id),
        )
        if not row:
            raise HTTPException(409, "Ten wsad nie stoi już w masownicy")
        # Pojemnik wraca na listę gotowych — przyprawy nadal stoją odważone.
        cx_execute(
            conn,
            "UPDATE mixing_spice_carts SET status='prepared', dumped_at=NULL, charge_id=NULL "
            "WHERE charge_id=%s AND status='dumped'",
            (charge_id,),
        )
    logger.info("masownia.charge.cancelled", extra={
        "machine": row.get("machine_id"), "powod": reason,
    })
    out = dict(row)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    return out


def finish_charge(charge_id: str, dto: ChargeFinish) -> Dict[str, Any]:
    """Odbiór z masownicy: kg z paleciaka → księgowanie istniejącą ścieżką.

    Wsad zamykamy PRZED księgowaniem: `UPDATE ... WHERE status='mixing'` jest
    bramką na dwa równoległe odbiory tego samego wsadu. Gdyby księgowanie szło
    pierwsze, dwa dotknięcia zdjęłyby mięso ze stanu dwa razy.
    """
    charge = query_one("SELECT * FROM mixing_charges WHERE id=%s", (charge_id,))
    if not charge:
        raise HTTPException(404, "Nie ma takiego wsadu")

    with transaction() as conn:
        zamkniety = cx_execute_returning(
            conn,
            "UPDATE mixing_charges SET status='done', finished_at=%s "
            "WHERE id=%s AND status='mixing' RETURNING *",
            (now_iso(), charge_id),
        )
    if not zamkniety:
        raise HTTPException(409, "Ten wsad jest już odebrany")

    sklad = query_all(
        "SELECT meat_stock_id, kg FROM mixing_charge_pallets WHERE charge_id=%s", (charge_id,)
    )
    try:
        mixing_service.finish_mixing_session(
            charge["order_id"],
            FinishMixingSessionDto(
                kgActual=float(charge["kg_meat"] or 0),
                batchNo=charge["batch_no"] or "",
                lotAllocations=[
                    FinishMixingLotAlloc(meatLotId=s["meat_stock_id"] or "", kg=float(s["kg"] or 0))
                    for s in sklad
                ],
            ),
        )
    except Exception:
        # Księgowanie padło — wsad wraca na maszynę, żeby operator mógł
        # spróbować jeszcze raz zamiast zostać z pustym ekranem i mięsem
        # nieodpisanym ze stanu.
        execute(
            "UPDATE mixing_charges SET status='mixing', finished_at=NULL WHERE id=%s",
            (charge_id,),
        )
        raise

    # Paleta, z której zeszło wszystko, kończy życie razem z odbiorem: mięso
    # jest już przyprawione, więc nie ma po co stać na magazynie surowca.
    # Paleta napoczęta zostaje — reszta z niej dalej czeka na wózek.
    execute(
        """
        UPDATE meat_pallets p
        SET consumed_at = %s, consumed_charge_id = %s
        WHERE p.deleted_at IS NULL AND p.consumed_at IS NULL
          AND p.id IN (SELECT cp.pallet_id FROM mixing_charge_pallets cp
                       WHERE cp.charge_id = %s AND cp.pallet_id IS NOT NULL)
          AND p.kg_net - COALESCE((
                SELECT SUM(cp2.kg) FROM mixing_charge_pallets cp2
                JOIN mixing_charges c2 ON c2.id = cp2.charge_id AND c2.status <> 'cancelled'
                WHERE cp2.pallet_id = p.id), 0) <= 0.05
        """,
        (now_iso(), charge_id, charge_id),
    )

    sesja = query_one(
        "SELECT id FROM mixing_sessions WHERE order_id=%s ORDER BY completed_at DESC LIMIT 1",
        (charge["order_id"],),
    )
    session_id = (sesja or {}).get("id") or ""
    # Odczyt z paleciaka zostaje przy wsadzie. Księgowanie liczy wyrób
    # z receptury, więc to JEDYNE miejsce, w którym zapisuje się, ile
    # naprawdę wyjechało z masownicy.
    execute(
        "UPDATE mixing_charges SET session_id=%s, kg_output=%s WHERE id=%s",
        (session_id, float(dto.kg_output), charge_id),
    )

    logger.info("masownia.charge.finished", extra={
        "machine": charge["machine_id"], "kg_output": dto.kg_output,
    })
    out = dict(zamkniety)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    out["water_l"] = float(out.get("water_l") or 0)
    out["kg_output"] = float(dto.kg_output)
    out["session_id"] = session_id
    return out
