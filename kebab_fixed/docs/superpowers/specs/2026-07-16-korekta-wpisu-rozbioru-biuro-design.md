# Korekta wpisu rozbioru z biura (pracownik + kg)

Data: 2026-07-16
Status: zaakceptowany (wariant B)

## Problem

Operator myli się przy zapisie na HMI, szczególnie na etapie uczenia się systemu.
Realne przypadki z produkcji:

- 15.07 — pobranie zapisane Adrianowi zamiast Raschadowi (zły **pracownik**).
- 14.07 — za dużo kg Evgheniemu, za mało innemu pracownikowi (złe **kg**).

Biuro nie ma dziś jak tego naprawić:

1. **Brak UI** — w feedzie `DeboningReportsPage` jest wyłącznie „Zmień partię wpisu".
2. **Brak pola pracownika** — `DeboningEntryUpdate` zna tylko kg; zmiany pracownika
   nie da się wyrazić w żadnym endpoincie.
3. **BLOKADA (najważniejsze)** — każda ścieżka korekty (`update_deboning_entry`,
   `change_deboning_entry_batch`, `delete_deboning_entry`) woła
   `validate_session_writable`, które dla zmiany `approved` zwraca „Sesja
   zatwierdzona — dane zablokowane". Zmiany są zatwierdzane codziennie, więc
   **wszystkie wpisy starsze niż dziś są zablokowane**:

   | Dzień | Status sesji | Wpisy |
   |---|---|---|
   | 16.07 (dziś) | `open` | 14 |
   | 15.07 (Adrian/Raschad) | `approved` | 34 |
   | 14.07 (Evgheni) | `approved` | 31 |

   Samo dorobienie przycisku nic nie da — blokada jest w logice.

## Decyzje właściciela

1. **Biuro może poprawiać zatwierdzone zmiany, ale MUSI podać powód.** Powód idzie
   do audytu. Blokada zostaje dla HMI — operator nadal nie dopisze do zamkniętej zmiany.
2. **Zakres: pracownik + kg ćwiartki + kg mięsa.** Partia ma osobny przycisk.
   Grzbiety/kości per wpis pomijamy — uboczne waży się zbiorczo na partię
   (patrz `batch_byproducts`), a raport i tak ignoruje per-wpisowe wartości dla
   partii zważonych zbiorczo.
3. **Wariant B: historia korekt widoczna w biurze.** Sam powód w logu serwera
   byłby teatrem — skoro go wymagamy, ma być do przeczytania przy wpisie.

## Rozwiązanie

### Model danych

Nowa tabela (migracja idempotentna w `_DDL`, wzorzec jak reszta `app/migrations.py`):

```sql
CREATE TABLE IF NOT EXISTS deboning_entry_corrections (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_subject  TEXT,              -- kto poprawił (request.state.subject)
  reason      TEXT NOT NULL,     -- wymagany powód
  changes     JSONB NOT NULL     -- {"worker":{"from":"Adrian","to":"Raschad"}, ...}
);
CREATE INDEX IF NOT EXISTS idx_dec_entry ON deboning_entry_corrections(entry_id);
```

`changes` jako JSONB (nie kolumny per pole), bo zakres korekty może rosnąć, a to
czysty zapis audytowy — nikt po nim nie filtruje ani nie liczy.

### Backend

`POST /api/deboning/entries/{entry_id}/correct`

- Body: `workerId?`, `kgQuarter?`, `kgMeat?`, `reason` (wymagany, po `strip()` ≥ 3 znaki).
- **NIE woła `validate_session_writable`** — to jest cel tego endpointu.
- Wszystko w JEDNEJ transakcji (`with transaction() as conn`).
- Korekta stanów — reużywa reguł z `update_deboning_entry`:
  - `delta_taken` → `raw_batches.kg_available` (zwrot/pobranie różnicy),
  - `delta_meat` → `meat_stock` (`kg_initial` + `kg_available`, lot `lot_no = raw_batch_no`),
  - `validate_edit_deltas` chroni przed zejściem stanu poniżej zera
    (np. mięso już zużyte w masowaniu → czytelny 400, nie cichy rozjazd).
