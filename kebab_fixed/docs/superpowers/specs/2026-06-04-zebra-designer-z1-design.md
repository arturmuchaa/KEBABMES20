# Projekt (Z-Design-1): Wizualny edytor etykiet Zebra → natywny ZPL

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: [[2026-06-04-etykiety-zebra-zpl-design]] (poprzednie podejście — import .prn; tu pełny edytor)

## Kontekst

Użytkownik chce tworzyć etykiety Zebra **wizualnie** (przeciąganie elementów) i drukować
na drukarce Zebra (np. ZDesigner GC420t, 203 dpi). Import gotowych plików z ZebraDesigner
zawiódł, bo ZebraDesigner eksportuje **zrasteryzowane** etykiety (`^GFA`/`^GW` bitmapy) bez
pól tekstowych ani placeholderów. Dlatego budujemy **własny edytor**, który generuje
**natywny ZPL** (pola tekstowe `^FD`, QR `^BQ`, ramki `^GB`), gdzie dane są podstawialne.

Wzór docelowy (zebra.png): etykieta spożywcza KEBAB — nazwa, opis, składniki (długi tekst),
alergeny, instrukcje przechowywania, **tabela wartości odżywczych** (ramki), WAGA, NR PARTII,
DATA PRODUKCJI, NALEŻY SPOŻYĆ DO, QR + znak weterynaryjny, producent. Rozmiary: **100×150 mm**
i **100×300 mm** (szerokość druku 100 mm ≤ głowica GC420t ~104 mm; długość 150/300 mm).

### Stan zastany (do reużycia)

- `src/lib/zebra.ts` — wrapper BrowserPrint (`loadBrowserPrint`, `getDevices`, `sendZpl`). Gotowy.
- `backend/app/services/zebra_labels_service.py` — `_zpl_escape`, `unit_zpl_values(unit, recipe)`
  (zwraca QR/PARTIA/DATA_PROD/DATA_MROZ/BEST_BEFORE/WAGA/NETTO/KLIENT/RECEPTURA/PRODUKT). Reużywamy.
- `LabelTemplateSetupPage` — istniejący wzorzec przeciągania pól (pozycjonowanie, nudge X/Y).
  Inspiracja dla interakcji; nowy edytor jest osobny (inny model danych: dowolne elementy).
- `finished_units` + `finishedUnitsApi.listByPlanLine` — dane sztuk do druku.

### Podział (zatwierdzony)

- **Z-Design-1 (ten spec, silnik):** model elementów + edytor wizualny (dodawanie/przeciąganie/
  zmiana rozmiaru/właściwości elementów: tekst, QR, ramka) + generator ZPL (DPI wybierane) +
  zapis + druk (test i z linii planu). Po nim można zbudować dowolną etykietę.
- **Z-Design-2 (później):** zawijanie wielolinijkowe dopieszczone (`^FB`), gotowy komponent
  tabeli wartości, duplikacja układu między rozmiarami, czcionka TTF dla pełnej polszczyzny, UX.

## Architektura

### 1. Model danych

Tabela `zebra_label_designs` (migracja):
```sql
CREATE TABLE IF NOT EXISTS zebra_label_designs (
    id          TEXT PRIMARY KEY,
    recipe_id   TEXT NOT NULL DEFAULT '',
    size_key    TEXT NOT NULL DEFAULT '',     -- np. '100x150' (etykieta na produkt+rozmiar)
    width_mm    NUMERIC NOT NULL DEFAULT 100,
    height_mm   NUMERIC NOT NULL DEFAULT 150,
    dpi         INTEGER NOT NULL DEFAULT 203,  -- wybierane (203/300)
    elements    JSONB NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (recipe_id, size_key)
);
CREATE INDEX IF NOT EXISTS idx_zebra_designs_recipe ON zebra_label_designs(recipe_id);
```

### 2. Model elementu (JSON w `elements`)

