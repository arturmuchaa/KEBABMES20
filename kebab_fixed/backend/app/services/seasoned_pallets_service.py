"""Palety mięsa przyprawionego — paleta po masowaniu to partia na hali.

Spec: docs/superpowers/specs/2026-11-26-plan-produkcji-partie-design.md.
Paleta powstaje przy odbiorze z masownicy z wagą z paleciaka. Kierownik
skanuje jej QR (`SP|<id>`) przy wywozie na halę, a końcówka wraca zważona
jako nowa paleta tej samej partii.
"""
from __future__ import annotations

from typing import Any, Dict

from app.db import cx_execute, cx_execute_returning, cx_query_one
from app.utils.ids import cuid

QR_PREFIX = "SP|"


def qr_of(pallet_id: str) -> str:
    return QR_PREFIX + pallet_id


def kg_teoria(charge: Dict[str, Any]) -> float | None:
    """Teoretyczna waga wsadu po masowaniu: mięso + woda + przyprawy.

    Przyprawa liczy się wagą zważoną (`weighed`), a gdy jej brak — zadaną
    (`qty`); jednostki kg/l → kg, g → kg/1000, inne pomijane."""
    if charge is None:
        return None
    spices = charge.get("spices") or []
    if isinstance(spices, str):
        try:
            spices = json.loads(spices)
        except Exception:
            spices = []
    kg = float(charge.get("kg_meat") or 0) + float(charge.get("water_l") or 0)
    for sp_ in spices if isinstance(spices, list) else []:
        if not isinstance(sp_, dict):
            continue
        ile = float(sp_.get("weighed") or 0) or float(sp_.get("qty") or 0)
        unit = str(sp_.get("unit") or "kg").strip().lower()
        if unit in ("kg", "l"):
            kg += ile
        elif unit == "g":
            kg += ile / 1000.0
    return round(kg, 3) if kg > 0 else None


def create_from_charge(conn, charge: Dict[str, Any], kg_output: float) -> Dict[str, Any]:
    """Paleta z odebranego wsadu. Idempotentna po `charge_id`."""
    istniejaca = cx_query_one(
        conn, "SELECT * FROM seasoned_pallets WHERE charge_id=%s", (charge["id"],))
    if istniejaca:
        return istniejaca
    zlecenie = cx_query_one(
        conn, "SELECT recipe_id, recipe_name FROM mixing_orders WHERE id=%s",
        (charge.get("order_id"),)) or {}
    recipe_id = zlecenie.get("recipe_id") or ""
    sm = cx_query_one(
        conn,
        "SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s "
        "ORDER BY created_at DESC LIMIT 1",
        (charge.get("batch_no") or "", recipe_id),
    ) or {}
    return cx_execute_returning(
        conn,
        """
        INSERT INTO seasoned_pallets
            (id, pallet_no, charge_id, seasoned_meat_id, batch_no, recipe_id,
             recipe_name, kg_weighed, status, kg_theory, mixed_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'in_cold',%s,
                COALESCE((SELECT finished_at FROM mixing_charges WHERE id=%s), now()))
        RETURNING *
        """,
        (cuid(), charge.get("out_pallet_no"), charge["id"], sm.get("id"),
         charge.get("batch_no") or "", recipe_id, zlecenie.get("recipe_name") or "",
         round(float(kg_output), 3), kg_teoria(charge), charge["id"]),
    )


# ── Wywóz palety na halę ─────────────────────────────────────────────────

import json  # noqa: E402
import re  # noqa: E402
from datetime import datetime  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from app.db import cx_query_all, transaction  # noqa: E402

def parse_code(code: str) -> str | None:
    """Id palety z kodu `SP|<20 hex>`; None, gdy to inny kod.

    Ta sama tolerancja co dla kodu sztuki (`unit_codes.parse_unit_qr`):
    skaner potrafi wystukać `|` jako inny znak, a CapsLock odwraca litery."""
    s = re.sub(r"[\x00-\x1f\x7f]", "", code or "").strip()
    s = re.sub(r"^\][A-Za-z][0-9A-Za-z]", "", s).strip()
    m = re.match(r"^SP[^0-9A-Za-z]?([0-9a-fA-F]{20})$", s, re.IGNORECASE)
    return m.group(1).lower() if m else None


