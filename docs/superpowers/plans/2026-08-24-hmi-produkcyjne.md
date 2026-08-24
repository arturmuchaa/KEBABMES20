# HMI produkcyjne — plan wdrożenia

> **Dla wykonawcy:** zadanie po zadaniu, każde kończy się zielonymi testami
> i commitem. Kroki mają checkboxy (`- [ ]`). **Nie zlecać podagentom** — w tym
> repo podagenty nie piszą do `src/` ani `backend/`.

**Cel:** panel produkcyjny na komputer hali — wygląd i obsługa jak HMI
rozbiorowe v10, zasady jak tablet produkcji, plus rozliczenie folii stretch.

**Architektura:** nowy kiosk Tauri z własnym kanałem aktualizacji. Logika
w czystych modułach `features/production-hmi/`, ekran jako cienka kompozycja.
Backend istniejący, poza dwoma brakami przy folii.

**Stos:** React 18 + TypeScript, Vite, Tauri 2, vitest (node + jsdom),
FastAPI + PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-08-24-hmi-produkcyjne-design.md`

## Ograniczenia globalne

- **Kolejność zadań nie jest dowolna.** Zaczynamy od kanału aktualizacji
  i ramy kiosku: dopóki ich nie ma, gotowy ekran nie ma jak trafić na
  stanowisko, a testowanie na hali jest niemożliwe.
- **Zasady tabletu bez zmian**: `updateLineProgress`, `tabletFinish`,
  `tabletReopen`, `office-confirm`. Nie dotykamy ich.
- **Pobranie folii zdejmuje stan OD RAZU** (decyzja właściciela).
  Zużycie dnia = pobrane − zwrócone.
- Komentarze po polsku, tłumaczą DLACZEGO.
- Testy: `npx vitest run <ścieżka>`, typy `npx tsc --noEmit -p tsconfig.json`,
  backend `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest`.
- Katalog roboczy: `/opt/kebab/kebab_new/kebab_fixed`.
- **Warunek poza kodem:** właściciel przypisuje pracowników do działu
  `produkcja`. Bez tego ekran logowania nie pokaże ani jednego kafla.

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `backend/app/routes/desktop_updates_produkcja.py` | kanał aktualizacji kiosku |
| `produkcja.html` + `src/produkcja.tsx` | wejście i rama (splash, PIN, bramka) |
| `src-tauri/tauri.produkcja.conf.json` | okno pełnoekranowe, identyfikator, updater |
| `.github/workflows/tauri-produkcja.yml` | build + publikacja instalatora |
| `src/features/production-hmi/planDiff.ts` | porównanie planów |
| `src/features/production-hmi/planProgress.ts` | sumy, postęp, stan pozycji |
| `src/features/production-hmi/filmUsage.ts` | rozliczenie folii |
| `src/features/production-hmi/components/PlanList.tsx` | lista pozycji |
| `src/features/production-hmi/components/LineCounter.tsx` | liczenie + rozliczenie |
| `src/features/production-hmi/components/PlanChangedBanner.tsx` | pasek zmiany |
| `src/features/production-hmi/components/MaterialsRail.tsx` | szyna folii |
| `src/pages/tablet/ProductionHmiPage.tsx` | kompozycja |

---

### Zadanie 1: Kanał aktualizacji kiosku

Bez niego instalator nie ma dokąd trafić, a stanowiska nie zaktualizują się
same. Kanały **nie są generyczne** — rozbiór ma własny moduł i produkcja też
musi mieć.

**Pliki:**
- Utwórz: `backend/app/routes/desktop_updates_produkcja.py` (wzorzec:
  `desktop_updates_rozbior_v10.py`, podmienione ścieżki i katalog)
- Zmień: `backend/app/main.py` — rejestracja routera

- [ ] **Krok 1:** skopiuj `desktop_updates_rozbior_v10.py`, zamień w ścieżkach
      `rozbior-v10` → `produkcja` i katalog przechowywania instalatorów.
- [ ] **Krok 2:** zarejestruj router w `main.py` obok pozostałych.
- [ ] **Krok 3:** sprawdź, że stary kanał dalej działa

Run: `TEST_DATABASE_URL=… python3 -m pytest tests/ -q`
Expected: bez regresji

- [ ] **Krok 4:** commit `feat(kiosk): kanal aktualizacji dla HMI produkcyjnego`

---

### Zadanie 2: Rama kiosku

**Pliki:**
- Utwórz: `produkcja.html`, `src/produkcja.tsx`,
  `src-tauri/tauri.produkcja.conf.json`, `.github/workflows/tauri-produkcja.yml`
- Zmień: `vite.config.ts`

**Interfejsy:**
- Produkuje: aplikację, która startuje splashem, prosi o PIN działu
  `produkcja` i renderuje `<ProductionHmiPage />` (na razie zaślepkę).

- [ ] **Krok 1:** `produkcja.html` na wzór `rozbior-v10.html` — ze skryptem
      sprzątającym service workera i statycznym splashem.
- [ ] **Krok 2:** `src/produkcja.tsx` — kopia ramy z `rozbior-v10.tsx`,
      `department=produkcja`, tytuł „Produkcja".
- [ ] **Krok 3:** `tauri.produkcja.conf.json` — `productName: "Produkcja HMI"`,
      `identifier: pl.kebabmes.produkcja`, okno pełnoekranowe, updater na
      `/api/desktop-updates/produkcja/latest.json`, wersja `1.0.0`.
- [ ] **Krok 4:** `vite.config.ts` — wpis w `rollupOptions.input` i stała
      `__PRODUKCJA_VERSION__` czytana z conf (jak dla v10).
- [ ] **Krok 5:** workflow `tauri-produkcja.yml` na wzór `tauri-rozbior-v10.yml`,
      tag `produkcja-*`.
- [ ] **Krok 6: wspólny wygląd, nie kopia.** Wyjmij z `DeboningHmiV10Page.tsx`
      obiekt `VARS` do `src/features/hmi-theme/vars.ts`, a `@font-face`
      z `DeboningHmiV10Page.css` do `src/features/hmi-theme/hmi-font.css`.
      Oba ekrany **importują to samo** — inaczej za pół roku rozjadą się kolory.
      Rozbiór po tej zmianie musi wyglądać identycznie: `npx vitest run src/` bez
      regresji i oględziny ekranu v10.
- [ ] **Krok 7:** font zostaje **lokalny** (`public/fonts/rozbior-v10/`), bez CDN —
      hala pracuje bez internetu.
- [ ] **Krok 8:** `npm run build` przechodzi, `npx tsc --noEmit` czysty.
- [ ] **Krok 9:** commit `feat(kiosk): rama HMI produkcyjnego na wspolnym motywie v10`

---

### Zadanie 3: Pusta lista operatorów mówi prawdę

Dziś przy pustej odpowiedzi ekran ponawia w nieskończoność i wygląda jak
zepsuty serwer. Dotyczy TAKŻE kiosku rozbioru.

**Pliki:**
- Zmień: `src/produkcja.tsx`, `src/rozbior-v10.tsx`

- [ ] **Krok 1:** rozdziel dwa przypadki — **błąd sieci** ponawiamy w kółko,
      **pusta lista z działającego backendu** po 5 próbach (10 s) pokazuje
      „Brak operatorów działu <dział> — ustaw dział w kartotece pracowników",
      nie przestając ponawiać w tle.
- [ ] **Krok 2:** `npx vitest run src/` — bez regresji.
- [ ] **Krok 3:** commit `fix(kiosk): pusta lista operatorow mowi, co jest nie tak`

---

### Zadanie 4: `planDiff` — co biuro zmieniło

**Pliki:** `src/features/production-hmi/planDiff.ts` + test

**Interfejsy:**
- Produkuje:
  - `interface PlanSnapshotLine { id: string; qty: number; kgPerUnit: number; recipeName: string; packagingName: string; clientName: string }`
  - `type PlanChange = { kind: 'added'|'removed'; line: PlanSnapshotLine } | { kind: 'qty'; line: PlanSnapshotLine; from: number; to: number } | { kind: 'field'; line: PlanSnapshotLine; pole: 'receptura'|'tuleja'|'klient'; from: string; to: string }`
  - `planDiff(poprzedni: PlanSnapshotLine[], biezacy: PlanSnapshotLine[]): PlanChange[]`
  - `opiszZmiane(z: PlanChange): string` — tekst na pasek

- [ ] **Krok 1: Test, który pada**

```ts
import { describe, it, expect } from 'vitest'
import { planDiff, opiszZmiane, type PlanSnapshotLine } from './planDiff'

