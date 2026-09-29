# HMI Magazyn — poprawki po niezależnym review (frontend), 28.09.2026

Zakres: tylko frontend kiosku magazynu (`src/pages/tablet/MagazynHmiPage.tsx`,
`src/features/magazyn/*`). Backend i `docs/HMI_MAGAZYN_BACKEND_AUDYT_2026-09-28.md`
— osobny worker, tu nietknięte. **Nic nie zostało wdrożone** (bez `/opt/kebab/app`,
bez restartów, bez commitu/pusha).

Układ ekranu z poprzedniej iteracji zostaje bez zmian: aktywny karton ~2/3
szerokości, zakładki „Ostatnie skany / Inne kartony", znacznik `WERSJA_HMI`.

## Błędy z review i naprawy

### P1 — kod skanera rozcinał się na granicy fokusu
Repro (Chromium, `keyboard.type`): kartka na menu → wstrzymany
`GET /magazyn/pakowanie` → operator zaczyna sztukę `U|bc82b8…` na body →
odczyt się kończy, pole skanu dostaje fokus → reszta znaków w polu → dwa
`POST /magazyn/pakowanie/skan` ze śmieciowymi kodami.

Naprawa (`useSkanGlobalny.ts`): gdy fokus jest w polu tekstowym, hook nadal
milczy — **chyba że sam już zbiera kod** i poprzedni klawisz przyszedł
najwyżej `KONTYNUACJA_MS` = 100 ms temu (tempo skanera). Wtedy dokańcza bufor
i robi `preventDefault`, więc znak nie wpada drugi raz do pola. Enter i
auto-wysyłka bez Entera działają jak dotąd; kod idzie jedną kolejką strony do
kolejki pakowania (kolejność zachowana). Człowiek nie przeniesie fokusu na
inne pole w 100 ms, więc zwykłe pisanie w cudzych polach nie jest przejmowane.
Nie dodano drugiego bufora.

### P1 — operacja mroźni po wyjściu z ekranu
Repro: aktywny pełny karton wybrany z listy, skan `PAL|…` w polu, lookup
czeka, klik „Wstecz" → po lookupie stary callback wysyłał NOWY
`POST /api/pallets/scan {action: cold_storage}`.

Naprawa (`EkranPakowania.tsx`): strażnik kontekstu — `pokolenie` + `zywy` +
`blokada`. Pokolenie podbija: odmontowanie, każde włączenie blokady (dialog
korekty, menu serwisowe — `useLayoutEffect`), ręczny wybór kartonu z bocznej
listy (`wybierzRecznie`). Skan sprawdza `aktualny(pok)` po lookupie, po
odświeżeniu stanu i tuż przed POST mroźni. Nieaktualny → komunikat
„SKAN PRZERWANY — nic nie zapisano" (prawda: na tej ścieżce nie wyszedł żaden
zapis). Unieważnienie jest trwałe (zamknięcie dialogu nie wskrzesza skanu).
Odpowiedź POST, który już wyszedł, jest pokazana, ale nie zmienia aktywnego
kartonu u rodzica (także odpowiedź skanu sztuki).

`MagazynHmiPage.tsx`: wspólne `uniewaznij()` dla Wstecz/kafla/wyboru z listy,
otwarcia menu serwisowego i „Wyloguj": podbija pokolenie, czyści skany
czekające na pakowanie (z komunikatem), resetuje kolejkę globalną (nowy skan
nie czeka za odczytem, który już nic nie zmieni) i gasi spinner. Spinner ma
numer odczytu — `finally` starego odczytu nie gasi spinnera nowego. Po
odmontowaniu strony spóźniony odczyt nic nie ogłasza ani nie przełącza.

### Pozostałe uwagi review
1. Kartka kartonu spoza pamięci + nieudane odświeżenie (offline) →
   „BRAK AKTUALNYCH DANYCH … brak połączenia", a nie fałszywe „karton
   zamknięty/w mroźni"; nic nie jest wybierane ani zapisywane.
2. Okno `POWTORKA_KARTKI_MS` liczone od **chwili odczytu**: `PasSkanowania`
   niesie `{ ts }` (moment wejścia do kolejki; dla skanów z menu — `ts`
   z `SkanOczekujacy`) aż do decyzji; porównanie po ID lub kanonicznym kodzie
   kartki. Reguła „inny pełny → wybór, kolejny świadomy skan aktywnego po
   oknie → mroźnia" zachowana.
3. Pasek „Kartka kartonu otwiera (nic nie zapisuje)" tylko na menu / liście /
   wyborze auta; na pakowaniu (gdzie kartka pełnego kartonu zapisuje mroźnię)
   nie pojawia się nawet w trakcie spinnera. Reguła OTHER bez zmian.
4. `PasSkanowania`: dodany tylko drugi argument `onSkan(kod, { ts })` i
   opcjonalny `ts` w `dodaj`. Załadunek i mroźnia (bez `onPominiety`)
   zachowują dawne zachowanie — test regresyjny dodany. Ochrona
   `onPominiety` i czystość kolejki po odmontowaniu bez zmian.

## Testy dopisane
- `useSkanGlobalny.test.tsx`: fokus przechodzi do pola w połowie kodu (znaki
  do aktywnego elementu, pole dostaje znak tylko bez `preventDefault`) → jeden
  pełny kod, pole puste; człowiek piszący w polu po pauzie — nieprzejęty.