def production_day(now: datetime | None = None) -> str:
    """Dzień produkcyjny jak na tabletach (`getProductionDate`): przed 04:00
    liczy się jeszcze poprzedni dzień — zmiana po północy pracuje na
    wczorajszym planie."""
    from datetime import timedelta
    teraz = (now or datetime.now(ZoneInfo("Europe/Warsaw"))).astimezone(ZoneInfo("Europe/Warsaw"))
    if teraz.hour < 4:
        teraz = teraz - timedelta(days=1)
    return teraz.date().isoformat()


def _fmt_kg(v: Any) -> str:
    x = round(float(v or 0), 3)
    s = (f"{x:.3f}").rstrip("0").rstrip(".")
    return s.replace(".", ",")


def line_label(line: Dict[str, Any]) -> str:
    return f"{int(line.get('qty') or 0)} × {_fmt_kg(line.get('kg_per_unit'))} kg {line.get('recipe_name') or ''}".strip()


def _alokacja(line: Dict[str, Any]) -> Dict[str, Any]:
    ba = line.get("batch_allocation") or {}
    if isinstance(ba, str):
        try:
            ba = json.loads(ba)
        except Exception:
            ba = {}
    return ba if isinstance(ba, dict) else {}


def pallet_belongs_to_line(conn, pallet: Dict[str, Any], line: Dict[str, Any]) -> bool:
    """Czy paleta należy do pozycji planu.

    Jawne przypisanie (`plan_line_pallets`, zapisuje je plan w PROTRIMA)
    wygrywa. Bez niego — partia palety z planu: id partii, numer partii
    (tylko tej samej receptury: ta sama partia surowca w dwóch recepturach
    daje ten sam numer) albo klucz rozpisania `batch_allocation`.
    """
    jawne = cx_query_all(
        conn, "SELECT pallet_id FROM plan_line_pallets WHERE plan_line_id=%s", (line["id"],))
    if jawne:
        return pallet["id"] in {j["pallet_id"] for j in jawne}
    sm_id = pallet.get("seasoned_meat_id")
    if sm_id and sm_id == line.get("seasoned_batch_id"):
        return True
    ba = _alokacja(line)
    if sm_id and any(isinstance(v, dict) and v.get("batch_id") == sm_id for v in ba.values()):
        return True
    if (pallet.get("recipe_id") or "") != (line.get("recipe_id") or ""):
        return False
    numery = set(line.get("seasoned_batch_nos") or []) | set(ba.keys())
    if line.get("seasoned_batch_no"):
        numery.add(line["seasoned_batch_no"])
    return (pallet.get("batch_no") or "") in numery


def _hhmm(ts: Any) -> str:
    if not ts:
        return ""
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return ts.astimezone(ZoneInfo("Europe/Warsaw")).strftime("%H:%M")


