# Potwierdzanie masowania z podziałem na partie źródłowe (bez HMI)

## Problem

Na masownicy nie ma HMI — biuro potwierdza wykonanie zlecenia przyciskiem „Potwierdź"
(`MixingDayPlanEditor.confirmExecution`). Obecnie wywołuje ono **jedno**
`finishSession(id, kg, '', [])` dla całego zlecenia z **pustymi** alokacjami partii.
Backend przy pustych alokacjach rozdziela mięso proporcjonalnie po **wszystkich** partiach
zlecenia → sesja obejmuje >1 partię surowca → numer partii = wspólny „PP" (mieszany).

Skutek: zlecenie z 2 partii (np. BEYAZ HALAL: 408=854 kg + 409=1346 kg) daje jedną partię
przyprawionego „PP1" mieszającą oba loty — mimo że operator fizycznie masuje głównie czyste
partie i miesza tylko resztki w ostatnim wsadzie. Traci się traceability i mnożą się „PP".

Operator (maszyny 1×600 + 2×200 kg, elastyczne ±20-40 kg) robi pełne wsady czystej 408,
potem czystej 409, a niewypełnione resztki obu partii łączy w JEDEN ostatni wsad. Chce, żeby
system to odzwierciedlał: czyste partie po numerach surowca + jedna mała partia mieszana
z jawnym składem.

## Kluczowe ustalenie (dlaczego to głównie frontend)

`finish_mixing_session` (backend, `mixing_service.py:647`) **już**:
- akumuluje `kg_done` i domyka zlecenie (`status='done'`) dopiero gdy suma sesji osiągnie
  `meat_kg` — więc można je wywołać **wiele razy** na jedno zlecenie;
