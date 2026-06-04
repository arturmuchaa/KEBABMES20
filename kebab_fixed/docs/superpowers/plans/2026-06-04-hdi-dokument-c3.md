# HDI C-3 — Dokument wstępny dwujęzyczny — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biuro generuje z zamówienia klienta wstępny dokument HDI (dwujęzyczny PL + język klienta, numer NN/MM/RR) z wyprodukowanych sztuk; podgląd/druk A4.

**Architecture:** Tabela `hdi_documents` (snapshot). Backend: czyste funkcje grupowania pozycji + numeracji (pytest), serwis `hdi_service` budujący dokument z `finished_units` zamówienia + klienta + ustawień firmy, słownik tłumaczeń `hdi_i18n`. Endpoint generuj/pobierz. Front: strona druku HTML A4 + akcja „HDI" w zamówieniach.

**Tech Stack:** Backend FastAPI + psycopg, pytest. Frontend React+TS (Vite, druk HTML jak OrderPrintPage).

**Spec:** `docs/superpowers/specs/2026-06-04-hdi-dokument-c3-design.md`

---

## File Structure
- `backend/app/migrations.py` — modyfikacja: tabela `hdi_documents`.
- `backend/app/services/hdi_service.py` — nowy: czyste (`_product_label`, `group_hdi_items`, `format_hdi_number`) + DB (`build_hdi`, `generate_hdi`, `get_hdi`, `list_hdi`).
- `backend/app/services/hdi_i18n.py` — nowy: słownik etykiet + `complaints_text`.
- `backend/app/routes/hdi.py` — nowy: trasy `/api/hdi`.
- `backend/app/main.py` — modyfikacja: rejestracja.
- `backend/tests/test_hdi.py` — nowy: testy czystych funkcji.
- `src/lib/api.ts` — modyfikacja: `hdiApi` + typy.
- `src/pages/office/HdiPrintPage.tsx` — nowy: druk A4 dwujęzyczny.
- `src/App.tsx` — modyfikacja: trasa `/office/hdi/:id/druk`.
- `src/pages/office/ClientOrdersPage.tsx` — modyfikacja: akcja „HDI".

---

## Task 1: Migracja `hdi_documents`

**Files:** Modify `backend/app/migrations.py`

- [ ] **Step 1:** Po wpisach HDI fundament (po `clients ADD COLUMN ... dest_city`) dopisz:
```python
    """CREATE TABLE IF NOT EXISTS hdi_documents (
        id           TEXT PRIMARY KEY,
        number       TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        year_month   TEXT NOT NULL,
        order_id     TEXT,
        client_name  TEXT DEFAULT '',
        language     TEXT DEFAULT 'pl',
        status       TEXT NOT NULL DEFAULT 'wstepny',
        incomplete   BOOLEAN NOT NULL DEFAULT false,
        header       JSONB NOT NULL DEFAULT '{}',
        items        JSONB NOT NULL DEFAULT '[]',
        totals       JSONB NOT NULL DEFAULT '{}',
        issue_date   TEXT DEFAULT '',
        created_at   TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_hdi_status ON hdi_documents(status)",
    "CREATE INDEX IF NOT EXISTS idx_hdi_order ON hdi_documents(order_id)",
```
- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.migrations"` → brak błędu.
- [ ] **Step 3:** `cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/migrations.py && git commit -m "feat(hdi): tabela hdi_documents"`

---

## Task 2: Backend — czyste funkcje (TDD)

**Files:** Create `backend/app/services/hdi_service.py`, `backend/tests/test_hdi.py`

- [ ] **Step 1: Testy**