def take_pallet(code: str, worker_name: str = "", plan_id: str | None = None) -> Dict[str, Any]:
    """Skan kierownika przy wywozie palety z chłodni na halę.

    `plan_id` — plan widoczny na tablecie; wtedy paleta musi należeć do TEGO
    planu (dwa plany na jeden dzień nie przejmują sobie palet). Bez niego —
    pierwszy pasujący plan dnia. Plan zamknięty przez tablet lub biuro nie
    przyjmuje już palet.
    """
    pallet_id = parse_code(code)
    again = False
    with transaction() as conn:
        p = cx_query_one(
            conn, "SELECT * FROM seasoned_pallets WHERE id=%s", (pallet_id,)) if pallet_id else None
        if not p:
            raise HTTPException(404, "Nie znam tej palety")
        nr = p.get("pallet_no")
        if p["status"] == "closed":
            raise HTTPException(409, f"Paleta {nr} jest już zużyta")

        sql = ("SELECT id, plan_no FROM production_plans "
               "WHERE status='active' AND pallet_gate AND plan_date=%s "
               "AND tablet_finished_at IS NULL AND office_confirmed_at IS NULL")
        args: list[Any] = [production_day()]
        if plan_id:
            sql += " AND id=%s"
            args.append(plan_id)
        plany = cx_query_all(conn, sql + " ORDER BY plan_no", tuple(args))

        if p["status"] == "on_hall":
            # Ponowny skan tej samej palety do tego samego planu (dubel
            # skanera, druga paleta fizyczna partii z jednego wpisu) — OK.
            if p.get("taken_plan_id") in {pl["id"] for pl in plany}:
                again = True
            else:
                raise HTTPException(409, f"Paleta {nr} już wyjechała na halę ({_hhmm(p.get('taken_at'))})")

        trafione: list[Dict[str, Any]] = []
        plan_trafiony: Dict[str, Any] | None = None
        for pl in plany:
            if again and pl["id"] != p.get("taken_plan_id"):
                continue
            linie = cx_query_all(
                conn,
                "SELECT * FROM production_plan_lines WHERE plan_id=%s ORDER BY position, id",
                (pl["id"],),
            )
            pasujace = [ln for ln in linie if pallet_belongs_to_line(conn, p, ln)]
            if pasujace:
                plan_trafiony, trafione = pl, pasujace
                break
        if not plan_trafiony:
            if not plany:
                raise HTTPException(
                    409,
                    f"Paleta {nr} (partia {p.get('batch_no')}): dzisiejszy plan nie ma kontroli palet "
                    "albo dzień jest już zamknięty — zapytaj biuro",
                )
            raise HTTPException(
                409,
                f"Paleta {nr} (partia {p.get('batch_no')}) nie jest w planie na dziś "
                "— zmiana tylko przez biuro",
            )

        if not again:
            zmieniona = cx_execute_returning(
                conn,
                "UPDATE seasoned_pallets SET status='on_hall', taken_at=now(), taken_by=%s, "
                "taken_plan_id=%s WHERE id=%s AND status='in_cold' RETURNING *",
                (worker_name or "", plan_trafiony["id"], p["id"]),
            )
            if not zmieniona:
                teraz = cx_query_one(conn, "SELECT taken_at FROM seasoned_pallets WHERE id=%s", (p["id"],))
                raise HTTPException(
                    409, f"Paleta {nr} już wyjechała na halę ({_hhmm((teraz or {}).get('taken_at'))})")

    return {
        "ok": True,
        "palletId": p["id"],
        "palletNo": nr,
        "batchNo": p.get("batch_no") or "",
        "recipeName": p.get("recipe_name") or "",
        "kgWeighed": float(p.get("kg_weighed") or 0),
        "planId": plan_trafiony["id"],
        "planNo": plan_trafiony.get("plan_no") or "",
        "lines": [{"lineId": ln["id"], "label": line_label(ln)} for ln in trafione],
        "again": again,
    }


def pallet_out(r: Dict[str, Any]) -> Dict[str, Any]:
    """Paleta w kształcie dla klientów (camelCase)."""
    return {
        "id": r["id"],
        "qr": qr_of(r["id"]),
        "palletNo": r.get("pallet_no"),
        "batchNo": r.get("batch_no") or "",
        "recipeId": r.get("recipe_id") or "",
        "recipeName": r.get("recipe_name") or "",
        "seasonedMeatId": r.get("seasoned_meat_id"),
        "kgWeighed": float(r.get("kg_weighed") or 0),
        "status": r.get("status"),
        "isRemainder": bool(r.get("is_remainder")),
        "parentId": r.get("parent_id"),
        "labelPrintedAt": r["label_printed_at"].isoformat() if r.get("label_printed_at") else None,
        "takenAt": r["taken_at"].isoformat() if r.get("taken_at") else None,
        "takenBy": r.get("taken_by") or "",
        "takenPlanId": r.get("taken_plan_id"),
        "returnedAt": r["returned_at"].isoformat() if r.get("returned_at") else None,
        "kgReturned": float(r["kg_returned"]) if r.get("kg_returned") is not None else None,
        "mixedAt": _iso(r.get("mixed_at") or r.get("created_at")),
        "kgTheory": float(r["kg_theory"]) if r.get("kg_theory") is not None else None,
        "expiryDate": _iso(r.get("expiry_date")),
        "materialTypeId": r.get("material_type_id") or "",
        "materialName": r.get("material_name") or "",
        "parentPalletNo": r.get("parent_pallet_no"),
        "planIds": list(r.get("plan_ids") or []),
    }


