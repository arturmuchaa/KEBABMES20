"""Palety mięsa przyprawionego — paleta po masowaniu to partia na hali.

Spec: docs/superpowers/specs/2026-11-26-plan-produkcji-partie-design.md.
Paleta powstaje przy odbiorze z masownicy z wagą z paleciaka. Kierownik
skanuje jej QR (`SP|<id>`) przy wywozie na halę, a końcówka wraca zważona
jako nowa paleta tej samej partii.
"""
from __future__ import annotations

from typing import Any, Dict

from app.db import cx_execute_returning, cx_query_one
from app.utils.ids import cuid

QR_PREFIX = "SP|"


def qr_of(pallet_id: str) -> str:
    return QR_PREFIX + pallet_id


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
             recipe_name, kg_weighed, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'in_cold')
        RETURNING *
        """,
        (cuid(), charge.get("out_pallet_no"), charge["id"], sm.get("id"),
         charge.get("batch_no") or "", recipe_id, zlecenie.get("recipe_name") or "",
         round(float(kg_output), 3)),
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


def today_local() -> str:
    return datetime.now(ZoneInfo("Europe/Warsaw")).date().isoformat()


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


def take_pallet(code: str, worker_name: str = "") -> Dict[str, Any]:
    """Skan kierownika przy wywozie palety z chłodni na halę."""
    pallet_id = parse_code(code)
    with transaction() as conn:
        p = cx_query_one(
            conn, "SELECT * FROM seasoned_pallets WHERE id=%s", (pallet_id,)) if pallet_id else None
        if not p:
            raise HTTPException(404, "Nie znam tej palety")
        nr = p.get("pallet_no")
        if p["status"] == "closed":
            raise HTTPException(409, f"Paleta {nr} jest już zużyta")
        if p["status"] == "on_hall":
            raise HTTPException(409, f"Paleta {nr} już wyjechała na halę ({_hhmm(p.get('taken_at'))})")

        plany = cx_query_all(
            conn,
            "SELECT id, plan_no FROM production_plans "
            "WHERE status='active' AND pallet_gate AND plan_date=%s ORDER BY plan_no",
            (today_local(),),
        )
        trafione: list[Dict[str, Any]] = []
        plan_trafiony: Dict[str, Any] | None = None
        for pl in plany:
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
            raise HTTPException(
                409,
                f"Paleta {nr} (partia {p.get('batch_no')}) nie jest w planie na dziś "
                "— zmiana tylko przez biuro",
            )

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
    }


# ── Sztuka tylko z partii wywiezionej na halę ────────────────────────────

def assert_unit_batch_on_hall(conn, unit: Dict[str, Any], plan_id: str) -> None:
    """Odbija skan sztuki, której partia nie wyjechała na halę w planie `plan_id`.

    Wołać tylko dla planów z `pallet_gate`. Sztuka PM (zaplanowana z końcówek)
    wymaga wywiezienia WSZYSTKICH palet przypisanych do jej pozycji.
    """
    line_id = unit.get("plan_line_id")
    batch = unit.get("batch_no") or ""
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
    wywieziona = cx_query_one(
        conn,
        "SELECT 1 FROM seasoned_pallets WHERE batch_no=%s AND taken_plan_id=%s LIMIT 1",
        (batch, plan_id),
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
                     kg_weighed, status, parent_id, is_remainder)
                VALUES (%s,%s,%s,%s,%s,%s,%s,'in_cold',%s,true)
                RETURNING *
                """,
                (cuid(), int(nowy_nr["value"]), p.get("seasoned_meat_id"), p.get("batch_no") or "",
                 p.get("recipe_id") or "", p.get("recipe_name") or "", kg, p["id"]),
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


