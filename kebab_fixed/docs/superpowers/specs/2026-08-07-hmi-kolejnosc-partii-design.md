# HMI rozbioru — własna kolejność partii na pasku

Data: 2026-08-07
Ekran: kiosk hali `rozbior-v10` (`src/pages/tablet/DeboningHmiV10Page.tsx`)

## Problem

Pasek partii w kiosku rozbioru sortuje się FEFO — najpierw najkrótszy termin
ważności, przy remisie niższy numer partii
(`DeboningHmiV10Page.tsx`, `allActiveBatches`).

Realny scenariusz z hali: na stanie są partie **466, 467, 468**. Zakład
pracuje dziś na 467 i 468, a 466 zaczyna dopiero jutro. FEFO stawia 466
pierwszą, bo jej termin mija najwcześniej — i operator regularnie klika
w nią przez pomyłkę, bo jest skrajnie z lewej, czyli najbliżej ręki.

To nie jest problem estetyczny, tylko **źródło błędów operatora**: wpis
rozbioru trafia na złą partię, a odkręcanie tego wymaga korekty biurowej
(patrz `kebab-rozbior-korekty-biuro`).

## Rozwiązanie

Pozwolić hali ułożyć pasek w kolejności, w jakiej realnie pracuje: przytrzymanie
kafla wprowadza go w tryb przenoszenia, przeciągnięcie zmienia pozycję.

### Gest

- Przytrzymanie **600 ms** na kaflu partii → kafel unosi się (cień,
  powiększenie ~1,05) i pasek wchodzi w tryb przenoszenia.
- Przeciągnięcie w lewo/prawo przestawia kafel między sąsiadami.
- Puszczenie palca upuszcza kafel i zapisuje kolejność.

600 ms, bo tyle ma już przytrzymanie backspace w tym samym kiosku
(`handleBackStart`) — próg sprawdzony w rękawicach roboczych.

**Zwykłe kliknięcie nadal wybiera partię.** Po przekroczeniu progu
przytrzymania kliknięcie jest blokowane, żeby puszczenie palca po
przeniesieniu nie zmieniło wybranej partii przy okazji.

**Przewijanie:** pasek przewija się w poziomie (limit 12 kafli). Na czas
przenoszenia natywne przewijanie jest wyłączone (`touch-action: none`),
a gdy palec zbliży się do krawędzi paska, pasek przewija się sam. Przy
typowych 3 partiach ta ścieżka nie uruchomi się nigdy, ale przy 12 jest
konieczna — bez niej pasek ucieka pod palcem.

### Trwałość

Kolejność jest **wspólna dla całej hali**, bo odzwierciedla fakt (ustawienie
palet, plan dnia), a nie preferencję operatora.

- Klucz `hmi_batch_order` w istniejącej tabeli `app_settings` — bez migracji.
- Wartość: JSON `{"order": ["467","468","466"], "updatedAt": "<ISO>"}`.
- Endpoint `GET /api/settings/hmi-batch-order` i `PUT` z tym samym kształtem.
- Kluczem jest **numer partii** (`internal_batch_no`), nie id — czytelny przy
  diagnozie w bazie i unikalny (kolumna ma UNIQUE). Anulowanie partii zmienia
  numer na `ANUL-<id>`, ale anulowana partia i tak znika z paska.

Kiosk czyta kolejność razem z cyklicznym odświeżaniem listy partii. Zapis
idzie natychmiast po upuszczeniu, interfejs aktualizuje się optymistycznie.

### Scalanie z FEFO

Czysta funkcja `mergeBatchOrder(batches, savedOrder)`:

1. partie, których numer jest w `savedOrder` → w zapisanej kolejności,
2. partie spoza `savedOrder` → doklejone **na koniec**, między sobą FEFO,
3. numery z `savedOrder`, których nie ma już na liście → pomijane; przy
   najbliższym zapisie znikają z konfiguracji.

Nowa dostawa (np. 469) pojawia się więc na końcu i można ją przestawić,
a ustawienie 466/467/468 nie rozsypuje się samo.

### Czego zmiana NIE rusza

Kolejność FEFO zapisuje zasadę „najstarsze pierwsze", więc własne sortowanie
zmienia **wyłącznie układ kafli**:

- znaczniki terminu na kaflach zostają,
- twarda blokada partii przeterminowanej zostaje,
- ostrzeżenia u góry ekranu („termin za X dni", „przeterminowana — blokada
  HACCP") nadal liczą się z dat, nie z kolejności paska,
- limit 12 kafli i filtr aktywnych partii bez zmian.

W menu serwisowym (kod 0099) dochodzi **„Przywróć kolejność FEFO"** —
kasuje `hmi_batch_order`, gdyby ktoś ułożył pasek na opak.

## Architektura

| Warstwa | Zmiana |
|---|---|
| `backend/app/services/settings_service.py` | `get_hmi_batch_order()` / `save_hmi_batch_order(order)` na `app_settings` |
| `backend/app/routes/settings.py` | `GET`/`PUT /settings/hmi-batch-order` |
| `src/pages/tablet/batchOrder.ts` (nowy) | czysty `mergeBatchOrder` + typy |
| `src/pages/tablet/batchOrder.test.ts` (nowy) | testy scalania |
| `src/pages/tablet/useBatchDrag.ts` (nowy) | hook gestu: próg 600 ms, przenoszenie, auto-przewijanie |
| `src/pages/tablet/DeboningHmiV10Page.tsx` | użycie kolejności w `allActiveBatches`, podpięcie hooka, pozycja w menu serwisowym |

Logika scalania i gest są rozdzielone celowo: scalanie da się przetestować
w vitest (środowisko `node`, bez DOM), gest wymaga urządzenia.

## Testy

`batchOrder.test.ts` (vitest):

- zapisana kolejność jest zachowana,
- partia spoza konfiguracji ląduje na końcu,
- kilka partii spoza konfiguracji jest między sobą FEFO,
- numer z konfiguracji nieobecny na liście jest pomijany bez błędu,
- pusta konfiguracja = czyste FEFO (zachowanie dzisiejsze),
- funkcja nie mutuje wejścia.

Gest sprawdzany na kiosku: przytrzymanie unosi kafel, zwykłe kliknięcie nadal
wybiera partię, po przeniesieniu kolejność przeżywa odświeżenie strony i jest
widoczna na drugim stanowisku.

## Wydanie

To zmiana w kiosku hali — **sam deploy `dist` jej tam nie dostarczy**. Ekrany
hali aktualizują się przez aplikację desktopową, więc wymagany jest podbity
numer wersji w `src-tauri/tauri.rozbior-v10.conf.json` i tag
`rozbior-v10-<wersja>` (patrz `kebab-release-process`, `kebab-kiosk-frontend-wbudowany`).
Backend wchodzi zwykłym deployem.

## Poza zakresem

- Układanie kolejności z poziomu biura.
- Osobna kolejność per zmiana lub per operator.
- Przenoszenie kafli na ekranach masowania i produkcji.
- Ukrywanie partii, na których dziś się nie pracuje (kolejność wystarcza —
  ukrywanie odcięłoby ostrzeżenia o terminach).