def _iso(v: Any) -> str | None:
    if v is None:
        return None
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


_LISTA_SQL = """
    SELECT sp.*, sm.expiry_date, sm.material_type_id, sm.material_name,
           par.pallet_no AS parent_pallet_no,
           COALESCE((
               SELECT array_agg(DISTINCT l.plan_id) FROM plan_line_pallets lp
               JOIN production_plan_lines l ON l.id = lp.plan_line_id
               JOIN production_plans pp ON pp.id = l.plan_id
               WHERE lp.pallet_id = sp.id AND pp.status IN ('draft', 'active')
           ), '{}') AS plan_ids
    FROM seasoned_pallets sp
    LEFT JOIN seasoned_meat sm ON sm.id = sp.seasoned_meat_id
    LEFT JOIN seasoned_pallets par ON par.id = sp.parent_id
"""


def list_pallets(status: str | None = None, plan_id: str | None = None) -> list[Dict[str, Any]]:
    """Palety dla biura i tabletów: z terminem, rodzajem mięsa i planami, w których są."""
    warunki, args = [], []
    if status:
        warunki.append("sp.status=%s"); args.append(status)
    if plan_id:
        warunki.append("sp.taken_plan_id=%s"); args.append(plan_id)
    where = ("WHERE " + " AND ".join(warunki)) if warunki else ""
    with transaction() as conn:
        rows = cx_query_all(
            conn, f"{_LISTA_SQL} {where} ORDER BY sp.created_at DESC LIMIT 500", tuple(args))
    return [pallet_out(r) for r in rows]


def mark_pallet_labels_printed(ids: list[str]) -> Dict[str, int]:
    """Biuro wydrukowało etykiety palet/końcówek z QR."""
    if not ids:
        return {"marked": 0}
    with transaction() as conn:
        rows = cx_query_all(
            conn,
            "UPDATE seasoned_pallets SET label_printed_at=now() WHERE id = ANY(%s) RETURNING id",
            (list(ids),),
        )
    return {"marked": len(rows)}


# ── Sztuka tylko z partii wywiezionej na halę ────────────────────────────

