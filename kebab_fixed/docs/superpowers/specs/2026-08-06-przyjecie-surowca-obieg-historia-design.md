# Przyjęcie surowca — „W obiegu" i „Historia dostaw"

Data: 2026-08-06
Strona: `/office/raw-batches` (`src/features/raw-batches/`)

## Problem

Strona „Przyjęcie surowca — historia dostaw" odpowiada dziś jedną tabelą na dwa
różne pytania i przegrywa oba:

1. **operacyjne** — „co jeszcze leży w chłodni i czy coś się psuje?"
2. **archiwalne** — „co przyjęliśmy 14 lipca, od kogo, po ile, jaki był ubój?"

Konkretne wady stanu obecnego:

- Sortowanie domyślne to **data ważności rosnąco** (`RawBatchesTable`,
  `sortCol='expiryDate'`), więc na górze siedzą najstarsze dostawy. Hook
  `useRawBatches` sortuje poprawnie (data przyjęcia malejąco), ale tabela
  ten porządek nadpisuje.
- **Nie ma kolumny z datą przyjęcia.** Pole `receivedDate` jest w typie
  i w API, ale nie trafia na ekran.
- Kolumna „Ważność" renderuje **sam `ExpiryBadge` bez daty** — audytor nie
  odczyta z niej terminu, a operator widzi tylko „Wygasła".
- Znacznik ważności świeci na czerwono **niezależnie od tego, czy partia
  została już zużyta**. W bazie na 2026-08-06: ćwiartka 45 dostaw aktywnych,
  z czego stan ma **jedna** (nr 464); filet 8/0, mięso z/s 6/0. Około 98 %
  wierszy to historia, która krzyczy nieaktualnym alarmem.
- Status ma tylko cztery wartości (`active` / `low_expiry` / `expired` /
  `used`) i nie mówi, **co się z dostawą stało** — czy czeka na rozbiór, jest
  napoczęta, czy rozliczona.
- Ikony „Edytuj" i „Usuń" pokazują się na **każdym** wierszu, także w pełni
  rozebranym. Warunek `Number(b.kgUsed) === 0` nigdy nie blokuje, bo tabela
  `raw_batches` nie ma kolumny `kg_used`, więc mapper w `src/lib/api.ts`
  ustawia `kgUsed: 0` dla wszystkich partii. Backend taką edycję odrzuca, ale
  operator dostaje przycisk, który go oszukuje.

## Rozwiązanie

Rozdzielić dwie perspektywy fizycznie — dwie sekcje na jednej stronie,
w obrębie wybranego rodzaju surowca (przełącznik Ćwiartka / Filet / Mięso z/s
zostaje bez zmian).

```
┌ W OBIEGU ───────────────────────────────── 1 dostawa · 1 485 kg ┐
│ Nr   Dostawca   Przyjęto  Ubój   Ważność        Zostało  Status │
│ 464  Drob-Pol   06.08     04.08  11.08 ⚠5 dni  1 485 kg  DO ROZBIORU │
└─────────────────────────────────────────────────────────────────┘

┌ HISTORIA DOSTAW ──── [30 dni ▾] [szukaj…] [☐ anulowane] 44 poz. ┐
│ 463  Drob-Pol   06.08     04.08  11.08              —   ROZEBRANA │
│ 462  Animex     05.08     04.08  11.08              —   ROZEBRANA │
└─────────────────────────────────────────────────────────────────┘
```

**Dlaczego rozdział sekcji, a nie filtr statusów na jednej liście:**
proporcje danych są ekstremalne (1 żywa pozycja na 48). Filtr ma sens przy
podziale zbliżonym do 50/50, gdzie realnie przełącza się perspektywę; tutaj
byłby kliknięciem po to, by zobaczyć jeden wiersz, który powinien być widoczny
od razu. Alarm terminu ma sens wyłącznie dla surowca, który jeszcze leży —
rozdział sekcji likwiduje dwuznaczność kolumny „Ważność" u źródła, zamiast ją
malować warunkiem na kolorze. Archiwum nic nie traci: wszystkie daty zostają,
przestają tylko krzyczeć.

**Dlaczego to nie duplikat Magazynu surowca:** Magazyn pokazuje żywy stan
wszystkich frakcji w perspektywie produkcji. Sekcja „W obiegu" pokazuje
niedomkniętą **dostawę** — z ceną, fakturą i numerem partii dostawcy, czyli
w perspektywie zakupowej.

### Gdzie naprawdę leży stan dostawy

**Korekta z 2026-08-06 (po przeglądzie kodu).** Pierwotna wersja tego spec
zakładała, że `raw_batches.kg_available` opisuje stan każdej dostawy. To jest
prawdą tylko dla ćwiartki.

