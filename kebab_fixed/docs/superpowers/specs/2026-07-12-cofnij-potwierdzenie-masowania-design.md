# Cofnij potwierdzenie masowania (safe undo)

## Problem

Masownia bez HMI: biuro potwierdza wykonanie (`finish_mixing_session`) → powstaje partia
przyprawionego (`seasoned_meat`), zużyte mięso (`meat_stock`), zejście przypraw
(`ingredient_stock` FIFO), `stock_movements` + `mixing_sessions`, zlecenie → `done` + lineage.
W ciągu dnia na masowni jest dużo zmian, a potwierdzenie bywa przedwczesne/błędne. Nie ma
sposobu cofnięcia — `cancel_mixing_order` odmawia zleceń w statusie `done`. Trzeba bezpiecznego
undo, działającego TYLKO gdy nic z partii nie poszło jeszcze na produkcję.

## Rozwiązanie

### Backend — `undo_mixing_confirmation(order_id)` + `PATCH /mixing-orders/{id}/undo-confirm`

Jedna transakcja z `FOR UPDATE` (wzór: `finish_mixing_session`, `cancel_mixing_order`).
Odwraca dokładnie to, co zrobiło potwierdzenie, w kolejności:

1. **Guard**:
   - zlecenie istnieje i ma `status='done'` — inaczej `HTTPException(400, "Cofnięcie dotyczy tylko potwierdzonych (gotowych) zleceń.")`;
   - każda partia `seasoned_meat` wyprodukowana przez to zlecenie ma `kg_used <= 0.001` — inaczej
     `HTTPException(400, "Nie można cofnąć — partia {batch_no} jest już częściowo zużyta w produkcji ({kg_used} kg).")`.
   - Partie zlecenia wyznaczane z jego sesji: `SELECT batch_no, kg_output FROM mixing_sessions WHERE order_id=%s`; wiersz `seasoned_meat` po `(recipe_id, batch_no, production_day)` zlecenia.
2. **Przyprawione** (odejmij wkład sesji — NIE kasuj cudzego przy współdzielonym batch_no):
   dla każdej sesji: `UPDATE seasoned_meat SET kg_produced = kg_produced - kg_output, kg_available = kg_available - kg_output WHERE recipe_id=? AND batch_no=? AND production_day=?`;
   po odjęciu: jeśli `kg_produced <= 0.001` → `DELETE` wiersza.
3. **Mięso** (z ruchów `meat OUT` tego zlecenia, per `batch_id`):
   `UPDATE meat_stock SET kg_reserved = kg_reserved + x, kg_available = kg_available + x, kg_used = GREATEST(0, kg_used - x)` (x = |qty| ruchu).
   `FOR UPDATE` na wszystkich dotykanych `meat_stock` (deterministyczna kolejność po id).
4. **Przyprawy** (z ruchów `ingredient OUT` tego zlecenia, per `batch_id`):
   `UPDATE ingredient_stock SET qty_available = qty_available + |qty| WHERE id=batch_id`.
5. **Usuń ślad**: `DELETE FROM stock_movements WHERE source_type='mixing' AND source_id=order_id`;
   `DELETE FROM mixing_sessions WHERE order_id=order_id`.
6. **Zlecenie**: `UPDATE mixing_orders SET status='confirmed', kg_done=0, source_seasoned_batch_ids='{}' WHERE id=order_id`;
   `UPDATE mixing_order_lots SET kg_planned = kg_actual, kg_actual = 0 WHERE order_id=order_id`
   (rezerwacja wraca — spójne z krokiem 3, gdzie kg_reserved podnosimy).
7. Zwróć `build_mixing_order(order)` (odświeżone zlecenie).

Router: `PATCH /mixing-orders/{id}/undo-confirm` → `undo_mixing_confirmation(id)`, RBAC jak inne
akcje masowania (ta sama zależność uprawnień co `finish-session`/`confirm`).

### Frontend

- `mixingOrdersApi.undoConfirm(id)` w `src/lib/api.ts` — `patch('/mixing-orders/{id}/undo-confirm', {})`.
- W `PlanRow.tsx`: dla wiersza `status='done'` pokaż przycisk **„Cofnij potwierdzenie"** (obok statusu),
  widoczny na tych samych zasadach co „Potwierdź" (tylko dzień dzisiejszy — nowy prop `showUndo`/reuse
  `showConfirmExecution`). Dla `in_progress` — brak (blokada).
- W `MixingDayPlanEditor.tsx`: handler `undoConfirmExecution(row)` → `window.confirm` z ostrzeżeniem
  („Cofnięcie usunie partię przyprawionego, przywróci mięso i przyprawy, zlecenie wróci do kolejki.")
  → `await mixingOrdersApi.undoConfirm(row.id)` → `await load()` + toast. Błąd guard (zużyte) →
  `toast.error(e.message)`.

### Weryfikacja (jednocześnie realizuje cofnięcie dzisiejszych 3 zleceń)

Repo testuje głównie frontend (vitest); backend weryfikowany na żywo. Po wdrożeniu: cofnij dziś
PRÓBKA (→408), BEYAZ (→PP1), BULLI (→410) — wszystkie `kg_used=0`. Sprawdź w bazie:
- `meat_stock`: 408 reserved 854 / used 0; 409 reserved 2626 / used 0; 410 reserved 1920 / used 0
  (available: 408→854, 409→2641, 410→1920).
- `seasoned_meat`: wiersze 408/PP1/410 z production_day=2026-07-12 usunięte.
- `ingredient_stock`: +157,2 kg łącznie wróciło (8 partii składników).
- `mixing_orders`: 3 zlecenia `status='confirmed'`, kg_done=0; `mixing_order_lots` kg_planned przywrócone.
- brak `stock_movements`/`mixing_sessions` dla tych zleceń.

## Edge cases

- **Współdzielony batch_no**: krok 2 odejmuje tylko kg_output sesji tego zlecenia; wiersz kasowany
  tylko gdy zejdzie do zera. Guard kg_used dotyczy całego wiersza (jeśli współdzielony i zużyty → blokada całości).
- **Partia częściowo zużyta** (kg_used>0): blokada (guard). Świadomie poza zakresem (odtwarzanie
  stanów cząstkowych zbyt ryzykowne).
- **Zlecenie in_progress** (sesja na tablecie w toku): brak przycisku / guard odrzuca (status≠done).
- **Podwójne cofnięcie / wyścig**: `FOR UPDATE` na zleceniu; drugie wywołanie zobaczy status≠done → 400.

## Zakres / pliki

- `backend/app/services/mixing_service.py` — `undo_mixing_confirmation()`.
- `backend/app/routers/` (router masowania) — endpoint `undo-confirm`.
- `src/lib/api.ts` — `undoConfirm`.
- `src/features/products/components/PlanRow.tsx` — przycisk na wierszu done.
- `src/features/products/components/MixingDayPlanEditor.tsx` — handler.

## Ryzyka

- Operacja na produkcyjnej bazie, wiele tabel — dlatego jedna transakcja + guard kg_used=0 + `FOR UPDATE`.
- Kwoty do przywrócenia bierzemy z `stock_movements` (źródło prawdy tego, co faktycznie zeszło),
  nie z przeliczeń — odporne na zaokrąglenia.