def assert_unit_batch_on_hall(conn, unit: Dict[str, Any], plan_id: str) -> None:
    """Odbija skan sztuki, której partia nie wyjechała na halę w planie `plan_id`.

    Wołać tylko dla planów z `pallet_gate`. Sztuka PM (zaplanowana z końcówek)
    wymaga wywiezienia WSZYSTKICH palet przypisanych do jej pozycji.
    """
    line_id = unit.get("plan_line_id")
    batch = unit.get("batch_no") or ""
    line = cx_query_one(
        conn, "SELECT recipe_id, batch_allocation FROM production_plan_lines WHERE id=%s", (line_id,)) or {}
    wpis = _alokacja(line).get(batch)
    czesci = (wpis or {}).get("parts") if isinstance(wpis, dict) else None
    if isinstance(czesci, dict) and czesci:
        # Sztuka z kilku partii (PM z końcówek albo kebab mix „355/356”):
        # każda partia musi mieć paletę wywiezioną do tego planu.
        brak = [
            b for b in czesci
            if not cx_query_one(
                conn,
                "SELECT 1 FROM seasoned_pallets WHERE batch_no=%s AND taken_plan_id=%s "
                "AND COALESCE(recipe_id,'') = %s LIMIT 1",
                (b, plan_id, line.get("recipe_id") or ""),
            )
        ]
        if brak:
            raise HTTPException(
                409,
                f"Partia {batch} nie wyjechała cała na halę — brakuje palety partii {', '.join(brak)}",
            )
        return
    jawne = cx_query_all(
        conn,
        "SELECT sp.pallet_no, sp.batch_no, sp.taken_plan_id FROM plan_line_pallets lp "
        "JOIN seasoned_pallets sp ON sp.id = lp.pallet_id WHERE lp.plan_line_id=%s",
        (line_id,),
    )
    if batch.startswith("PM") and jawne:
        brak = [j for j in jawne if j.get("taken_plan_id") != plan_id]
        if brak:
            raise HTTPException(
                409,
                f"Partia {batch} nie wyjechała na halę — najpierw zeskanuj końcówki: "
                + ", ".join(f"{j['batch_no']} (paleta {j['pallet_no']})" for j in brak),
            )
        return
    # Partia ORAZ receptura: ta sama partia surowca w dwóch recepturach
    # daje ten sam numer, a wywieziona paleta KIRMIZI nie wpuszcza BEYAZ.
    wywieziona = cx_query_one(
        conn,
        "SELECT 1 FROM seasoned_pallets sp JOIN production_plan_lines l ON l.id=%s "
        "WHERE sp.batch_no=%s AND sp.taken_plan_id=%s "
        "AND COALESCE(sp.recipe_id,'') = COALESCE(l.recipe_id,'') LIMIT 1",
        (line_id, batch, plan_id),
    )
    if not wywieziona:
        raise HTTPException(
            409, f"Partia {batch} nie wyjechała na halę — najpierw zeskanuj jej paletę")


# ── Zwrot końcówki ───────────────────────────────────────────────────────

def return_pallet(code_or_id: str, kg: float) -> Dict[str, Any]:
    """Koniec palety na hali: kg z wagi paletowej (0 = zużyta do zera).

    Paleta zawsze się zamyka. Końcówka > 0 kg to NOWA paleta tej samej partii
    w chłodni, z własnym numerem i kodem QR (etykietę drukuje biuro).
    """
    pallet_id = parse_code(code_or_id) or (code_or_id or "").strip().lower()
    kg = round(float(kg or 0), 3)
    if kg < 0:
        raise HTTPException(400, "Waga nie może być ujemna")
    with transaction() as conn:
        p = cx_query_one(
            conn, "SELECT * FROM seasoned_pallets WHERE id=%s FOR UPDATE", (pallet_id,))
        if not p:
            raise HTTPException(404, "Nie znam tej palety")
        nr = p.get("pallet_no")
        if p["status"] != "on_hall":
            raise HTTPException(409, f"Paleta {nr} nie jest na hali")
        wyjechalo = round(float(p.get("kg_weighed") or 0), 3)
        if kg > wyjechalo:
            raise HTTPException(
                409, f"Końcówka {_fmt_kg(kg)} kg to więcej niż wyjechało ({_fmt_kg(wyjechalo)} kg)")
        cx_execute_returning(
            conn,
            "UPDATE seasoned_pallets SET status='closed', returned_at=now(), kg_returned=%s "
            "WHERE id=%s RETURNING id",
            (kg, p["id"]),
        )
        koncowka = None
        if kg > 0:
            nowy_nr = cx_execute_returning(
                conn,
                "INSERT INTO sequences (key, value) VALUES ('seasoned_pallet_seq', 1) "
                "ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value",
            )
            koncowka = cx_execute_returning(
                conn,
                """
                INSERT INTO seasoned_pallets
                    (id, pallet_no, seasoned_meat_id, batch_no, recipe_id, recipe_name,
                     kg_weighed, status, parent_id, is_remainder, mixed_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,'in_cold',%s,true,%s)
                RETURNING *
                """,
                (cuid(), int(nowy_nr["value"]), p.get("seasoned_meat_id"), p.get("batch_no") or "",
                 p.get("recipe_id") or "", p.get("recipe_name") or "", kg, p["id"],
                 p.get("mixed_at") or p.get("created_at")),
            )
    return {
        "ok": True,
        "palletNo": nr,
        "closed": True,
        "remainder": None if not koncowka else {
            "id": koncowka["id"],
            "palletNo": koncowka["pallet_no"],
            "qr": qr_of(koncowka["id"]),
            "kg": float(koncowka["kg_weighed"]),
        },
    }