Dla surowca przyjmowanego **bez rozbioru** (filet, mięso z/s z dostawy
zewnętrznej) `create_batch` w `raw_batches_service.py` zeruje `kg_available`
**już przy przyjęciu** i przerzuca całość do `meat_stock` pod tym samym
numerem partii. Czytanie stanu z dostawy pokazywałoby więc filet przyjęty
przed godziną jako ZUŻYTY, a sekcja „W obiegu" dla tych rodzajów byłaby
pusta z definicji (potwierdzone na produkcji: filet 465, 816 kg, przyjęty
2026-08-06, `kg_available = 0`, całość leży w `meat_stock`).

Stan rozwiązuje `resolveDelivery(batch, { requiresDeboning, meatStock })`:

| Rodzaj | Źródło „ile zostało" |
|---|---|
| Ćwiartka | `raw_batches.kg_available` (maleje przy rozbiorze) |
| Filet, mięso z/s | `meat_stock.kg_available` po numerze partii; brak lotu = 0 |

Mapa lotów pochodzi z `GET /wz/stock/raw` (to samo źródło co Magazyn surowca
i picker WZ) — zero zmian w backendzie. Endpoint zwraca tylko loty z dodatnim
stanem, więc brak klucza w mapie znaczy „wszystko zeszło do masowania".
`meat_stock.kg_reserved` NIE jest odjęte od stanu — pokazujemy je osobno,
inaczej planista liczyłby kilogramy już zaklepane przez czyjś plan.

Dostawa bez rozbioru nigdy nie jest edytowalna: `_batch_used_reason_cx`
odrzuca (409) każdą partię mającą wiersz w `meat_stock`, a ten powstaje przy
przyjęciu. Przyciski edycji i usunięcia nie mogą się tam pokazywać.

### Podział wierszy

| Sekcja | Warunek |
|---|---|
| W obiegu | `status !== 'cancelled'` **i** `resolveDelivery(...).kgLeft > 0` |
| Historia dostaw | wszystko pozostałe (zużyte + anulowane) |

Sekcja „W obiegu" przy pustym zbiorze pokazuje stan pusty: „Wszystkie dostawy
rozliczone — brak surowca w obiegu". Nie znika, bo jej brak byłby
nieodróżnialny od błędu ładowania.

### Statusy dostawy

Nowa funkcja `deriveDeliveryStatus(batch, requiresDeboning)` w
`src/lib/utils/fefo.ts`. **Nie zmienia** istniejącej `deriveRawBatchStatus` —
ta zostaje nietknięta, bo używa jej `DashboardPage` i `computeDisplayStatus`.

Kolejność rozstrzygania:

1. `status === 'cancelled'` → `cancelled`
2. `kgAvailable <= 0` → `processed`
3. `kgAvailable < kgReceived` → `in_progress`
4. w pozostałych przypadkach → `awaiting`

Etykiety zależą od `requiresDeboning` rodzaju surowca:

| Status | Ćwiartka (rozbiór) | Filet, mięso z/s (bez rozbioru) | Ton |
|---|---|---|---|
| `cancelled` | ANULOWANA | ANULOWANA | red |
| `awaiting` | DO ROZBIORU | NA MAGAZYNIE | blue |
| `in_progress` | W ROZBIORZE | CZĘŚCIOWO ZUŻYTA | amber |
| `processed` | ROZEBRANA | ZUŻYTA | gray |

Etykiety trafiają do `STATUS_META` w `src/components/ui/badge.tsx` pod
kluczami `delivery_awaiting_deboning`, `delivery_awaiting_stock`,
`delivery_in_progress_deboning`, `delivery_in_progress_stock`,
`delivery_processed_deboning`, `delivery_processed_stock`,
`delivery_cancelled` — jedno źródło prawdy dla etykiet i tonów, zgodnie
z istniejącym systemem znaczników.

Świadomie **nie** rozróżniamy, czy partia zeszła na rozbiór, czy została
sprzedana WZ jako ćwiartka. Wymagałoby to zapytania o ruchy magazynowe dla
każdego wiersza; ta informacja jest w kartotece partii po kliknięciu.

Statusy kończą się na „zeszło z magazynu". Dalszy los surowca (zamasowane →
w produkcji → wyrób gotowy) to osobny łańcuch, opisany w kartotece partii —
patrz „Poza zakresem".

### Znacznik ważności

`ExpiryBadge` renderowany **wyłącznie gdy `kgAvailable > 0`**. Data ważności
jest zawsze widoczna jako tekst — w historii sama data, wyszarzona, bez
znacznika. Zamknięta partia nigdy nie pokazuje alarmu.

