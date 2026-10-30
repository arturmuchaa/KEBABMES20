> **Kopia referencyjna w repo KEBABMES20.** Wzór wyglądu dla próby PROTRIMA — nie budujemy jej tutaj.
> Kod przenosimy do `src/protrima/` według `docs/protrima-ui/PLAN_PROBY.md`; dane demo (`src/data/demo.ts`)
> nie wchodzą do próby.

# PROTRIMA — demo interfejsu v0.3 (Pulpit, Zamówienia, Wyrób gotowy)

Działający prototyp nowego interfejsu biurowego PROTRIMA. **Nie jest podłączony do KEBABMES20** —
wszystkie dane są demonstracyjne (`src/data/demo.ts`), zamrożone na 29.10.2026, 10:42.
Zmiany wprowadzone w demo (edycja ilości, palety, WZ, anulowanie) żyją tylko w pamięci karty.

## Uruchomienie

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/ — zwykła aplikacja (ten sam stos co KEBABMES20: React + TS + Vite)
npm run build:artifact   # dist-artifact/protrima.html — jeden plik do podglądu
python3 scripts/shots.py # zrzuty ekranu z uruchomionej aplikacji (wymaga `npm run preview`)
```

## Struktura

```
src/styles/tokens.css     tokeny: kolory (jasny + grafitowy), typografia, gęstość komfortowa/kompaktowa
src/styles/base.css       przyciski, pola, chipy, statusy, mierniki, panele, komunikaty
src/styles/shell.css      pasek roboczy z kartami, nawigacja, pasek stanu, menu, okna, powiadomienia
src/styles/table.css      wspólna tabela danych (grupy, zaznaczanie, sortowanie, alerty)
src/styles/modules.css    linia procesu, Pulpit, Zamówienia, palety, formularze
src/shell/                powłoka: karty robocze, nawigacja wg przepływu zakładu, Ctrl+K, kontekst aplikacji
src/data/model.ts         typy i obliczenia (pokrycie / produkcja / wysyłka — osobno)
src/data/demo.ts          dane demonstracyjne
src/modules/dashboard/    Pulpit zakładu
src/modules/orders/       lista, dolny panel, 8 zakładek, okno zamówienia, nowe zamówienie
src/modules/stock/        Wyrób gotowy: pozycje, przydział, kartony, ruchy, śledzenie partii
src/data/stock.ts         magazyn wyrobu gotowego (pozycje budowane z zamówień)
src/modules/misc/         System projektowy, moduły spoza demo
```

## Najważniejsze decyzje

- **Klasyczne okno Windows 2026, trzy pasy u góry**: (1) pasek tytułu — logo, szukaj, zakład, konto, przyciski okna;
  (2) menu Plik, Edycja, Widok, [moduł], Raporty, Narzędzia, Okno, Pomoc; (3) pasek narzędzi programu
  (Nowe ▾, Plan produkcji, Raport dzienny, Drukuj ▾, Eksport ▾, Odśwież … Więcej akcji ▾). Niżej karty okien,
  pasek akcji modułu (dla zaznaczonego rekordu) i następny krok w dolnym panelu. Pasek narzędzi można ukryć
  i wyłączyć etykiety (Widok).
  Każde polecenie istnieje raz (`Cmd` w `shell/context.tsx`): ten sam obiekt trafia na pasek narzędzi,
  do menu modułu i pod skrót. Alt otwiera menu (Alt+P, Alt+E, Alt+W…), strzałki chodzą po menu.
- **Wspólny stan zamówień i magazynu** (`data/store.tsx`): przydział w „Wyrobie gotowym” od razu zmienia
  pokrycie zamówienia; każda zmiana stanu zapisuje ruch magazynowy.

- **Karty robocze** zamiast przeładowywania stron: Pulpit przypięty, moduły i pojedyncze zamówienia
  otwierają się w kartach (Ctrl+1…9, Ctrl+W).
- **Lista + dolny panel + karta**: ten sam komponent `OrderDetail` działa w panelu i na całej karcie.
  Kolejne moduły (magazyn, palety, plan) dostają ten sam szkielet.
- **Trzy miary osobno**: Produkcja (zgłoszono z tabletów), Pokrycie (magazyn + wydano), Wysyłka (wydano).
  Osobne kolory, osobne kolumny, nigdy jeden procent. Zgodne z `docs/ORDER_PROGRESS_POLICY.md`.
- **Wyjątek głośny, norma cicha**: statusy cyklu życia kodowane kształtem znacznika, kolory stanów
  tylko dla problemów. Linia procesu na Pulpicie i w zamówieniu używa tych samych węzłów.
- **Gęstość zamiast pomniejszania**: przy 1366 × 768 zmienia się wysokość wierszy, nawigacja zwija się
  do ikon, mniej ważne kolumny się chowają. Tekst nie schodzi poniżej 12 px.
- **Stałe numery palet**: usunięta paleta zostaje widoczna jako zablokowany numer, nowa dostaje następny.

## Droga do wdrożenia (kolejny etap)

| Demo | KEBABMES20 |
|---|---|
| `Order`, `Line` | `ClientOrder`, `OrderLine` (`qty`, `qtyStock`, `qtyDelivered`, `production.reportedQty`) |
| `Pallet` | `OrderPallet` (`palletNo`, `cartonNo`, `status`) |
| `computeMetrics()` | `lineShipping.ts` + `orderPlanning.ts` (logika zostaje po stronie istniejącego kodu) |
| `useOrders()` | `useApi(() => clientOrdersApi.list())` + `useLiveRefresh` |
| Pulpit | `rawBatchesApi`, `meatStockApi`, `productionPlansApi`, `productionSessionsApi.pending`, `receptionChecksApi.pending`, `zaladunkiApi.doWydruku` |

Czcionka: IBM Plex Sans / Mono (licencja OFL), osadzona lokalnie przez `@fontsource` — działa offline w Tauri.

## Znak

`src/brand/Logo.tsx` używa krzywych z paczki „PROTRIMA_Pakiet_dla_grafika_2026-10-28” (Koncepcja 02) bez zmian kształtu.
Zmienione są tylko kolory: połączone „pr” w kolorze akcentu (`--logo-mark`), reszta nazwy w graficie (`--logo-type`);
w motywie grafitowym jasne odpowiedniki. Wersja jednokolorowa: `<Logo mono />`. Oryginalne pliki: `src/brand/files/` (SVG)
i `public/brand/` (ICO, PNG). To wektory robocze — po dopracowaniu przez grafika wystarczy podmienić ścieżki.
