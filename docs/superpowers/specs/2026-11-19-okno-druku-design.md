# Własne okno druku (drukarka, zasobnik, kolor) i rejestr wydruków

Data: 19.11.2026 · Gałąź: `feat/okno-druku-20261119` (z `7a1c300c`, czyli z kodu stojącego na produkcji)

## Po co

W biurze stoi Konica Minolta bizhub z 4 zasobnikami. W zasobniku 1 jest biały papier, w pozostałych kolorowy, a różne dokumenty idą na różnych kolorach. Dziś przy każdym wydruku trzeba wejść w ustawienia drukarki Windows i przestawić zasobnik. Właściciel chce mieć własny ekran druku, jak w Subiekcie: wybór drukarki, zasobnika, koloru i kopii przy każdym wydruku, z ustawieniami domyślnymi zapamiętanymi na każdym z trzech komputerów.

Druga potrzeba wyszła przy TRUVA/Z/2/11/26 (19.11): nie było widać, czy kartki palet zostały wydrukowane. Paleta dodana w ostatniej chwili (P14, P15) nie miała kartki i mroźnia nie mogła jej zważyć.

## Cele

1. Każdy wydruk z programów na komputerze (MES biuro, PROTRIMA) otwiera nasze okno druku zamiast systemowego.
2. W oknie: drukarka, a pod nią wszystkie ustawienia, które udostępnia jej sterownik (nie tylko zasobnik 1–4): zasobnik, kolor albo czarno-biały, dwustronnie, format i rodzaj papieru, jakość, sortowanie, zszywanie i dziurkowanie, jeśli bizhub ma finiszer, i inne opcje sterownika Konica. Do tego kopie, zakres stron i przycisk „Ustawienia drukarki…” otwierający oryginalne okno sterownika (właściciel 19.11: „nie tylko wybór zasobnika od 1–4, jeżeli drukarka udostępnia takie rzeczy”).
3. Domyślnie zasobnik 1. Ustawienia zapamiętane osobno dla każdego rodzaju dokumentu i osobno na każdym komputerze.
4. Zasobnikom można nadać kolor papieru („Zasobnik 3 – zielone”), osobno na każdym komputerze (decyzja właściciela 19.11). Lista pokazuje oba: nazwę ze sterownika i kolor.
5. Każdy wydruk zapisuje się na serwerze: co, kto, na jakim komputerze, kiedy, drukarka, zasobnik, kopie.
6. Przy paletach (rozpis w PROTRIMA i w MES) widać „wydrukowano 19.11 11:40 · am” albo wyróżnione „kartka niewydrukowana”.

## Poza zakresem

- Drukarki etykiet Zebra (ZPL, osobna ścieżka). Ich druk zostaje bez zmian.
- Wydruki w zwykłej przeglądarce (bez aplikacji Tauri) zostają przy `window.print()`, bo przeglądarka nie ma dostępu do sterownika. Rejestr wydruku zapisuje się też tam.
- Kioski HMI na hali (magazyn, rozbiór, masowanie) w tej wersji. Mają wspólny kod Tauri, więc dostaną to samo okno przy okazji, ale nikt ich nie testuje pod kątem tego projektu.
- Podgląd wydruku w oknie. Dokument jest już widoczny na ekranie, z którego się drukuje.

## Czego nie wolno zepsuć

- Wydruk nie może cicho przepaść. Jeśli druk natywny zawiedzie (brak sterownika, stara wersja aplikacji), użytkownik dostaje czytelny komunikat i może wydrukować starym oknem systemowym.
- Kartki palet muszą mieć skalę 100%. Okno nie może skalować ani dopasowywać strony do papieru, bo QR na kartce przestanie się skanować.
- Rejestr nie może blokować druku. Gdy serwer nie odpowiada, druk idzie, a wpis zostaje ponowiony.

## Rozważone sposoby

