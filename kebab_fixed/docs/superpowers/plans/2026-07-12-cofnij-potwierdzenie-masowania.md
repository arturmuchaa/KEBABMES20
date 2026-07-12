# Cofnij potwierdzenie masowania — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać bezpieczne „Cofnij potwierdzenie" masowania — odwraca finish zlecenia `done` (partia przyprawionego, mięso, przyprawy, ruchy, sesje, status) TYLKO gdy nic nie zużyto na produkcji.

**Architecture:** Backend: nowa funkcja `undo_mixing_confirmation(order_id)` w `mixing_service.py` + endpoint `PATCH /mixing-orders/{id}/undo-confirm`. Odwraca w JEDNEJ transakcji, biorąc kwoty ze `stock_movements` tego zlecenia (źródło prawdy). Frontend: `mixingOrdersApi.undoConfirm`, przycisk „Cofnij" na wierszach `done` w `PlanRow`, handler w `MixingDayPlanEditor`.

**Tech Stack:** FastAPI + psycopg2, pytest (testy DB), React + TS, vitest.

## Global Constraints

- Undo dozwolone TYLKO gdy `status='done'` ORAZ każda partia przyprawionego zlecenia ma `kg_used <= 0.001`. Inaczej `HTTPException(400, ...)`.
- Jedna transakcja, `FOR UPDATE` na zleceniu i dotykanych `meat_stock`/`seasoned_meat` (kolejność deterministyczna po id — bez deadlocków).
- Kwoty do przywrócenia = ze `stock_movements` zlecenia (`source_type='mixing'`, `source_id=order_id`): meat OUT (qty<0), ingredient OUT (qty<0), seasoned IN (`batch_id = seasoned_meat.id`).
- Czyste cofnięcie: usuwamy ruchy i sesje (jakby nie potwierdzono); zlecenie → `confirmed`, `kg_done=0`, rezerwacje lotów wracają (`kg_planned=kg_actual, kg_actual=0`).
- Pułapka współdzielonego `batch_no`: odejmujemy tylko wkład zlecenia; wiersz `seasoned_meat` kasujemy dopiero gdy `kg_produced<=0.001`.
- Test DB: `TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test"` (schemat już zmigrowany). Spec: `docs/superpowers/specs/2026-07-12-cofnij-potwierdzenie-masowania-design.md`.

---

## Task 1: Backend `undo_mixing_confirmation` + endpoint + testy DB

**Files:**
- Modify: `backend/app/services/mixing_service.py` (dodać funkcję po `cancel_mixing_order`)
- Modify: `backend/app/routes/mixing.py` (dodać endpoint)
- Create: `backend/tests/test_mixing_undo_db.py`

**Interfaces:**
- Produces: `undo_mixing_confirmation(order_id: str) -> Dict` (zwraca `build_mixing_order`), endpoint `PATCH /api/mixing-orders/{id}/undo-confirm`. Używane przez frontend (Task 2).

- [ ] **Step 1: Napisz testy (failing)**

Utwórz `backend/tests/test_mixing_undo_db.py`:

```python
"""Testy INTEGRACYJNE undo_mixing_confirmation (prawdziwy SQL na bazie testowej).

Cofnięcie potwierdzenia = odwrócenie finish_mixing_session: usunięcie partii
przyprawionego, przywrócenie mięsa i przypraw, powrót zlecenia do kolejki.
Guard: undo tylko gdy partia przyprawionego niezużyta (kg_used=0).
"""
import pytest
from fastapi import HTTPException

from app.db import query_one, query_all, execute
from app.models.mixing import FinishMixingSessionDto, FinishMixingLotAlloc
from app.services.mixing_service import finish_mixing_session, undo_mixing_confirmation


def _seed_raw_batch(rb_id, seq):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
        "VALUES (%s,%s,%s,'active')",
        (rb_id, f"RB-{rb_id}", seq),
    )


def _seed_stock(ms_id, lot_no, kg_available, kg_reserved, raw_batch_id):
    execute(
        "INSERT INTO meat_stock "
        "(id, lot_no, kg_available, kg_reserved, status, raw_batch_id, material_type_id, material_name) "
        "VALUES (%s,%s,%s,%s,'AVAILABLE',%s,'mat-A','Łopatka')",
        (ms_id, lot_no, kg_available, kg_reserved, raw_batch_id),
    )


def _seed_order(order_id, recipe_id, recipe_name, meat_kg=200):
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, status, machine_id) "
        "VALUES (%s,%s,%s,%s,%s,'in_progress',1)",
        (order_id, f"MAS/{order_id}", recipe_id, recipe_name, meat_kg),
    )


def _finish(order_id, ms_id, kg):
    dto = FinishMixingSessionDto(
        kg_actual=kg, batch_no="",
        lot_allocations=[FinishMixingLotAlloc(meat_lot_id=ms_id, kg=kg)],
    )
    return finish_mixing_session(order_id, dto)


def test_undo_reverses_finish(db):
    _seed_raw_batch("rb500", 500)
    _seed_stock("msu1", "LOT-U1", 1000, 200, "rb500")   # 200 zarezerwowane pod zlecenie
    _seed_order("ou1", "r-gold2", "Gold2", meat_kg=200)

    _finish("ou1", "msu1", 200)
    # po finish: partia powstała, mięso zużyte, zlecenie done
    assert query_one("SELECT status FROM mixing_orders WHERE id=%s", ("ou1",))["status"] == "done"
    assert query_one("SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s", ("500", "r-gold2")) is not None

    undo_mixing_confirmation("ou1")

    # partia przyprawionego usunięta
    assert query_one("SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s", ("500", "r-gold2")) is None
    # mięso przywrócone (available z powrotem, used=0, rezerwacja wraca)
    ms = query_one("SELECT kg_available, kg_reserved, kg_used FROM meat_stock WHERE id=%s", ("msu1",))
    assert float(ms["kg_available"]) == 1000.0
    assert float(ms["kg_reserved"]) == 200.0
    assert float(ms["kg_used"]) == 0.0
    # zlecenie wróciło do kolejki, rezerwacja lotu przywrócona
    o = query_one("SELECT status, kg_done FROM mixing_orders WHERE id=%s", ("ou1",))
    assert o["status"] == "confirmed"
    assert float(o["kg_done"]) == 0.0
    lot = query_one("SELECT kg_planned, kg_actual FROM mixing_order_lots WHERE order_id=%s AND meat_stock_id=%s", ("ou1", "msu1"))
    assert float(lot["kg_planned"]) == 200.0 and float(lot["kg_actual"]) == 0.0
    # ślad ruchów i sesji usunięty
    assert query_all("SELECT id FROM stock_movements WHERE source_type='mixing' AND source_id=%s", ("ou1",)) == []
    assert query_all("SELECT id FROM mixing_sessions WHERE order_id=%s", ("ou1",)) == []


def test_undo_blocked_when_seasoned_used(db):
    _seed_raw_batch("rb501", 501)
    _seed_stock("msu2", "LOT-U2", 1000, 200, "rb501")
    _seed_order("ou2", "r-gold2", "Gold2", meat_kg=200)
    _finish("ou2", "msu2", 200)

    # symuluj zużycie downstream
    execute("UPDATE seasoned_meat SET kg_used=50 WHERE batch_no=%s AND recipe_id=%s", ("501", "r-gold2"))

    with pytest.raises(HTTPException) as ei:
        undo_mixing_confirmation("ou2")
    assert ei.value.status_code == 400
    # nic nie cofnięte — zlecenie nadal done
    assert query_one("SELECT status FROM mixing_orders WHERE id=%s", ("ou2",))["status"] == "done"


def test_undo_rejects_non_done(db):
    _seed_order("ou3", "r-gold2", "Gold2", meat_kg=200)
    execute("UPDATE mixing_orders SET status='confirmed' WHERE id=%s", ("ou3",))
    with pytest.raises(HTTPException) as ei:
        undo_mixing_confirmation("ou3")
    assert ei.value.status_code == 400
```