`backend/tests/test_hdi.py`:
```python
from app.services.hdi_service import _product_label, group_hdi_items, format_hdi_number


def test_product_label():
    assert _product_label("KEBAB", 40.0) == "KEBAB 40KG"
    assert _product_label("KEBAB UDO", 30) == "KEBAB UDO 30KG"


def test_format_hdi_number():
    assert format_hdi_number(15, "2605") == "15/05/26"  # year_month RRMM


def _u(pt="KEBAB", w=40, batch="326", pd="2026-05-29", shelf=365):
    return {"product_type_name": pt, "weight_kg": w, "batch_no": batch,
            "produced_date": pd, "shelf_life_days": shelf}


def test_group_two_products():
    items = group_hdi_items([_u(pt="KEBAB", w=40), _u(pt="KEBAB", w=30)])
    names = {i["name"] for i in items}
    assert names == {"KEBAB 40KG", "KEBAB 30KG"}
    assert all(i["qty"] == 1 for i in items)


def test_group_sums_and_batches():
    items = group_hdi_items([
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="332", pd="2026-05-30"),
    ])
    assert len(items) == 1
    it = items[0]
    assert it["name"] == "KEBAB 40KG" and it["qty"] == 3 and it["kg"] == 120.0
    # dwie partie (326 z 29.05, 332 z 30.05)
    assert len(it["batches"]) == 2
    b = {x["partia"]: x for x in it["batches"]}
    assert "290526 326" in b and b["290526 326"]["qty"] == 2
    assert b["290526 326"]["termin"] == "29.05.2027"  # +365 dni


def test_group_empty():
    assert group_hdi_items([]) == []
```

- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_hdi.py -v` → ImportError (FAIL).

- [ ] **Step 3: Implementacja**

`backend/app/services/hdi_service.py`:
```python
"""HDI — generowanie dokumentu wstępnego z zamówienia."""
import json
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.batch_numbers import kebab_batch_no
from app.utils.unit_codes import best_before
from app.utils.hdi_lang import lang_from_nip
from app.services.settings_service import get_company

logger = get_logger(__name__)


def _product_label(product_type_name: str, weight_kg) -> str:
    return f"{(product_type_name or '').strip()} {int(round(float(weight_kg or 0)))}KG".strip()


