# Projekt: Etykiety Zebra (ZPL z ZebraDesigner) + druk przez BrowserPrint

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)

## Kontekst i cel

Część etykiet projektujemy w **ZebraDesigner** i drukujemy na **drukarkach Zebra**
(termotransfer, ZPL). Dziś MES generuje wyłącznie **A4 PDF** drukowane przez przeglądarkę
(`LabelPrintPage`, `buildVectorPdf`). W tabeli `label_templates` istnieje kolumna `zpl`,
ale **nie jest używana do druku** — realnej integracji z Zebrą nie ma.

Cel: pozwolić wgrać szablon ZPL z ZebraDesigner (plik `.prn`/`.zpl` z placeholderami),
podstawić dane sztuki (QR, partia, daty, waga…) i wydrukować na drukarce Zebra przez
**Zebra BrowserPrint** — uruchamiane **osobnym przyciskiem „Drukuj Zebra"** (obok
istniejącego druku PDF), bez zmiany dotychczasowego przepływu A4.

### Decyzje (zatwierdzone w brainstormie)

- **Transport:** Zebra BrowserPrint — drukarka przy stanowisku (USB/LAN), aplikacja w
  przeglądarce wysyła ZPL do lokalnej drukarki.
- **Format:** tylko `.prn`/ZPL. `.nlbl` (NiceLabel XML) **nieobsługiwany** (wymaga silnika
  NiceLabel/SDK — poza zakresem).
- **Pola dynamiczne:** **placeholdery tekstowe** w ZPL (np. `[[QR]]`), podmieniane przez MES.
- **Model:** reużycie `label_templates` z nowym `kind = 'zpl'` (Podejście 1).
- **Rendering ZPL:** **na backendzie** (Python) — testowalny w pytest; front tylko transport
  (brak frontowego runnera testów w repo).
- **Wyzwalanie:** osobny przycisk „Drukuj Zebra" przy linii planu (tam gdzie dziś „Drukuj
  etykiety"), nowy ekran druku Zebra.

### Stan zastany (istotny)

- `label_templates`: `id, client_id, recipe_id, kind (DEFAULT 'overlay'), background_data,
  field_positions, page_size, labels_per_sheet, zpl, slot_offsets, updated_at`. Zapis przez
  `label_templates_service.save` (upsert per client+recipe) zapisuje już `kind` i `zpl`.
- `finished_units`: per sztuka — `qr_code`, `batch_no`, `produced_date`, `weight_kg`,
  `client_name`, `product_type_id`, `recipe_id`. Lista przez
  `finished_units_service` / `finishedUnitsApi.listByPlanLine`.
- `unit_codes.best_before(produced_date, shelf_life_days)` — backendowe wyliczenie terminu.
- `recipes`: `shelf_life_days`, `name`.
- Druk PDF startuje z `ProductionPlanningPage` (~linia 987):
  `navigate('/etykiety/druk?planLineId=&clientId=&recipeId=')` → `LabelPrintPage`.
- Front: brak vitest/jest. Dlatego logika merge jest po stronie backendu.

## Architektura

### 1. Model

- `label_templates.kind` przyjmuje wartości: `'overlay'` (obecny PDF) | `'zpl'` (Zebra).
- Dla `kind='zpl'` używamy kolumny `zpl` (treść ZPL z ZebraDesigner). `field_positions`,
  `background_data` nieużywane. Per klient+receptura — jak dziś.
- Brak zmian schematu (kolumny już są). Ewentualnie walidacja w save: jeśli `kind='zpl'`,
  `zpl` nie może być puste.

### 2. Placeholdery (stały, rozszerzalny zestaw)

MES podmienia w ZPL następujące znaczniki na dane sztuki:

| Placeholder | Źródło (per sztuka / receptura) |
|---|---|
| `[[QR]]` | `unit.qr_code` (token `U\|<id>`) |
| `[[PARTIA]]` | `unit.batch_no` |
| `[[DATA_PROD]]` | `produced_date` → `dd.mm.yyyy` |
| `[[DATA_MROZ]]` | `produced_date` → `dd.mm.yyyy` (data zamrożenia = produkcji) |
| `[[BEST_BEFORE]]` | `best_before(produced_date, recipe.shelf_life_days)` → `dd.mm.yyyy` |
| `[[WAGA]]` | `weight_kg` (np. `40` / `40,0`) |
| `[[NETTO]]` | alias `[[WAGA]]` |
| `[[KLIENT]]` | `unit.client_name` |
| `[[RECEPTURA]]` | `recipe.name` |
| `[[PRODUKT]]` | `product_type_name` (jeśli dostępne; inaczej puste) |

Niezdefiniowane/niewypełnione znaczniki `[[...]]` są **usuwane** z wyjścia (nie drukują się
dosłownie). Lista placeholderów pokazana w UI wgrywania szablonu.

### 3. Rendering ZPL (backend, testowalny)

Nowy moduł `backend/app/services/zebra_labels_service.py`:

- `merge_zpl(zpl: str, values: Dict[str, str]) -> str` — **czysta**: dla każdego klucza
  podmienia `[[KLUCZ]]` na `_zpl_escape(value)`; pozostałe `[[...]]` → `''`.
- `_zpl_escape(s) -> str` — usuwa/zamienia znaki sterujące ZPL `^` i `~` w wartości
  (zamiana na spację), żeby dane nie rozbiły komend ZPL.
- `unit_zpl_values(unit, recipe) -> Dict[str, str]` — **czysta**: buduje słownik wartości
  placeholderów z pól sztuki + receptury (`best_before`, formatowanie dat/wag).
