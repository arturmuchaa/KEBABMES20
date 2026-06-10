# SP-2b — WZ zintegrowany (wydanie → WZ, ceny później, WZ z zamówienia) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Każde wydanie towaru kończy się WZ bez podwójnego rozchodu: (A) `close_dispatch` generuje ilościowy WZ i przypisuje swój istniejący rozchód do tego WZ; (B) biuro uzupełnia ceny później (`PATCH /api/wz/{id}/prices`); (C) biuro może wystawić WZ z zamówienia (`qty_done` z planu) z flagą „może brakować" i rozchodem FG.

**Architecture:** Rozszerzenie `wz_service` o trzy czyste funkcje (`build_dispatch_wz_lines`, `apply_wz_prices`, `wz_order_incomplete` + `build_order_wz_lines`) i dwie usługi (`update_wz_prices`, `create_wz_from_order`). `close_dispatch` zmienia TYLKO atrybucję istniejącego ruchu OUT (`source_type='dispatch'` → `'wz'`) + tworzy dokument idempotentnie per `(dispatch, id)`. Rozchód z zamówienia kopiuje wzorzec `close_dispatch` (FOR UPDATE, greedy po `qty_available`, 400+rollback przy braku stanu).

**Tech Stack:** FastAPI + psycopg2, React + TS + Vite, pytest (testy czyste, bez DB).

**Spec:** `docs/superpowers/specs/2026-06-07-wz-sp2b-integracja-design.md`

---

## Faza 2b-1 (A + B)

### Task 1: `build_dispatch_wz_lines` (czysta funkcja)

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Test: `backend/tests/test_wz_dispatch_lines.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_wz_dispatch_lines.py`:

```python
from app.services.wz_service import build_dispatch_wz_lines


def test_groups_to_quantity_lines():
    groups = {
        ("2026-06-01", "K123", "r1"): {"count": 10, "kg": 200.0},
        ("2026-06-01", "K124", "r2"): {"count": 4, "kg": 60.0},
    }
    lines = build_dispatch_wz_lines(groups, {"r1": "Kebab drobiowy", "r2": "Kebab wołowy"})
    assert len(lines) == 2
    by_batch = {l["batch_no"]: l for l in lines}
    assert by_batch["K123"]["name"] == "Kebab drobiowy"
    assert by_batch["K123"]["qty"] == 10
    assert by_batch["K123"]["unit"] == "szt"
    assert by_batch["K123"]["price"] is None and by_batch["K123"]["value"] is None
    assert by_batch["K123"]["stock_type"] == "fg"


def test_recipe_name_fallback():
    groups = {("2026-06-01", "K1", "rX"): {"count": 1, "kg": 20.0}}
    lines = build_dispatch_wz_lines(groups, {})
    assert lines[0]["name"] == "Kebab"


def test_stable_order_by_name_then_batch():
    groups = {
        ("d", "B2", "r1"): {"count": 1, "kg": 1.0},
        ("d", "B1", "r1"): {"count": 1, "kg": 1.0},
        ("d", "A1", "r2"): {"count": 1, "kg": 1.0},
    }
    lines = build_dispatch_wz_lines(groups, {"r1": "B-kebab", "r2": "A-kebab"})
    assert [(l["name"], l["batch_no"]) for l in lines] == [
        ("A-kebab", "A1"), ("B-kebab", "B1"), ("B-kebab", "B2")]


def test_empty_groups():
    assert build_dispatch_wz_lines({}, {}) == []
```

- [ ] **Step 2: Run — FAIL**

Run: `cd backend && pytest tests/test_wz_dispatch_lines.py -q`
Expected: FAIL (ImportError: cannot import name 'build_dispatch_wz_lines').

- [ ] **Step 3: Implementacja — dopisz do `wz_service.py`** (po `build_manual_wz_lines`)

