# Projektor etykiet kebabów w PROTRIMA — projekt

Data: 27.11.2026 · gałąź bazowa: `feat/plan-produkcji-partie-20261126` (prod 4dbce4ef = PROTRIMA 0.16.1)
Wydanie razem z niewydaną poprawką odliczania pokrycia w planie (commit 79971e04).

## Po co

Każdy klient ma swoją etykietę na kebaba (adres, skład, alergeny, wartości
odżywcze, HALAL, owal weterynaryjny). Etykiety są już zaprojektowane poza
systemem: część jako PDF (ZAGROS/OKAYTEKIN, TRUVA, Carrier, SAS ISSA, YAZGI —
druk na arkuszach A4 na zwykłej drukarce), część w ZebraDesigner (EMIN/YALCIN,
FUDI — rolka Zebra 100 × 150). System ma na te gotowe etykiety nałożyć dane
sztuki: wagę, partię, daty, QR, i drukować je prosto z planu produkcji.

W starym MES działało wczytanie PDF, ustawienie pól, zapis i wstawianie danych
przy druku. Złe było okno projektowania (wygląd, wygoda) i obsługa Zebry: import
`.prn` odrzucał każdy prawdziwy plik z ZebraDesigner (wymagał `N` jako pierwszej
komendy; ZebraDesigner wstawia przed nim ustawienia `I8,A,001 Q q rN S3 D12 ZT
JF OD R f`, a kreski rysuje komendą `LO`, której stary parser nie znał).

Właściciel (27.11): „to jest proste — daję nakładkę PDF, wczytuje się podgląd,
ustawiam pola i zapisuję, a potem na te pola wczytują się odpowiednie dane”.
UI ma być zrobione profesjonalnie i ze smakiem.

## Decyzje właściciela

- **Budowa od zera (wariant B)**, z dokładnym przejrzeniem starego kodu i
  przeniesieniem tego, co działało (silnik PDF A4, sloty, kalibracja, pola).
- **Dwa sposoby druku, zależnie od klienta:** PDF na A4 (zwykła drukarka) albo
  Zebra 100 × 150 (tło z ZebraDesigner `.prn` lub z PDF).
- **Przypisanie:** klient + rodzaj + receptura.
- **Termin przydatności** = data produkcji + `recipes.shelf_life_days`
  (właściciel wpisuje w recepturze już „−1 dzień”, np. 364). Tak samo jak HDI
  (`app/utils/unit_codes.best_before`).
- **Data zamrożenia = data produkcji.**
- **Druk do planu przez nasze okno druku** (jak kartki palet): podgląd, wybór
  drukarki i zasobnika, ustawienia zapamiętane per rodzaj dokumentu i komputer,
  rejestr wydruków. Zebra — prosto na drukarkę, jak dziś.
- Rolki: kebaby 100 × 150, ćwiartka/surowiec 80 × 100 (projektor obsługuje
  kebaby; rozmiar szablonu Zebry wynika z importu).
- 7 obecnych szablonów przenieść automatycznie.
- Wdrożenie dopiero po akceptacji zrzutów, razem z 79971e04.

## Cele

1. Moduł PROTRIMA „Etykiety”: lista szablonów, projektor z podglądem 1:1,
   przeciąganie pól myszą, panel właściwości, cofanie/ponawianie, próbny druk.
2. Import tła: PDF (A4, 1 lub 2 etykiety na arkusz) oraz `.prn` z ZebraDesigner
   (EPL2 i ZPL, grafika `GW`/`^GFA`, kreski `LO`) — także PDF jako tło Zebry.
3. Druk z planu (okno „Etykiety sztuk”): każda pozycja dobiera swój szablon;
   A4 → jeden PDF przez okno druku; Zebra → seria ZPL; sztuki oznaczone jako
   wydrukowane dopiero po udanym druku.
4. Migracja 7 istniejących szablonów; stare strony etykiet w MES tylko do
   podglądu z odesłaniem do PROTRIMA.

## Poza zakresem (non-goals)

