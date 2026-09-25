"""Pakowanie na kiosku magazynu — pula „do spakowania" i routing sztuki.

Spec: docs/superpowers/specs/2026-09-21-panel-magazynu-design.md §5.

KARTONY DEFINIUJE BIURO. Na hali „otwarty karton" to jedno z dwóch:
  - paleta zamówienia (`order_pallets`, status created/packing),
  - karton magazynowy (`stock_cartons`, status open).
Dla magazyniera to JEDNO — ten sam numer z `carton_seq`, ta sama etykieta
(patrz `CartonLabel`). Różni je tylko to, czy jest numer zamówienia.

AKTYWNY KARTON TO DOMYSŁ, NIE ZAMEK (§5.3). Sztuka niesie klienta
i specyfikację, więc system zawsze wie, gdzie należy:
  - pasuje do aktywnego          → zapis tam, CISZA,
  - pasuje do innego otwartego   → zapis TAM, ekran mówi który,
  - nie pasuje do żadnego        → brak zapisu, błąd z podpowiedzią.
Za jedną wpadającą sztuką nikt nigdzie nie wraca skanem.

KLIENT jest kryterium także dla kartonu magazynowego. `scan_unit_into_carton`
sprawdza tylko specyfikację (receptura/rodzaj/tuleja/waga), bo biuro dorzuca
sztuki „na górkę" ręcznie — a dokładnie tu, przy wózku mieszanym, sztuka
jednego klienta trafiała do kartonu drugiego. Dlatego filtr klienta żyje
w routingu, przed zapisem.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.services import pallets_service, stock_cartons_service
from app.services.stock_cartons_service import pick_line_for_unit
from app.utils.ids import format_carton_no
from app.utils.unit_codes import (
    PRODUCED, _client_matches, pallet_line_key, parse_unit_qr,
)

logger = get_logger(__name__)


def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


# ── Czysta logika: gdzie ta sztuka może wejść ─────────────────────────────

def pasuje_do_kontenera(unit: Dict[str, Any], k: Dict[str, Any]) -> bool:
    """Czy sztuka wchodzi do otwartego kartonu `k` (klient + spec + wolne miejsce).

    `k` ma kształt z `otwarte_kontenery()`: kind, clientName, lines[] z polami
    recipe_id, product_type_id, packaging_name, kg_per_unit, target_qty,
    packed_qty. Palety zamówień nie pilnują tulei (pozycja zamówienia jej nie
    rozróżnia) — kartony magazynowe tak, jak `pick_line_for_unit`.
    """
    if not _client_matches(unit.get("client_name"), k.get("clientName")):
        return False
    if k.get("kind") == "stock":
        return pick_line_for_unit(unit, k.get("lines") or []) is not None
    klucz = pallet_line_key(unit.get("product_type_id"), unit.get("recipe_id"),
                            unit.get("weight_kg"))
    for ln in k.get("lines") or []:
        if pallet_line_key(ln.get("product_type_id"), ln.get("recipe_id"),
                           ln.get("kg_per_unit")) != klucz:
            continue
        if int(ln.get("packed_qty") or 0) < int(ln.get("target_qty") or 0):
            return True
    return False


def kolejnosc_kandydatow(unit: Dict[str, Any], kontenery: List[Dict[str, Any]],
                         aktywny_id: Optional[str]) -> List[Dict[str, Any]]:
    """Kartony, do których sztuka może wejść — aktywny pierwszy.

    Po aktywnym idą kartony TEGO SAMEGO klienta (imiennie, nie „na magazyn"),
    potem reszta; w grupie najstarszy numer kartonu, bo otwarty dłużej leży
    niedopakowany. Kolejność jest deterministyczna — dwa kiosk-skanery przy
    tym samym stanie wybiorą to samo miejsce.
    """
    pasujace = [k for k in kontenery if pasuje_do_kontenera(unit, k)]
    klient = (unit.get("client_name") or "").strip().lower()

    def waga(k: Dict[str, Any]):
        aktywny = 0 if aktywny_id and k.get("id") == aktywny_id else 1
        ten_klient = 0 if klient and (k.get("clientName") or "").strip().lower() == klient else 1
        return (aktywny, ten_klient, int(k.get("cartonNoInt") or 0), str(k.get("id")))

    return sorted(pasujace, key=waga)


def opis_sztuki(unit: Dict[str, Any]) -> str:
    """„YALCIN · KIRMIZI 15 kg" — to, co magazynier czyta na etykiecie sztuki."""
    klient = (unit.get("client_name") or "").strip() or "na magazyn"
    rec = (unit.get("recipe_name") or "").strip()
    kg = _kg(unit.get("weight_kg"))
    kg_txt = (f"{kg:.3f}".rstrip("0").rstrip(".")).replace(".", ",")
    return " · ".join(x for x in (klient, f"{rec} {kg_txt} kg".strip()) if x)


# ── Odczyt stanu ──────────────────────────────────────────────────────────

def _linie_palet(ids: List[str]) -> Dict[str, List[Dict]]:
    if not ids:
        return {}
    rows = query_all(
        """SELECT pi.pallet_id, l.product_type_id, l.product_type_name, l.recipe_id,
                  l.recipe_name, l.packaging_name, l.kg_per_unit,
                  SUM(pi.qty) AS target_qty
           FROM order_pallet_items pi
           JOIN client_order_lines l ON l.id = pi.order_line_id
           WHERE pi.pallet_id = ANY(%s)
           GROUP BY pi.pallet_id, l.product_type_id, l.product_type_name, l.recipe_id,
                    l.recipe_name, l.packaging_name, l.kg_per_unit""",
        (ids,),
    )
    spak = query_all(
        """SELECT pallet_id, product_type_id, recipe_id, weight_kg, COUNT(*) AS n
           FROM finished_units WHERE pallet_id = ANY(%s)
           GROUP BY pallet_id, product_type_id, recipe_id, weight_kg""",
        (ids,),
    )
    spak_by = {(r["pallet_id"], pallet_line_key(r["product_type_id"], r["recipe_id"],
                                                r["weight_kg"])): int(r["n"]) for r in spak}
    out: Dict[str, List[Dict]] = {}
    for r in rows:
        k = (r["pallet_id"], pallet_line_key(r["product_type_id"], r["recipe_id"],
                                             r["kg_per_unit"]))
        out.setdefault(r["pallet_id"], []).append({
            "product_type_id": r.get("product_type_id") or "",
            "product_type_name": r.get("product_type_name") or "",
            "recipe_id": r.get("recipe_id") or "",
            "recipe_name": r.get("recipe_name") or "",
            "packaging_name": r.get("packaging_name") or "",
            "kg_per_unit": _kg(r.get("kg_per_unit")),
            "target_qty": int(r.get("target_qty") or 0),
            # Rozpis palety bywa na pozycjach o tym samym kluczu — pierwsza
            # dostaje całe „spakowane", co wystarcza do liczenia wolnego miejsca.
            "packed_qty": spak_by.pop(k, 0),
        })
    return out


def _linia_publiczna(ln: Dict) -> Dict:
    return {
        "productTypeName": ln.get("product_type_name") or "",
        "recipeName": ln.get("recipe_name") or "",
        "packagingName": ln.get("packaging_name") or "",
        "kgPerUnit": _kg(ln.get("kg_per_unit")),
        "targetQty": int(ln.get("target_qty") or 0),
        "packedQty": int(ln.get("packed_qty") or 0),
    }


def otwarte_kontenery() -> List[Dict[str, Any]]:
    """Wszystkie otwarte kartony — palety zamówień i kartony magazynowe razem.

    Pola z podkreśleniem w `lines` służą routingowi; na zewnątrz wychodzą
    przez `publiczny()`.
    """
    palety = query_all(
        """SELECT p.id, p.order_id, p.pallet_no, p.carton_no, p.status, p.created_at,
                  o.order_no, o.client_name, o.delivery_date
           FROM order_pallets p
           JOIN client_orders o ON o.id = p.order_id
           WHERE p.status IN ('created','packing')
             AND COALESCE(o.status,'') NOT IN ('done','cancelled')""",
    )
    linie = _linie_palet([p["id"] for p in palety])
    out: List[Dict[str, Any]] = []
    for p in palety:
        ln = linie.get(p["id"], [])
        out.append({
            "kind": "order", "id": p["id"],
            "cartonNoInt": int(p.get("carton_no") or 0),
            "cartonNo": format_carton_no(p.get("carton_no")) if p.get("carton_no") else "",
            "clientName": p.get("client_name") or "",
            "orderNo": p.get("order_no") or "",
            "palletNo": int(p.get("pallet_no") or 0),
            "deliveryDate": str(p.get("delivery_date") or "")[:10],
            "openedAt": str(p.get("created_at") or "")[:10],
            "lines": ln,
            "targetQty": sum(x["target_qty"] for x in ln),
            "packedQty": sum(x["packed_qty"] for x in ln),
        })
    for c in query_all("SELECT * FROM stock_cartons WHERE status='open'"):
        ln = query_all(
            "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit",
            (c["id"],),
        )
        out.append({
            "kind": "stock", "id": c["id"],
            "cartonNoInt": int(c.get("carton_no") or 0),
            "cartonNo": format_carton_no(c.get("carton_no")) if c.get("carton_no") else "",
            "clientName": c.get("client_name") or "",
            "orderNo": c.get("linked_order_no") or "",
            "palletNo": 0,
            "deliveryDate": "",
            "openedAt": str(c.get("created_at") or "")[:10],
            "lines": ln,
            "targetQty": sum(int(x.get("target_qty") or 0) for x in ln),
            "packedQty": sum(int(x.get("packed_qty") or 0) for x in ln),
        })
    out.sort(key=lambda k: (k["cartonNoInt"], k["id"]))
    return out


def publiczny(k: Dict[str, Any]) -> Dict[str, Any]:
    return {kk: v for kk, v in k.items() if kk != "lines"} | {
        "lines": [_linia_publiczna(x) for x in k.get("lines") or []],
    }


def pula_do_spakowania() -> List[Dict[str, Any]]:
    """Sztuki wyprodukowane, których nie ma w żadnym kartonie ani na palecie.

    Pogrupowane po DNIU produkcji i specyfikacji — magazynier widzi, co
    produkcja zrobiła wczoraj i co zostało z poprzednich dni (właściciel,
    21.09.2026). Najstarsze na górze: leżą najdłużej, mają najkrótszy termin.
    Nikt tej listy nie wprowadza — wylicza się z produkcji.
    """
    rows = query_all(
        """SELECT fu.produced_date, fu.client_name, fu.product_type_id, fu.recipe_id,
                  fu.tuleja, fu.weight_kg,
                  MAX(r.name) AS recipe_name, MAX(pt.name) AS product_type_name,
                  COUNT(*) AS n
           FROM finished_units fu
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           LEFT JOIN product_types pt ON pt.id = fu.product_type_id
           WHERE fu.status = %s AND fu.carton_id IS NULL AND fu.pallet_id IS NULL
             AND fu.dispatch_id IS NULL
           GROUP BY fu.produced_date, fu.client_name, fu.product_type_id, fu.recipe_id,
                    fu.tuleja, fu.weight_kg
           ORDER BY fu.produced_date NULLS FIRST, fu.client_name, MAX(r.name), fu.weight_kg""",
        (PRODUCED,),
    )
    return [{
        "producedDate": (r.get("produced_date") or "")[:10],
        "clientName": r.get("client_name") or "",
        "recipeName": r.get("recipe_name") or "",
        "productTypeName": r.get("product_type_name") or "",
        "tuleja": r.get("tuleja") or "",
        "kgPerUnit": _kg(r.get("weight_kg")),
        "qty": int(r.get("n") or 0),
    } for r in rows]


def spakowane_do_mrozni() -> List[Dict[str, Any]]:
    """Kartony pełne, które jeszcze NIE wjechały do mroźni (spec §6: mroźnia
    to przegub między pakowaniem a załadunkiem).

    Właściciel 25.09.2026: spakowany karton ma się zrobić zielony z poleceniem
    „zeskanuj i wjedź do mroźni", a po wjeździe ZNIKNĄĆ z widoku pakowania
    i być widoczny w mroźni. Palety zamówień: status `packed` do skanu mroźni.
    Karton magazynowy: `cold_storage_at IS NULL` (patrz `wstaw_karton_do_mrozni`).
    """
    palety = query_all(
        """SELECT p.id, p.pallet_no, p.carton_no, p.created_at, o.order_no, o.client_name
           FROM order_pallets p JOIN client_orders o ON o.id = p.order_id
           WHERE p.status = 'packed'
             AND COALESCE(o.status,'') NOT IN ('done','cancelled')""",
    )
    linie = _linie_palet([p["id"] for p in palety])
    out: List[Dict[str, Any]] = []
    for p in palety:
        ln = linie.get(p["id"], [])
        out.append({
            "kind": "order", "id": p["id"],
            "cartonNoInt": int(p.get("carton_no") or 0),
            "cartonNo": format_carton_no(p.get("carton_no")) if p.get("carton_no") else "",
            "clientName": p.get("client_name") or "", "orderNo": p.get("order_no") or "",
            "palletNo": int(p.get("pallet_no") or 0), "deliveryDate": "",
            "openedAt": str(p.get("created_at") or "")[:10], "lines": ln,
            "targetQty": sum(x["target_qty"] for x in ln),
            "packedQty": sum(x["packed_qty"] for x in ln),
        })
    for c in query_all(
        """SELECT * FROM stock_cartons
           WHERE status = 'packed' AND cold_storage_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM finished_units fu
                             WHERE fu.carton_id = stock_cartons.id AND fu.status = 'shipped')"""):
        ln = query_all(
            "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit", (c["id"],))
        out.append({
            "kind": "stock", "id": c["id"],
            "cartonNoInt": int(c.get("carton_no") or 0),
            "cartonNo": format_carton_no(c.get("carton_no")) if c.get("carton_no") else "",
            "clientName": c.get("client_name") or "", "orderNo": c.get("linked_order_no") or "",
            "palletNo": 0, "deliveryDate": "",
            "openedAt": str(c.get("created_at") or "")[:10], "lines": ln,
            "targetQty": sum(int(x.get("target_qty") or 0) for x in ln),
            "packedQty": sum(int(x.get("packed_qty") or 0) for x in ln),
        })
    out.sort(key=lambda k: (k["cartonNoInt"], k["id"]))
    return out


def stan_pakowania() -> Dict[str, Any]:
    return {
        "kontenery": [publiczny(k) for k in otwarte_kontenery()],
        "spakowane": [publiczny(k) for k in spakowane_do_mrozni()],
        "pula": pula_do_spakowania(),
    }


# ── Skan ──────────────────────────────────────────────────────────────────

def _sztuka(unit_id: str) -> Optional[Dict[str, Any]]:
    return query_one(
        """SELECT fu.*, r.name AS recipe_name, pt.name AS product_type_name
           FROM finished_units fu
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           LEFT JOIN product_types pt ON pt.id = fu.product_type_id
           WHERE fu.id = %s""",
        (unit_id,),
    )


def _gdzie_lezy(unit: Dict[str, Any]) -> str:
    """Numer kartonu, w którym sztuka już jest — do komunikatu „już spakowana"."""
    if unit.get("carton_id"):
        r = query_one("SELECT carton_no FROM stock_cartons WHERE id=%s", (unit["carton_id"],))
        if r and r.get("carton_no"):
            return format_carton_no(r["carton_no"])
    if unit.get("pallet_id"):
        r = query_one("SELECT carton_no FROM order_pallets WHERE id=%s", (unit["pallet_id"],))
        if r and r.get("carton_no"):
            return format_carton_no(r["carton_no"])
    return ""


def _wynik(result: str, unit: Optional[Dict], k: Optional[Dict] = None, **extra) -> Dict:
    return {
        "result": result,
        "unit": opis_sztuki(unit) if unit else "",
        "container": publiczny(k) if k else None,
        **extra,
    }


def _zapisz(k: Dict[str, Any], code: str) -> bool:
    """Zapis przez ISTNIEJĄCE ścieżki (blokady FOR UPDATE żyją tam).
    False = w międzyczasie ktoś zajął ostatnie miejsce — próbujemy dalej."""
    if k["kind"] == "order":
        r = pallets_service.pack_unit_into_pallet(k["id"], code)
        return bool(r.get("ok"))
    try:
        stock_cartons_service.scan_unit_into_carton(k["id"], code)
        return True
    except HTTPException as e:
        if e.status_code == 409:
            return False
        raise


def skanuj_sztuke(code: str, aktywny_id: Optional[str] = None) -> Dict[str, Any]:
    """Skan sztuki na kiosku — zapis tam, gdzie należy.

    Wyniki (`result`): ACTIVE — do aktywnego (albo pierwszy wybór, gdy żaden
    nie był aktywny); OTHER — do innego otwartego; ALREADY — już w kartonie;
    NO_PLACE — żaden otwarty karton tego nie przyjmie; NOT_PRODUCED — sztuka
    nie zeszła z produkcji; INVALID — nieznany kod. Odmowy to zwykła
    odpowiedź 200, nie wyjątek: panel ma pokazać powód, a nie „błąd serwera".
    """
    unit_id = parse_unit_qr(code or "")
    unit = _sztuka(unit_id) if unit_id else None
    if not unit:
        # Hala 25.09.2026: panel magazynu dostawał „nieznany kod" na etykietach,
        # które na produkcji przechodzą. Bez surowego kodu w logu nie da się
        # zobaczyć, co skaner tego stanowiska faktycznie wystukuje.
        logger.info("magazyn.pakowanie.nieznany_kod",
                    extra={"kod_surowy": repr(code)[:120], "unit_id": unit_id or ""})
        return _wynik("INVALID", None)

    kontenery = otwarte_kontenery()
    aktywny = next((k for k in kontenery if k["id"] == aktywny_id), None) if aktywny_id else None
    aktywny_zamkniety = bool(aktywny_id) and aktywny is None

    if unit.get("carton_id") or unit.get("pallet_id"):
        ten = aktywny_id and aktywny_id in (unit.get("carton_id"), unit.get("pallet_id"))
        return _wynik("ALREADY", unit, None, where=_gdzie_lezy(unit), sameCarton=bool(ten))
    if unit.get("status") != PRODUCED:
        return _wynik("NOT_PRODUCED", unit, None, status=unit.get("status") or "")

    for k in kolejnosc_kandydatow(unit, kontenery, aktywny_id):
        if not _zapisz(k, code):
            continue
        # Stan po zapisie — licznik i ewentualne zamknięcie kartonu.
        po = next((x for x in otwarte_kontenery() if x["id"] == k["id"]), None)
        pelny = po is None
        k_wynik = po or {**k, "packedQty": int(k.get("packedQty") or 0) + 1}
        do_aktywnego = (not aktywny_id) or k["id"] == aktywny_id or aktywny_zamkniety
        logger.info("magazyn.pakowanie.skan", extra={
            "unit_id": unit_id, "container_id": k["id"], "kind": k["kind"],
            "active": aktywny_id or "", "other": not do_aktywnego})
        return _wynik("ACTIVE" if do_aktywnego else "OTHER", unit, k_wynik,
                      full=pelny, activeClosed=aktywny_zamkniety)

    logger.info("magazyn.pakowanie.brak_kartonu",
                extra={"unit_id": unit_id, "klient": unit.get("client_name") or ""})
    return _wynik("NO_PLACE", unit, None, activeClosed=aktywny_zamkniety)


def podsumowanie_kafli(dzis: Optional[date] = None) -> Dict[str, Any]:
    """Żywy stan pod kaflami ekranu startowego — jeden odczyt na cały ekran."""
    dzis = dzis or date.today()
    kont = otwarte_kontenery()
    pula = pula_do_spakowania()
    wczoraj_i_dzis = {dzis.isoformat(), date.fromordinal(dzis.toordinal() - 1).isoformat()}
    zalegle = sum(p["qty"] for p in pula if p["producedDate"] and p["producedDate"] not in wczoraj_i_dzis)
    wydanie = query_one(
        """SELECT COUNT(DISTINCT o.id) AS n,
                  COALESCE(SUM(COALESCE(l.total_kg, l.qty * l.kg_per_unit)), 0) AS kg
           FROM client_orders o
           LEFT JOIN client_order_lines l ON l.order_id = o.id
           WHERE NULLIF(o.delivery_date::text, '')::date = %s
             AND COALESCE(o.status,'') NOT IN ('done','cancelled')""",
        (dzis.isoformat(),),
    ) or {}
    wydanie_lista = query_all(
        """SELECT o.client_name, COALESCE(SUM(COALESCE(l.total_kg, l.qty * l.kg_per_unit)), 0) AS kg
           FROM client_orders o
           LEFT JOIN client_order_lines l ON l.order_id = o.id
           WHERE NULLIF(o.delivery_date::text, '')::date = %s
             AND COALESCE(o.status,'') NOT IN ('done','cancelled')
           GROUP BY o.id, o.client_name
           ORDER BY kg DESC LIMIT 4""",
        (dzis.isoformat(),),
    )
    mroz_lista = query_all(
        """SELECT o.client_name, COUNT(*) AS n
           FROM order_pallets p JOIN client_orders o ON o.id = p.order_id
           WHERE p.status = 'cold_storage'
           GROUP BY o.client_name ORDER BY n DESC, o.client_name LIMIT 4""",
    )
    # Dni puli — ten sam podział co na ekranie KARTONY, tu tylko sumy.
    dni: Dict[str, int] = {}
    for p in pula:
        dni[p["producedDate"]] = dni.get(p["producedDate"], 0) + p["qty"]
    return {
        "kartony": {
            "otwarte": len(kont),
            "sztukDoSpakowania": sum(p["qty"] for p in pula),
            "zalegle": zalegle,
            "brakujeWKartonach": sum(max(0, k["targetQty"] - k["packedQty"]) for k in kont),
            # Właściciel 25.09.2026: kafel liczy KARTONY — przygotowane przez
            # biuro i nietknięte vs zaczęte, do dokończenia.
            "doSpakowania": sum(1 for k in kont if k["packedQty"] == 0),
            "doDokonczenia": sum(1 for k in kont if 0 < k["packedQty"] < k["targetQty"]),
            "zaczete": [{"cartonNo": k["cartonNo"], "klient": k["clientName"],
                         "packedQty": k["packedQty"], "targetQty": k["targetQty"]}
                        for k in kont if 0 < k["packedQty"] < k["targetQty"]][:4],
            "dni": [{"data": d, "sztuk": n, "zalegle": bool(d) and d not in wczoraj_i_dzis}
                    for d, n in list(dni.items())[:4]],
        },
        "wydanie": {
            "zamowien": int(wydanie.get("n") or 0), "kg": float(wydanie.get("kg") or 0),
            "lista": [{"klient": r.get("client_name") or "", "kg": float(r.get("kg") or 0)}
                      for r in wydanie_lista],
        },
        "mroznia": {
            "palet": int((query_one(
                "SELECT COUNT(*) AS n FROM order_pallets WHERE status='cold_storage'") or {}).get("n") or 0)
                     + len(kartony_w_mrozni()),
            "lista": [{"klient": r.get("client_name") or "", "palet": int(r["n"])} for r in mroz_lista],
        },
    }


def wstaw_karton_do_mrozni(code: str) -> Dict[str, Any]:
    """Skan karty PEŁNEGO kartonu magazynowego = wjazd do mroźni.

    Idempotentnie: karton już w mroźni zwraca ALREADY_SCANNED, bez zmiany
    znacznika czasu (liczy się pierwszy wjazd). Niepełny karton — odmowa,
    bo w mroźni ma stać to, co czeka na załadunek, nie to, co się pakuje.
    """
    from app.services.dispatches_service import _parse_stock_carton
    cid = _parse_stock_carton(code)
    if not cid:
        return {"result": "INVALID"}
    c = query_one("SELECT * FROM stock_cartons WHERE id=%s", (cid,))
    if not c:
        return {"result": "INVALID"}
    opis = {"cartonNo": format_carton_no(c.get("carton_no")) if c.get("carton_no") else "",
            "clientName": c.get("client_name") or ""}
    if c.get("status") != "packed":
        return {"result": "NOT_FULL", **opis}
    if c.get("cold_storage_at"):
        return {"result": "ALREADY_SCANNED", **opis}
    execute("UPDATE stock_cartons SET cold_storage_at=now() WHERE id=%s AND cold_storage_at IS NULL",
            (cid,))
    logger.info("magazyn.karton.mroznia", extra={"carton_id": cid})
    return {"result": "SUCCESS", **opis}


def kartony_w_mrozni() -> List[Dict[str, Any]]:
    """Kartony magazynowe stojące w mroźni (do wyjazdu). Znikają, gdy ich
    sztuki wyjadą — tak jak w sekcji „Spakowane kebaby" biura."""
    rows = query_all(
        """SELECT sc.*,
                  (SELECT COALESCE(SUM(l.packed_qty * l.kg_per_unit), 0)
                     FROM stock_carton_lines l WHERE l.carton_id = sc.id) AS kg
           FROM stock_cartons sc
           WHERE sc.cold_storage_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM finished_units fu
                             WHERE fu.carton_id = sc.id AND fu.status = 'shipped')
           ORDER BY sc.cold_storage_at""",
    )
    return [{
        "id": r["id"],
        "cartonNo": format_carton_no(r.get("carton_no")) if r.get("carton_no") else "",
        "clientName": r.get("client_name") or "",
        "packedQty": int(r.get("packed_qty") or 0),
        "kg": float(r.get("kg") or 0),
        "coldStorageAt": str(r.get("cold_storage_at") or ""),
    } for r in rows]
