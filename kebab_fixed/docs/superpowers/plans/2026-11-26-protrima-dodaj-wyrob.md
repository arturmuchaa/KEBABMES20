# PROTRIMA „Dodaj wyrób gotowy” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Okno „Dodaj wyrób gotowy” w module Wyrób gotowy PROTRIMA: zwijane drzewo klient → zamówienie → pozycje, pozycja rozbijana na kilka partii, sekcja „Ręcznie”, jeden zapis `createBulk`.

**Architecture:** Czysta logika (drzewo, podział na partie, payload) w `modules/stock/dodaj/model.ts` testowana jednostkowo; okno `DodajWyrobDialog.tsx` na istniejącym `Dialog` z `shell/context`; wpięcie w polecenia `FinishedGoods.tsx`. Backend bez zmian.

**Tech Stack:** React + TS, vitest + @testing-library/react (jsdom), lucide-react, istniejące `finishedGoodsApi.createBulk`, `seasonedMeatApi.list`, `recipesApi`, `productTypesApi`, `packagingApi`, `clientsApi`.

**Spec:** `kebab_fixed/docs/superpowers/specs/2026-11-26-protrima-dodaj-wyrob-design.md`

Wszystkie ścieżki względem `kebab_fixed/` w worktree `/opt/kebab/wt-wyrob-reczny`. Testy: `npx vitest run <ścieżka>` (najpierw `npm ci` jeśli brak node_modules; TZ=UTC jak w `npm test`).

## Global Constraints

- Pokrycie zamówienia wiąże się po trójce `clientOrderNo` + `recipeId` + `kgPerUnit` — przy pozycjach z zamówień te pola z POZYCJI, nie z ręki.
- Numer partii na wyrobie: `ddmmrr <nr>` z DATY PRODUKCJI okna (nie z dzisiaj).
- Wsad masowni o wpisanym numerze → `seasonedBatchNos=[nr]`, `consumeSeasoned=true`, `batchNo=''`; inaczej `batchNo=normalizeManualBatchNo(nr, data)`, `seasonedBatchNos=[]`, `consumeSeasoned=false`.
- Jeden wiersz partii = jeden element `createBulk`; zapis całości albo nic.
- Na backend `clientName` = nazwa z zamówienia (`order.client.name`) / z kartoteki (`name`) dla ręcznych; na ekranie nazwa handlowa (`displayName || name`).
- Rodzaj (productType) wymagany dla pozycji ręcznej.
- Copy po polsku, liczby przecinkiem (`1,5`), standard UX PROTRIMA: Enter/Esc, autofocus, błąd przy polu, pusty stan.
- Nie zmieniać starego `AddFinishedGoodModal` ani backendu.
- Reużyć z `src/features/finished-goods/manualGoods.ts`: `ddmmrr`, `normalizeManualBatchNo`, `liczba` (import, nie kopiować).

## Review Focus

1. Suma partii ≠ sztuk pozycji (mniej albo więcej niż zostało) — pokaż „razem 70/80” ostrzegawczo, ale pozwól zapisać (biuro może zrobić mniej/więcej); blokuj tylko 0 szt. w wierszu. → test w Task 1 (`statusPozycji`).
2. Pusty numer partii w którymś wierszu — błąd przy tym polu, zapis zablokowany. → Task 1 (`bledyKoszyka`).
3. Numer już z datą („231126 111”) albo wsad masowni z datą — nie doklejać drugiej daty; dopasowanie do masowni po numerze bez daty. → Task 1 (`rozpoznajPartie`).
4. Ten sam klient z dwoma zamówieniami, pozycje o tej samej recepturze i wadze — muszą zostać osobnymi gałęziami i osobnymi pozycjami koszyka (różny `clientOrderNo`). → Task 1 (`drzewoZamowien`).
5. Błąd serwera przy zapisie — okno zostaje otwarte z całym koszykiem, komunikat błędu widoczny, przycisk znów aktywny. → Task 2 (test komponentu).

---

### Task 1: Model — drzewo, partie, payload

