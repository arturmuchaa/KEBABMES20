# PROTRIMA — zasady pracy (od 6.11.2026)

Ten plik jest dołączony do CLAUDE.md. Zastępuje `ZASADY_PROBY.md` (zostaje jako historia próby z 30.10).
Reguły z CLAUDE.md (niezmienniki domeny, testy komponentów, mapery z testami) obowiązują dalej.

## Cel

PROTRIMA (`src/protrima/`, wejście `protrima.html`, instalator `pl.protrima.biuro`) jest docelowym
programem biura i zastępuje stary MES biura — moduł po module. Panele hali (rozbiór, masowanie,
produkcja, magazyn/mroźnia) zostają osobnymi programami.

**Każdy moduł ze starego MES jest najpierw SPRAWDZONY, a potem zrobiony LEPIEJ i FUNKCJONALNIEJ —
nigdy 1:1** (właściciel, 6.11.2026). Przegląd starego modułu (co robi biuro, gdzie klika za dużo,
znane błędy i obejścia) → lepszy przepływ (mniej klikania, skróty, akcje zbiorcze, podpowiedzi,
bez martwych przycisków) → reguły biznesowe i DTO ze starego MES → w raporcie: co działa inaczej i dlaczego.

## Zasady

1. **Jedna linia kodu.** PROTRIMA i produkcja żyją na tej samej gałęzi wydań. Nowe wydania serwera
   i paneli hali budujemy z niej, nie z osobnych gałęzi z boku (inaczej znów się rozjedzie).
2. **Serwer wolno zmieniać** — z testami (pytest; DB przez `TEST_DATABASE_URL`), zielonym CI
   i zwykłą procedurą wdrożenia na produkcję (`proba_generalna.sh`, kopia, `deploy.sh`, `smoke.sh`).
   Endpointy, z których korzystają panele hali i stary MES, zmieniaj tylko wstecznie zgodnie.
3. **`src/lib/api.ts` jest wspólne z kioskami** — zmiany tylko addytywne i zgodne wstecz.
4. **Starej części webowej NIE usuwamy z serwera**, także po wycofaniu starego programu biura:
   serwer robi PDF-y WZ/HDI/CMR/HACCP z jej tras `/office/*/druk` (także dla PROTRIMA), a z niej
   korzystają `/mobile/*`, kody QR palet `/m/p/:orderId/:palletNo`, `/tablet/*`, `/etykiety/*`, `/panel`.
5. **Produkt dla wielu zakładów.** Nazwy firm, logo, adresy serwera, standardy pakowania i progi
   nigdy w modułach — tylko z serwera albo z `src/protrima/zaklad/`.
   Sprawdzenie: `grep -rni 'księżyc\|91\.98' src/protrima` trafia wyłącznie w `zaklad/`.
6. **Trzy miary zamówienia osobno:** produkcja (zgłoszenia), pokrycie (magazyn + wydano), wysyłka
   (wydano). Nigdy jeden wspólny procent (`src/features/orders/lineShipping.ts`, `orderPlanning.ts`).
7. **Nie udawaj funkcji.** Czego nie ma — przycisk wyłączony z opisem albo brak przycisku.
   Brak w API → `docs/protrima-ui/BRAKI_API.md`.
8. **Wygląd UI przed wydaniem** — zrzuty 1920×1080 i 1366×768 (jasny i ciemny) do akceptacji
   właściciela przy zmianach widocznych dla biura.

## Wydanie PROTRIMA

Wersja: `version` w `src-tauri/tauri.protrima.conf.json`. Workflow `tauri-protrima.yml`.
Testy: `npx tsc --noEmit`, `npx vitest run --pool=forks --poolOptions.forks.singleFork src/protrima`
(maszyna ma mało pamięci — bez singleFork vitest pada), `npm run build`.
Środowisko próby (:8090, `deploy/protrima_proba.sh`, kopia bazy) można dalej używać do sprawdzania
nowych modułów na danych bez ryzyka dla produkcji.