```python
def build_dispatch_wz_lines(groups: Dict, recipe_names: Dict[str, str]) -> List[Dict[str, Any]]:
    """Pozycje WZ z grup wydania (group_units_for_out): linia ilościowa per
    (data, partia, receptura) — bez cen (WZ wstępny, valued=False)."""
    lines: List[Dict[str, Any]] = []
    for (_produced_date, batch_no, recipe_id), g in (groups or {}).items():
        lines.append({
            "name": recipe_names.get(recipe_id) or "Kebab",
            "qty": int(g.get("count") or 0),
            "unit": "szt",
            "batch_no": batch_no,
            "price": None,
            "value": None,
            "stock_type": "fg",
        })
    lines.sort(key=lambda l: (l["name"], l["batch_no"] or ""))
    return lines
```

- [ ] **Step 4: Run — PASS**

Run: `cd backend && pytest tests/test_wz_dispatch_lines.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_dispatch_lines.py
git commit -m "feat(wz): build_dispatch_wz_lines — pozycje WZ z grup wydania (TDD)"
```

---

### Task 2: `close_dispatch` → WZ (zmiana atrybucji rozchodu)

**Files:**
- Modify: `backend/app/services/dispatches_service.py`

Minimalna zmiana: ta sama logika OUT, zmienia się tylko `source_type/source_id`
ruchu + powstaje dokument WZ (idempotentnie). Brak nowych ruchów magazynowych.

- [ ] **Step 1: Importy** (na górze `dispatches_service.py`)

```python
from datetime import date

from app.services.settings_service import get_company
from app.services.wz_service import _insert_wz, _seller_block, build_dispatch_wz_lines
```

(`wz_service` nie importuje `dispatches_service` — brak cyklu importów.)

- [ ] **Step 2: W `close_dispatch`, po `groups = group_units_for_out(units)` a PRZED pętlą rozchodu**, wstaw:

```python
        # WZ z zawartości wydania (ilościowy, ceny później) — idempotentnie.
        recipe_ids = sorted({k[2] for k in groups if k[2]})
        recipe_names: Dict[str, str] = {}
        if recipe_ids:
            for r in cx_query_all(conn, "SELECT id, name FROM recipes WHERE id = ANY(%s)", (recipe_ids,)):
                recipe_names[r["id"]] = r.get("name") or ""

        buyer: Dict[str, Any] = {"name": disp.get("client_name") or "", "address": "", "nip": ""}
        if disp.get("client_id"):
            cli = cx_query_one(conn, "SELECT name, address, city, nip FROM clients WHERE id=%s",
                               (disp["client_id"],))
            if cli:
                buyer = {"name": cli.get("name") or buyer["name"],
                         "address": f"{cli.get('address') or ''} {cli.get('city') or ''}".strip(),
                         "nip": cli.get("nip") or ""}

        existing_wz = cx_query_one(
            conn, "SELECT id, number FROM wz_documents WHERE source_type='dispatch' AND source_id=%s "
                  "ORDER BY created_at LIMIT 1", (dispatch_id,))
        if existing_wz:
            wid, wz_number = existing_wz["id"], existing_wz["number"]
        else:
            issued = date.today().strftime("%d.%m.%Y")
            wid = _insert_wz(
                conn, source_type="dispatch", source_id=dispatch_id, seller=_seller_block(),
                buyer=buyer, valued=False, lines=build_dispatch_wz_lines(groups, recipe_names),
                total=0.0, place=get_company().get("city") or "", issued=issued,
                released=issued, notes="")
            wz_number = cx_query_one(conn, "SELECT number FROM wz_documents WHERE id=%s", (wid,))["number"]
```

(Dodaj `Dict` do importu typing w nagłówku pliku: `from typing import Any, Dict, List`.)

- [ ] **Step 3: W pętli rozchodu zmień TYLKO atrybucję ruchu**

```python
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=row["id"],
                        qty=take * float(row.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="wz", source_id=wid,
                    )
```

- [ ] **Step 4: Zwróć WZ w odpowiedzi** (ostatnia linia `close_dispatch`)