**Files:**
- Modify: `src/protrima/data/model.ts` (Line: dodać `productTypeId?: string; packagingId?: string`)
- Modify: `src/protrima/data/mapuj.ts:80-100` (`mapujPozycje`: `productTypeId: l.productTypeId`, `packagingId: l.packagingId ?? ''`)
- Create: `src/protrima/modules/stock/dodaj/model.ts`
- Test: `src/protrima/modules/stock/dodaj/model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PartiaWiersz { key: string; nr: string; qty: string }
  export interface PozycjaKoszyka {
    key: string                       // lineId albo 'r-<n>' dla ręcznych
    zrodlo: 'zamowienie' | 'reczna'
    orderNo: string                   // '' dla ręcznych
    clientId: string; clientName: string; clientLabel: string
    recipeId: string; recipeName: string
    productTypeId: string; productTypeName: string
    packagingId: string; packagingName: string
    kgPerUnit: number
    cel: number                       // ile zostało do zrobienia (ręczne: wpisane sztuki)
    partie: PartiaWiersz[]
  }
  export interface GalazZamowienia { orderId: string; orderNo: string; delivery?: Date; kgLeft: number; lines: Line[] }
  export interface GalazKlienta { clientId: string; clientName: string; kgLeft: number; zamowienia: GalazZamowienia[] }
  export function drzewoZamowien(orders: Order[], q?: string): GalazKlienta[]
  export function pozycjaZLinii(o: Order, l: Line): PozycjaKoszyka        // jedna partia, qty = lineMissing(l) || l.qty
  export function dodajPartie(p: PozycjaKoszyka): PozycjaKoszyka          // nowy wiersz z resztą: max(0, cel − suma)
  export function sumaPartii(p: PozycjaKoszyka): number
  export function statusPozycji(p: PozycjaKoszyka): 'ok' | 'mniej' | 'wiecej'
  export interface Rozpoznana { naWyrobie: string; masownia: boolean; nrMasowni?: string }
  export function rozpoznajPartie(nr: string, data: string, wsadyMasowni: string[]): Rozpoznana
  export function bledyKoszyka(k: PozycjaKoszyka[], data: string): Record<string, string>  // klucz `${poz.key}:${partia.key}:nr|qty`, plus 'data', 'koszyk'
  export function payloadKoszyka(k: PozycjaKoszyka[], data: string, wsadyMasowni: string[]): FinishedGoodBulkItem[]
  export function sumyKoszyka(k: PozycjaKoszyka[]): { partie: number; sztuki: number; kg: number }
  ```
  `FinishedGoodBulkItem` = obiekt camelCase o polach jak `manualGoodsPayload` w `src/features/finished-goods/manualGoods.ts` + `batchNo` + `clientOrderNo`.

Zasady:
- `drzewoZamowien`: tylko `!isClosed(o) && o.status !== 'draft'`; pomijać linie `usluga`; klient = `o.client.id`, sort klientów `localeCompare(..,'pl')`, zamówienia w kliencie po dacie dostawy rosnąco (brak daty na końcu); `kgLeft` = Σ `lineMissing(l)*kgPerUnit` zaokrąglone do 0,01; `q` filtruje (bez wielkości liter) po nazwie klienta, numerze zamówienia, recepturze — klient zostaje, jeśli cokolwiek pasuje.
- `rozpoznajPartie`: `wpis=nr.trim()`; `goly` = wpis bez prefiksu `^\d{6}\s+`; jeśli `goly` ∈ `wsadyMasowni` (porównanie trim, bez wielkości liter) → `{ naWyrobie: \`${ddmmrr(data)} ${goly}\`, masownia: true, nrMasowni: goly }`; inaczej `{ naWyrobie: normalizeManualBatchNo(wpis, data), masownia: false }`. Pusty wpis → `{ naWyrobie: '—', masownia: false }`.

