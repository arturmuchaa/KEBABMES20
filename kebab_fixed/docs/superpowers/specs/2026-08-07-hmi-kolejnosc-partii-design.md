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

Pozwolić hali ułożyć pasek w kolejności, w jakiej realnie pracuje.

### Sterowanie — tryb układania i przeciąganie palcem

**Pierwotny pomysł (przytrzymanie kafla + przeciągnięcie) odpadł: ten gest
jest już zajęty.** Przytrzymanie kafla partii przez 600 ms otwiera kreator
ważenia kości i grzbietów w trakcie rozbioru
(`onLongPress={openWizardInProgress}` w `DeboningHmiV10Page.tsx`). Podpięcie
pod niego przenoszenia zabrałoby hali ważenie ubocznych.

Zamiast tego (decyzje użytkownika z 2026-08-07):

- **trzy szybkie dotknięcia kafla partii** włączają tryb układania — licznik
  zeruje się po 600 ms przerwy, więc zwykłe klikanie w partie go nie uzbiera;
  wejściu towarzyszy komunikat, bo gest jest niewidoczny,
- w tym trybie kafle **przeciąga się palcem** — kolejność zmienia się na żywo
  pod palcem, a puszczenie zapisuje,
- **„Gotowe"** wychodzi z trybu, **„FEFO"** przywraca kolejność domyślną.

Pierwsza wersja (1.0.72) miała przycisk „Ułóż" na pasku; użytkownik uznał go
za zbędny element na ekranie i w 1.0.73 zastąpił gestem. Przyciski „Gotowe"
i „FEFO" pojawiają się wyłącznie w trybie układania.

**Skutek uboczny wymagający naprawy:** `pickBatch` czyścił wpisane kilogramy
przy KAŻDYM dotknięciu kafla, więc trzykrotne dotknięcie partii, na której
operator już pracuje, kasowałoby mu wagę. Od 1.0.73 ponowne dotknięcie tej
samej partii nie rusza pól — to naprawia też zwykłe omyłkowe dotknięcia.

Przeciąganie jest bezpieczne właśnie dlatego, że działa w osobnym trybie:
wybór partii i przytrzymanie (ważenie ubocznych) są tam wyłączone, więc palec
nie ma z czym kolidować. Na czas przeciągania `touchAction: 'none'` wyłącza
natywne przewijanie paska, a pointer capture utrzymuje zdarzenia na kaflu,
gdy palec z niego zjedzie. Cel wyliczany jest z ŻYWYCH prostokątów kafli
(`getBoundingClientRect`), nie z arytmetyki na szerokościach — kafle
przestawiają się w trakcie ruchu i tylko rect mówi prawdę o tym, co widzi
operator.

W trakcie prac 1.0.73 miała najpierw strzałki ‹ ›; użytkownik wolał
przeciąganie palcem i tak zostało wydane.

W trybie układania kliknięcie w kafel **nie zmienia wybranej partii**
i przytrzymanie **nie otwiera ważenia** — inaczej układanie kolejności
wpadałoby w te same pomyłki, które ma likwidować.

Kolejność zapisuje się po **każdym** puszczeniu kafla (optymistycznie, PUT
w tle), więc odejście od ekranu bez kliknięcia „Gotowe" niczego nie gubi.
Dotknięcie bez przesunięcia nie generuje zapisu.

### Trwałość

Kolejność jest **wspólna dla całej hali**, bo odzwierciedla fakt (ustawienie
palet, plan dnia), a nie preferencję operatora.

- Klucz `hmi_batch_order` w istniejącej tabeli `app_settings` — bez migracji.
- Wartość: JSON `{"order": ["467","468","466"]}`; znacznik czasu trzyma
  kolumna `updated_at` tabeli, więc nie dublujemy go w treści.
- Endpoint `GET /api/deboning/batch-order` i `PUT` z tym samym kształtem.
- Kluczem jest **numer partii** (`internal_batch_no`), nie id — czytelny przy
  diagnozie w bazie i unikalny (kolumna ma UNIQUE). Anulowanie partii zmienia
  numer na `ANUL-<id>`, ale anulowana partia i tak znika z paska.

Kiosk czyta kolejność razem z cyklicznym odświeżaniem listy partii.

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

Przycisk **„FEFO"** w trybie układania kasuje `hmi_batch_order` i przywraca
kolejność domyślną. Świadomie NIE chowamy go za kodem serwisowym 0099 —
przywrócenie FEFO jest działaniem bezpiecznym, a ukrycie go sprawiłoby, że
źle ułożony pasek zostaje na cały dzień.

## Architektura

| Warstwa | Zmiana |
|---|---|
| `backend/app/services/settings_service.py` | `get_hmi_batch_order()` / `save_hmi_batch_order(order)` na `app_settings` |
| `backend/app/routes/deboning.py` | `GET`/`PUT /api/deboning/batch-order` |
| `src/pages/tablet/batchOrder.ts` (nowy) | czysty `mergeBatchOrder` + typy |
| `src/pages/tablet/batchOrder.test.ts` (nowy) | testy scalania |
| `backend/tests/test_hmi_batch_order.py` (nowy) | walidacja konfiguracji, bez bazy |
| `src/pages/tablet/DeboningHmiV10Page.tsx` | kolejność w `allActiveBatches`, tryb układania, przeciąganie kafli |

Trasa siedzi pod `/api/deboning`, a nie `/api/settings`: RBAC
(`app/auth/permissions.py`) daje kioskowi dostęp do prefiksu `/api/deboning`
przez rolę `rozbior`, natomiast `/api/settings` jest zarezerwowane dla biura.
Ten sam wzorzec zastosowano wcześniej dla tar wózków.

Logika scalania jest wydzielona celowo: da się ją przetestować w vitest
(środowisko `node`, bez DOM), a sam tryb układania sprawdza się na kiosku.

## Testy

`batchOrder.test.ts` (vitest):

- zapisana kolejność jest zachowana,
- partia spoza konfiguracji ląduje na końcu,
- kilka partii spoza konfiguracji jest między sobą FEFO,
- numer z konfiguracji nieobecny na liście jest pomijany bez błędu,
- pusta konfiguracja = czyste FEFO (zachowanie dzisiejsze),
- funkcja nie mutuje wejścia.

`backend/tests/test_hmi_batch_order.py` (pytest, bez bazy): duplikaty, puste
wpisy, wartość niebędąca listą, zbyt długi numer, limit pozycji.

Na kiosku: trzy szybkie dotknięcia włączają tryb (z komunikatem), kafel
przeciąga się palcem, „Gotowe" wychodzi, przytrzymanie kafla POZA trybem nadal
otwiera ważenie ubocznych, wpisane kilogramy przeżywają ponowne dotknięcie
tej samej partii, a kolejność przeżywa odświeżenie strony i jest widoczna
na drugim stanowisku.

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