const l = (over: Partial<PlanSnapshotLine> = {}): PlanSnapshotLine => ({
  id: 'l1', qty: 20, kgPerUnit: 35, recipeName: 'WROCŁAW',
  packagingName: 'Tuleja 120', clientName: 'Bulli', ...over,
})

describe('planDiff', () => {
  it('bez zmian nie zgłasza nic', () => {
    expect(planDiff([l()], [l()])).toEqual([])
  })

  it('nowa pozycja', () => {
    const z = planDiff([l()], [l(), l({ id: 'l2', recipeName: 'KIRMIZI', qty: 10, kgPerUnit: 40 })])
    expect(z).toHaveLength(1)
    expect(opiszZmiane(z[0])).toBe('doszła KIRMIZI 10×40 kg')
  })

  it('zdjęta pozycja', () => {
    const z = planDiff([l()], [])
    expect(opiszZmiane(z[0])).toBe('zdjęto WROCŁAW 20×35 kg')
  })

  it('zmieniona ilość', () => {
    const z = planDiff([l()], [l({ qty: 32 })])
    expect(opiszZmiane(z[0])).toBe('WROCŁAW 20 → 32 szt.')
  })

  it('zmieniona tuleja', () => {
    const z = planDiff([l()], [l({ packagingName: 'Tuleja 65' })])
    expect(opiszZmiane(z[0])).toBe('WROCŁAW — tuleja: Tuleja 120 → Tuleja 65')
  })

  it('zmieniony klient i receptura naraz to DWIE zmiany', () => {
    expect(planDiff([l()], [l({ clientName: 'Nowak', recipeName: 'BULLI' })])).toHaveLength(2)
  })

  it('kolejność pozycji NIE jest zmianą — plan wolno przestawić', () => {
    const a = l(), b = l({ id: 'l2', recipeName: 'BULLI' })
    expect(planDiff([a, b], [b, a])).toEqual([])
  })
})
```

- [ ] **Krok 2:** `npx vitest run src/features/production-hmi/planDiff.test.ts` → FAIL (brak modułu)
- [ ] **Krok 3:** implementacja — porównanie **po `id`**, nie po pozycji w tablicy.
- [ ] **Krok 4:** zielone, 7 testów
- [ ] **Krok 5:** commit `feat(hmi-produkcja): porownanie planow`

---

### Zadanie 5: `planProgress` — sumy i stany

**Pliki:** `src/features/production-hmi/planProgress.ts` + test

**Interfejsy:**
- `planTotals(lines)` → `{ sztPlan, sztDone, kgPlan, kgDone, pct }`
- `lineState(line)` → `'PLANNED' | 'IN_PROGRESS' | 'DONE'`
- `byWorker(line)` → `{ workerName: string; pieces: number }[]`

- [ ] **Krok 1:** testy — sumy szt/kg, procent, pozycja bez postępu =
      `PLANNED`, częściowa = `IN_PROGRESS`, pełna = `DONE`, nadwyżka też
      `DONE` (hala zrobiła więcej, to nie błąd ekranu); rozbicie per pracownik
      sumuje wpisy tej samej osoby.
- [ ] **Krok 2:** czerwone → **Krok 3:** implementacja → **Krok 4:** zielone
- [ ] **Krok 5:** commit `feat(hmi-produkcja): sumy i stany pozycji`

---

### Zadanie 6: `shiftStats` i `breakState` — tempo i przerwy

Tempo mierzymy w **kilogramach na godzinę**, nie w sztukach: sztuka sztuce
nierówna, a tempo w sztukach karałoby za robienie dużych kebabów. Czas przerw
odchodzi od czasu pracy, inaczej trzy przerwy dziennie zaniżają wynik zmiany.

**Pliki:** `src/features/production-hmi/shiftStats.ts`,
`src/features/production-hmi/breakState.ts` + testy

**Interfejsy:**
- `interface Entry { worker: string; pieces: number; kgPerPiece: number; at: string }`
- `interface Pause { from: string; to: string | null }`
- `workedMs(from, now, pauses)` → milisekundy pracy **bez przerw**
- `shiftStats(entries, { from, now, pauses })` →
  `{ perWorker: { worker, kg, pieces, kgPerHour, split: { kgPerPiece, pieces }[] }[], total }`
- `breakStarted(now)` / `breakEnded(state, now)` / `canSave(state)` → `boolean`
- `pausedMs(state)` → suma przerw dnia

- [ ] **Krok 1: Testy, które padają**
      — `workedMs`: godzina zegarowa minus 20 min przerwy = 40 min pracy;
        **trwająca przerwa** (`to: null`) też się liczy, do „teraz";
      — `shiftStats`: kg = suma `pieces × kgPerPiece`; `kgPerHour` z czasu
        pracy, nie zegarowego; `split` grupuje po wadze sztuki
        (`5 × 40 kg`, `10 × 20 kg`) i sumuje powtórzenia tej samej wagi;
        zero czasu pracy → tempo `0`, **nie `Infinity`/`NaN`**;
      — `breakState`: `canSave` **fałsz w trakcie przerwy**, prawda po
        wyłączeniu; przerwa wyłączona dwa razy nie dubluje sumy.
- [ ] **Krok 2:** `npx vitest run src/features/production-hmi/` → FAIL (brak modułów)
- [ ] **Krok 3:** implementacja
- [ ] **Krok 4:** zielone + **sabotaż**: policz tempo z czasu zegarowego zamiast
      pracy — test tempa MUSI paść; zwróć `canSave: true` na sztywno — test
      blokady MUSI paść.
- [ ] **Krok 5:** commit `feat(hmi-produkcja): tempo w kg na godzine i przerwy`

---

### Zadanie 7: `filmUsage` — rozliczenie folii

**Pliki:** `src/features/production-hmi/filmUsage.ts` + test

**Interfejsy:**
- `interface FilmMove { at: string; qty: number; kind: 'pobranie'|'zwrot' }`
- `filmSummary(moves: FilmMove[])` → `{ pobrane, zwrocone, zuzyte }`
- `returnIssues(pobrane: number, zwrot: number): string[]`

- [ ] **Krok 1:** testy — pobranie 40 + dokładka 20 = 60 pobranych; zwrot 5 →
      zużyte 55; **zwrot większy niż pobranie odrzucony** z komunikatem;
      zwrot ujemny odrzucony; brak ruchów = zero, nie NaN.
- [ ] **Krok 2:** czerwone → **Krok 3:** implementacja → **Krok 4:** zielone
- [ ] **Krok 5:** commit `feat(hmi-produkcja): rozliczenie folii stretch`

---

### Zadanie 8: Backend folii — zwrot i zużycie per dzień

`packaging.kg_used` to licznik narastający i nie odpowie na pytanie „ile folii
poszło 25.08". Do kosztów potrzebny zapis per dzień, który przeżyje zamknięcie.

**Pliki:**
- Zmień: `backend/app/migrations.py` (tabela `production_day_materials`)
- Zmień: `backend/app/services/packaging_service.py` (zwrot)
- Zmień: `backend/app/routes/packaging.py` (`PATCH /{id}/return`)
- Utwórz: `backend/app/services/day_materials_service.py` + trasy
- Test: `backend/tests/test_day_materials_db.py`

- [ ] **Krok 1: Testy, które padają** — pobranie zdejmuje stan od razu; zwrot
      oddaje do `kg_available` i zdejmuje z `kg_used`; **zwrot większy niż
      pobrano odrzucony**; zużycie dnia = pobrane − zwrócone; zapis dnia
      przeżywa zamknięcie planu; dwa pobrania tego samego dnia sumują się.
- [ ] **Krok 2:** czerwone → **Krok 3:** implementacja → **Krok 4:** zielone
- [ ] **Krok 5:** pełny zestaw backendu bez regresji
- [ ] **Krok 6:** commit `feat(opakowania): zwrot na magazyn i zuzycie per dzien`

---

### Zadanie 9: Komponenty ekranu

**Pliki:** `PlanList.tsx`, `LineCounter.tsx`, `PlanChangedBanner.tsx`,
`MaterialsRail.tsx`, `BreakOverlay.tsx`, `ShiftStats.tsx` + testy jsdom

- [ ] **Krok 1: Testy, które padają** — kolumny w kolejności karty produkcji
      (`ILOŚĆ SZT. · WAGA · RODZAJ · TULEJE · KLIENT · RAZEM · POSTĘP`);
      pozycja gotowa wyróżniona; `−`/`+` nastawiają liczbę i **nigdzie nie ma
      pola do wpisywania z klawiatury**; pod liczbą stoi przelicznik na kg;
      zapis oddaje pracownika, pozycję i liczbę; rozbicie per pracownik;
      **pasek zmiany nie znika bez potwierdzenia**; szyna folii pokazuje log
      pobrań i sumę; **`BreakOverlay` zasłania ekran, a przycisk zapisu w
      trakcie przerwy nie woła zapisu**; `ShiftStats` pokazuje kolumny w
      kolejności `Kilogramy · Sztuki · Kg/godz.` i rozbicie `5 × 40 kg`.
- [ ] **Krok 2:** czerwone → **Krok 3:** implementacja na **wspólnym motywie**
      (`hmi-theme/vars.ts` + `hmi-font.css`), z geometrią v10: nagłówek 76 px na
      `--barBg`, przyciski `h-9 r-8` / `h-14 r-10`, karty `r-12`, modale `r-14`
      z kwadratem ikony 56 px, plakietki `r-6`, paski `--barBg` w klamrach
      `--accent` → **Krok 4:** zielone
- [ ] **Krok 5:** commit `feat(hmi-produkcja): lista planu, licznik, szyna materialow`

---

### Zadanie 10: Złożenie ekranu + stelaż okablowania

**Pliki:** `src/pages/tablet/ProductionHmiPage.tsx` + `productionHmiPage.test.tsx`

**Stelaż od pierwszego dnia** — nie zaślepiamy `useApi`, tylko moduły
sięgające na zewnątrz. Trzy awarie z 24.08 wyszły dokładnie z tej warstwy.

- [ ] **Krok 1: Testy okablowania, które padają** — podsumowanie dnia podaje
      liczby w kolejności **kilogramy → sztuki → tempo (kg/godz.)**; plan dnia wczytuje się SAM
      po zalogowaniu; `+1` wysyła właściwą pozycję i pracownika do
      `updateLineProgress`; zmiana planu w tle podnosi pasek; pobranie folii
      woła `use_packaging`; zakończenie dnia pyta o zwrot i dopiero potem
      woła `tabletFinish`.
- [ ] **Krok 2:** czerwone → **Krok 3:** kompozycja, odświeżanie przez
      `useLiveRefresh` → **Krok 4:** zielone
- [ ] **Krok 5:** `npx vitest run` + `npx tsc --noEmit` + `npm run build`
- [ ] **Krok 6:** commit `feat(hmi-produkcja): terminal produkcyjny`

---

### Zadanie 11: Wydanie

- [ ] **Krok 1:** założyć kartotekę folii stretch w opakowaniach (jednostka
      „rolka") — z biura, nie SQL-em.
- [ ] **Krok 2:** wdrożyć backend (migracja + trasy) i **sprawdzić DANYMI**,
      że tabela `production_day_materials` istnieje.
- [ ] **Krok 3:** tag `produkcja-1.0.0`, poczekać na build.
- [ ] **Krok 4:** potwierdzić kanał: `latest.json` podaje 1.0.0 z podpisem
      **i instalator realnie się pobiera** — zielony build to nie to samo.
- [ ] **Krok 5:** zainstalować na stanowisku, sprawdzić z operatorem pełny
      dzień: logowanie, liczenie, zmiana planu z biura, zwrot folii.

---

## Samosprawdzenie planu

**Pokrycie spec-a:** kanał (Zad. 1) · rama i start (Zad. 2) · pusta lista
operatorów (Zad. 3) · pasek zmiany planu (Zad. 4, 8, 9) · sumy i postęp
(Zad. 5, 8) · folia od strony ekranu (Zad. 6, 8) i backendu (Zad. 7) ·
liczenie z rozbiciem per pracownik (Zad. 5, 8, 9) · zakończenie dnia (Zad. 9).

**Spójność nazw:** `PlanSnapshotLine`/`planDiff`/`opiszZmiane` (Zad. 4) używane
w Zad. 8 i 9; `filmSummary` (Zad. 6) konsumowane przez `MaterialsRail` (Zad. 8);
`planTotals`/`lineState`/`byWorker` (Zad. 5) przez `PlanList` i `LineCounter`.

**Zakres:** jeden podsystem — stanowisko produkcyjne. Zasady tabletu i reszta
MES poza zakresem.