- Zmiana pracownika: `worker_id` + `worker_name` z tabeli `workers`; nieznany id → 400.
- Przelicza `yield_pct` i `kg_remainder` (jak `update_deboning_entry`).
- Zapisuje wiersz do `deboning_entry_corrections` z powodem i diffem PRZED/PO.
- Brak jakiejkolwiek zmiany → 400 (nie zaśmiecamy historii pustymi wpisami).
- `kg_meat > kg_quarter` → 400 (ta sama reguła co wszędzie).

`GET /api/deboning/entries/{entry_id}/corrections` → lista historii (do UI).

**Dlaczego osobny endpoint, a nie rozszerzenie `PATCH /entries/{id}`:** tego PATCH
używa **HMI** (ręczne „Zakończenie partii" woła `editEntry`). Wpuszczenie do niego
omijania blokady sesji groziłoby tym, że kiosk przypadkiem nadpisze zatwierdzone
dane. Osobny endpoint jest też spójny z istniejącym `change-batch`.

### RBAC — krytyczne

`DEPARTMENT_PREFIXES` mapuje `"rozbior": ("/api/deboning",)`, a `<slug>` znaczy
**„operator działu LUB biuro"** — więc sam osobny endpoint NIE wystarczy:
operator kiosku mógłby go wywołać i ominąć blokadę. Potrzebny jawny wyjątek
w `permission_for_path`, wzorowany na istniejącym `cart-tares`, umieszczony
**przed** pętlą po `DEPARTMENT_PREFIXES`:

```python
# Korekta wpisu z biura omija blokadę zatwierdzonej zmiany, więc WYŁĄCZNIE
# biuro — operator hali nie może przepisywać zatwierdzonych danych ani
# cudzego akordu.
if path.startswith("/api/deboning/entries/") and path.endswith("/correct"):
    return "office"
```

`can_access`: `kind == "office"` → przechodzi; operator → `"office"` nie jest
w `DEPARTMENT_PREFIXES` → 403.

### Front — biuro

`DeboningReportsPage`, feed wpisów (tam, gdzie już jest „Zmień partię"):

- Przycisk **„Popraw"** przy wierszu.
- Modal:
  - Pracownik — select z `GET /api/workers`.
  - Ćwiartka [kg], Mięso [kg] — z podglądem przeliczonego uzysku %.
  - Powód — pole wymagane; zapis zablokowany, dopóki puste.
  - Ostrzeżenie, gdy zmiana jest `approved`: „Poprawiasz zatwierdzoną zmianę —
    zmieni się akord i statystyki".
- Po zapisie refetch statystyk (`deboningApi.stats`).
- Historia korekt: znacznik przy poprawionym wpisie → rozwinięcie z listą
  (kto, kiedy, co na co, powód).

### Akord i statystyki — nic dodatkowego nie trzeba

Sprawdzone: robocizna liczy się z `workers.rate_per_kg × kg_quarter` per wpis,
a ranking grupuje po `worker_id`. Nie ma nigdzie zdenormalizowanej kopii
wynagrodzenia, którą trzeba by osobno prostować — **zmiana `worker_id` sama
naprawia akord i rankingi**.

## Testy (DB, `kebab_mes_test`)

1. Korekta pracownika przenosi akord (`laborCost`) na nowego pracownika i przepina
   wpis w rankingu.
2. Korekta kg ćwiartki zwraca/pobiera różnicę z `raw_batches.kg_available`.
3. Korekta kg mięsa koryguje lot `meat_stock`.
4. **Korekta działa na sesji `approved`** — regresja na główny problem.
5. Brak powodu → 400; sam whitespace → 400.
6. Brak zmian → 400.
7. `kg_meat > kg_quarter` → 400.
8. Mięso zużyte w masowaniu → 400 z czytelnym komunikatem (nie ujemny stan).
9. Historia korekt zapisuje powód + diff PRZED/PO.
10. RBAC: operator działu `rozbior` → 403; biuro → 200 (`permission_for_path`
    zwraca `"office"` dla `/correct`).

## Świadomie poza zakresem

- Cofanie korekt — korektę korekty robi się kolejną korektą; osobny mechanizm
  cofania to drugi zestaw błędów do utrzymania (YAGNI).
- Edycja grzbietów/kości per wpis — uboczne są zbiorcze na partię.
- Przenoszenie kg między dwoma wpisami jednym ruchem — dwie korekty załatwiają
  sprawę; „transfer" wymagałby własnej walidacji i atomowości na dwóch wpisach.