# ── Bilans partii przy potwierdzeniu planu przez biuro ───────────────────

def _palety_planu(conn, plan_id: str) -> list[Dict[str, Any]]:
    return cx_query_all(
        conn, "SELECT * FROM seasoned_pallets WHERE taken_plan_id=%s ORDER BY pallet_no", (plan_id,))


def _hala_zamknieta(conn, plan_id: str) -> None:
    na_hali = [p for p in _palety_planu(conn, plan_id) if p["status"] == "on_hall"]
    if na_hali:
        nr = ", ".join(str(p["pallet_no"]) for p in na_hali)
        raise HTTPException(
            409, f"Paleta {nr} nie ma zwrotu końcówki — zważ ją albo wpisz 0")


def assert_plan_ready_to_confirm(conn, plan_id: str, entries: list | None = None) -> None:
    """Przed potwierdzeniem biura (plan z `pallet_gate`):

    * każda wywieziona paleta ma zwrot końcówki (także 0 kg),
    * hala nie wpisała więcej sztuk, niż zeskanowano — sztuka bez skanu nie
      ma partii potwierdzonej paletą (spec §7).
    """
    _hala_zamknieta(conn, plan_id)
    wpisane: Dict[str, int] = {}
    for e in entries or []:
        lid = getattr(e, "plan_line_id", None) or (e.get("planLineId") if isinstance(e, dict) else None)
        qty = getattr(e, "qty", None) if not isinstance(e, dict) else e.get("qty")
        if lid:
            wpisane[lid] = wpisane.get(lid, 0) + int(qty or 0)
    for lid, ile in wpisane.items():
        r = cx_query_one(
            conn,
            "SELECT count(*) FILTER (WHERE u.status <> 'planned') AS n, l.qty, l.kg_per_unit, l.recipe_name "
            "FROM production_plan_lines l LEFT JOIN finished_units u ON u.plan_line_id = l.id "
            "WHERE l.id=%s GROUP BY l.id",
            (lid,),
        ) or {}
        zeskanowane = int(r.get("n") or 0)
        if ile > zeskanowane:
            raise HTTPException(
                409,
                f"Pozycja {line_label(r)}: wpisano {ile} szt., zeskanowano {zeskanowane} "
                "— zeskanuj brakujące sztuki albo popraw wpis hali",
            )


def _kg_wyrobow_wg_partii(conn, plan_id: str) -> Dict[tuple, float]:
    """Kg wyrobów planu na (partia, receptura). Sztuka z kilku partii (PM,
    kebab mix) dzieli swoją wagę na partie według kg części w alokacji."""
    rows = cx_query_all(
        conn,
        "SELECT u.batch_no, u.weight_kg, COALESCE(l.recipe_id,'') AS recipe_id, l.id AS line_id, "
        "l.batch_allocation FROM finished_units u JOIN production_plan_lines l ON l.id = u.plan_line_id "
        "WHERE l.plan_id=%s AND u.status <> 'planned'",
        (plan_id,),
    )
    out: Dict[tuple, float] = {}
    for u in rows:
        waga = float(u.get("weight_kg") or 0)
        wpis = _alokacja(u).get(u.get("batch_no") or "")
        czesci = wpis.get("parts") if isinstance(wpis, dict) else None
        razem = sum(float((c or {}).get("kg") or 0) for c in (czesci or {}).values())
        if isinstance(czesci, dict) and razem > 0:
            for b, c in czesci.items():
                klucz = (b, u["recipe_id"])
                out[klucz] = out.get(klucz, 0.0) + waga * float((c or {}).get("kg") or 0) / razem
        else:
            klucz = (u.get("batch_no") or "", u["recipe_id"])
            out[klucz] = out.get(klucz, 0.0) + waga
    return out