- `magazynComponents.test.tsx`: `onSkan` dostaje chwilę odczytu (nie
  wykonania); bez `onPominiety` kolejka wysyła mimo blokady (załadunek).
- `ekranPakowania.test.tsx`: wolny lookup + odmontowanie; + menu serwisowe
  (potem zamknięte); + ręczny wybór z listy; offline przy odświeżeniu;
  wolny duplikat innej formy kartki pełnego kartonu + świadomy skan po oknie.
- `magazynHmiPage.test.tsx`: fokus w połowie kodu na całej stronie (jeden
  POST z pełnym kodem i id kartonu); lookup + menu serwisowe; stary odczyt po
  „Wstecz" nie blokuje nowego i nie gasi jego spinnera; brak paska
  „nic nie zapisuje" na pakowaniu.
- `e2e/magazyn-pakowanie.spec.ts` (Playwright, wszystkie `**/api/**`
  zamockowane, `kebab.token=mock`, splash 5 s), 1024×768 i 1366×768:
  menu → QR → karton → sztuka z właściwym ID; wersja; brak poziomego
  overflow; przewinięcie wielopozycyjnego kartonu do końca; pole skanu
  i przyciski dialogu w widoku; przejęcie fokusu w połowie kodu (prawdziwe
  klawisze); lista z długimi nazwami i znacznikami.

## Status uruchomienia
Wykonawca nie mógł uruchomić npm/npx (brak uprawnień w jego środowisku);
wszystkie wyniki poniżej pochodzą z niezależnych przebiegów Senior Developera.
Komendy:

```
npm test -- src/features/magazyn src/features/scan src/features/loading src/pages/tablet/magazynHmiPage.test.tsx
npm run typecheck
npm run build
E2E_BASE_URL=http://127.0.0.1:5187 npx playwright test e2e/magazyn-pakowanie.spec.ts
```

### Wyniki końcowe Seniora — 29.09.2026 (po poprawce epoki kolejki)
- Unit frontend: **152 PASS** (9 plików).
- `npm run typecheck` — **PASS**.
- `npm run build` — **PASS** (tylko znane ostrzeżenia: Browserslist
  i duże bundle).
- E2E `e2e/magazyn-pakowanie.spec.ts` — **6 PASS** na 1024×768 i 1366×768,
  API w całości zamockowane.
- Niezależny retest w Chromium: wolny POST A, skan B w kolejce, menu
  serwisowe otwarte i zamknięte, odpowiedź A → B **nie został wysłany**,
  pokazany komunikat pominięcia; nowy skan C wysłany prawidłowo — **PASS**.

Wydanie: Magazyn HMI **1.0.6** (`src-tauri/tauri.magazyn.conf.json`).
Commit, CI, publikacja tagu `magazyn-1.0.6` i wdrożenie są na tym etapie
**dopiero przygotowywane** (wykonuje Senior) — nie są ukończone.

### Historia: wyniki Seniora po poprzedniej implementacji
- Unit frontend: **151 PASS**.
- `E2E_BASE_URL=http://127.0.0.1:5187 npx playwright test e2e/magazyn-pakowanie.spec.ts --workers=2`
  — **6 PASS** (1024/1366, QR→sztuka, przejęcie fokusu, wielopozycyjny
  karton/dialog, lista).
- Niezależny retest w przeglądarce: oczekujący lookup PAL + „Wstecz" —
  ZERO POST po odmontowaniu — **PASS**.
- `npm run typecheck` — **FAILED** w `magazynComponents.test.tsx:109`
  (atrapa `onSkan` z jednym argumentem, test czytał `meta`) — poprawione.
  `npm run build` jeszcze nie uruchomiony (łańcuch zatrzymał się na typach).
- Senior odtworzył w Chromium: wolny POST A, skan B w kolejce, menu
  serwisowe otwarte i zamknięte przed powrotem A → B wysyłał nowy POST.
  Naprawione epoką kolejki w `PasSkanowania` (tylko tryb z `onPominiety`):
  blokada podbija epokę, czekający skan z poprzedniej epoki jest pomijany
  z komunikatem „Skan oczekiwał na wysłanie, gdy ekran został
  zablokowany/zmieniony. Zeskanuj ponownie.", nawet gdy dialog już zamknięto.
  Regresja w `magazynComponents.test.tsx`.

Wyniki po tej poprawce — patrz „Wyniki końcowe Seniora" wyżej.

## Ograniczenia
- Fizyczny skaner (Zebra DS2278 / HID) nie był testowany; e2e emuluje go
  `keyboard.type` z odstępem 5–15 ms/znak. Skaner z odstępami > 100 ms między
  znakami przy zmianie fokusu nadal może rozciąć kod (poza tym progiem
  traktujemy klawisze jak pisanie człowieka).
- Połówka kodu bez Entera może zostać wysłana timerem auto-wysyłki
  (150 ms ciszy), jeśli skaner sam zrobi przerwę w połowie kodu — zachowanie
  sprzed zmian.
- Żądanie POST, które już wyszło, nie jest anulowane — jego wynik jest
  pokazywany uczciwie, ale nie przestawia ekranu.
- Brak wdrożenia; brak sprawdzenia na stanowisku Tauri.