Tablica elementów. Współrzędne i wymiary w **mm** (niezależne od DPI; konwersja na punkty
przy generowaniu ZPL). Pola wspólne: `id` (string), `type`, `x`, `y` (lewy-górny róg, mm).

| type | dodatkowe pola | uwagi |
|---|---|---|
| `text` | `w` (mm, szerokość bloku do zawijania), `fontMm` (wys. fontu mm), `align` (`L\|C\|R`), `value` (string, może zawierać `[[KLUCZ]]`) | statyczny tekst lub dynamiczny przez `[[...]]` |
| `qr` | `mag` (1–10, powiększenie modułu QR), `value` (zwykle `[[QR]]`) | natywny `^BQ` |
| `box` | `w`, `h` (mm), `thickMm` (grubość mm) | ramka/linia (linia = cienkie `h` lub `w`) `^GB` |

Placeholdery dynamiczne (wartości z `unit_zpl_values`): `[[QR]] [[PARTIA]] [[DATA_PROD]]
[[DATA_MROZ]] [[BEST_BEFORE]] [[WAGA]] [[NETTO]] [[KLIENT]] [[RECEPTURA]] [[PRODUKT]]`.

### 3. Generator ZPL (backend, czysty, testowalny)

`backend/app/services/zebra_designer_service.py`:

- `_mm_to_dots(mm, dpi) -> int` = `round(float(mm) / 25.4 * dpi)`.
- `_merge(value, values) -> str` — podmień `[[KLUCZ]]` na `_zpl_escape(values[KLUCZ])`,
  usuń pozostałe `[[...]]` (reużycie wzorca z `merge_zpl`).
- `design_to_zpl(design: dict, values: dict) -> str` — **czysta**:
  - nagłówek: `^XA`, `^CI28` (UTF-8, polskie znaki), `^PW{mm_to_dots(width_mm)}`,
    `^LL{mm_to_dots(height_mm)}`, `^LS0`.
  - dla każdego elementu (kolejność z listy):
    - `text`: `^FO{x_d},{y_d}^A0N,{font_d},{font_d}^FB{w_d},50,0,{just},0^FD{merge(value)}^FS`
      gdzie `just` = `L/C/R` z `align`; `^FB` daje zawijanie do szerokości `w`.
    - `qr`: `^FO{x_d},{y_d}^BQN,2,{mag}^FDLA,{merge(value)}^FS` (`LA,` = tryb alfanumeryczny QR).
    - `box`: `^FO{x_d},{y_d}^GB{w_d},{h_d},{thick_d}^FS`.
  - stopka: `^XZ`.
  - `_zpl_escape` na każdej wstawianej wartości (usuwa `^` `~`).
- `render_units(recipe_id, size_key, plan_line_id) -> dict` — pobierz design + recepturę +
  sztuki; dla każdej `design_to_zpl(design, unit_zpl_values(u, recipe))`; zwróć
  `{ok, zpl: "\n".join(blocks), count}`. Brak designu → `{ok:False, reason}`.