def settle_plan_balance(conn, plan_id: str, plan_no: str) -> list[Dict[str, Any]]:
    """Bilans partii planu: weszło (palety) − na wyroby − końcówki = strata.

    Korekta stanu jest WZGLĘDNA i dotyczy tylko palet tego planu: finish_day
    zdjął z partii zużycie teoretyczne (ruchy OUT źródła `plan`), a palety
    mówią, ile zeszło naprawdę (zważone − końcówki). Różnica idzie ruchem
    `reconcile`. Zużycie innych planów i palety w chłodni lub na hali w innym
    planie zostają nietknięte.
    """
    from app.services.seasoned_meat_service import _reconcile_row

    _hala_zamknieta(conn, plan_id)
    palety = _palety_planu(conn, plan_id)
    grupy: Dict[tuple, list] = {}
    for p in palety:
        grupy.setdefault(
            (p.get("seasoned_meat_id") or "", p.get("batch_no") or "", p.get("recipe_id") or ""), []
        ).append(p)

    wyroby = _kg_wyrobow_wg_partii(conn, plan_id)
    wynik = []
    for (sm_id, batch, recipe_id), lista in grupy.items():
        kg_in = round(sum(float(p.get("kg_weighed") or 0) for p in lista), 3)
        kg_ret = round(sum(float(p.get("kg_returned") or 0) for p in lista), 3)
        kg_goods = round(wyroby.get((batch, recipe_id), 0.0), 3)
        kg_loss = round(kg_in - kg_goods - kg_ret, 3)
        cx_execute_returning(
            conn,
            """
            INSERT INTO plan_batch_balance
                (plan_id, batch_no, recipe_id, kg_in, kg_goods, kg_returned, kg_loss)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (plan_id, batch_no, recipe_id) DO UPDATE SET
                kg_in=EXCLUDED.kg_in, kg_goods=EXCLUDED.kg_goods,
                kg_returned=EXCLUDED.kg_returned, kg_loss=EXCLUDED.kg_loss
            RETURNING plan_id
            """,
            (plan_id, batch, recipe_id, kg_in, kg_goods, kg_ret, kg_loss),
        )
        row = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE", (sm_id,)) if sm_id else None
        if row:
            ksiegowane = cx_query_one(
                conn,
                "SELECT COALESCE(-SUM(qty), 0) AS kg FROM stock_movements "
                "WHERE batch_id=%s AND source_type='plan' AND source_id=%s AND movement_type='OUT'",
                (sm_id, plan_id),
            )
            zdjete = round(float((ksiegowane or {}).get("kg") or 0), 3)
            naprawde = round(kg_in - kg_ret, 3)
            target = round(float(row.get("kg_available") or 0) + zdjete - naprawde, 3)
            if target < 0:
                target = 0.0
            reserved = round(float(row.get("kg_reserved") or 0), 3)
            if target + 0.001 < reserved:
                raise HTTPException(
                    409,
                    f"Partia {batch}: po bilansie zostaje {_fmt_kg(target)} kg, a inne plany mają "
                    f"zarezerwowane {_fmt_kg(reserved)} kg — popraw tamte plany i powtórz bilans",
                )
            otwarte = cx_query_one(
                conn,
                "SELECT 1 FROM seasoned_pallets WHERE seasoned_meat_id=%s "
                "AND status IN ('in_cold','on_hall') LIMIT 1",
                (sm_id,),
            )
            zamknij = target <= 0.001 and not otwarte
            if (row.get("status") or "") != "closed":
                _reconcile_row(conn, row, target, reason=f"Bilans planu {plan_no}", close=zamknij)
        wynik.append({"batchNo": batch, "recipeId": recipe_id, "kgIn": kg_in, "kgGoods": kg_goods,
                      "kgReturned": kg_ret, "kgLoss": kg_loss})
    return wynik