- liczy numer partii z lotów **tej** sesji (`lot_allocations`): 1 partia → czysty numer
  (`internal_batch_seq` surowca), ≥2 partie → `combined_batch_no` („PP…").

Komentarz w kodzie (`mixing_service.py:682-686`) wprost opisuje ten scenariusz. Backend NIE
wymaga zmian. Brakuje tylko UI, które rozbije potwierdzenie na wiele sesji z właściwymi
alokacjami.

## Rozwiązanie

### Przepływ potwierdzenia (zlecenie z ≥2 partiami surowca)

1. Klik „Potwierdź" na wierszu planu → otwiera **dialog podziału** (zamiast `window.confirm`).
2. Dialog pobiera partie zlecenia z `row.lots` (`meatLotId`, `kgPlanned`, `lotNo`) i pokazuje
   **proponowany podział**:
   - **partia mieszana** = suma resztek `kgPlanned mod 200` po każdej partii;
   - **partie czyste** = `kgPlanned − resztka` per partia.
   Przykład 408=854, 409=1346: resztki 54 + 146 = mieszana **200 kg** (54@408 + 146@409),
   czyste 408:800, 409:1200.
3. Pole składu **partii mieszanej edytowalne** per partia (biuro wpisuje realne kg z kartki
   operatora, np. 54/154). Partie czyste przeliczają się automatycznie
   (`czysta_i = kgPlanned_i − mieszana_i`).
4. Walidacja (blokuje zapis, gdy niespełniona):
   - dla każdej partii `mieszana_i ≥ 0` oraz `mieszana_i ≤ kgPlanned_i`;
   - suma wszystkich kg (czyste + mieszana) = `meat_kg` zlecenia (tolerancja 0,5 kg);
   - partia mieszana ma ≥2 partie z kg>0 (inaczej to nie jest „mieszana" — patrz Edge cases).
   - miękkie **ostrzeżenie** (nie blokuje), gdy suma mieszanej > 640 kg (największa masownica
     + zapas) — sygnał, że to raczej >1 wsad.
5. Na zatwierdzenie — sekwencja `finishSession` (po kolei, await), kolejność: najpierw czyste,
   mieszana **ostatnia** (domyka zlecenie):
   - dla każdej partii i z `czysta_i > 0`:
     `finishSession(id, czysta_i, '', [{ meatLotId: i, kg: czysta_i }])`
   - jeśli `Σ mieszana > 0`:
     `finishSession(id, Σmieszana, '', [{ meatLotId: 408, kg: m408 }, { meatLotId: 409, kg: m409 }])`
   - po sekwencji: `load()` + toast.
6. Backend nada: czystym sesjom numer partii surowca (408, 409), mieszanej — „PP…".

### Zlecenie z 1 partią surowca

Bez zmian: jedno `finishSession(id, kg, '', [{ meatLotId, kg }])` (lub bez alokacji jak dziś) →
jedna czysta partia. Dialog podziału **nie pokazuje się** (albo pokazuje trywialny 1-wierszowy
podgląd). Decyzja: dla 1 partii pomijamy dialog i potwierdzamy jak dotąd (mniej klikania).

### 3+ partii surowca

Ta sama zasada: czyste per partia + jedna mieszana z resztek (`Σ mod 200`). UI listuje wszystkie
partie; skład mieszanej edytowalny per partia. Bez limitu 2.

### Edge cases

- **Mieszana = 0** (operator zrobił wsady częściowe, zero mieszania): dozwolone — wtedy tylko
  czyste partie, każda `finishSession` osobno; brak „PP". Walidacja „≥2 partie w mieszanej"
  dotyczy tylko sytuacji gdy `Σmieszana > 0`.
- **Tylko jedna partia ma resztkę** (`Σmieszana>0` ale z jednej partii): to nie jest mieszanka —
  ta resztka zostaje w partii czystej tej partii (mieszanej nie tworzymy). Praktycznie: mieszana
  powstaje tylko gdy ≥2 partie mają `mieszana_i > 0`.
- **Błąd w połowie sekwencji** (np. druga `finishSession` padnie): część sesji już zapisana,
  `kg_done` częściowe, zlecenie zostaje `in_progress`. Dialog pokazuje błąd i informuje, że
  zlecenie jest częściowo potwierdzone — biuro może dokończyć ręcznie. NIE ma automatycznego
  rollbacku między sesjami (każda sesja to osobna transakcja backendu). To akceptowalne:
  stan jest spójny (mięso zużyte tyle ile sesji przeszło), a operacja jest wznawialna.

## Zakres / pliki

- `src/features/products/components/MixingDayPlanEditor.tsx` — `confirmExecution`: dla ≥2 partii
  otwiera dialog; sekwencja `finishSession`.
- **Nowy** `src/features/products/components/ConfirmMixingSplitDialog.tsx` — dialog podziału
  (props: partie zlecenia + `meatKg` + `onConfirm(batches)`), logika propozycji `mod 200`,
  edycja składu mieszanej, walidacja.
- **Nowy** `src/features/products/lib/mixingSplit.ts` — czysta funkcja
  `proposeMixingSplit(lots, meatKg)` + `validateMixingSplit(...)` (testowalne bez UI, wzór jak
  `autoFefo.ts`).
- Backend — **bez zmian**.

### Interfejs czystej logiki (`mixingSplit.ts`)

```ts
export interface SplitLotInput { meatLotId: string; lotNo: string; kgPlanned: number }
export interface MixingSplit {
  pure: { meatLotId: string; lotNo: string; kg: number }[]   // czyste partie (kg>0)
  mixed: { meatLotId: string; lotNo: string; kg: number }[]  // skład mieszanej ([] gdy brak)
}
export function proposeMixingSplit(lots: SplitLotInput[]): MixingSplit
// domyślnie: mixed_i = kgPlanned_i mod 200 (0 gdy wynik 0); pure_i = kgPlanned_i − mixed_i.
// mixed tylko gdy ≥2 partie z mixed_i>0; inaczej resztka zostaje w pure.

export interface SplitValidation { ok: boolean; error?: string; warning?: string }
export function validateMixingSplit(split: MixingSplit, lots: SplitLotInput[], meatKg: number): SplitValidation
```

## Testy

Vitest dla `mixingSplit.ts` (jak `fefo.test.ts`):
- 2 partie 854/1346 → mixed 54@408 + 146@409 (=200), pure 800/1200.
- partie podzielne przez 200 (np. 800/1200) → mixed [] (brak PP), pure 800/1200.
- 1 partia → pure=[cała], mixed=[].
- resztka tylko z jednej partii (np. 854 + 1200) → mixed [] (54 zostaje w pure 408), pure 854/1200.
- 3 partie z resztkami → mixed z 3 składników.
- walidacja: suma ≠ meatKg → error; mixed_i > kgPlanned_i → error; Σmixed>640 → warning.

## Ryzyka / kompromisy

- Domyślny `mod 200` to tylko podpowiedź — przy elastycznych maszynach realny podział ustala
  operator, biuro koryguje. Świadome (użytkownik wybrał hybrydę).
- Brak atomowości między sesjami (patrz Edge cases) — akceptowalne, bo stan pozostaje spójny
  i operacja jest wznawialna; pełna atomowość wymagałaby zmiany backendu (poza zakresem).