- [ ] **Step 2: Uruchom testy — FAIL (funkcja nie istnieje)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_mixing_undo_db.py -q`
Expected: FAIL — `ImportError: cannot import name 'undo_mixing_confirmation'`.

- [ ] **Step 3: Zaimplementuj `undo_mixing_confirmation`**

W `backend/app/services/mixing_service.py`, PO funkcji `cancel_mixing_order` (kończy się `return build_mixing_order(row)` ok. linii 1130), dodaj:

```python
def undo_mixing_confirmation(order_id: str) -> Dict:
    """Cofnij potwierdzenie (finish) zlecenia 'done' — czysto, jakby nie
    potwierdzono. Dozwolone TYLKO gdy każda partia przyprawionego z tego
    zlecenia jest niezużyta (kg_used=0). Odwraca w jednej transakcji ślad
    finish_mixing_session: seasoned_meat, meat_stock, ingredient_stock,
    stock_movements, mixing_sessions, status zlecenia + rezerwacje lotów.
    Kwoty bierzemy ze stock_movements zlecenia (odporne na zaokrąglenia).
    """
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zlecenie nie znalezione")
        if order.get("status") != "done":
            raise HTTPException(
                400, "Cofnięcie dotyczy tylko potwierdzonych (gotowych) zleceń."
            )

        # Partie przyprawionego zlecenia (seasoned IN: batch_id = seasoned_meat.id)
        seasoned = cx_query_all(
            conn,
            "SELECT batch_id AS sm_id, SUM(qty) AS kg FROM stock_movements "
            "WHERE source_type='mixing' AND product_type='seasoned' AND source_id=%s "
            "GROUP BY batch_id",
            (order_id,),
        )
        # Guard + blokada wierszy: żadna partia nie może być częściowo zużyta.
        for s in sorted(seasoned, key=lambda r: r.get("sm_id") or ""):
            if not s.get("sm_id"):
                continue
            sm = cx_query_one(
                conn,
                "SELECT batch_no, kg_used FROM seasoned_meat WHERE id=%s FOR UPDATE",
                (s["sm_id"],),
            )
            if sm and float(sm.get("kg_used") or 0) > 0.001:
                raise HTTPException(
                    400,
                    f"Nie można cofnąć — partia {sm.get('batch_no')} jest już "
                    f"częściowo zużyta w produkcji ({float(sm['kg_used']):.2f} kg).",
                )

        # Odejmij wkład zlecenia od partii przyprawionego; usuń gdy zejdzie do zera.
        for s in seasoned:
            if not s.get("sm_id"):
                continue
            kg = float(s.get("kg") or 0)
            cx_execute(
                conn,
                "UPDATE seasoned_meat SET kg_produced = kg_produced - %s, "
                "kg_available = kg_available - %s WHERE id=%s",
                (kg, kg, s["sm_id"]),
            )
            cx_execute(
                conn,
                "DELETE FROM seasoned_meat WHERE id=%s AND kg_produced <= 0.001",
                (s["sm_id"],),
            )

        # Przywróć mięso (meat OUT: qty ujemne). Lock rows deterministycznie.
        meat = cx_query_all(
            conn,
            "SELECT batch_id, SUM(qty) AS qty FROM stock_movements "
            "WHERE source_type='mixing' AND product_type='meat' AND source_id=%s "
            "GROUP BY batch_id",
            (order_id,),
        )
        for m in sorted(meat, key=lambda r: r.get("batch_id") or ""):
            if m.get("batch_id"):
                cx_query_one(
                    conn, "SELECT id FROM meat_stock WHERE id=%s FOR UPDATE",
                    (m["batch_id"],),
                )
        for m in meat:
            x = -float(m.get("qty") or 0)  # OUT ujemne → x dodatnie
            if x <= 0 or not m.get("batch_id"):
                continue
            cx_execute(
                conn,
                "UPDATE meat_stock SET kg_reserved = kg_reserved + %s, "
                "kg_available = kg_available + %s, "
                "kg_used = GREATEST(0, kg_used - %s) WHERE id=%s",
                (x, x, x, m["batch_id"]),
            )

        # Przywróć przyprawy (ingredient OUT: qty ujemne).
        ingr = cx_query_all(
            conn,
            "SELECT batch_id, SUM(qty) AS qty FROM stock_movements "
            "WHERE source_type='mixing' AND product_type='ingredient' AND source_id=%s "
            "GROUP BY batch_id",
            (order_id,),
        )
        for g in ingr:
            x = -float(g.get("qty") or 0)
            if x <= 0 or not g.get("batch_id"):
                continue
            cx_execute(
                conn,
                "UPDATE ingredient_stock SET qty_available = qty_available + %s WHERE id=%s",
                (x, g["batch_id"]),
            )

        # Usuń ślad ruchów i sesji tego zlecenia.
        cx_execute(
            conn,
            "DELETE FROM stock_movements WHERE source_type='mixing' AND source_id=%s",
            (order_id,),
        )
        cx_execute(conn, "DELETE FROM mixing_sessions WHERE order_id=%s", (order_id,))

        # Rezerwacje lotów wracają (kg_planned z kg_actual).
        cx_execute(
            conn,
            "UPDATE mixing_order_lots SET kg_planned = kg_actual, kg_actual = 0 "
            "WHERE order_id=%s",
            (order_id,),
        )

        # Zlecenie wraca do kolejki (jak przed potwierdzeniem).
        updated = cx_execute_returning(
            conn,
            "UPDATE mixing_orders SET status='confirmed', kg_done=0, completed_at=NULL, "
            "kg_in_machine=0, source_seasoned_batch_ids='{}' WHERE id=%s RETURNING *",
            (order_id,),
        )
    logger.info("mixing.order.undo_confirm", extra={"order_id": order_id})
    return build_mixing_order(updated)