def plan_balance(plan_id: str) -> list[Dict[str, Any]]:
    from app.db import query_all
    return [
        {"batchNo": r["batch_no"], "recipeId": r.get("recipe_id") or "",
         "kgIn": float(r["kg_in"]), "kgGoods": float(r["kg_goods"]),
         "kgReturned": float(r["kg_returned"]), "kgLoss": float(r["kg_loss"])}
        for r in query_all(
            "SELECT * FROM plan_batch_balance WHERE plan_id=%s ORDER BY batch_no, recipe_id", (plan_id,))
    ]


# ── Palety przy pozycjach planu (PROTRIMA, plan B) ───────────────────────

def resolve_line_pallets(conn, line, plan_id: str | None = None) -> list[Dict[str, Any]]:
    """Palety pozycji planu (`line.pallet_ids`) w kolejności wyboru, zablokowane.

    Sprawdza, że każda leży w chłodni i ma recepturę pozycji. Ustawia
    `line.seasoned_batch_ids` na partie palet (bez powtórzeń, w kolejności),
    żeby alokacja planu brała mięso dokładnie z tych palet.
    """
    wynik: list[Dict[str, Any]] = []
    for pid in line.pallet_ids:
        p = cx_query_one(
            conn,
            "SELECT sp.*, sm.material_type_id FROM seasoned_pallets sp "
            "LEFT JOIN seasoned_meat sm ON sm.id = sp.seasoned_meat_id "
            "WHERE sp.id=%s FOR UPDATE OF sp",
            (pid,),
        )
        if not p:
            raise HTTPException(404, "Nie znam palety wybranej w planie — odśwież listę palet")
        nr = p.get("pallet_no")
        if p["status"] == "closed":
            raise HTTPException(409, f"Paleta {nr} jest już zużyta — odśwież listę palet")
        # Edycja planu w trakcie dnia: paleta wywieziona do TEGO planu zostaje.
        if p["status"] == "on_hall" and not (plan_id and p.get("taken_plan_id") == plan_id):
            raise HTTPException(
                409, f"Paleta {nr} już wyjechała na halę ({_hhmm(p.get('taken_at'))}) — odśwież listę palet")
        if (p.get("recipe_id") or "") != (line.recipe_id or ""):
            raise HTTPException(
                400,
                f"Paleta {nr} (partia {p.get('batch_no')}) to {p.get('recipe_name') or 'inna receptura'}, "
                f"a pozycja to {line.recipe_name or line.recipe_id}",
            )
        wynik.append(p)
    ids: list[str] = []
    for p in wynik:
        sm = p.get("seasoned_meat_id")
        if sm and sm not in ids:
            ids.append(sm)
    if wynik:
        line.seasoned_batch_ids = ids
        line.seasoned_batch_id = ids[0] if ids else ""
    return wynik


def write_line_pallets(conn, plan_line_id: str, pallet_ids: list[str]) -> None:
    cx_execute(conn, "DELETE FROM plan_line_pallets WHERE plan_line_id=%s", (plan_line_id,))
    for pos, pid in enumerate(dict.fromkeys(pallet_ids), start=1):
        cx_execute(
            conn,
            "INSERT INTO plan_line_pallets (plan_line_id, pallet_id, position) VALUES (%s,%s,%s)",
            (plan_line_id, pid, pos),
        )


def line_pallets(conn, plan_line_ids: list[str]) -> Dict[str, list[Dict[str, Any]]]:
    """Palety pozycji (w kolejności zapisu) dla odczytu planu."""
    if not plan_line_ids:
        return {}
    rows = cx_query_all(
        conn,
        "SELECT lp.plan_line_id, sp.* FROM plan_line_pallets lp "
        "JOIN seasoned_pallets sp ON sp.id = lp.pallet_id "
        "WHERE lp.plan_line_id = ANY(%s) ORDER BY lp.plan_line_id, lp.position, sp.pallet_no",
        (plan_line_ids,),
    )
    out: Dict[str, list[Dict[str, Any]]] = {}
    for r in rows:
        lista = out.setdefault(r["plan_line_id"], [])
        lista.append({**pallet_out(r), "position": len(lista) + 1})
    return out