### Kolumny (obie sekcje, ten sam komponent)

`Nr partii · Dostawca · Nr dostawcy · Przyjęto · Ubój · Ważność ·
Przyjęto kg · Zostało kg · Cena/kg · Status · akcje`

- **Przyjęto** — nowa kolumna, `receivedDate`, format PL.
- **Ważność** — data PL + `ExpiryBadge` tylko gdy w obiegu.
- **Zostało kg** — dotychczasowa „Kg dostępne"; `—` gdy `kgAvailable <= 0`
  (mniej szumu niż „0,00 kg", ten sam sens). Anulowana dostawa z resztą kg
  pokazuje wartość wyszarzoną, nie `—` — inaczej zniknęłaby informacja
  o niezwróconym surowcu.

### Sortowanie

Domyślnie **data przyjęcia malejąco**, tie-break numer partii malejąco
(`localeCompare` z `numeric: true`, tak jak w `useRawBatches`). Klikanie
nagłówków zostaje; obie sekcje mają własny stan sortowania.

### Filtry historii

- wyszukiwarka (nr partii / dostawca / nr dostawcy) — jak dziś, tylko
  w historii,
- okres: **30 dni** (domyślnie) / 90 dni / wszystko, liczony po
  `receivedDate`,
- checkbox „pokaż anulowane" — domyślnie **wyłączony**.

Sekcja „W obiegu" nie ma filtrów — przy 1–3 wierszach są zbędne.

### Poprawka blokady edycji

Zużycie liczone jako `kgReceived - kgAvailable` zamiast pola `kgUsed`
(zawsze 0 z backendu). Warunek widoczności ikon:

```
kgAvailable >= kgReceived && status !== 'cancelled' && !isInUse
```

czyli edycja i usunięcie tylko dla dostawy nietkniętej. Zmiana w
`RawBatchesTable`; backend bez zmian (i tak odrzuca).

## Architektura

Zmiana wyłącznie po stronie frontendu. Zero zmian w bazie, API i backendzie —
wszystkie potrzebne pola (`received_date`, `slaughter_date`, `expiry_date`,
`kg_received`, `kg_available`, `status`, `material_type_id`) już przychodzą
z `GET /raw-batches` i są mapowane w `src/lib/api.ts`.

| Plik | Zmiana |
|---|---|
| `src/lib/utils/fefo.ts` | + `DeliveryStatus`, + `deriveDeliveryStatus()` |
| `src/components/ui/badge.tsx` | + 7 kluczy w `STATUS_META` |
| `src/features/raw-batches/components/RawBatchesTable.tsx` | kolumna „Przyjęto", data przy ważności, warunkowy `ExpiryBadge`, nowy status, sort domyślny, prop `requiresDeboning`, prop `variant: 'live' \| 'history'`, poprawka blokady edycji |
| `src/features/raw-batches/pages/RawBatchesPage.tsx` | podział `matBatches` na dwie sekcje + nagłówki z podsumowaniem + filtry historii |

`RawBatchesTable` pozostaje **jednym** komponentem sterowanym propem
`variant`: `'live'` (znaczniki ważności, brak filtrów) / `'history'`
(wyszarzone, bez alarmów, filtry). Dwa komponenty rozjechałyby się przy
pierwszej zmianie kolumn.

## Testy

Wszystko istotne jest czystą funkcją — testy jednostkowe w vitest:

- `fefo.test.ts` — `deriveDeliveryStatus`: cztery statusy × dwa rodzaje
  surowca; przypadek brzegowy `kgAvailable > kgReceived` (korekta stanu
  w górę) → `awaiting`; `cancelled` wygrywa nawet gdy `kgAvailable > 0`.
- test podziału wierszy na sekcje (anulowana z resztą kg trafia do historii,
  nie do obiegu).
- test sortowania: dwie dostawy z tego samego dnia → wyżej wyższy numer.

Bez testów E2E — zmiana jest prezentacyjna i nie dotyka ścieżek zapisu.

## Poza zakresem

- Rozróżnienie „rozebrana" vs „sprzedana WZ" (wymaga ruchów magazynowych
  per wiersz; jest w kartotece partii).
- Status dalszego łańcucha per dostawa („zamasowane", „w produkcji",
  „wyprodukowane" z kilogramami na każdym etapie). Wymaga złączenia
  `mixing_orders` / `seasoned_batches` / `production_sessions` po numerze
  partii, czyli nowego endpointu — osobna iteracja.
- Sumy miesięczne / porównania okresów — to widok raportowy, miejsce
  w Analityce.
- Zmiany w Magazynie surowca i na innych stronach używających
  `deriveRawBatchStatus`.
