# Projekt (F2-B): Przepływ partii — mobilny widok ze skanu sztuki

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: F2-A „uszczelnienie" (zrobione). [[kebab-wydanie-dokumenty-roadmap]]

## Kontekst i cel

Po zeskanowaniu pojedynczej sztuki magazynier chce zobaczyć **cały przepływ partii krok po
kroku**: **Przyjęcie → Rozbiór → Masowanie → Produkcja**, każdy z poprawnym numerem partii,
datą i kg. To „źródło prawdy" identyfikowalności.

Dane już istnieją: endpoint `GET /api/traceability?batchId=<batch>&direction=backward`
(`traceabilityApi.backward`) zwraca czyste tablice łańcucha:
`{ rawBatches, deboning, mixingOrders, seasonedBatches, finishedGoods, suppliers }`.
Komponent biurowy `LineageChain` (w `DetailModal`) już to renderuje (poziomo) i po F2-A
pokazuje poprawne partie (rozbiór = `rawBatchNo`, nie cuid).

**Luka:** karta skanu sztuki (`MobileSztukaPage`) ma link „Pokaż pochodzenie partii", ale leci
do `/office/recall` **bez kontekstu** (pusty ekran biurowy, niewygodny na telefonie).

### Zakres F2-B

Mobilny, pionowy widok przepływu partii, uruchamiany ze skanu sztuki, oparty na istniejących
danych traceability. **Bez nowego bytu/endpointu** (reużycie `traceabilityApi.backward`).

### Poza zakresem

- Zmiany w biurowym `RecallPage`/`DetailModal` (zostają — szczegółowy recall).
- Nowy endpoint backendu (reużywamy istniejący traceability).
- Przepływ „w przód" (forward) — tu tylko wstecz (pochodzenie).

## Architektura

### 1. Backend — bez zmian

Reużycie `GET /api/traceability?batchId=<batch>&direction=backward`. Akceptuje numer partii
(query po `id` LUB `batch_no`/`internal_batch_no`), więc `batchNo` zeskanowanej sztuki
('346'/'PP1') zadziała. (Pola partii czyste po F2-A.)

### 2. Front — mobilny ekran przepływu

`src/pages/mobile/MobilePrzeplywPartiiPage.tsx`, trasa `/mobile/przeplyw?batch=<batchNo>`:
- Pobiera `traceabilityApi.backward(batch)` (`@/lib/apiClient`).
- Rysuje **pionowy przepływ** (od dołu/góry chronologicznie) z 4–5 krokami; każdy krok =
  karta z: nazwa etapu, **numer partii**, data, kg, drobne detale. Mapowanie pól (zgodne z
  naprawionym `LineageChain`):

| Krok | Źródło | Partia (pole) | Detale |
|---|---|---|---|
| Przyjęcie | `rawBatches[]` | `internal_batch_no` (fallback `id.slice` tylko gdy brak) | dostawca (`supplier_name`/z `suppliers`), data, kg |
| Rozbiór | `deboning[]` | `rawBatchNo`/`raw_batch_no` (fallback `meatLotNo`) | kg mięsa (`kgMeat`/`kg_meat`), `sessionNo`, data |
| Masowanie | `mixingOrders[]` | `order_no` | receptura (`recipe_name`) |
| Mięso przyprawione | `seasonedBatches[]` | `batch_no` | kg (`kg_produced`) |
| Produkcja / wyrób | `finishedGoods[]` (jeśli) inaczej `seasonedBatches[0]` | `batch_no` | — |

- Pusty wynik (brak łańcucha) → komunikat „Brak danych pochodzenia dla partii {batch}".
- Stan ładowania/błędu — czytelny.
- Styl spójny z innymi ekranami mobilnymi (nagłówek z „Wstecz").

### 3. Front — wpięcie ze skanu

`src/pages/mobile/MobileSztukaPage.tsx`: zamienić link „Pokaż pochodzenie partii"
(→ `/office/recall`) na **„Pokaż przepływ partii"** → `Link` do
`/mobile/przeplyw?batch=<encodeURIComponent(card.batchNo)>`.

### 4. Trasa

`src/App.tsx`: dodać `<Route path="/mobile/przeplyw" element={<MobilePrzeplywPartiiPage />} />`.

## Obsługa błędów / brzegowe

| Sytuacja | Zachowanie |
|---|---|
| brak `batch` w URL | komunikat „Brak partii" |
| traceability zwraca pustą strukturę | „Brak danych pochodzenia dla partii {batch}" |
| brak danego etapu (np. brak rozbioru) | pomiń krok / pokaż „—" |
| `batchNo` = partia łączona (PP1) | traceability po `batch_no='PP1'` zwraca wiele źródeł — pokazać wszystkie pozycje w danym kroku |

## Testy

Brak frontowego runnera → **build + ręczny e2e**:
- Skan sztuki (partia '346') → „Pokaż przepływ partii" → widać: Przyjęcie (nr partii surowca,
  dostawca) → Rozbiór (numer partii, nie cuid) → Masowanie → Mięso przyprawione '346' → Produkcja.
- Partia łączona ('PP1') → krok źródeł pokazuje obie partie.
- Brak danych → czytelny komunikat.

## Otwarte kwestie

- Czy „produkcja" pokazywać jako numer wyrobu gotowego `ddmmrr partia` (gdy `finishedGoods`
  obecne) — tak, spójnie z identyfikacją wyrobu (F2-A). Gdy brak `finishedGoods`, pokazać partię
  mięsa przyprawionego.