- [ ] **Step 1: Write the failing tests** (`model.test.ts`, dane w kształcie `Order`/`Line` z `data/model.ts`):
  - `drzewo: dwa otwarte zamówienia YALCIN to dwie gałęzie pod jednym klientem` — zamówienia `41/11` i `44/11`, obie z linią KEBAB 10 kg tej samej receptury → `drzewo.length===1`, `drzewo[0].zamowienia.map(z=>z.orderNo)` = `['41/11','44/11']` (wg dostawy).
  - `drzewo: pomija zamknięte, szkice i pozycje usługowe`.
  - `drzewo: filtr q po recepturze zostawia tylko pasujące zamówienia`.
  - `pozycjaZLinii: jedna partia z brakującą ilością` — `qty 80, stock 0, delivered 0` → `partie=[{nr:'',qty:'80'}]`, `cel 80`, `orderNo` z zamówienia.
  - `dodajPartie: reszta sztuk` — partia 30 z celu 80 → nowy wiersz `qty '50'`; przy sumie ≥ cel → `qty ''`.
  - `statusPozycji`: 30+50 z 80 → `'ok'`; 30+40 → `'mniej'`; 30+60 → `'wiecej'`.
  - `rozpoznajPartie`: `('111','2026-11-23',['111','112'])` → `{naWyrobie:'231126 111', masownia:true, nrMasowni:'111'}`; `('231126 111', ..., ['111'])` → to samo; `('PP13','2026-11-23',[])` → `{naWyrobie:'231126 PP13', masownia:false}`; `('',…)` → `naWyrobie '—'`.
  - `bledyKoszyka`: pusty koszyk → klucz `koszyk`; partia z pustym `nr` → klucz `…:nr` = `'Wpisz numer partii'`; `qty '0'` → `…:qty` = `'Podaj sztuki'`; brak daty → `data`.
  - `payloadKoszyka: pozycja 80 szt rozbita na 111 (30) i 112 (50)` → 2 elementy: `{qty:30, kgPerUnit:10, producedDate:'2026-11-23', clientOrderNo:'41/11', recipeId, productTypeId, packagingId, clientName:'YALCIN', batchNo:'', seasonedBatchNos:['111'], consumeSeasoned:true}` i analogicznie 50/`112`; partia spoza masowni `'PP13'` → `batchNo:'231126 PP13', seasonedBatchNos:[], consumeSeasoned:false`; pozycja ręczna → `clientOrderNo:''`.
  - `sumyKoszyka`: `{partie:2, sztuki:80, kg:800}`.
  - `mapujPozycje niesie productTypeId i packagingId` (dopisać w `data/mapuj.test.ts`).

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/protrima/modules/stock/dodaj/model.test.ts src/protrima/data/mapuj.test.ts` → FAIL (moduł nie istnieje / brak pól).
- [ ] **Step 3: Implement** — pola w `Line` + `mapujPozycje`; `dodaj/model.ts` wg Interfaces i Zasad. `key` partii: licznik/`crypto.randomUUID` niezależny od indeksu.
- [ ] **Step 4: Run to verify pass** — ta sama komenda → PASS; plus `npx tsc --noEmit -p .` bez nowych błędów.
- [ ] **Step 5: Commit** — `feat(protrima): model okna Dodaj wyrób — drzewo zamówień, partie, payload`

---

### Task 2: Okno `DodajWyrobDialog`

**Files:**
- Create: `src/protrima/modules/stock/dodaj/DodajWyrobDialog.tsx`
- Create (jeśli style nie mieszczą się w istniejących klasach): sekcja w `src/protrima/styles` / pliku stylów modułu stock — tylko istniejące tokeny
- Test: `src/protrima/modules/stock/dodaj/DodajWyrobDialog.test.tsx`

**Interfaces:**
- Consumes: wszystko z Task 1.
- Produces: `export function DodajWyrobDialog({ onClose }: { onClose: () => void }): JSX.Element` — sam pobiera `useOrders()` (`orders`, `refresh`), `useApp()` (`toast`), `seasonedMeatApi.list` (numery `batchNo` wsadów), kartoteki do sekcji „Ręcznie”.

Zachowanie (wg szkicu w spec):
- `Dialog` `xl`, tytuł „Dodaj wyrób gotowy”, w nagłówku/treści pole „Data produkcji” (`type=date`, domyślnie dziś, `data-autofocus` na wyszukiwarce drzewa).
- Lewa kolumna: wyszukiwarka + drzewo. Klient (▸/▾, `aria-expanded`, liczba zamówień, „zostało X kg”), pod nim zamówienia (▸/▾, nr, dostawa, „zostało X kg”), pod nim pozycje z checkboxem (`receptura · rodzaj · waga kg · tuleja`, „brakuje N szt.”). Domyślnie klienci zwinięci; przy niepustym `q` rozwinięte. Na końcu wpis „Ręcznie (bez zamówienia)”, który otwiera formularz ręczny po prawej.
- Prawa kolumna „Do zapisu”: pozycje koszyka z nagłówkiem `KLIENT · nr zam. · receptura waga kg`, cel szt.; wiersze partii: pole numeru (z `<datalist>` wsadów masowni), pole sztuk, podgląd `→ {naWyrobie}` + znacznik „masownia ✓” / „bez masowni”, przycisk usuń wiersz; pod spodem „+ partia” i „razem S/C” (kolor ostrzegawczy przy `mniej`/`wiecej`). Enter w polu sztuk ostatniego wiersza → `dodajPartie` + fokus na nowym polu numeru. Odznaczenie pozycji w drzewie usuwa ją z koszyka.
- Formularz ręczny: receptura, rodzaj (wymagany), waga sztuki, tuleja, klient (opcjonalny, `Wybor` jak w `NowyKartonDialog`), sztuki → „Dodaj do zapisu” tworzy `PozycjaKoszyka` `zrodlo:'reczna'` z jedną partią.
- Stopka: `sumyKoszyka` („3 partie · 80 szt. · 800 kg”), „Anuluj”, „Zapisz” (primary, Ctrl+Enter). Klik z błędami → pokaż błędy przy polach (`bledyKoszyka`), bez żądania. Zapis: blokada podwójnego kliknięcia (ref jak w `NowyKartonDialog`), `finishedGoodsApi.createBulk(payloadKoszyka(...))`, potem `refresh()`, toast `success` „Dodano wyrób: N szt. · X kg” i `onClose()`. Błąd → `note` z komunikatem w oknie, koszyk zostaje.
- Pusty stan drzewa: „Brak otwartych zamówień — dodaj wyrób ręcznie”. Pusty koszyk: „Zaznacz pozycje po lewej albo dodaj wyrób ręcznie”.

- [ ] **Step 1: Write the failing tests** (wzór mocków jak `PoprawWyrob.test.tsx`; `useOrders` zwraca `orders` z dwoma zamówieniami YALCIN + jednym BULLI, `refresh`):
  - `klienci zwinięci, rozwinięcie YALCIN pokazuje dwa zamówienia osobno`.
  - `zwinięcie zamówienia chowa jego pozycje`.
  - `80 szt z partii 111 i 112 w jednym zapisie` — zaznacz pozycję 41/11, wpisz `111`, sztuki `30`, Enter → nowy wiersz z `50`, wpisz `112`, „Zapisz” → `createBulk` wywołane RAZ z 2 elementami (asercje jak w Task 1 payload), `refresh` wywołane, `onClose` wywołane.
  - `podgląd numeru i znacznik masowni` — po wpisaniu `111` widać `231126 111` i „masownia”.
  - `pusty numer partii blokuje zapis i pokazuje błąd przy polu` — `createBulk` nie wywołane, widać „Wpisz numer partii”.
  - `błąd serwera zostawia okno i koszyk` — `createBulk` rejected `new Error('Brak tulei')` → tekst „Brak tulei” widoczny, `onClose` nie wywołane, pozycja dalej w koszyku, „Zapisz” aktywny.
  - `wyrób ręczny trafia do zapisu bez numeru zamówienia`.
- [ ] **Step 2: Run to verify fail** — `npx vitest run src/protrima/modules/stock/dodaj/DodajWyrobDialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `DodajWyrobDialog.tsx` wg Zachowania.
- [ ] **Step 4: Run to verify pass** — ta sama komenda → PASS.
- [ ] **Step 5: Commit** — `feat(protrima): okno Dodaj wyrób gotowy — zwijane zamówienia, kilka partii na pozycję`