- Projektowanie stałej treści etykiety (skład, logo) od zera — to robi
  ZebraDesigner / PDF; projektor nakłada wyłącznie pola zmienne i proste
  elementy (stały tekst, ramka).
- Etykiety palet mięsa (drukuje HMI masowni), zawieszki przyjęcia, kartki palet
  zamówień, etykiety ćwiartki — bez zmian.
- Druk na hali — etykiety dalej drukuje biuro wieczorem.

## Anty-cele (porażka mimo „działa”)

- Zepsucie druku etykiet PDF, który dziś działa u ZAGROS/TRUVA.
- QR, którego skaner na hali nie czyta (za mały, rozmyty po rasteryzacji).
- Pole, które w podglądzie stoi gdzie indziej niż na wydruku.
- Etykieta wydrukowana z danymi innej sztuki/klienta albo oznaczona jako
  wydrukowana, choć druk anulowano.

## Jak działało w starym MES (przenosimy)

Źródła: `src/pages/office/LabelPrintPage.tsx` (`buildVectorPdf`),
`LabelTemplateSetupPage.tsx`, `backend/app/services/label_templates_service.py`,
`label_raster_import.py`, `zebra_designer_service.py`, `label_print_jobs.py`.

- Tło PDF normalizowane do całego arkusza A4 (`drawPage` ze skalą
  srcW→210 mm, srcH→297 mm), pola nakładane wektorowo (pdf-lib + fontkit,
  Liberation Sans jako Arial, Times, Courier; ładowane na żądanie).
- Pozycja pola: lewy-górny róg w % strony A4; rozmiar tekstu w pt, QR w mm.
  Nowy projekt przechodzi na **milimetry** (migracja przelicza %→mm).
- Sloty: 1 lub 2 etykiety na arkusz obok siebie; slot 2 = pozycje slotu 1
  przesunięte o pół szerokości (`slot_offsets` nadpisuje przesunięcie), a
  `slot_field_positions` pozwala przestawić pojedyncze pole tylko na slocie 2.
- Kalibracja (`print_calib`): dx/dy w mm, skala %, „dopasuj do treści” (przycina
  białe marginesy tła), „rozciągnij” — jedno przekształcenie całej strony.
- Wartości: `weight` „40 kg” (liczba wg pogrubienia pola, „ kg” zawsze zwykłe),
  `batch_no` „ddmmrr partia”, `prod_date`, `freeze_date` (= prod), `best_before`
  (+ shelf_life_days), `org_code` (kod HALAL wpisywany przy druku), `qr` (kod
  sztuki `U|…`, `UNIT_QR_OPTIONS`).
- Rejestr wydruków A4 z dodrukiem oryginalnego QR (`label_print_jobs`).

## Podejścia (rozważone)

- **A. Nowy projektor na obecnych tabelach**, druk A4 starym silnikiem — mniej
  pracy, ale stary model danych (klient po nazwie, % strony, brak rodzaju).
- **B. Od zera, przenosząc sprawdzone zasady (WYBRANE przez właściciela)** —
  nowy model w mm, klient po id, rodzaj w przypisaniu, jeden projektor dla A4 i
  Zebry; ryzyko zepsucia druku PDF ograniczone testem zgodności: migrowany
  szablon musi dać w nowym silniku te same pozycje pól (±0,2 mm) co stary.
- C. Nowy projektor tylko dla Zebry — odrzucony (PDF zostałby w starym oknie).

## Projekt

### Model danych (nowe tabele)

`label_designs` — szablon:
- `id`, `name` (np. „YALCIN · Zebra”), `client_id` (id klienta, wymagany),
  `product_type_id` (`''` = każdy rodzaj), `recipe_id` (`''` = każda receptura),
  `print_mode` `'a4' | 'zebra'`, `active`.
- Tło: `background_pdf` (base64 PDF, A4), `background_png` (podgląd), dla Zebry
  `background_zpl` (`^GFA` gotowe do druku) + `width_mm`, `height_mm`, `dpi`
  (203), `source_name`, `source_sha256`.