- `render_sample(design) -> str` — `design_to_zpl` z przykładowymi danymi (do „Test druku").

Kluczowe: ZPL jest **wektorowy/tekstowy** (nie bitmapa) → dane podstawialne, QR skanowalny.

### 4. API (`backend/app/routes/zebra_designer.py`, prefix `/api/zebra-designs`)

| Metoda | Ścieżka | Akcja |
|---|---|---|
| GET | `?recipe_id=&size_key=` | pobierz design (lub `{exists:false}`) |
| PUT | `` | zapisz/utwórz (upsert po recipe_id+size_key) |
| GET | `/render?recipe_id=&size_key=&plan_line_id=` | ZPL dla sztuk linii |
| POST | `/render-sample` | ZPL z danymi przykładowymi (body: design) |

Rejestracja routera w `main.py`.

### 5. Front — edytor wizualny

`src/pages/office/ZebraDesignerPage.tsx`, trasa `/etykiety/zebra-designer?recipeId=&size=`.

- **Pasek:** wybór receptury (lub z URL), wybór rozmiaru (100×150 / 100×300 / własny W×H mm),
  wybór **DPI** (203/300), Zapisz, „Test druku" (BrowserPrint, dane przykładowe), Wstecz.
- **Paleta:** dodaj Tekst / dodaj QR / dodaj Ramkę.
- **Canvas (WYSIWYG):** div w proporcji etykiety (skala `px/mm`, np. 3 px/mm); elementy jako
  absolutnie pozycjonowane divy renderowane z modelu (tekst/QR-podgląd/ramka). To **jest** podgląd.
  - **Przeciąganie** (zmiana `x,y`) i **zmiana rozmiaru** (uchwyt; `w,h`/`fontMm`).
  - Zaznaczenie elementu → **panel właściwości**: typ, pozycja/wymiary (mm), font (mm),
    wyrównanie, treść/powiązanie (`Tekst` lub `Dane: Waga/Partia/Data prod./Termin/QR/…`),
    grubość ramki, mag QR; usuń element.
- Stan = model elementów; zapis przez `zebraDesignsApi.save`. Reużyć wzorce interakcji z
  `LabelTemplateSetupPage` (nudge/pozycje), ale nowy, samodzielny komponent.

### 6. Front — API + druk produkcyjny

- `src/lib/api.ts`: `zebraDesignsApi` (`get`, `save`, `render`, `renderSample`) + typy.
- Druk per sztuka: ekran `/etykiety/zebra` (`ZebraPrintPage`, już istnieje) rozszerzyć —
  jeśli dla receptury istnieje **design** w danym rozmiarze, drukuj z `zebraDesignsApi.render`
  (wybór rozmiaru na ekranie); w przeciwnym razie dotychczasowe `labelsZebraApi.render`
  (import .prn). Reużycie wrappera BrowserPrint.
- Wejście do edytora: przycisk „Projektant Zebra" w `LabelTemplatesPage` / menu biura.

## Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| brak designu przy render | `{ok:false, reason:"Brak projektu etykiety Zebra"}` → komunikat + link do edytora |
| brak sztuk | „Brak sztuk do druku" |
| brak BrowserPrint/drukarki | jak dotychczas (komunikat z `zebra.ts`) |
| wartość z `^`/`~` | `_zpl_escape` usuwa |

## Testy

Pytest (`backend/tests/test_zebra_designer.py`) — czyste funkcje:
- `_mm_to_dots(25.4, 203) == 203`; `_mm_to_dots(10, 300) == 118`.
- `design_to_zpl`: text → `^FO…^A0N…^FB…^FD…^FS`; qr → `^BQ…^FDLA,…`; box → `^GB…`;
  nagłówek `^XA^CI28^PW…^LL…`, stopka `^XZ`.
- merge: `[[WAGA]]` → wartość; nieznane `[[X]]` usunięte; `^`/`~` w wartości usunięte.
- `render_sample`/`render_units` skład (liczba bloków = liczba sztuk).

Edytor wizualny (drag/resize) i realny druk — weryfikacja **ręczna** (build + sprzęt).

## Poza zakresem (Z-Design-2 / później)

- Dopieszczone zawijanie i gotowy komponent tabeli wartości odżywczych.
- Czcionka TTF wgrywana do drukarki dla pełnej polszczyzny (na start `^CI28` + font `0`;
  część znaków PL może wymagać TTF — odnotowane).
- Duplikacja/skalowanie układu między rozmiarami; obrót elementów; obrazki/logo.
- Klient-specyficzne warianty (na start design per receptura+rozmiar).

## Otwarte kwestie

- **Polskie znaki:** `^CI28` + rezydentny font `0` pokrywa większość; pełne pokrycie (ł, ś, ż…)
  może wymagać wgrania TTF do drukarki — Z-Design-2. W Z-Design-1 zakładamy font `0`.
- **Rozmiar etykiety vs sztuka:** który rozmiar drukować przy danej linii planu — wybór na
  ekranie druku (`ZebraPrintPage`); domyślnie pierwszy istniejący design receptury.