```python
        logger.info("dispatch.closed", extra={"dispatch_id": dispatch_id, "units": len(units), "wz_id": wid})
        return {"id": dispatch_id, "status": "shipped", "units": len(units),
                "wzId": wid, "wzNumber": wz_number}
```

- [ ] **Step 5: Sanity — pełne testy czyste + import**

Run: `cd backend && pytest tests/ -q && python -c "import app.services.dispatches_service"`
Expected: PASS, brak ImportError.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/dispatches_service.py
git commit -m "feat(wz): close_dispatch generuje WZ i przypisuje rozchód do WZ (bez podwójnych ruchów)"
```

---

### Task 3: `apply_wz_prices` (czysta funkcja)

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Test: `backend/tests/test_wz_apply_prices.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_wz_apply_prices.py`:

```python
from app.services.wz_service import apply_wz_prices


def _lines():
    return [
        {"name": "Kebab A", "qty": 10, "unit": "szt", "price": None, "value": None},
        {"name": "Kebab B", "qty": 4, "unit": "szt", "price": None, "value": None},
    ]


def test_applies_prices_and_totals():
    lines, total = apply_wz_prices(_lines(), [{"index": 0, "price": 2.5}, {"index": 1, "price": 10}])
    assert lines[0]["price"] == 2.5 and lines[0]["value"] == 25.0
    assert lines[1]["price"] == 10.0 and lines[1]["value"] == 40.0
    assert total == 65.0


def test_partial_prices_total_counts_only_priced():
    lines, total = apply_wz_prices(_lines(), [{"index": 1, "price": 1}])
    assert lines[0]["price"] is None and lines[0]["value"] is None
    assert total == 4.0


def test_out_of_range_index_ignored():
    lines, total = apply_wz_prices(_lines(), [{"index": 5, "price": 9}, {"index": -1, "price": 9}])
    assert all(l["price"] is None for l in lines)
    assert total == 0.0


def test_does_not_mutate_input():
    src = _lines()
    apply_wz_prices(src, [{"index": 0, "price": 3}])
    assert src[0]["price"] is None