def assert_plan_ready_to_confirm(conn, plan_id: str) -> None:
    """Przed potwierdzeniem biura (plan z `pallet_gate`):

    * każda wywieziona paleta ma zwrot końcówki (także 0 kg),
    * po bilansie żadna partia nie zejdzie poniżej rezerwacji INNYCH planów.
    """
    from app.services.production_plans_service import _allocation_kg_per_batch

    palety = _palety_planu(conn, plan_id)
    na_hali = [p for p in palety if p["status"] == "on_hall"]
    if na_hali:
        nr = ", ".join(str(p["pallet_no"]) for p in na_hali)
        raise HTTPException(
            409, f"Paleta {nr} nie ma zwrotu końcówki — zważ ją albo wpisz 0")

    wlasne: Dict[str, float] = {}
    for ln in cx_query_all(
            conn, "SELECT batch_allocation FROM production_plan_lines WHERE plan_id=%s", (plan_id,)):
        for bid, kg in _allocation_kg_per_batch(_alokacja(ln)).items():
            wlasne[bid] = wlasne.get(bid, 0.0) + kg
    for sm_id in {p["seasoned_meat_id"] for p in palety if p.get("seasoned_meat_id")}:
        row = cx_query_one(
            conn, "SELECT batch_no, kg_reserved FROM seasoned_meat WHERE id=%s", (sm_id,)) or {}
        target = _kg_w_chlodni(conn, sm_id)
        cudze = round(float(row.get("kg_reserved") or 0) - wlasne.get(sm_id, 0.0), 3)
        if cudze > target + 0.001:
            raise HTTPException(
                409,
                f"Partia {row.get('batch_no')}: po bilansie zostaje {_fmt_kg(target)} kg, "
                f"a inne plany mają zarezerwowane {_fmt_kg(cudze)} kg — popraw tamte plany",
            )


def _kg_w_chlodni(conn, seasoned_meat_id: str) -> float:
    r = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_weighed), 0) AS kg FROM seasoned_pallets "
        "WHERE seasoned_meat_id=%s AND status='in_cold'",
        (seasoned_meat_id,),
    )
    return round(float((r or {}).get("kg") or 0), 3)


def settle_plan_balance(conn, plan_id: str, plan_no: str) -> list[Dict[str, Any]]:
    """Bilans partii planu: weszło (palety) − na wyroby − końcówki = strata.

    Stan partii ustawia się na sumę jej palet w chłodni (końcówki + palety
    nietknięte), a różnica idzie ruchem magazynowym `reconcile`.
    """
    from app.services.seasoned_meat_service import _reconcile_row

    palety = _palety_planu(conn, plan_id)
    po_partii: Dict[str, list] = {}
    for p in palety:
        po_partii.setdefault(p.get("batch_no") or "", []).append(p)

    wynik = []
    for batch, lista in po_partii.items():
        kg_in = round(sum(float(p.get("kg_weighed") or 0) for p in lista), 3)
        kg_ret = round(sum(float(p.get("kg_returned") or 0) for p in lista), 3)
        goods = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(u.weight_kg), 0) AS kg FROM finished_units u "
            "JOIN production_plan_lines l ON l.id = u.plan_line_id "
            "WHERE l.plan_id=%s AND u.batch_no=%s AND u.status <> 'planned'",
            (plan_id, batch),
        )
        kg_goods = round(float((goods or {}).get("kg") or 0), 3)
        kg_loss = round(kg_in - kg_goods - kg_ret, 3)
        cx_execute_returning(
            conn,
            """
            INSERT INTO plan_batch_balance (plan_id, batch_no, kg_in, kg_goods, kg_returned, kg_loss)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (plan_id, batch_no) DO UPDATE SET
                kg_in=EXCLUDED.kg_in, kg_goods=EXCLUDED.kg_goods,
                kg_returned=EXCLUDED.kg_returned, kg_loss=EXCLUDED.kg_loss
            RETURNING plan_id
            """,
            (plan_id, batch, kg_in, kg_goods, kg_ret, kg_loss),
        )
        for sm_id in {p["seasoned_meat_id"] for p in lista if p.get("seasoned_meat_id")}:
            row = cx_query_one(conn, "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE", (sm_id,))
            if not row:
                continue
            target = _kg_w_chlodni(conn, sm_id)
            _reconcile_row(conn, row, target, reason=f"Bilans planu {plan_no}", close=target <= 0)
        wynik.append({"batchNo": batch, "kgIn": kg_in, "kgGoods": kg_goods,
                      "kgReturned": kg_ret, "kgLoss": kg_loss})
    return wynik


def plan_balance(plan_id: str) -> list[Dict[str, Any]]:
    from app.db import query_all
    return [
        {"batchNo": r["batch_no"], "kgIn": float(r["kg_in"]), "kgGoods": float(r["kg_goods"]),
         "kgReturned": float(r["kg_returned"]), "kgLoss": float(r["kg_loss"])}
        for r in query_all(
            "SELECT * FROM plan_batch_balance WHERE plan_id=%s ORDER BY batch_no", (plan_id,))
    ]