- `labels_per_sheet` (1|2, tylko A4), `slot_offset` (dx/dy mm slotu 2),
  `calibration` (dx, dy mm, scale %, fit, fit_stretch — tylko A4).
- `fields` JSONB: lista pól `{id, kind, x_mm, y_mm, w_mm?, font, size_pt,
  bold, align, rotation (0|90|180|270), text?, qr_mm?}`; `kind` ∈
  `weight, batch, prod_date, freeze_date, best_before, org_code, qr, client,
  recipe, product_type, unit_no ("3/29"), static_text, box`.
- `slot2_fields` JSONB: nadpisania pozycji pojedynczych pól na slocie 2.
- `updated_at`, `updated_by`; unikalność aktywnego szablonu na
  (client_id, product_type_id, recipe_id).

`label_design_revisions` — każda zapisana wersja (kto, kiedy, pełny JSON bez
tła, hash tła) — do historii i dodruku „jak wtedy”.

Stare tabele (`label_templates`, `zebra_label_designs`, revisions, print jobs)
zostają nietknięte — powrót jest możliwy.

### Dobór szablonu dla pozycji planu

Najbardziej szczegółowy aktywny szablon klienta pozycji:
klient+rodzaj+receptura → klient+receptura → klient+rodzaj → sam klient.
Klient pozycji: `client_id` z zamówienia; pozycja bez klienta albo bez
pasującego szablonu → prosta etykieta systemowa 100 × 150 (dzisiejszy wzór)
i ostrzeżenie w oknie „Etykiety sztuk”: „brak szablonu dla YALCIN · KEBAB UDO
· KIRMIZI”.

### Import tła

- **PDF:** w przeglądarce (pdfjs, jak podgląd w oknie druku). Dla A4 zapisany
  oryginał + PNG podglądu. Dla Zebry: pierwsza strona rasteryzowana do 203 dpi
  w rozmiarze etykiety (100 × 150 albo wymiar strony PDF), progowanie do 1 bitu,
  zamiana na `^GFA`.
- **`.prn`:** na serwerze, nowy parser (nic z pliku nie trafia do drukarki):
  - EPL2: pomija komendy ustawień przed/po `N` (`I, Q, q, rN/rY, S, D, Z, J,
    O, R, f, US, UN…`), rysuje `GW` (bit 0 = czarny) i `LO` (czarny prostokąt),
    `LE/LW` (XOR/biały), kończy na `P`; szerokość z `q`, wysokość z `Q`.
  - ZPL: `^XA ^PW ^LL ^FO ^GFA ^GB ^FS ^XZ` (bez kompresji Z64 w pierwszej wersji
    — czytelny błąd).
  - Komendy tekstu/kodów (`A`, `B`, `b`, `^A`, `^B`) → błąd z listą komend
    i podpowiedzią „ZebraDesigner: drukuj do pliku z tekstem jako grafika”.
  - Wynik: PNG podglądu + `^GFA` + wymiary w mm. Odrysowanie „yalcin najnowsza.prn”
    musi zgadzać się 1:1 (test na pliku-wzorcu w repo, bez danych klienta w
    nazwie — fixture zanonimizowana do samych grafik).
- Po imporcie stałe wartości wpisane w grafikę (stare daty, „40 KG”) właściciel
  usuwa w ZebraDesigner przed eksportem; projektor ma dodatkowo element
  „zakrywka” (biały prostokąt) na wypadek pozostałości.

### Projektor (UI)

Moduł PROTRIMA „Etykiety” (sekcja Produkcja), standard PROTRIMA (CommandBar,
Dialog, Wybor, tokeny, jasny i ciemny):
- Lewa kolumna: szablony pogrupowane klientami (nazwa, A4×2 / Zebra, przypisanie),
  szukajka, „Nowy szablon”.
- Środek: płótno z tłem w skali 1:1 (zoom 50–400 %, „dopasuj”), linijki w mm,
  siatka 0,5 mm z przyciąganiem, przeciąganie pól, uchwyt obrotu dla Zebry,
  slot 2 wyszarzony z powtórzonymi polami (klik → nadpisanie pozycji).