```

- [ ] **Step 2: Run — FAIL**

Run: `cd backend && pytest tests/test_wz_apply_prices.py -q`
Expected: FAIL (ImportError).

- [ ] **Step 3: Implementacja — dopisz do `wz_service.py`**

```python
def apply_wz_prices(lines: List[Dict[str, Any]], prices: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    """Nałóż ceny [{index, price}] na kopię pozycji; przelicz value=qty*price
    i sumę. Indeksy spoza zakresu pomijane. Nie mutuje wejścia."""
    out = [dict(l) for l in (lines or [])]
    for p in prices or []:
        try:
            i = int(p.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(out):
            price = round(float(p.get("price") or 0), 2)
            qty = float(out[i].get("qty") or 0)
            out[i]["price"] = price
            out[i]["value"] = round(qty * price, 2)
    total = round(sum(float(l.get("value") or 0) for l in out), 2)
    return out, total
```

- [ ] **Step 4: Run — PASS**

Run: `cd backend && pytest tests/test_wz_apply_prices.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_apply_prices.py
git commit -m "feat(wz): apply_wz_prices — nakładanie cen na pozycje WZ (TDD)"
```

---

### Task 4: `update_wz_prices` + `PATCH /api/wz/{id}/prices`

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Modify: `backend/app/routes/wz.py`

- [ ] **Step 1: Usługa — dopisz do `wz_service.py`** (po `create_manual_wz`)

```python
def update_wz_prices(wz_id: str, prices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Uzupełnij ceny na WZ wstępnym: nadpisuje wskazane pozycje, valued=True,
    przelicza total_value. WZ potwierdzony → 409."""
    if not prices:
        raise HTTPException(400, "Brak cen do uzupełnienia")
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id, status, lines FROM wz_documents WHERE id=%s FOR UPDATE", (wz_id,))
        if not row:
            raise HTTPException(404, "Dokument WZ nie istnieje")
        if row.get("status") != "wstepny":
            raise HTTPException(409, "Ceny można uzupełnić tylko na WZ wstępnym")
        lines = row.get("lines")
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")
        new_lines, total = apply_wz_prices(lines, prices)
        cx_execute(conn,
                   "UPDATE wz_documents SET lines=%s, total_value=%s, valued=TRUE WHERE id=%s",
                   (json.dumps(new_lines), total, wz_id))
    logger.info("wz.prices_updated", extra={"wz_id": wz_id, "total": total})
    return get_wz(wz_id)
```

- [ ] **Step 2: Endpoint — dopisz do `routes/wz.py`** (przed `GET /{wz_id}`)

```python
@router.patch("/{wz_id}/prices")
def update_prices(wz_id: str, body: dict):
    return svc.update_wz_prices(wz_id, body.get("prices") or [])
```

- [ ] **Step 3: Sanity**

Run: `cd backend && pytest tests/ -q && python -c "import app.routes.wz"`
Expected: PASS, brak ImportError.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/wz_service.py backend/app/routes/wz.py
git commit -m "feat(wz): update_wz_prices + PATCH /api/wz/{id}/prices"
```

---

### Task 5: Front — `wzApi.updatePrices` + edytor cen na liście WZ

**Files:**
- Modify: `src/lib/api.ts` (w `wzApi`)
- Modify: `src/pages/office/WzDocumentsPage.tsx`

- [ ] **Step 1: `api.ts` — dopisz do `wzApi`**

```typescript
  updatePrices: (id: string, prices: { index: number; price: number }[]) =>
    patch<WzDoc>(`/wz/${encodeURIComponent(id)}/prices`, { prices }),
```

(Helper `patch` już istnieje w `api.ts`.)

- [ ] **Step 2: `WzDocumentsPage.tsx` — edytor cen**

Przy WZ `!d.valued && d.status === 'wstepny'` przycisk „Uzupełnij ceny".
Klik → `wzApi.byId(d.id)` → rozwija wiersz edycji pod dokumentem: tabelka
pozycji (`name`, `batch_no`, `qty`, `unit`, input `price`), suma na żywo,
przycisk „Zapisz ceny" → `wzApi.updatePrices(d.id, prices)` → odśwież listę
(`wzApi.list()`), zwiń edytor. Błąd → komunikat w wierszu (styl jak `err`
w `WzNewPage`). Stan: `editId: string | null`, `editLines`, `editErr`.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 błędów.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/pages/office/WzDocumentsPage.tsx
git commit -m "feat(wz): edytor cen na liście WZ (uzupełnianie cen po wydaniu)"
```

---

## Faza 2b-2 (C)

### Task 6: `wz_order_incomplete` + `build_order_wz_lines` (czyste funkcje)

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Test: `backend/tests/test_wz_from_order.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_wz_from_order.py`:

```python
from app.services.wz_service import build_order_wz_lines, wz_order_incomplete


def test_incomplete_when_produced_below_ordered():
    assert wz_order_incomplete(5, 10) is True
    assert wz_order_incomplete(10, 10) is False
    assert wz_order_incomplete(12, 10) is False
    assert wz_order_incomplete(0, 0) is False  # brak zamówionych = nie flagujemy


def test_lines_split_per_batch_allocation():
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "Kebab drobiowy",
        "batch_allocation": {"S1": {"pieces": 6}, "S2": {"pieces": 4}},
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert produced == 10
    assert [(l["batch_no"], l["qty"]) for l in lines] == [("S1", 6), ("S2", 4)]
    assert all(l["unit"] == "szt" and l["price"] is None and l["stock_type"] == "fg" for l in lines)
    assert all(l["recipe_id"] == "r1" for l in lines)


def test_fallback_to_seasoned_batch_when_allocation_mismatch():
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "Kebab",
        "batch_allocation": {"S1": {"pieces": 3}},  # 3 != 10 → fallback
        "seasoned_batch_no": "S9",
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert lines == [{"name": "Kebab", "qty": 10, "unit": "szt", "batch_no": "S9",
                      "price": None, "value": None, "stock_type": "fg", "recipe_id": "r1"}]
    assert produced == 10


def test_aggregates_same_recipe_and_batch_across_lines():
    plan_lines = [
        {"qty_done": 2, "recipe_id": "r1", "recipe_name": "Kebab", "seasoned_batch_no": "S1"},
        {"qty_done": 3, "recipe_id": "r1", "recipe_name": "Kebab", "seasoned_batch_no": "S1"},
    ]
    lines, produced = build_order_wz_lines(plan_lines)
    assert lines[0]["qty"] == 5 and produced == 5


def test_skips_lines_without_production():
    lines, produced = build_order_wz_lines([{"qty_done": 0, "recipe_name": "X"}])
    assert lines == [] and produced == 0
```

- [ ] **Step 2: Run — FAIL**

Run: `cd backend && pytest tests/test_wz_from_order.py -q`
Expected: FAIL (ImportError).

- [ ] **Step 3: Implementacja — dopisz do `wz_service.py`**

```python
def wz_order_incomplete(produced: int, ordered: int) -> bool:
    """Flaga „może brakować": zamówiono więcej, niż wyprodukowano."""
    return ordered > 0 and produced < ordered


def build_order_wz_lines(plan_lines: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Linie WZ z linii planu produkcji: pozycja per (receptura, partia) wg
    batch_allocation (fallback: seasoned_batch_no, jak w HDI). Ilościowe.
    Zwraca (linie, suma wyprodukowanych szt)."""
    agg: Dict[Tuple, int] = {}
    produced = 0
    for line in plan_lines or []:
        qty_done = int(line.get("qty_done") or 0)
        if qty_done <= 0:
            continue
        produced += qty_done
        name = (line.get("recipe_name") or line.get("product_type_name") or "Kebab").strip()
        rid = line.get("recipe_id")
        ba = line.get("batch_allocation") or {}
        alloc = ({bno: int((info or {}).get("pieces") or 0) for bno, info in ba.items()}
                 if isinstance(ba, dict) else {})
        if alloc and sum(alloc.values()) == qty_done:
            buckets = list(alloc.items())
        else:
            sbn = line.get("seasoned_batch_no")
            if not sbn:
                lst = line.get("seasoned_batch_nos") or []
                sbn = lst[0] if lst else ""
            buckets = [(sbn or "", qty_done)]
        for bno, pieces in buckets:
            key = (rid, name, bno)
            agg[key] = agg.get(key, 0) + int(pieces)
    lines = [
        {"name": name, "qty": qty, "unit": "szt", "batch_no": bno,
         "price": None, "value": None, "stock_type": "fg", "recipe_id": rid}
        for (rid, name, bno), qty in sorted(agg.items(), key=lambda kv: (kv[0][1], kv[0][2] or ""))
    ]
    return lines, produced
```

- [ ] **Step 4: Run — PASS**

Run: `cd backend && pytest tests/test_wz_from_order.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_from_order.py
git commit -m "feat(wz): build_order_wz_lines + wz_order_incomplete (TDD)"
```

---

### Task 7: `create_wz_from_order` (usługa z rozchodem)

**Files:**
- Modify: `backend/app/services/wz_service.py`

Wzorzec rozchodu z `close_dispatch`: dopasowanie `finished_goods` po
`(batch_no, recipe_id)` (bez `produced_date` — zamówienie może być realizowane
z kilku dni), FOR UPDATE, greedy po `qty_available`, brak stanu → 400 + rollback.

- [ ] **Step 1: Implementacja — dopisz do `wz_service.py`** (po `update_wz_prices`)

```python
def create_wz_from_order(order_id: str) -> Dict[str, Any]:
    """WZ z zamówienia: pozycje z qty_done linii planu, rozchód FG, flaga
    incomplete. Idempotentny per (source_type='order', source_id=order_id)."""
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    plan_lines = query_all(
        """SELECT pl.qty_done, pl.recipe_id, pl.recipe_name, pl.product_type_name,
                  pl.batch_allocation, pl.seasoned_batch_no, pl.seasoned_batch_nos
           FROM production_plan_lines pl
           WHERE pl.client_order_id=%s AND COALESCE(pl.qty_done,0) > 0""",
        (order_id,))
    lines, produced = build_order_wz_lines(plan_lines)
    if not lines:
        raise HTTPException(400, "Brak wyprodukowanych pozycji do WZ")

    ordered = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM client_order_lines WHERE order_id=%s", (order_id,))
    incomplete = wz_order_incomplete(produced, int((ordered or {}).get("q") or 0))

    # Klient jak w HDI: najpierw client_id, potem nazwa.
    client = None
    if order.get("client_id"):
        client = query_one("SELECT name, address, city, nip FROM clients WHERE id=%s",
                           (order.get("client_id"),))
    if not client:
        client = query_one("SELECT name, address, city, nip FROM clients WHERE name=%s",
                           (order.get("client_name"),))
    client = client or {}
    buyer = {"name": client.get("name") or order.get("client_name") or "",
             "address": f"{client.get('address') or ''} {client.get('city') or ''}".strip(),
             "nip": client.get("nip") or ""}

    issued = date.today().strftime("%d.%m.%Y")
    notes = "UWAGA: zamówienie zrealizowane częściowo — może brakować sztuk." if incomplete else ""

    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s "
                  "ORDER BY created_at LIMIT 1", (order_id,))
        if existing:
            doc = get_wz(existing["id"])
            doc["incomplete"] = incomplete
            logger.info("wz.order.reused", extra={"wz_id": existing["id"]})
            return doc

        wid = _insert_wz(
            conn, source_type="order", source_id=order_id, seller=_seller_block(),
            buyer=buyer, valued=False, lines=lines, total=0.0,
            place=get_company().get("city") or "", issued=issued, released=issued,
            notes=notes)

        for ln in lines:
            need = int(ln["qty"])
            if need <= 0:
                continue
            sql = ("SELECT id, qty_available, kg_per_unit FROM finished_goods "
                   "WHERE batch_no=%s")
            params: List[Any] = [ln.get("batch_no")]
            if ln.get("recipe_id"):
                sql += " AND recipe_id=%s"
                params.append(ln["recipe_id"])
            sql += " ORDER BY (COALESCE(client_name,'')='') DESC, qty_available DESC FOR UPDATE"
            rows = cx_query_all(conn, sql, tuple(params))
            for row in rows:
                take = min(need, max(0, int(row.get("qty_available") or 0)))
                if take > 0:
                    cx_execute(
                        conn,
                        "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                        (take, take, row["id"]))
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=row["id"],
                        qty=take * float(row.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="wz", source_id=wid)
                    need -= take
                if need == 0:
                    break
            if need > 0:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów dla partii {ln.get('batch_no')} (brakuje {need} szt)")

    logger.info("wz.order.created", extra={"wz_id": wid, "order_id": order_id, "incomplete": incomplete})
    doc = get_wz(wid)
    doc["incomplete"] = incomplete
    return doc
```

Wymaga `cx_query_all` w imporcie z `app.db` (dopisz do istniejącego importu).

- [ ] **Step 2: Sanity**

Run: `cd backend && pytest tests/ -q && python -c "import app.services.wz_service"`
Expected: PASS, brak ImportError.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/wz_service.py
git commit -m "feat(wz): create_wz_from_order — WZ z zamówienia z rozchodem FG i flagą incomplete"
```

---

### Task 8: `POST /api/wz/from-order` (endpoint)

**Files:**
- Modify: `backend/app/routes/wz.py`

- [ ] **Step 1: Endpoint** (obok `POST /manual`, przed `GET /{wz_id}`)

```python
@router.post("/from-order")
def from_order(body: dict):
    order_id = (body.get("orderId") or "").strip()
    if not order_id:
        raise HTTPException(400, "orderId wymagany")
    return svc.create_wz_from_order(order_id)
```

- [ ] **Step 2: Sanity**

Run: `cd backend && python -c "import app.routes.wz" && pytest tests/ -q`
Expected: brak ImportError, PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/wz.py
git commit -m "feat(wz): POST /api/wz/from-order"
```

---

### Task 9: Front — `wzApi.fromOrder` + przycisk WZ na zamówieniach

**Files:**
- Modify: `src/lib/api.ts` (w `wzApi`)
- Modify: `src/pages/office/ClientOrdersPage.tsx`

- [ ] **Step 1: `api.ts` — dopisz do `wzApi`**

```typescript
  fromOrder: (orderId: string) =>
    post<WzDoc & { incomplete?: boolean }>('/wz/from-order', { orderId }),
```

- [ ] **Step 2: `ClientOrdersPage.tsx` — przycisk „WZ"** (obok przycisku HDI, wzorzec 1:1 jak HDI ~linia 507-528)

```tsx
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  const r = await wzApi.fromOrder(o.id)
                                  if (r.incomplete) {
                                    alert(`Uwaga: zamówienie zrealizowane częściowo — może brakować sztuk.\n` +
                                          `WZ ${r.number} wystawiono na stan faktyczny produkcji.`)
                                  }
                                  const url = `/office/wz/${r.id}/druk`
                                  const win = window.open(url, '_blank')
                                  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Błąd wystawiania WZ')
                                }
                              }}
                              className="inline-flex items-center justify-center h-7 px-1.5 rounded text-[10px] font-bold text-amber-700 hover:bg-amber-50"
                              title="Wystaw WZ (rozchód ze stanu)"
                            >
                              WZ
                            </button>
```

Dodaj `wzApi` do importu z `@/lib/api`.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 błędów.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/pages/office/ClientOrdersPage.tsx
git commit -m "feat(wz): przycisk WZ z zamówienia na liście zamówień"
```

---

### Task 10: Weryfikacja końcowa + deploy + smoke na żywej bazie

- [ ] **Step 1: Pełny przebieg testów i builda**

Run: `cd backend && pytest tests/ -q` oraz `npm run typecheck && npm run build`
Expected: wszystko PASS / 0 błędów.

- [ ] **Step 2: Deploy backend** (jak zawsze: kopiowanie plików, NIE git)

```bash
cp backend/app/services/wz_service.py backend/app/services/dispatches_service.py /opt/kebab/app/backend/app/services/
cp backend/app/routes/wz.py /opt/kebab/app/backend/app/routes/
systemctl restart kebab-mes.service
curl -s http://127.0.0.1:8010/api/health
```

- [ ] **Step 3: Deploy frontend** (zachowując stare hashe assetów — Tauri!)

```bash
cp -r dist/. /opt/kebab/app/dist/
```

- [ ] **Step 4: Smoke na żywej bazie** (spec: „zamknięcie testowego wydania tworzy WZ i jeden OUT pod source_id=wz; brak podwójnego ruchu")

1. `POST /api/wz/from-order` na zamówieniu testowym z `qty_done>0` → dokument
   z liniami, rozchód widoczny: `SELECT * FROM stock_movements WHERE source_type='wz' AND source_id=<wid>`.
2. Ponowny `POST` na tym samym zamówieniu → ten sam `id` (idempotencja), ruchy
   NIE zduplikowane (`COUNT(*)` bez zmian).
3. `PATCH /api/wz/<wid>/prices` z cenami → `valued=true`, `total_value` poprawny.
4. Jeżeli jest otwarte wydanie testowe: zamknij → odpowiedź zawiera `wzId`,
   `SELECT COUNT(*) FROM stock_movements WHERE source_id=<wzId>` = liczba grup,
   zero ruchów `source_type='dispatch'` dla tego wydania.

Jeśli krok smoke wymaga danych, których nie wolno ruszać — ogranicz się do
1-3 (zamówienie testowe) i weryfikacji `close_dispatch` przy najbliższym
realnym wydaniu.

- [ ] **Step 5: Commit dokumentacji planu (odhaczone checkboxy)**