---

### Task 3: Wpięcie w moduł, wersja, zrzuty

**Files:**
- Modify: `src/protrima/modules/stock/FinishedGoods.tsx` (stan `dodaj`, polecenie, render dialogu)
- Modify: `src-tauri/tauri.protrima.conf.json` (wersja `0.14.0` → `0.15.0`)
- Test: istniejące testy modułu stock + `npm test` całości frontu

**Interfaces:**
- Consumes: `DodajWyrobDialog` z Task 2.

- [ ] **Step 1:** W `cmds` dodać na początku `{ id: 'dodaj', group: 1, label: 'Dodaj wyrób…', icon: <PackagePlus size={17} />, tip: 'Wpisz wyrób z produkcji: z zamówień albo ręcznie, z partiami', run: () => setDodaj(true) }` (ikonę dobrać tak, by różniła się od „Karton magazynowy” — np. `Plus`); `{dodaj && <DodajWyrobDialog onClose={() => setDodaj(false)} />}`. Polecenie trafia też do Ctrl+K przez `setCmds` (sprawdzić w palecie).
- [ ] **Step 2:** Skrót: `Ctrl+N`/`Insert` w handlerze klawiszy modułu otwiera okno (tylko gdy brak `.dialog-wrap`). Jeśli `Ctrl+N` koliduje z istniejącym skrótem w shellu — tylko `Insert`.
- [ ] **Step 3:** `npm test` (cały front) i `npx tsc --noEmit -p .` → bez nowych błędów (znany niezależny błąd backendowy `test_production_rates_db` nie dotyczy frontu).
- [ ] **Step 4:** Wersja PROTRIMA `0.15.0` w `src-tauri/tauri.protrima.conf.json`.
- [ ] **Step 5:** Zrzuty do akceptacji: lokalny stos (baza `kebab_mes_test_zrzuty_biuro`, backend :8642, vite :5642, Chrome `--no-sandbox` skryptem node) — 3 zrzuty: drzewo z rozwiniętym YALCIN (dwa zamówienia), koszyk z pozycją rozbitą na 111/112, formularz ręczny z błędem przy polu. Opublikować jako artefakt do akceptacji właściciela. NIE wdrażać przed akceptacją.
- [ ] **Step 6: Commit** — `feat(protrima): Dodaj wyrób w module Wyrób gotowy` i osobno `chore(protrima): wersja 0.15.0 — dodawanie wyrobu gotowego z partiami`