| Sposób | Co daje | Dlaczego tak / nie |
|---|---|---|
| **Natywny druk przez część Windows aplikacji Tauri (wybrany)** | Pełny wybór zasobnika ze sterownika, jak w Subiekcie, bez dodatkowych programów | Jedyny, który daje zasobnik przy każdym wydruku bez ręcznego ustawiania komputerów. Właściciel wybrał go 19.11. |
| PDF + zewnętrzny program (SumatraPDF) | Wybór zasobnika | Odrzucony przez właściciela: obcy program w instalatorze. |
| Wbudowany druk WebView2 | Drukarka, kopie, kolor | Nie ma wyboru zasobnika, a to sedno sprawy. |
| Kilka kopii drukarki w Windows z różnymi zasobnikami | Bez programowania | Ręczna konfiguracja na 3 komputerach, rozjeżdża się po zmianie sterownika. Odrzucony. |

## Jak to działa (decyzje)

### Druk natywny (Rust, `src-tauri`, tylko Windows)

Opcje drukarki bierzemy z **PrintCapabilities** (Print Schema Windows): sterownik opisuje w nim WSZYSTKIE swoje ustawienia, razem z nazwami do pokazania, także te własne Konica (zszywanie, dziurkowanie, rodzaj papieru w zasobniku). Dzięki temu okno pokazuje to, co drukarka naprawdę oferuje, zamiast stałej listy. Wybór zapisujemy jako **PrintTicket** (XML), a przy druku sterownik zamienia go na swoje ustawienia.

Nowe komendy Tauri (moduł `src-tauri/src/druk.rs`, pod `#[cfg(windows)]`; na innych systemach zwracają błąd „nieobsługiwane”):

- `drukarki()` – lista drukarek (`EnumPrintersW`) z zaznaczoną domyślną Windows.
- `mozliwosci(drukarka, ticket?)` – `PTOpenProvider` + `PTGetPrintCapabilities`: lista funkcji (`psf:Feature`) z nazwą wyświetlaną, typem i opcjami (`psf:Option` z nazwą), plus parametry liczbowe (np. kopie). Do tego aktualny wybór z ticketu (podanego albo domyślnego dla użytkownika). Zwracamy prosty JSON: `[{ id, nazwa, opcje: [{ id, nazwa }], wybrana }]`.
- `ustawienia_sterownika(drukarka, ticket?)` – otwiera oryginalne okno sterownika (`DocumentPropertiesW` z `DM_IN_PROMPT | DM_OUT_BUFFER`, ticket → DEVMODE i z powrotem przez `PTConvertPrintTicketToDevMode` / `PTConvertDevModeToPrintTicket`) i zwraca nowy ticket.
- `drukuj_pdf(drukarka, pdf_base64, ticket, kopie, strony)` – ticket → DEVMODE (`PTConvertPrintTicketToDevMode`, zakres `kPTJobScope`), kontekst `CreateDCW` z tym DEVMODE, strony PDF rysowane przez PDFium (crate `pdfium-render`, `pdfium.dll` dołączona do instalatora) w skali 1:1 względem fizycznego marginesu drukarki (`GetDeviceCaps` PHYSICALOFFSETX/Y). Zwraca liczbę stron.
- Źródło PDF: bieżąca strona wydruku zamieniona na PDF przez WebView2 (`ICoreWebView2_7::PrintToPdf` przez `with_webview`, bez marginesów, z tłem, rozmiar papieru z `@page` dokumentu). Gdzie dokument już jest PDF-em z serwera (podgląd WZ/CMR/HDI w PROTRIMA), drukujemy ten PDF bez ponownej zamiany.

Druk przez PDF, a nie przez GDI bezpośrednio ze strony, bo WebView2 nie potrafi narysować strony na kontekście drukarki z naszymi ustawieniami, a PDF zachowuje dokładnie to, co dziś wychodzi z wydruku przeglądarkowego.

### Okno druku (React, wspólne)