```

- [ ] **Step 4: Dodaj endpoint**

W `backend/app/routes/mixing.py`, po bloku `cancel_mixing_order` (linie 77-79), dodaj:

```python
@router.patch("/{order_id}/undo-confirm")
def undo_mixing_confirmation(order_id: str):
    return svc.undo_mixing_confirmation(order_id)
```

- [ ] **Step 5: Uruchom testy — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_mixing_undo_db.py -q`
Expected: PASS (3 testy).

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/mixing_service.py backend/app/routes/mixing.py backend/tests/test_mixing_undo_db.py
git commit -m "feat: undo_mixing_confirmation — bezpieczne cofnięcie potwierdzenia masowania (guard kg_used=0)"
```

---

## Task 2: Frontend — API + przycisk „Cofnij" + handler

**Files:**
- Modify: `src/lib/api.ts` (dodać `undoConfirm` do `mixingOrdersApi`, ok. linii 1984 po `finishSession`)
- Modify: `src/features/products/components/PlanRow.tsx`
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx`

**Interfaces:**
- Consumes z Task 1: endpoint `PATCH /mixing-orders/{id}/undo-confirm`.
- Produces: `mixingOrdersApi.undoConfirm(id: string)`; prop `PlanRow.onUndoConfirm: () => void`.

- [ ] **Step 1: Dodaj `undoConfirm` w api.ts**

W `src/lib/api.ts`, w obiekcie `mixingOrdersApi`, zaraz po metodzie `finishSession` (kończy się `.then(mapMixingOrder),`) dodaj:

```ts
  undoConfirm: (id: string) =>
    patch<any>(`/mixing-orders/${id}/undo-confirm`, {}).then(mapMixingOrder),
```

- [ ] **Step 2: Dodaj import ikony i prop w PlanRow**

W `src/features/products/components/PlanRow.tsx` zmień import lucide (linie 16-17):

```tsx
  AlertTriangle, CheckCheck, Loader2, RotateCcw,
} from 'lucide-react'
```

W definicji propsów, po `onConfirmExecution: () => void` (linia 62) dodaj:

```tsx
  onUndoConfirm: () => void
```

I w destrukturyzacji propsów (linia 46, po `onConfirmExecution,`) dodaj `onUndoConfirm,`:

```tsx
  onConfirmExecution, onUndoConfirm, confirmingExecution, canConfirmExecution, showConfirmExecution,
```

- [ ] **Step 3: Dodaj przycisk „Cofnij" dla wierszy done**