- Prawa kolumna: właściwości zaznaczonego pola (X/Y mm, czcionka, rozmiar,
  pogrubienie, wyrównanie, obrót, rozmiar QR) + „Dodaj pole” z listy rodzajów;
  zakładka „Przypisanie” (klient, rodzaj, receptura) i „Druk” (A4: etykiet na
  arkusz, kalibracja; Zebra: rozmiar, dpi).
- Klawiatura: strzałki 0,5 mm (Shift 5 mm), Delete, Ctrl+Z/Ctrl+Y, Ctrl+S.
- Podgląd z przykładowymi danymi (40 kg, „281126 724”, daty z receptury, QR
  `U|przyklad`); „Próbny druk” (A4 przez okno druku, Zebra prosto).
- QR: minimalny rozmiar 18 mm z ostrzeżeniem poniżej; na Zebrze `^BQN` magnituda
  z mm.

### Druk z planu

Okno „Etykiety sztuk” (`OknoEtykiet`):
- Pozycje pogrupowane: „A4 (PDF)” i „Zebra”, przy każdej nazwa szablonu albo
  ostrzeżenie o braku.
- A4: jeden PDF (pdf-lib, nowy silnik według zasad starego `buildVectorPdf`),
  kolejność jak dziś (pozycje, potem numer sztuki), 1/2 na arkusz;
  `drukuj({ rodzaj: 'etykiety', tytul, pdfBase64, strict: true, rejestr })` —
  okno druku z zasobnikiem; `strict` = anulowanie nie oznacza wydruku.
- Zebra: ZPL na sztukę = tło `^GFA` + pola; `drukujEtykiety(zpl, profil)`.
- Kod HALAL (`org_code`): pole w oknie, pamiętane per szablon (ostatnia wartość).
- Oznaczenie wydruku (`finished_units.label_printed_at`) po udanym druku;
  przedruk/wyrzuć bez zmian.

### Stary MES

Strony `LabelTemplateSetupPage`, `ZebraDesignerPage`, `ZebraLabelEditorPage`:
tylko podgląd z komunikatem „Etykiety projektuje się w PROTRIMA”. `LabelPrintPage`
dalej drukuje stare szablony (dla planów sprzed wdrożenia).

### Migracja

Jednorazowo (znacznik w `sequences`): każdy `label_templates` → `label_designs`:
- klient: id z `clients` po `name`/`display_name`; brak dopasowania → szablon
  nieaktywny z adnotacją;
- `overlay` z PDF → `print_mode='a4'`, pola %→mm (x·210/100, y·297/100), size
  pt bez zmian, QR mm, sloty, kalibracja 1:1;
- `zpl` (Vatan) → `print_mode='zebra'` jeśli tło da się wyciągnąć, inaczej
  nieaktywny „do sprawdzenia”; `zebra_label_designs` (bez klienta) → nieaktywny.
Test zgodności: dla każdego migrowanego szablonu A4 nowy silnik umieszcza pola
w tych samych miejscach co stary (porównanie współrzędnych drawText/drawImage
±0,2 mm na danych przykładowych).

## Co zostawiam wykonawcy

Szczegóły UI w granicach standardu PROTRIMA (zrzuty do akceptacji przed
wydaniem), nazwy komponentów, podział plików, dokładna lista komend EPL do
pominięcia (rozszerzalna), algorytm progowania PDF→1 bit (z testem czytelności
QR), limity rozmiarów plików (jak stary import: 4 MiB).

## Moje decyzje do sprawdzenia przez właściciela

- Szablon zawsze należy do klienta; brak szablonu → prosta etykieta systemowa.
- Kod HALAL wpisywany w oknie druku, pamiętany per szablon.
- Stary MES drukuje dalej stare szablony dla starych planów; nowe plany drukują
  wyłącznie z PROTRIMA.
- Etykiety A4 korzystają z istniejącego rodzaju dokumentu „Etykiety” w oknie
  druku (osobne zapamiętane ustawienia zasobnika).
