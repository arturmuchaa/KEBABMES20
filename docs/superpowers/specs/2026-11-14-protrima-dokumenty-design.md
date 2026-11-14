# PROTRIMA — moduł „Dokumenty” (etap 2a)

Data: 2026-11-14 · Gałąź: `feat/protrima-dokumenty-20261114` (prod f6a405a1 = 0.10.0) · Zatwierdzone przez właściciela 14.11.

## Po co
Biuro potrzebuje jednego miejsca na wszystkie dokumenty wydania: lista WZ/WM, CMR i HDI z sortowaniem, filtrowaniem, podglądem, drukiem (także zbiorczym jednym PDF), PDF-em i edycją. Dziś to zaślepka odsyłająca do starego MES (trzy osobne strony).

## Decyzje (właściciel)
- Jeden moduł „Dokumenty” w sidebarze z zakładkami **WZ / CMR / HDI** w środku (nie rozwijana grupa w sidebarze) — powody: zwinięty sidebar przy 1366 px, filtry wspólne między zakładkami, jedno okno robocze.
- Druk zbiorczy = **jeden scalony PDF** (istniejący mechanizm `polaczPdf`).
- Wygląd wydruków (etap 2b) osobno, po tym module, z wariantami do wyboru.

## Zakres
**Lista (każda zakładka):** szukaj (numer, klient, zamówienie), okres (dziś / 7 dni / ten miesiąc / poprzedni miesiąc / wszystko / zakres dat), klient, stan (aktywne / anulowane / wszystkie); WZ dodatkowo seria (WZ+WM / tylko WZ / tylko WM). Sortowanie kliknięciem w nagłówek kolumny. Filtry wspólne dla zakładek (klient, okres, szukaj zostają przy przełączeniu). Liczniki w zakładkach (np. „WZ 447”). Zaznaczanie ptaszkami + „Zaznacz wszystkie widoczne”.
- Kolumny WZ: numer, data wydania, klient, zamówienie, seria, wartość z walutą, stan (wystawiony / załadowany / rozjazd / anulowany).
- Kolumny CMR: numer, data, klient, zamówienie, przewoźnik, stan.
- Kolumny HDI: numer, data, klient, zamówienie, rodzaj (całość / do faktury / usługa), stan (w tym „niekompletny”).

**Panel podglądu (po prawej, jak w Recepturach):** PDF z serwera — ten sam, który wyjdzie z drukarki; nagłówek z numerem, klientem, datą; przyciski działań.

**Działania:**
- Wszystkie: Drukuj / Otwórz PDF (pojedynczo), Drukuj zaznaczone i Pobierz PDF (zbiorczo, jeden plik).
- WZ/WM: Popraw ceny i walutę (kurs NBP), Dopisz pozycję… (etap 1), Anuluj (z potwierdzeniem; tylko gdy serwer pozwala — przy WM/WZ z kursu i dokumentach podziału przycisk wyłączony z podpowiedzią), Raport rozjazdu (gdy `loading_status='rozjazd'`), Zamówienie → otwiera kartę zamówienia.
- CMR: Edytuj (pola dokumentu, zapis `PATCH /cmr/{id}`).
- HDI: Anuluj (z potwierdzeniem).

**Wejście:** sidebar „Dokumenty”, paleta Ctrl+K („WZ”, „CMR”, „HDI” otwierają moduł na danej zakładce), skróty z menu. Moduł znika z listy „na razie w starym MES”.

## Nie-cele
Nowy wygląd wydruków (2b). Wystawianie nowych dokumentów z tego modułu (zostaje w zamówieniu / kursie / Wyrobie gotowym). Edycja HDI. Stronicowanie na serwerze (dokumentów jest kilkaset).

## Anty-cele
Działanie, które serwer odrzuci, wygląda na dostępne. Podgląd różny od wydruku. Filtry gubione przy przełączeniu zakładki.

## Podejście techniczne
- Serwer: listy `GET /wz`, `/cmr`, `/hdi` dostają brakujące pola (seria, zakres podziału, waluta, numer i id zamówienia, stan załadunku, rodzaj HDI) — dopisane kolumny, bez zmiany istniejących.
- PROTRIMA: `src/protrima/modules/dokumenty/` — `model.ts` (filtry, sort, dostępność działań — czyste funkcje), `DokumentyModule.tsx` (układ workarea + dock jak Receptury), okna działań. PDF w podglądzie przez `fetchBlob` → `<iframe>` z blob URL.

## Do decyzji budującego
Szerokości kolumn, teksty podpowiedzi, kolejność przycisków; zrzuty do akceptacji przed wdrożeniem.