W `src/features/products/components/PlanRow.tsx`, w `<span className="flex flex-col items-start gap-1">` (po bloku przycisku „Potwierdź", tuż przed zamknięciem `</span>` na linii ~184), dodaj:

```tsx
          {row.status === 'done' && showConfirmExecution && (
            <button
              onClick={onUndoConfirm}
              disabled={confirmingExecution}
              title="Cofnij potwierdzenie — usuwa partię przyprawionego, przywraca mięso i przyprawy; działa tylko gdy nic nie zużyto na produkcji"
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
                'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
                confirmingExecution && 'opacity-60 cursor-wait',
              )}>
              {confirmingExecution
                ? <Loader2 size={10} className="animate-spin" />
                : <RotateCcw size={10} />}
              Cofnij
            </button>
          )}
```

- [ ] **Step 4: Handler + przekazanie propa w MixingDayPlanEditor**

W `src/features/products/components/MixingDayPlanEditor.tsx`, po funkcji `runSplitConfirm` (dodanej wcześniej) dodaj handler:

```ts
  async function undoConfirmExecution(row: PlanRowData) {
    if (!row.id || !isToday) return
    if (!window.confirm(
      `Cofnąć potwierdzenie: ${recipes.find((r: any) => r.id === row.recipeId)?.name ?? ''}?\n\nUsunie partię przyprawionego, przywróci mięso i przyprawy, zlecenie wróci do kolejki. Działa tylko gdy nic nie zużyto na produkcji.`
    )) return
    setConfirmingKey(row.rowKey)
    try {
      await mixingOrdersApi.undoConfirm(row.id)
      await load()
      toast.success('Cofnięto potwierdzenie — zlecenie wróciło do kolejki')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie można cofnąć potwierdzenia')
    } finally {
      setConfirmingKey(null)
    }
  }
```

W renderze `<PlanRow ...>` (ok. linii 403), po `onConfirmExecution={() => confirmExecution(r)}` dodaj:

```tsx
                onUndoConfirm={() => undoConfirmExecution(r)}
```

- [ ] **Step 5: Typecheck + testy frontendu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck && TZ=UTC npm test 2>&1 | tail -4`
Expected: typecheck bez błędów; testy 105/105 (bez zmian w testach frontendu).

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/api.ts src/features/products/components/PlanRow.tsx src/features/products/components/MixingDayPlanEditor.tsx
git commit -m "feat: przycisk 'Cofnij potwierdzenie' na wierszach gotowych planu masowania"
```

---

## Task 3: Deploy (backend + frontend) + weryfikacja na żywo = cofnięcie dzisiejszych 3 zleceń

**Files:** brak zmian — deploy + weryfikacja.

REGUŁA pre-deploy: to nowy kod z repo (nic prod-only). Backend zmiana → deploy backend (restart) + frontend.

- [ ] **Step 1: Deploy backend + frontend**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
bash deploy/deploy.sh all
```
Expected: `✓ backend OK — health true` oraz `✓ frontend OK — serwowany: main-…js`.

- [ ] **Step 2: Zweryfikuj stan sprzed cofnięcia (read-only, MCP kebab-mes-db)**

```sql
SELECT recipe_name, status FROM mixing_orders WHERE plan_date='2026-07-12' AND status<>'cancelled' ORDER BY day_seq;
```
Expected: PRÓBKA/BEYAZ/BULLI = `done`, KIRMIZI = `confirmed`.

- [ ] **Step 3: Cofnij dzisiejsze 3 zlecenia przez UI (prawdziwa ścieżka)**

Dev proxy→prod (`sed` target 8010) + `npm run dev -- --port 5183` w tle; Playwright login (`am`/hasło od użytkownika jeśli trzeba); `http://localhost:5183/office/planowanie-masowania`. Dla każdego z 3 wierszy „gotowe" (PRÓBKA, BEYAZ HALAL, BULLI) kliknij **„Cofnij"** i potwierdź `window.confirm` (`browser_handle_dialog accept`). Po każdym — wiersz wraca do „W kolejce".

Alternatywnie (jeśli UI-flow zawiedzie) — wywołaj endpoint z zalogowanej strony:
`await fetch('/api/mixing-orders/'+ID+'/undo-confirm',{method:'PATCH',headers:{Authorization:'Bearer '+localStorage.getItem('kebab.token')}})` dla ID: `e826e30ab0784756bf37` (PRÓBKA), `1b5f36c3cd9a45f18628` (BEYAZ), `72fa8a4209884b059aeb` (BULLI).

- [ ] **Step 4: Zweryfikuj w bazie (MCP) pełne cofnięcie**

```sql
SELECT lot_no, kg_available, kg_reserved, kg_used FROM meat_stock WHERE lot_no IN ('408','409','410') ORDER BY lot_no;
```
Expected: 408 available 854 / reserved 854 / used 0; 409 available 2641 / reserved 2626 / used 0; 410 available 1920 / reserved 1920 / used 0.

```sql
SELECT batch_no FROM seasoned_meat WHERE production_day='2026-07-12';
```
Expected: brak wierszy 408/PP1/410 (usunięte).

```sql
SELECT recipe_name, status FROM mixing_orders WHERE plan_date='2026-07-12' AND status<>'cancelled' ORDER BY day_seq;
```
Expected: wszystkie 4 = `confirmed` (w kolejce).

- [ ] **Step 5: Sprzątanie**

```bash
pkill -f "vite --port 5183"; cd /opt/kebab/kebab_new/kebab_fixed && git checkout -- vite.config.ts; rm -f vite.config.ts.timestamp-*.mjs
```
`browser_close`. Jeśli Step 4 pokaże rozjazd → nie kontynuuj, zgłoś użytkownikowi (dane produkcyjne).