- Jeden komponent `OknoDruku` w `src/lib/druk/` używany przez MES i PROTRIMA. Wygląd w stylu PROTRIMA (tokeny PROTRIMA), ten sam w MES.
- Wywołanie: `drukuj({ rodzaj: 'kartki-palet', tytul, rejestr: {...} })`. Funkcja `drukuj()` z `src/lib/print.ts` zostaje punktem wejścia: w Tauri otwiera nasze okno, w przeglądarce `window.print()`. Miejsca, które dziś wołają `window.print()` bezpośrednio (10 plików, m.in. `KartkiPalet.tsx`, `ZamowienieDruk.tsx`, `ListaKompletacji.tsx`, `RozrachunkiDrukPage.tsx`), przechodzą na `drukuj()`.
- Pola stałe: drukarka, kopie, zakres stron, „Ustawienia drukarki…”, „zapamiętaj dla <rodzaj dokumentu>” (domyślnie zaznaczone), Drukuj / Anuluj. Enter drukuje.
- Pola ze sterownika (z `mozliwosci`): na górze najczęstsze, jeśli drukarka je ma: zasobnik (`psk:PageInputBin` / `psk:JobInputBin`), kolor (`psk:PageOutputColor`), dwustronnie (`psk:JobDuplexAllDocumentsContiguously`), format papieru (`psk:PageMediaSize`), rodzaj papieru (`psk:PageMediaType`). Pozostałe funkcje sterownika (jakość, sortowanie, zszywanie, dziurkowanie, opcje własne Konica…) w rozwijanej sekcji „Więcej ustawień drukarki”, każda jako lista wyboru z nazwami ze sterownika. Funkcje bez opcji do wyboru i czysto techniczne (np. `psk:PageScaling`, `psk:PageResolution` z jedną opcją) pomijamy. Skalowanie jest zawsze wyłączone (1:1).
- Przy błędzie druku natywnego: komunikat z treścią błędu i przycisk „Drukuj oknem systemowym” (dzisiejsza ścieżka `print_page`).

### Ustawienia na komputerze

- Plik JSON w katalogu danych komputera (wspólny dla MES i PROTRIMA na tym komputerze, np. `%APPDATA%\\KebabMES\\druk.json`), osobny na każdym z trzech komputerów: ustawienia na rodzaj dokumentu (drukarka, PrintTicket XML, kopie) i kolory zasobników na drukarkę.
- Pierwsze uruchomienie: domyślna drukarka Windows z jej domyślnym ticketem, a w nim zasobnik 1 (opcja, której nazwa zawiera „1”, inaczej pierwsza na liście), czarno-biały, 1 kopia.
- Rodzaje dokumentów: stała lista w kodzie (kartki palet, WZ, WM, CMR, HDI, lista kompletacji, zamówienie, rozrachunki, rozliczenie dostawy, paski wypłat, plan masowania, inne). Nieznany wydruk idzie jako „inne”.

### Rejestr wydruków (backend)

- Tabela `print_log`: id, `rodzaj`, `tytul`, `order_id` (nullable), `pallet_ids` text[], `dokument_id` (nullable), `drukarka`, `zasobnik`, `kopie`, `stron`, `komputer` (nazwa komputera z Tauri), `operator` (z sesji), `at`.
- `POST /api/druk/rejestr` (zapis), `GET /api/druk/rejestr?order_id=` (lista dla zamówienia). Log `druk.zapisany` z polami.
- `order_pallets` dostaje w odczycie listy palet pola `ostatni_wydruk_at` i `ostatni_wydruk_kto` (z `print_log`, bez nowej kolumny).
- Zakładka „Palety” w PROTRIMA i `PalletsEditor` w MES: znacznik przy palecie. Paleta, która nigdy nie była drukowana, ma ostrzeżenie „kartka niewydrukowana”, a nagłówek mówi „3 palety bez kartki”.

## Wydanie

- Nowe wersje: PROTRIMA, MES biuro (desktop „produkcja”), każda z `pdfium.dll` w instalatorze, oraz backend (tabela i API). Auto-aktualizacja jak dziś.
- Przed wydaniem zrzuty okna druku i znaczników do akceptacji właściciela.
- Testy natywnej części wymagają Windows: budowa na GitHub Actions (`windows-latest`, jak dziś `tauri-protrima.yml`) i próba na jednym komputerze biura z bizhubem przed wydaniem na trzy komputery.

## Zostawione budującemu

- Dokładne wywołanie `PrintToPdf` przez `webview2-com` w Tauri 2 i wersje crate'ów.
- Drukarki ze starym sterownikiem bez sensownych nazw w PrintCapabilities: pokazać nazwę techniczną opcji.
- Kolejność pól w „Więcej ustawień drukarki” (alfabetycznie albo jak w sterowniku).
- Gdzie dokładnie w nagłówku zakładki „Palety” stoi licznik palet bez kartki (zgodnie z istniejącym układem).