def _fmt_date(iso) -> str:
    s = (iso or "")[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return ""
    return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"


def format_hdi_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2605"); numer = NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"{seq}/{mm}/{yy}"


def group_hdi_items(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Grupuj sztuki po (produkt, waga) → pozycje HDI z partiami."""
    by_prod: Dict[tuple, Dict[str, Any]] = {}
    for u in units:
        w = round(float(u.get("weight_kg") or 0), 3)
        key = ((u.get("product_type_name") or "").strip(), w)
        grp = by_prod.setdefault(key, {"name": _product_label(key[0], w), "qty": 0, "kg": 0.0, "_b": {}})
        grp["qty"] += 1
        grp["kg"] += w
        pd = u.get("produced_date") or ""
        partia = kebab_batch_no(pd, u.get("batch_no") or "") if pd else (u.get("batch_no") or "")
        bb = best_before(pd, int(u.get("shelf_life_days") or 0)) if pd else ""
        bkey = (partia, bb)
        b = grp["_b"].setdefault(bkey, {"partia": partia, "termin": _fmt_date(bb), "qty": 0})
        b["qty"] += 1
    out: List[Dict[str, Any]] = []
    for grp in by_prod.values():
        grp["batches"] = list(grp.pop("_b").values())
        grp["kg"] = round(grp["kg"], 3)
        out.append(grp)
    return out
```

- [ ] **Step 4:** `python3 -m pytest tests/test_hdi.py -v` → PASS (5).
- [ ] **Step 5:** `cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/hdi_service.py backend/tests/test_hdi.py && git commit -m "feat(hdi): czyste grupowanie pozycji + numeracja + testy"`

---

## Task 3: Backend — tłumaczenia `hdi_i18n.py`

**Files:** Create `backend/app/services/hdi_i18n.py`

- [ ] **Step 1: Implementacja** (etykiety per język; SK/CZ etykiety + uwagi fallback EN)

```python
"""HDI — etykiety dwujęzyczne."""

LABELS = {
    "pl": {
        "title": "HANDLOWY DOKUMENT IDENTYFIKACYJNY", "number": "Numer HDI",
        "issue_date": "Data wystawienia", "producer": "Producent",
        "vet_no": "Weterynaryjny numer identyfikacyjny", "market_domestic": "Krajowy",
        "market_eu": "Unii Europejskiej", "supervision": "Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.",
        "col_name": "NAZWA TOWARU", "col_qty": "SZT.", "col_net": "MASA NETTO",
        "col_batch": "NR PARTII", "col_exp": "TERMIN PRZYDATNOŚCI", "total": "RAZEM",
        "recipient": "Odbiorca", "unload": "Miejsce rozładunku", "reg_no": "Numer rejestracyjny",
        "load": "Miejsce załadunku", "seller": "Sprzedawca", "ship_date": "Data wysyłki",
        "signature": "Podpis Wystawiającego", "fridge": "Samochód zabudowany chłodnią -18°C",
        "remarks": "UWAGI / WARUNKI REKLAMACJI",
    },
    "de": {
        "title": "HANDELSIDENTIFIKATIONSDOKUMENT", "number": "HDI-Nummer",
        "issue_date": "Datum der Ausgabe", "producer": "Hersteller",
        "vet_no": "Veterinärkontrollnummer", "market_domestic": "National",
        "market_eu": "Europäische Union", "supervision": "Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.",
        "col_name": "WARENBEZEICHNUNG", "col_qty": "STÜCKZAHL", "col_net": "NETTOGEWICHT",
        "col_batch": "CHARGENNUMMER", "col_exp": "MHD", "total": "GESAMT",
        "recipient": "Empfänger", "unload": "Abladeort", "reg_no": "Registriernummer",
        "load": "Ladeort", "seller": "Verkäufer", "ship_date": "Datum des Versands",
        "signature": "Unterschrift des Ausstellers", "fridge": "Auto mit Kühlschrank -18°C",
        "remarks": "ANMERKUNGEN / VORAUSSETZUNGEN FÜR BESCHWERDEN",
    },
    "en": {
        "title": "COMMERCIAL IDENTIFICATION DOCUMENT", "number": "HDI No.",
        "issue_date": "Date of issue", "producer": "Producer",
        "vet_no": "Veterinary identification number", "market_domestic": "Domestic market",
        "market_eu": "European Union", "supervision": "The establishment is under permanent veterinary supervision and has a HACCP system.",
        "col_name": "PRODUCT NAME", "col_qty": "QTY", "col_net": "NET WEIGHT",
        "col_batch": "BATCH NO.", "col_exp": "BEST BEFORE", "total": "TOTAL",
        "recipient": "Recipient", "unload": "Unloading place", "reg_no": "Registration number",
        "load": "Loading place", "seller": "Seller", "ship_date": "Date of shipment",
        "signature": "Signature of the issuer", "fridge": "Refrigerated truck -18°C",
        "remarks": "COMMENTS / CONDITIONS REGARDING COMPLAINTS",
    },
    "sk": {
        "title": "OBCHODNÝ IDENTIFIKAČNÝ DOKLAD", "number": "Číslo HDI",
        "issue_date": "Dátum vystavenia", "producer": "Výrobca",
        "vet_no": "Veterinárne identifikačné číslo", "market_domestic": "Domáci trh",
        "market_eu": "Európska únia", "supervision": "Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.",
        "col_name": "NÁZOV TOVARU", "col_qty": "KS", "col_net": "ČISTÁ HMOTNOSŤ",
        "col_batch": "ČÍSLO ŠARŽE", "col_exp": "DÁTUM SPOTREBY", "total": "SPOLU",
        "recipient": "Príjemca", "unload": "Miesto vykládky", "reg_no": "Evidenčné číslo",
        "load": "Miesto nakládky", "seller": "Predávajúci", "ship_date": "Dátum odoslania",
        "signature": "Podpis vystaviteľa", "fridge": "Auto s chladiarňou -18°C",
        "remarks": "POZNÁMKY / PODMIENKY REKLAMÁCIE",
    },
    "cs": {
        "title": "OBCHODNÍ IDENTIFIKAČNÍ DOKLAD", "number": "Číslo HDI",
        "issue_date": "Datum vystavení", "producer": "Výrobce",
        "vet_no": "Veterinární identifikační číslo", "market_domestic": "Domácí trh",
        "market_eu": "Evropská unie", "supervision": "Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.",
        "col_name": "NÁZEV ZBOŽÍ", "col_qty": "KS", "col_net": "ČISTÁ HMOTNOST",
        "col_batch": "ČÍSLO ŠARŽE", "col_exp": "DATUM SPOTŘEBY", "total": "CELKEM",
        "recipient": "Příjemce", "unload": "Místo vykládky", "reg_no": "Evidenční číslo",
        "load": "Místo nakládky", "seller": "Prodávající", "ship_date": "Datum odeslání",
        "signature": "Podpis vystavitele", "fridge": "Auto s chladírnou -18°C",
        "remarks": "POZNÁMKY / PODMÍNKY REKLAMACE",
    },
}

_COMPLAINTS = {
    "pl": "Wszelkie zastrzeżenia co do jakości i ilości towaru należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).",
    "de": "Beanstandungen der Qualität und Menge der Ware müssen während des Be-/Entladens und/oder bis zur Unterzeichnung der Lieferpapiere (Rechnung, Lieferschein, CMR) erfolgen.",
    "en": "Any objections to the quality or quantity of the goods must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.",
}


def labels(lang: str) -> dict:
    return LABELS.get(lang, LABELS["en"])


def complaints_text(lang: str) -> str:
    return _COMPLAINTS.get(lang, _COMPLAINTS["en"])
```

- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "from app.services.hdi_i18n import labels, complaints_text; print(labels('de')['title']); print(complaints_text('sk')[:10])"` → wypisze niemiecki tytuł + (EN fallback dla sk complaints).
- [ ] **Step 3:** `cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/hdi_i18n.py && git commit -m "feat(hdi): tlumaczenia etykiet PL/DE/EN/SK/CZ"`

---

## Task 4: Backend — serwis budowy/generacji + endpoint

**Files:** Modify `backend/app/services/hdi_service.py`, create `backend/app/routes/hdi.py`, modify `backend/app/main.py`

- [ ] **Step 1: Dopisz w `hdi_service.py`**

```python
def build_hdi(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    units = query_all(
        """SELECT fu.weight_kg, fu.batch_no, fu.produced_date, fu.product_type_id, fu.recipe_id,
                  pt.name AS product_type_name, r.shelf_life_days
           FROM finished_units fu
           LEFT JOIN product_types pt ON pt.id = fu.product_type_id
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           WHERE fu.order_id=%s""",
        (order_id,),
    )
    if not units:
        raise HTTPException(400, "Brak wyprodukowanych sztuk do HDI")
    items = group_hdi_items(units)
    total_qty = sum(i["qty"] for i in items)
    total_kg = round(sum(i["kg"] for i in items), 3)

    ordered = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM client_order_lines WHERE order_id=%s", (order_id,))
    ordered_qty = int((ordered or {}).get("q") or 0)
    incomplete = ordered_qty > 0 and total_qty < ordered_qty

    client = query_one(
        "SELECT name, address, city, nip, language, dest_name, dest_address, dest_city FROM clients WHERE name=%s",
        (order.get("client_name"),)) or {}
    co = get_company()
    lang = client.get("language") or lang_from_nip(client.get("nip") or "")

    company_addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    client_addr = f"{client.get('address','')}, {client.get('city','')}".strip(", ")
    dest = " ".join(x for x in [client.get('dest_name',''), client.get('dest_address',''), client.get('dest_city','')] if x).strip()
    header = {
        "producer_name": co.get("name", ""), "producer_addr": company_addr,
        "vet_number": co.get("vet_number", ""),
        "market_domestic": bool(co.get("market_domestic", True)),
        "market_eu": bool(co.get("market_eu", True)),
        "recipient": f"{client.get('name','')}, {client_addr}, {client.get('nip','')}".strip(", "),
        "unload": dest or f"{client.get('name','')}, {client_addr}".strip(", "),
        "load": co.get("load_place") or company_addr,
        "seller": f"{co.get('name','')}, {company_addr}".strip(", "),
    }
    return {"order_id": order_id, "client_name": order.get("client_name", ""), "language": lang,
            "incomplete": incomplete, "header": header, "items": items,
            "totals": {"qty": total_qty, "kg": total_kg}}


def generate_hdi(order_id: str) -> Dict[str, Any]:
    data = build_hdi(order_id)
    today = datetime.now()
    ym = today.strftime("%y%m")  # RRMM
    hid = cuid()
    with transaction() as conn:
        row = cx_query_one(conn,
            "SELECT COALESCE(MAX(seq),0)+1 AS n FROM hdi_documents WHERE year_month=%s", (ym,))
        seq = int(row["n"])
        number = format_hdi_number(seq, ym)
        cx_execute(conn,
            """INSERT INTO hdi_documents
               (id, number, seq, year_month, order_id, client_name, language, status,
                incomplete, header, items, totals, issue_date, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)""",
            (hid, number, seq, ym, order_id, data["client_name"], data["language"],
             data["incomplete"], json.dumps(data["header"]), json.dumps(data["items"]),
             json.dumps(data["totals"]), today.strftime("%d.%m.%Y"), now_iso()))
    return {"id": hid, "number": number, "status": "wstepny"}


def get_hdi(hdi_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM hdi_documents WHERE id=%s", (hdi_id,))
    if not row:
        raise HTTPException(404, "HDI nie znaleziony")
    return row


def list_hdi() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, status, incomplete, issue_date, created_at FROM hdi_documents ORDER BY created_at DESC")
```

- [ ] **Step 2: Trasy** — `backend/app/routes/hdi.py`:
```python
"""Endpointy HDI."""
from fastapi import APIRouter, Query

from app.services import hdi_service as svc

router = APIRouter(prefix="/api/hdi", tags=["hdi"])


@router.post("/generate")
def generate(order_id: str = Query(...)):
    return svc.generate_hdi(order_id)


@router.get("/{hdi_id}")
def get(hdi_id: str):
    return svc.get_hdi(hdi_id)


@router.get("")
def list_all():
    return svc.list_hdi()
```

- [ ] **Step 3: Rejestracja** — w `backend/app/main.py` dodać `hdi,` w obu krotkach po `labels_zebra,`.

- [ ] **Step 4: Smoke** — `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.main; from app.routes.hdi import router; print(sorted(r.path for r in router.routes))"` → zawiera `/api/hdi`, `/api/hdi/generate`, `/api/hdi/{hdi_id}`.

- [ ] **Step 5: Commit**
```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/hdi_service.py backend/app/routes/hdi.py backend/app/main.py && git commit -m "feat(hdi): build/generate HDI z zamowienia + endpointy"
```

---

## Task 5: Frontend — `hdiApi` + typy

**Files:** Modify `src/lib/api.ts`

- [ ] **Step 1:** dopisz:
```typescript
export interface HdiBatch { partia: string; termin: string; qty: number }
export interface HdiItem { name: string; qty: number; kg: number; batches: HdiBatch[] }
export interface HdiDoc {
  id: string; number: string; clientName: string; language: string; status: string
  incomplete: boolean; issueDate: string
  header: Record<string, any>; items: HdiItem[]; totals: { qty: number; kg: number }
}

export const hdiApi = {
  generate: (orderId: string) =>
    post<{ id: string; number: string; status: string }>(`/hdi/generate?order_id=${encodeURIComponent(orderId)}`, {}),
  get: (id: string) => get<any>(`/hdi/${id}`).then((r: any): HdiDoc => ({
    id: r.id, number: r.number, clientName: r.client_name ?? '', language: r.language ?? 'pl',
    status: r.status ?? 'wstepny', incomplete: !!r.incomplete, issueDate: r.issue_date ?? '',
    header: r.header ?? {}, items: r.items ?? [], totals: r.totals ?? { qty: 0, kg: 0 },
  })),
  list: () => get<any[]>('/hdi'),
}
```
- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "hdiApi|HdiDoc|HdiItem" || echo "BRAK bledow"`
- [ ] **Step 3:** `git add src/lib/api.ts && git commit -m "feat(hdi): hdiApi + typy"`

---

## Task 6: Frontend — strona druku HDI (dwujęzyczna) + trasa

**Files:** Create `src/pages/office/HdiPrintPage.tsx`, modify `src/App.tsx`

- [ ] **Step 1: Strona** `src/pages/office/HdiPrintPage.tsx` — pobiera `hdiApi.get(id)`, renderuje A4 wg wzoru, **dwujęzycznie PL + doc.language**. Etykiety dwujęzyczne pobierać przez prosty słownik front (zduplikowany z `hdi_i18n` — klucze identyczne) albo wbudowany. Minimalny, kompletny układ:

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { hdiApi, type HdiDoc } from '@/lib/api'

const L: Record<string, Record<string, string>> = {
  pl: { title: 'HANDLOWY DOKUMENT IDENTYFIKACYJNY', number: 'Numer HDI', issue: 'Data wystawienia', producer: 'Producent', vet: 'Weterynaryjny numer identyfikacyjny', dom: 'Krajowy', eu: 'Unii Europejskiej', superv: 'Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.', cName: 'NAZWA TOWARU', cQty: 'SZT.', cNet: 'MASA NETTO', cBatch: 'NR PARTII', cExp: 'TERMIN PRZYDATNOŚCI', total: 'RAZEM', recip: 'Odbiorca', unload: 'Miejsce rozładunku', load: 'Miejsce załadunku', seller: 'Sprzedawca', ship: 'Data wysyłki', sign: 'Podpis Wystawiającego' },
  de: { title: 'HANDELSIDENTIFIKATIONSDOKUMENT', number: 'HDI-Nummer', issue: 'Datum der Ausgabe', producer: 'Hersteller', vet: 'Veterinärkontrollnummer', dom: 'National', eu: 'Europäische Union', superv: 'Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.', cName: 'WARENBEZEICHNUNG', cQty: 'STÜCKZAHL', cNet: 'NETTOGEWICHT', cBatch: 'CHARGENNUMMER', cExp: 'MHD', total: 'GESAMT', recip: 'Empfänger', unload: 'Abladeort', load: 'Ladeort', seller: 'Verkäufer', ship: 'Datum des Versands', sign: 'Unterschrift des Ausstellers' },
  en: { title: 'COMMERCIAL IDENTIFICATION DOCUMENT', number: 'HDI No.', issue: 'Date of issue', producer: 'Producer', vet: 'Veterinary identification number', dom: 'Domestic market', eu: 'European Union', superv: 'The establishment is under permanent veterinary supervision and has a HACCP system.', cName: 'PRODUCT NAME', cQty: 'QTY', cNet: 'NET WEIGHT', cBatch: 'BATCH NO.', cExp: 'BEST BEFORE', total: 'TOTAL', recip: 'Recipient', unload: 'Unloading place', load: 'Loading place', seller: 'Seller', ship: 'Date of shipment', sign: 'Signature of the issuer' },
  sk: { title: 'OBCHODNÝ IDENTIFIKAČNÝ DOKLAD', number: 'Číslo HDI', issue: 'Dátum vystavenia', producer: 'Výrobca', vet: 'Veterinárne identifikačné číslo', dom: 'Domáci trh', eu: 'Európska únia', superv: 'Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.', cName: 'NÁZOV TOVARU', cQty: 'KS', cNet: 'ČISTÁ HMOTNOSŤ', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DÁTUM SPOTREBY', total: 'SPOLU', recip: 'Príjemca', unload: 'Miesto vykládky', load: 'Miesto nakládky', seller: 'Predávajúci', ship: 'Dátum odoslania', sign: 'Podpis vystaviteľa' },
  cs: { title: 'OBCHODNÍ IDENTIFIKAČNÍ DOKLAD', number: 'Číslo HDI', issue: 'Datum vystavení', producer: 'Výrobce', vet: 'Veterinární identifikační číslo', dom: 'Domácí trh', eu: 'Evropská unie', superv: 'Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.', cName: 'NÁZEV ZBOŽÍ', cQty: 'KS', cNet: 'ČISTÁ HMOTNOST', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DATUM SPOTŘEBY', total: 'CELKEM', recip: 'Příjemce', unload: 'Místo vykládky', load: 'Místo nakládky', seller: 'Prodávající', ship: 'Datum odeslání', sign: 'Podpis vystavitele' },
}

export function HdiPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<HdiDoc | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { hdiApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd')) }, [id])
  useEffect(() => { if (doc) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t) } }, [doc])
  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc) return <div className="p-8 text-slate-500">Ładowanie HDI…</div>
  const pl = L.pl; const cl = L[doc.language] || L.en
  const h = doc.header
  const bi = (k: keyof typeof pl) => `${pl[k]} / ${cl[k]}`
  return (
    <div className="bg-white text-black text-[11px]">
      <style>{`@media print{.no-print{display:none}@page{size:A4 portrait;margin:10mm}} .hdi{max-width:190mm;margin:0 auto;padding:8px}`}</style>
      <div className="no-print p-2"><Link to="/office/zamowienia" className="text-sm text-blue-700"><ArrowLeft size={14} className="inline"/> Zamówienia</Link>
        <button onClick={() => window.print()} className="ml-3 rounded bg-blue-600 px-3 py-1 text-white">Drukuj</button></div>
      <div className="hdi">
        {doc.status === 'wstepny' && <div className="mb-1 border border-amber-400 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">WSTĘPNY — towar niezeskanowany, możliwe błędy{doc.incomplete ? ' · niekompletne wzg. zamówienia' : ''}</div>}
        <div className="text-center font-bold">{bi('title')}</div>
        <div className="flex justify-between"><div><b>{bi('number')}:</b> {doc.number}</div><div><b>{bi('issue')}:</b> {doc.issueDate}</div></div>
        <div className="mt-1"><b>{bi('producer')}:</b> {h.producer_name}, {h.producer_addr}</div>
        <div>{bi('vet')}: <b>{h.vet_number}</b> &nbsp; {h.market_domestic && `☒ ${bi('dom')}`} {h.market_eu && `☒ ${bi('eu')}`}</div>
        <div className="text-[10px]">{pl.superv} / {cl.superv}</div>
        <table className="mt-2 w-full border-collapse text-[10px]" style={{ border: '1px solid #000' }}>
          <thead><tr>
            <th className="border px-1">L.P</th><th className="border px-1">{bi('cName')}</th>
            <th className="border px-1">{bi('cQty')}</th><th className="border px-1">{bi('cNet')}</th>
            <th className="border px-1">{bi('cBatch')}</th><th className="border px-1">{bi('cExp')}</th>
          </tr></thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i}>
                <td className="border px-1 text-center">{i + 1}.</td>
                <td className="border px-1">{it.name}</td>
                <td className="border px-1 text-center">{it.qty}szt.</td>
                <td className="border px-1 text-center">{it.kg.toFixed(0)}kg</td>
                <td className="border px-1">{it.batches.map(b => b.qty + 'szt ' + b.partia).join(' / ')}</td>
                <td className="border px-1">{it.batches.map(b => b.termin).join(' / ')}</td>
              </tr>
            ))}
            <tr><td className="border px-1 text-right" colSpan={2}><b>{bi('total')}:</b></td>
              <td className="border px-1 text-center"><b>{doc.totals.qty}szt.</b></td>
              <td className="border px-1 text-center"><b>{doc.totals.kg.toFixed(0)}kg</b></td>
              <td className="border" colSpan={2}></td></tr>
          </tbody>
        </table>
        <table className="mt-2 w-full border-collapse text-[10px]" style={{ border: '1px solid #000' }}>
          <tbody>
            <tr><td className="border px-1 font-bold">{bi('recip')}</td><td className="border px-1">{h.recipient}</td></tr>
            <tr><td className="border px-1 font-bold">{bi('unload')}</td><td className="border px-1">{h.unload}</td></tr>
            <tr><td className="border px-1 font-bold">{bi('load')}</td><td className="border px-1">{h.load}</td></tr>
            <tr><td className="border px-1 font-bold">{bi('seller')}</td><td className="border px-1">{h.seller}</td></tr>
          </tbody>
        </table>
        <div className="mt-6 flex justify-between text-[10px]"><div>{bi('ship')}: {doc.issueDate}</div><div>({bi('sign')})</div></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Trasa** w `src/App.tsx`: import `HdiPrintPage` + `<Route path="/office/hdi/:id/druk" element={<HdiPrintPage />} />`.

- [ ] **Step 3:** `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "HdiPrintPage" || echo "BRAK bledow"; npm run build 2>&1 | tail -2`

- [ ] **Step 4: Commit**
```bash
git add src/pages/office/HdiPrintPage.tsx src/App.tsx && git commit -m "feat(hdi): strona druku HDI dwujezyczna A4"
```

---

## Task 7: Frontend — akcja „HDI" w zamówieniach

**Files:** Modify `src/pages/office/ClientOrdersPage.tsx`

- [ ] **Step 1:** Obok akcji „Drukuj" (która robi `navigate('/office/zamowienia/{id}/druk')`) dodać przycisk/akcję „HDI":
```tsx
// import hdiApi z '@/lib/api' (lub apiClient gdzie reszta)
onClick={async () => {
  try { const r = await hdiApi.generate(o.id); navigate(`/office/hdi/${r.id}/druk`) }
  catch (e) { alert(e instanceof Error ? e.message : 'Błąd generowania HDI') }
}}
```
(dopasować do istniejącego wzorca przycisków akcji wiersza zamówienia; `hdiApi` import z `@/lib/api`).

- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ClientOrdersPage" || echo "BRAK bledow"; npm run build 2>&1 | tail -2`
- [ ] **Step 3:** `git add src/pages/office/ClientOrdersPage.tsx && git commit -m "feat(hdi): akcja Generuj HDI w zamowieniach"`

---

## Task 8: Pełne testy + build + e2e

- [ ] **Step 1:** `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q` → zielone (w tym `test_hdi.py`).
- [ ] **Step 2:** `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -2` → OK.
- [ ] **Step 3: Ręczny e2e:** zamówienie z wyprodukowanymi sztukami → akcja „HDI" → dokument PL + język klienta, numer NN/MM/RR, pozycje (produkt+waga, szt., masa, partie „ddmmrr nr", termin), RAZEM, bloki odbiorca/rozładunek/załadunek/sprzedawca; gdy wyprodukowano < zamówiono → baner „niekompletne".

---

## Self-Review (autora planu)
- **Pokrycie specu:** model (T1); grupowanie/numeracja (T2); tłumaczenia (T3); build/generate+endpoint (T4);
  hdiApi (T5); strona druku dwujęzyczna (T6); wyzwalanie z zamówienia (T7); testy (T8). ✅
- **Spójność:** `group_hdi_items`/`format_hdi_number`/`_product_label` zdef. w T2, użyte w T4;
  `HdiDoc`/`HdiItem` (T5) zgodne z payloadem serwisu (T4) i stroną druku (T6); etykiety front (T6)
  = klucze i18n backend (T3). Trasy T4 = `hdiApi` T5. ✅
- **Placeholdery:** brak — pełny kod/komendy. „dopasować do wzorca przycisku" (T7) = wskazana
  integracja z istniejącym UI, nie luka logiczna. ✅