- `render_zebra_labels(plan_line_id, client_id, recipe_id) -> Dict` — pobiera szablon
  (`kind='zpl'`, niepuste `zpl`), sztuki linii, recepturę; dla każdej sztuki: `merge_zpl`;
  zwraca `{ "ok": True, "zpl": "<sklejone bloki>", "count": N }`.
  - Brak szablonu zpl → `{ "ok": False, "reason": "Brak szablonu Zebra dla klient+receptura" }`.
  - Brak sztuk → `{ "ok": False, "reason": "Brak sztuk do druku" }`.

Endpoint: `GET /api/labels/zebra/render?plan_line_id=&client_id=&recipe_id=`
(`backend/app/routes/labels_zebra.py`, rejestracja w `main.py`). Zwraca gotowy ZPL.

### 4. Front — transport BrowserPrint

- **Vendored SDK:** `public/browserprint/BrowserPrint-3.1.250.min.js` (+ `BrowserPrint-Zebra-1.0.5.min.js`)
  — pliki z Zebra (darmowe). **Prerekwizyt**: użytkownik/wdrożeniowiec umieszcza je w `public/`.
  Kod ładuje je dynamicznie; przy braku → komunikat „BrowserPrint niedostępny — zainstaluj/wgraj SDK".
- `src/lib/zebra.ts` — cienki wrapper:
  - `loadBrowserPrint()` — dynamiczne wczytanie skryptu (idempotentne), zwraca `window.BrowserPrint` lub rzuca.
  - `getDevices()` — `getDefaultDevice('printer')` + `getLocalDevices` → lista drukarek.
  - `sendZpl(device, zpl)` — `device.send(zpl, ok, err)` opakowane w Promise.
- Ekran `src/pages/office/ZebraPrintPage.tsx`, trasa `/etykiety/zebra`
  (`?planLineId=&clientId=&recipeId=`):
  1. fetch `labelsZebraApi.render(...)` → ZPL + count (albo komunikat o braku szablonu).
  2. lista/wybór drukarki (domyślna zaznaczona) z `getDevices()`.
  3. „Drukuj ({count})" → `sendZpl(device, zpl)`; „Test druku" → wyślij prosty testowy ZPL
     (`^XA^FO50,50^A0N,40,40^FDTest Zebra^FS^XZ`).
  4. Stany: brak SDK, brak drukarki, brak szablonu — czytelne komunikaty.

### 5. Front — wgrywanie szablonu ZPL (biuro)

W `LabelTemplateSetupPage` dodać wybór **Typ etykiety: Nakładka PDF (overlay) / Zebra (ZPL)**:
- `overlay` → istniejący edytor WYSIWYG (bez zmian).
- `zpl` → sekcja: upload pliku `.prn`/`.zpl` (czytany jako tekst → `zpl`), podgląd surowego
  ZPL (textarea read-only/edytowalny), ściąga dostępnych placeholderów (sekcja 2), oraz
  „Test druku" (opcjonalnie). Zapis: `labelTemplatesApi.save({ clientId, recipeId,
  kind: 'zpl', zpl })`.

### 6. Front — przycisk „Drukuj Zebra"

W `ProductionPlanningPage`, obok istniejącego „Drukuj etykiety" (które robi
`navigate('/etykiety/druk?...')`), dodać **„Drukuj Zebra"** →
`navigate('/etykiety/zebra?planLineId=&clientId=&recipeId=')`.

## Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| brak szablonu `kind='zpl'` | render zwraca `{ok:false, reason}`; ekran: „Brak szablonu Zebra…" + link do konfiguracji |
| brak sztuk | „Brak sztuk do druku" |
| brak BrowserPrint SDK | „BrowserPrint niedostępny — zainstaluj aplikację Zebra BrowserPrint i wgraj SDK" |
| brak/niewybrana drukarka | „Nie znaleziono drukarki Zebra" |
| błąd `device.send` | komunikat błędu z BrowserPrint |

## Testy

Pytest (`backend/tests/test_zebra_labels.py`) — czyste funkcje:
- `merge_zpl`: podmiana wielu placeholderów; powtórzone wystąpienia; nieznane `[[X]]` → usunięte;
  `_zpl_escape` usuwa `^`/`~` z wartości.
- `unit_zpl_values`: poprawne `best_before` (produkcja + shelf_life), formaty dat/wag, QR.

Transport BrowserPrint i realny druk — weryfikowane **ręcznie na sprzęcie** (poza testami).
Ręczny e2e: wgraj `.prn` z `[[QR]]`/`[[PARTIA]]`/`[[WAGA]]`, „Drukuj Zebra", sprawdź etykietę.

## Poza zakresem

- `.nlbl` / NiceLabel.
- Konwersja istniejącego edytora WYSIWYG (overlay) na ZPL — Zebra używa osobnego szablonu.
- Druk sieciowy IP:9100 (wybrano BrowserPrint).
- Automatyczny druk Zebra po spakowaniu/wydaniu (na razie ręczny przycisk; można dodać później).

## Otwarte kwestie

- **Dostarczenie plików SDK BrowserPrint:** to darmowe pliki Zebry, ale nie są w repo i nie
  pobieramy ich automatycznie. Plan zakłada miejsce `public/browserprint/` i graceful-degradation
  przy braku; faktyczne pliki wgrywa wdrożeniowiec.
- **`product_type_name` na sztuce:** `finished_units` ma `product_type_id`, niekoniecznie nazwę.
  `[[PRODUKT]]` wypełniamy z dołączonej receptury/lookup, a przy braku — puste.
