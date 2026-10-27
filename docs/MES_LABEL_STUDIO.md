# MES Label Studio — audyt i bramki wdrożenia

Audyt kodu: 2026-10-18; historia ZPL: 2026-10-19; historia A4/PDF: 2026-10-20. Gałąź: `feature/mes-label-studio`. Bez deploymentu.

## Mapa istniejących funkcji (przed zmianami)

| Obszar / pliki w kebab_fixed | Rzeczywiste możliwości i ograniczenia |
|---|---|
| `src/pages/office/LabelTemplateSetupPage.tsx` | PDF pierwsza strona + oryginalny PDF do druku, PNG/JPG/WebP, klient (nazwa/alias) + receptura, 7 pól: QR, produkcja, zamrożenie, przydatność, partia, masa, HALAL. Pozycje procentowe A4, rozmiar tekstu pt / QR mm, 8 rodzin fontów, pogrubienie, osobno pogrubiana liczba masy. Kliknij-aby-przesunąć, zoom 1–4, podglądy kolejnych slotów. |
| ten sam edytor | 1–20 etykiet/arkusz, osobne offsety X/Y kolejnych slotów, ręczne nadpisania KAŻDEGO pola w slotach 2+, usunięcie nadpisania przywraca dziedziczenie. Kalibracja X/Y mm, skala, obcinanie białych marginesów (`fit`), rozciągnięcie (`fitStretch`), reset zachowujący ustawienia fit. Próbny PDF z tego samego silnika co produkcja. Wszystkie te opcje muszą zostać. |
| `LabelPrintPage.tsx`, `features/labels/unitQr.ts` | `buildVectorPdf`: osadzanie oryginalnego PDF, fonty, wektorowe tło, QR osobno na sztukę; transformacje kalibracji, kwadratowy QR także przy fitStretch. Rastrowy fallback; wybór kodu HALAL. `unitIds` filtruje istniejące sztuki. |
| `backend/app/services/label_templates_service.py`, `models/label_templates.py` | JSON pól i konfiguracji + zasoby data URL; upsert po UNIQUE klient/receptura; aliasy klienta; lista, pobranie, usunięcie, resolve. Brak historii, archiwum, wielu wariantów dla tej samej pary i tenant scope. Usuwanie NUL z tekstu nie jest dekoderem EPL. |
| `ZebraLabelEditorPage.tsx`, `features/zebra/composeZpl.ts` | Dodatkowy starszy edytor zapisuje metadane w `fieldPositions.__zebra__` i wynik ZPL w `label_templates`; oddzielny obraz podglądu, tekst/QR, mm, 203/300 DPI. |
| `ZebraDesignerPage.tsx`, `zebra_designer_service.py` | Osobna istniejąca tabela `zebra_label_designs`, presety, tekst, QR, ramki, obrazy, fonty systemowe rasteryzowane przez canvas, GFA; import tła ZPL. Podgląd wysyła ZPL do zewnętrznego Labelary. Stałe rozmiary 100×150/300. Brak EPL. |
| `zebra_labels_service.py`, `zebra_designer_service.py`, `ZebraPrintPage.tsx` | Wsad ZPL na bazie istniejących finished_units. Starsza ścieżka grupuje identyczne bloki przez PQ — szablon bez dynamicznego QR może powielać etykietę. Brak wyboru unitIds w Zebra, trwałego snapshotu i audytu dodruku. |
| `finished_units_service.py`, `utils/unit_codes.py`, `app/migrations.py` | Serwer tworzy `U\|<cuid>`; UNIQUE qr_code. Ponowne generowanie zwraca istniejące sztuki, ale może synchronizować datę/partię sztuk planned. Początkowy SELECT linii nie blokuje równoległego tworzenia. Brak UNIQUE (plan_line_id, qr_seq). |
| `UnitReprintModal.tsx`, `lib/unitReprint.ts` | Lista statusów i dodruk konkretnego ID przez A4. Nie generuje sztuki. Brak skanu oznacza wyłącznie brak skanu. |
| `lib/zebra.ts`, `zebraProfiles.ts`, `ZebraPrinterPanel.tsx` | BrowserPrint, wybór drukarki, kolejka per urządzenie i Web Locks, timeout/stan niepewny, kontrola medium i kalibracji ZPL. Nie należy wysyłać EPL tą ścieżką: preflight sam wysyła komendy ZPL. |
| `src-tauri/src/lib.rs`, `lib/print.ts` | Tauri wywołuje WebView print; brak adaptera Windows RAW spooler. |

Format partii A4 składa datę DDMMRR i numer mięsa; `unit_zpl_values` przekazuje zapisany batch_no bez takiego składania. Nie zmieniać danych partii w bazie w ramach korekty prezentacji. Parser skanera toleruje warianty klawiatury HID i prefiksy AIM — nie zastępować go.

## Architektura rozszerzenia (docelowa, nie deklaracja implementacji)

1. Wspólny dokument JSON z wersją schematu: fizyczny rozmiar, orientacja, marginesy, warstwy, zasoby z SHA256, dynamiczne źródła, konfiguracja urządzenia. Adapter legacy A4 musi zachować wszystkie klucze, procenty i transformacje — bez automatycznej konwersji istniejących zapisów.
2. Importery przetwarzają **bajty**, nigdy nie wysyłają źródła do drukarki. Lista dozwolonych poleceń, limity wymiarów/pamięci, odrzucenie nieznanych instrukcji. Grafika EPL GW i ZPL GFA to pierwszy bezstratny podzbiór. Fonty urządzenia, kompresje, pamięć drukarki i makra wymagają osobnych adapterów, nie cichego pomijania.
3. Rewizje szablonu i snapshot danych wydruku: append-only; referencja do istniejącej finished_unit, nigdy osobna ewidencja sztuk. Dodruk wskazuje pierwotną rewizję + wartości + zasoby. Dla historycznych wydruków bez snapshotu jawne ostrzeżenie, nie obietnica rekonstrukcji.
4. Wspólny render danych produkcyjnych dla A4/EPL/ZPL, bazujący na zapisanym qr_code. Każda sztuka renderowana indywidualnie; QR wymagany w szablonie produkcyjnym. Statyczne zasoby cache po SHA256 + DPI.
5. Adaptery wyjścia: PDF przez istniejący silnik, raster EPL GW dla GC420t, ZPL. Transport oddzielony: Windows RAW spooler w Tauri (bajty), istniejący BrowserPrint wyłącznie dla obecnej ścieżki ZPL. Żadnego PDF do RAW EPL.
6. Trwałe zadania z idempotency key, snapshotem i wybranymi unitIds. Stany prepared / queued / submitting / submitted / uncertain / cancelled. Submitted nie znaczy printed. Wznowienie uncertain wyłącznie po decyzji operatora; anulowanie nie cofa bajtów przyjętych przez spooler. Brak automatycznego retry niepewnej paczki.
7. Tenant musi pochodzić z zaufanego kontekstu uwierzytelnienia, nie z clientId ani parametru przeglądarki. Samo dodanie tenant_id do etykiet nie izoluje produkcji/magazynu. Do czasu spójnej izolacji istniejących encji nie deklarować gotowości multi-company.
8. UI i adaptery wyjścia wdrażane niezależnie. Przełącznik klasyczny/Studio zachowuje ten sam model formularza oraz silnik A4.

## Migracje / rollback

Przygotowano addytywne tabele rewizji, snapshotów i zadań oraz triggery historii
(`backend/app/label_history_schema.py`). Istniejący runner instaluje je w jednej
transakcji. Migracje uruchomiono **wyłącznie na odizolowanej bazie testowej**;
nie zmieniono danych ani schematu produkcji. Przed przyszłym unikalnym indeksem
pozycji sztuki należy wykryć historyczne duplikaty — nie usuwać ich automatycznie.

Rollback UI: przełącznik układu klasycznego; rollback kodu: powrót do poprzedniego wydania po standardowym zatwierdzeniu. Nie kasować rewizji/zadań przy rollbacku. Stare kolumny i API pozostają dostępne. Triggery zachowują historię zapisów szablonów także ze starszego kodu; starszy ekran drukowania nie zapisze jednak nowych zadań. Żadnych zmian w `/opt/kebab/app`.

## Bramki odbioru

- Testy legacy PDF, slot overrides, fit/fitStretch, próba A4 i zgodność QR.
- Izolowana baza PostgreSQL: dwa równoległe generowania, snapshot/dodruk, brak zmiany licznika sztuk; nigdy testy na produkcji.
- Pliki **VATAN.prn / VATAN.nlbl nie zostały znalezione w repozytorium**. Potrzebny rzeczywisty PRN (bajty), rozmiar materiału i ustawienia DPI. Syntetyczna próbka nie jest potwierdzeniem zgodności VATAN.
- Windows 11 IoT: spooler, odłączenie USB, restart, anulowanie, niepewny wynik, brak drukarki.
- GC420t fizycznie: 100 różnych QR, odczyt skanerem MES, oryginalna grafika i mały tekst, rozmiar linijką, offsety i kalibracja; analogicznie A4 i 300 DPI na odpowiednim urządzeniu.
- Zmiana szablonu, ponowne otwarcie, dodruk po zmianie, równoległe firmy, eksport/import, responsywność. Nie oznaczać niewykonanych scenariuszy jako zaliczonych.

## Zaimplementowany etap — stan faktyczny

**To nie jest kompletna realizacja specyfikacji ani wydanie dopuszczone do produkcji.**

### Edytor PDF

`/etykiety/szablon`: przełączany Studio/klasyczny, trzy kolumny na szerokim ekranie,
lista siedmiu istniejących pól, większy obszar roboczy z widoczną granicą arkusza,
inspektor wybranego pola. Współrzędne mm są widokiem procentów, nie migracją danych.
Precyzja istniejących współrzędnych nie jest obcinana przy otwarciu/zapisie. Przy
przeciąganiu uchwyt nie przeskakuje do lewego górnego rogu. Dostępne: kliknij-przesuń,
strzałki 0,1 mm / Shift 1 mm, siatka 5 mm, opcjonalne przyciąganie do siatki 1 mm,
zoom 0,5–4, dopasowanie do okna, blokada pozycji w sesji, cofanie/ponawianie (60 kroków,
jeden drag = jeden krok). Historia obejmuje również zasoby i zaawansowane ustawienia;
nie przechodzi między klientami/recepturami. Pola i ustawienia legacy nadal dostępne.

Wybór projektu, zasoby/proof oraz kalibracja są zwijane, nie usuwane. Modernizacja
edytora nie zmieniła silnika `buildVectorPdf` ani parsera QR. Etap A4 poniżej dodaje
do tego samego renderera jawne historyczne sloty i przerywanie nieaktualnego renderu,
bez zmiany jego transformacji geometrycznych. Błąd pobrania szablonu blokuje zapis;
spóźniona odpowiedź innego klienta nie nadpisuje aktualnego formularza.

### Import i adaptery

Nowy endpoint `POST /api/label-templates/import-raster?dpi=203|300`, multipart `file`.
W istniejącym projektancie Zebra jest wybór PRN/EPL/ZPL. Import działa offline na
serwerze, **bez wysłania danych do Labelary ani drukarki**. Rozpoznanie po zawartości;
plik nie jest odczytywany jako UTF-8. Obsługiwany podzbiór:

- EPL: jedna etykieta, `N`, `q`, `Q`, binarne `GW`, `P1` / `P1,1`.
- ZPL: jedna etykieta, `XA`, `PW`, `LL`, `FO`, nieskompresowane `GFA` HEX,
  `FS`, `XZ`, zerowe `LH/LS/LT`, `CI28`, `PQ1`.
- Inne instrukcje, makra, pamięć urządzenia, fonty natywne w **imporcie grafiki**,
  kompresje, nakładające się grafiki i wieloetykietowe PRN są jawnie odrzucane.
- Limity: źródło 4 MiB, do 4096 punktów/osi, 8 mln pikseli, 256 grafik.
  Walidowane długości danych, granice i białe dopełnienie bajtów. Poprawna polaryzacja
  EPL (0 czarny / 1 biały), ZPL odwrotnie. SHA256 źródła do identyfikacji importu.
- Rozmiar wyliczany z punktów oraz **jawnie wybranego DPI**, potwierdzany przez
  operatora. Po imporcie blokada zmiany wymiarów/DPI; nie stosujemy fit-to-page.
- PNG do podglądu + kanoniczny GFA do istniejącego zapisu projektu. Ponowne otwarcie
  importu używa tego samego lokalnego parsera. Stara ręczna ścieżka wklejania ZPL
  nadal korzysta z Labelary — nowy import jej nie wywołuje.
- `raster_to_epl` generuje kompletne **bajty** GW/P1 z monochromatycznej etykiety;
  `raster_to_zpl` generuje GFA. Są przetestowanymi funkcjami, **nie gotowym transportem
  Windows/Tauri ani rendererem dynamicznej serii EPL**. Obecny projektant nadal wysyła
  ZPL. UI ostrzega przed użyciem tej ścieżki dla GC420t/EPL.

### Sztuki i dodruk ZPL

- Generator blokuje wiersz linii `FOR UPDATE` przed sprawdzeniem istniejących sztuk.
  Nie zmieniono formatu QR, generatora cuid ani numeracji partii.
- Ten sam `UnitReprintModal` rozpoznaje istniejący typ szablonu i przekazuje unitIds
  do A4 albo ZPL. Nie dodano alternatywnej ewidencji sztuk.
- Obie ścieżki renderu ZPL filtrują istniejące sztuki na serwerze; obcy ID, duplikat ID,
  jawnie pusta lista i niezgodny klient/receptura są błędem, nie żądaniem całej serii.
- Produkcyjny ZPL wymaga dynamicznego pola QR `[[QR]]` i unikalnych zapisanych QR.
  Wsad 500 sztuk zawiera 500 odrębnych kodów. Każda sztuka ma dokładnie `PQ1`;
  kopie z eksportu Designer nie są dziedziczone. Nie grupujemy etykiet sztuk w PQn.
- Przed wygenerowaniem wydruku produkcyjnego i próbnego z projektanta walidowana
  jest lista poleceń etykiety ZPL. Polecenia urządzenia, zapisu zasobów, zmiany
  znaków sterujących, nieznane instrukcje i nieobsługiwana grafika są blokowane.
  Nie jest to pełny interpreter ZPL. Starszy szablon z poleceniami spoza listy może
  wymagać ponownego eksportu — błąd jest celowy, nie wolno go omijać passthrough.
- Błąd walidacji projektanta nie uruchamia po cichu drugiego szablonu. Fallback
  jest wyłącznie przy jawnym braku projektu, nie przy błędzie HTTP/QR.
- Komunikat: brak skanu != brak wydruku; przekazanie != fizyczny wydruk.
- Pierwszy etap używał aktualnego szablonu i danych. Kontynuacje poniżej dodają
  historyczne odtwarzanie **nowo zapisanych zadań ZPL i A4**. Starsze wydruki
  bez snapshotu nadal nie gwarantują odtworzenia oryginalnej etykiety.

### Kontynuacja 2026-10-19 — rewizje i trwałe zadania ZPL

- `label_template_revisions`: bazowy zapis istniejących szablonów A4/ZPL oraz
  projektów Zebra, kolejne wersje przy zmianie treści, wpis przy usunięciu.
  Zmiana samego `updated_at` nie tworzy rewizji. Oryginalne PDF, procenty,
  slot overrides i kalibracja pozostają w dokumencie bez przeliczania.
- `label_print_jobs`, `label_print_job_items`, `label_print_events`: gotowy ZPL
  każdej istniejącej sztuki (zlib + SHA256), dane sztuki i receptury **z chwili
  przygotowania**, referencja do rewizji, identyfikator wybranego urządzenia,
  operator z sesji i chronologiczne zdarzenia. Brak tworzenia finished_units
  w tym mechanizmie. Brak FK do zmiennych danych produkcji jest celowy: usunięcie
  bieżącego szablonu/receptury nie usuwa archiwalnego wydruku.
- Triggery blokują UPDATE/DELETE snapshotów, rewizji i zdarzeń. Metadane zadania
  są niezmienne, stany mają jednokierunkowe przejścia. To nie jest zabezpieczenie
  WORM przed administratorem bazy; backup i uprawnienia DBA pozostają konieczne.
- Pierwotne przygotowanie blokuje odczytywane wiersze `FOR SHARE`, sprawdza
  powiązanie klient/receptura, dynamiczny i unikalny QR, listę komend i jedną
  kopię. Niejednoznaczne aliasy/szablony są błędem, nie losowym wyborem.
- Idempotency key i blokada transakcyjna zapobiegają dwóm zapisom tej samej
  operacji. `begin` blokuje wiersz zadania — tylko jedno równoległe żądanie
  uzyska token próby. Brak potwierdzonego `begin` oznacza brak wysyłki etykiet.
- Ekran `/etykiety/zebra` przed wysyłką zapisuje zadanie i używa **zapisanych**
  bajtów, nie wcześniejszego podglądu. Klucz operacji zapisuje w URL przed POST;
  po otrzymaniu odpowiedzi zastępuje go `jobId`. Przeładowanie odczytuje stan,
  nigdy automatycznie nie ponawia drukowania. Przygotowane zadanie można ręcznie
  wysłać lub anulować; zmiana drukarki wymaga anulowania niewysłanej operacji.
- Istniejący transport BrowserPrint ma opcjonalny `beforeSend` pod blokadą
  urządzenia, po preflight. Dla zapisanych etykiet brak automatycznego dodawania
  `^MF`: treść etykiety pozostaje identyczna. Kontrole stanu/medium nadal działają;
  kalibracja jawnie z istniejącego panelu. Inne moduły zachowują domyślne zachowanie.
- Stany: `prepared → submitting → submitted / exported / uncertain` albo
  `prepared → cancelled`. `submitted` oznacza callback BrowserPrint, **nie
  fizyczny wydruk**; `exported` tylko przekazanie pliku do pobrania, nie jego
  wysłanie do drukarki ani nawet potwierdzenie zapisu na dysku.
- Błąd po uzyskaniu tokenu zapisuje `uncertain` (o ile serwer jest dostępny).
  Po utracie połączenia może pozostać `submitting`. Po minimum 5 minutach operator,
  po zamknięciu starej próby i sprawdzeniu drukarki, może oznaczyć wynik jako
  nieznany. Nie cofa to bajtów w buforze. Nie ma automatycznego ponawiania
  niepewnej próby ani gwarancji „dokładnie jeden fizyczny wydruk”.
- `UnitReprintModal` odczytuje historię wybranej sztuki i pozwala wybrać konkretny
  zapis. Historyczny dodruk tworzy nowe zadanie z wybranymi sztukami i **kopiuje
  oryginalne payloady/snapshoty/referencję do rewizji**, bez odczytu aktualnych
  receptur, szablonów czy finished_units. Wymaga świadomego potwierdzenia w UI;
  dla źródła `uncertain` również API wymaga `acknowledge_uncertain`.
  Awaria odczytu historii nie uruchamia fallbacku do bieżącego szablonu.
- Jawna opcja „Aktualny szablon” pozostaje, ale nie jest przedstawiana jako
  rekonstrukcja historii. Historia obejmuje maksymalnie 100 ostatnich zadań
  danej sztuki. Nie odtwarza zapisów sprzed wprowadzenia tego mechanizmu.
- Limity: 1000 sztuk/zadanie, 4 MiB ZPL/sztukę, 64 MiB rozpakowanego ZPL,
  16 MiB skompresowanych payloadów i 8 MiB snapshotów danych/zadanie.
  Przekroczenie wycofuje całą operację, nic nie wysyła. Dotychczasowe endpointy
  podglądu ZPL też mają limit sztuk/pamięci i renderują bloki kolejno.
  Nie jest to jeszcze streaming dużych serii ani cache współdzielonych grafik.
- Scope ma stałą wartość `legacy-single-company`; nie przyjmujemy tenant ID
  z przeglądarki i **nie deklarujemy izolacji wielu firm**. Nowe operacje historii
  wymagają rzeczywistej sesji (token renderowania PDF nie nadaje uprawnień druku).

API (autoryzowane istniejącymi regułami MES, domyślnie biuro):

| Endpoint | Znaczenie |
|---|---|
| `POST /api/labels/zebra/jobs` | Przygotuj nowe zadanie lub historyczny dodruk; idempotency key |
| `GET /api/labels/zebra/jobs/{id}` | Zapisany payload i historia; opcjonalnie wybrane `unit_ids` do podglądu/dodruku |
| `GET /api/labels/zebra/job-by-key?key=…` | Odzyskaj wynik przygotowania po zerwaniu odpowiedzi; bez efektów ubocznych |
| `POST /api/labels/zebra/jobs/{id}/actions` | `begin`, `cancel`, `submitted`, `exported`, `uncertain`, ręczne `recover` |
| `GET /api/labels/zebra/unit-history/{unit_id}` | Ostatnie zadania istniejącej tożsamości sztuki |
| `GET /api/label-templates/history/{source}/{template_id}` | Lista rewizji istniejącego modelu legacy |
| `GET /api/label-templates/revisions/{revision_id}` | Dokument wybranej rewizji |

### Kontynuacja 2026-10-20 — snapshoty A4/PDF i wspólna historia

- Rozszerzenie **tego samego** rejestru, nie drugi system zadań: `language=a4`,
  transport `browser` lub `file`, niezmienny `render_context`, nowy stan
  `dialog_opened`. Upgrade poszerza CHECK-i i dodaje kolumnę w transakcji;
  istniejące zadania ZPL pozostają bez zmian. Obsługiwane są też klucze
  idempotencji utworzone przed dodaniem domyślnych pól A4 do DTO.
- `label_a4_snapshot.py`: dane istniejącej sztuki, oryginalny QR, data produkcji,
  masa i zapisany numer partii; snapshot receptury, jej trwałość, kod i flaga
  nadzoru HALAL, rewizja szablonu z osadzonym tłem, numer arkusza i slotu.
  Payload każdej sztuki ma zlib + SHA256; kontekst zadania chroni istniejący
  trigger niezmienności. Nie zmieniamy finished_units ani danych partii.
- Brak prawidłowej daty produkcji jest błędem, nie zgodą na użycie zegara
  przeglądarki. Nieprawidłowy układ, brak QR w zajętym slocie, nieznany klient,
  brak wymaganego HALAL i zewnętrzne URL zasobów blokują przygotowanie.
  Nowe snapshoty dopuszczają osadzone PDF/PNG/JPEG/WebP. Nie jest to nowy,
  kompletny sanitizer/importer dowolnych dokumentów PDF.
- Dodruk wskazuje źródłowe zadanie i konkretne ID. Kopiuje zapisane wejścia,
  kontekst i rewizję, **bez odczytu bieżącego klienta, receptury, szablonu czy
  sztuki**. Nie nadpisuje oryginalnego kodu HALAL. Usunięcie bieżącego szablonu
  lub receptury nie uniemożliwia odtworzenia zapisanych wejść.
- `groupA4Units` zachowuje logiczny arkusz i oryginalny slot. Wybranie tylko
  drugiej etykiety nie przenosi jej do pierwszego slotu. Nie są renderowane
  dynamiczne pola ani QR sąsiednich sztuk. Arkusze bez wybranych sztuk są
  pomijane, bez alokowania pustych stron. Całe **statyczne tło** pozostaje:
  nie rozpoznajemy ani nie usuwamy z niego starych kodów wtopionych w grafikę
  (maskowanie/usuwanie obiektów nadal jest osobnym, niezrealizowanym zakresem).
- `buildVectorPdf` nadal osadza oryginalny PDF i drukuje 210 × 297 mm.
  Procenty, mm QR, punkty fontów, offsety, nadpisania slotów i kalibracja nie
  są przeliczane w bazie. Zachowane `fit`, `fitStretch` oraz kwadratowy QR.
  Ta sama funkcja służy próbnemu wydrukowi edytora. Rastrowe szablony nadal
  używają istniejącej ścieżki HTML; nie dodano konkurencyjnego renderera.
- Wersja wejść to `legacy-a4-v1`. **Nie przechowujemy gotowych bajtów końcowego
  PDF** — składamy dokument ponownie. Przyszła zmiana reguł formatowania,
  fontów, QR lub geometrii wymaga nowej wersji renderera z zachowaniem starego
  adaptera albo archiwizacji artefaktów. Sam snapshot wejść nie gwarantuje
  identycznych bajtów PDF ani identycznej rasteryzacji HTML na różnych systemach.
- `/etykiety/druk`: jeden klik „Drukuj”/„Pobierz PDF” **na tym ekranie**, po
  podaniu HALAL i świadomym potwierdzeniu dodruku, przygotowuje zadanie na
  serwerze i składa wyjście wyłącznie z odpowiedzi snapshotu. Nie drukuje
  wcześniejszego live preview. Nie ma już automatycznego druku HTML po wejściu
  na stronę; samo otwarcie dokumentu z planu nie jest zleceniem wysyłki.
- `requestKey` jest zapisany w URL przed POST, potem zastępowany `jobId`.
  Odczyt po kluczu, odświeżenie lub wejście w historię **nigdy samo nie drukuje**.
  Podwójny klik i StrictMode nie powielają efektów. Zmiana ekranu unieważnia
  lokalny zamiar, również gdy operator wróci do tego samego URL przed końcem
  oczekiwania. Nieaktualny QR/PDF/błąd nie może zostać użyty przez nowy render.
- Przed `begin` czekamy na dekodowanie obrazów i fonty HTML. Błąd lokalnego
  składania pozostawia zadanie `prepared`. Po potwierdzonym `begin` błąd
  wyjścia/potwierdzenia oznacza `uncertain`; utrata odpowiedzi `begin` blokuje
  IO i może pozostawić `submitting`. Wspólne ręczne `recover` nadal wymaga
  sprawdzenia poprzedniej próby i co najmniej 5 minut. Brak automatycznych retry.
- `dialog_opened` znaczy **wywołanie funkcji okna druku**, nie potwierdzenie,
  że dialog był widoczny, operator go zaakceptował lub urządzenie drukowało.
  `exported` znaczy przekazanie pobierania do przeglądarki. Nie znamy wybranej
  w systemowym dialogu drukarki; jej pole opisuje dialog, a nie fikcyjne USB.
  Historia dotyczy przycisków aplikacji, nie ręcznego Ctrl+P, wydruku pobranego
  pliku ani liczby kopii wybranej poza MES. Pasek narzędzi podglądu PDF ukryto,
  ale nie jest to zabezpieczenie przed drukiem poza aplikacją.
- A4/PDF nigdy nie trafia do BrowserPrint/RAW. Wyjścia muszą odpowiadać
  `browser:dialog` lub `file:pdf`. Eksport PDF bez oryginalnego PDF tła jest
  blokowany także dla dodruku historycznego; nie udajemy konwersji HTML na PDF.
- Dla HTML w Tauri opcjonalny ścisły tryb istniejącego `drukuj` nie zamienia
  błędu natywnego w pozorny sukces no-op `window.print()`. Inne dokumenty
  zachowują dotychczasowy fallback. Druk osadzonego PDF w Tauri jest jawnie
  niedostępny: należy wyeksportować plik i użyć zewnętrznej przeglądarki PDF.
  To ograniczenie nie jest wykonaniem adaptera Windows RAW ani testem WebView2.
- Wspólny `UnitReprintModal` pokazuje ZPL i A4 i otwiera właściwy ekran na
  podstawie języka **zapisanego zadania**, nie rodzaju aktualnego szablonu.
  Jawna opcja aktualnych danych pozostaje, z ostrzeżeniem o braku rekonstrukcji.
- Limit nowego zadania A4: 200 sztuk, do 32 MiB na każde osadzone tło; wspólne
  limity snapshotów/payloadów nadal obowiązują. QR powstają kolejno, składanie
  PDF można przerwać między sztukami. To ogranicza narzut, ale nie zastępuje
  streamingu, cache ani izolowanego procesu z twardym limitem pamięci dla PDF.
- Nowe endpointy poniżej są aliasami istniejącej implementacji historii, mają
  domyślne uprawnienia biura i wymagają rzeczywistej sesji operatora. Token
  headless renderowania sam nie daje uprawnień. Scope nadal `legacy-single-company`.

| Endpoint | Znaczenie |
|---|---|
| `POST /api/label-print-jobs` | Przygotowanie ZPL/A4 lub wybranego historycznego dodruku |
| `GET /api/label-print-jobs/{id}` | Snapshot, układ i zdarzenia; opcjonalnie `unit_ids` |
| `GET /api/label-print-jobs/by-key?key=…` | Odczyt wyniku operacji bez druku |
| `POST /api/label-print-jobs/{id}/actions` | Wspólne przejścia, także `dialog_opened` |
| `GET /api/label-print-jobs/unit-history/{unit_id}` | Wspólna historia sztuki |

### Pozostały zakres — blokuje pełny odbiór

1. Wspólny wersjonowany dokument projektu i archiwum końcowych artefaktów PDF.
   Rewizje legacy A4/ZPL i snapshoty nowych zadań ZPL/A4 są już zaimplementowane;
   nie zastępują uniwersalnego modelu projektu ani produkcyjnego snapshotu
   utworzonego w momencie powstania sztuki. Ujednolicenie prezentacji partii A4/ZPL
   nadal wymaga osobnej zmiany, bez modyfikowania zapisanych partii i QR.
2. Renderer kompletnej dynamicznej etykiety EPL w natywnej rozdzielczości oraz
   adapter Windows RAW/Tauri, profile drukarek/kalibracja EPL i wybór urządzenia.
3. Worker/wsady dzielone na mniejsze paczki, streaming i cache statyki,
   anulowanie/wznawianie pomiędzy paczkami oraz harmonogram/przegląd kolejki.
   Obecne trwałe zadania ZPL/A4 obsługują idempotencję, wznawianie niewysłanej
   operacji i stany niepewne, ale nie zatrzymują serii już przekazanej BrowserPrint.
4. Maskowanie z kontrolą kolizji, usuwanie źródłowych obiektów, warstwy, wielokrotny
   wybór/kopiowanie, dodatkowe typy pól, obrót, formaty, linie pomocnicze i snapping
   do elementów. Obecna siatka nie jest realizacją wszystkich tych funkcji.
5. Warianty/kopiowanie/archiwum/eksport projektów, domyślne drukarki oraz izolacja
   firm oparta o uwierzytelnienie i powiązaną ewidencję MES.
6. Realny VATAN.prn, dalsze regresje integracji całego workflow, testy Windows i fizyczne
   wydruki A4/GC420t/300 DPI. Nie wykonywano deploymentu ani migracji produkcyjnych.

### Weryfikacja

- Przed zmianami: 29 testów frontendowych dotyczących PDF/dodruków/ZPL/partii,
  53 testy backendowe — zaliczone; TypeScript bez błędów.
- Pełny przebieg Vitest podczas implementacji: **233 pliki / 3165 testów zaliczonych**,
  w tym produkcja, skanowanie i magazyn. Po tym przebiegu dodano kolejne testy etykiet;
  końcowy wynik jest raportowany oddzielnie, nie należy sumować przebiegów.
- Playwright Chromium: **4/4**, realna przeglądarka z mockowanym API (zero danych
  produkcyjnych), szerokości 800/1280/1920 px, brak przewijania całej strony w poziomie,
  mm/cofnij, dostępność klasycznego układu i kalibracji oraz rzeczywisty drag/cofnij.
  Pierwszy przebieg miał błąd mocka (`**/api/**` przechwytywało moduł Tauri);
  zawężono go do ścieżek zaczynających się od `/api/`, następny przebieg zaliczony.
- Python: roundtrip binarny EPL↔ZPL↔PNG, polaryzacja, 203/300 DPI, padding, uszkodzenia,
  nieobsługiwane instrukcje/limity, 500 QR i pojedynczy dodruk, zgodność klient/receptura,
  odrzucanie komend urządzenia. Test współbieżności PostgreSQL dodany, ale **pominięty**
  bez `TEST_DATABASE_URL`. Nie uznajemy mocka za test blokad PostgreSQL.
- TypeScript i Vite build zaliczone. Artefakty wyłącznie w `/tmp/opencode/`, nie we
  wdrożeniu. Ostrzeżenia: stare dane Browserslist, rozmiar chunków; istniejące testy
  innych modułów zgłaszają także ostrzeżenia React/Radix/jsdom.

**Końcowy przebieg tego etapu (2026-10-18):**

| Weryfikacja | Wynik |
|---|---|
| Pełny `npm test` | **236 plików / 3173 testy zaliczone** |
| Ukierunkowany pytest (import, dodruk, QR, szablony, skaner, odpowiedź palety) | **132 zaliczone, 2 pominięte** |
| Pominięte testy SQL | Współbieżność generowania i integracyjna odpowiedź palety — brak TEST_DATABASE_URL |
| `npx playwright test e2e/label-studio.spec.ts --workers=1` | **4 zaliczone** |
| `npm run typecheck` | zaliczone |
| Vite build | zaliczone; `/tmp/opencode/mes-label-studio-build-20261018` |
| `git diff --check` | bez błędów whitespace |
| Windows/Tauri RAW, GC420t, rzeczywiste etykiety VATAN | **nie wykonano** |

Logi końcowego Vitest i builda: `/tmp/opencode/mes-label-studio-tests-final.log`,
`/tmp/opencode/mes-label-studio-build-final.log`. Nie wykonano push ani deploymentu.

**Kontynuacja — weryfikacja 2026-10-19:**

| Weryfikacja | Wynik |
|---|---|
| Pełny Vitest | **237 plików / 3191 testów zaliczonych** |
| Ukierunkowany pytest, z rzeczywistym PostgreSQL | **219 zaliczonych, bez pominięć** |
| Chromium — Studio A4 i historia ZPL | **6 zaliczonych** |
| TypeScript i Vite build | zaliczone; `/tmp/opencode/mes-label-history-build-20261019` |
| `git diff --check` | bez błędów whitespace |
| GC420t, Windows RAW, VATAN, rzeczywiste A4/300 DPI | **nie wykonano** |

PostgreSQL 14 uruchomiono jako osobną tymczasową instancję w
`/tmp/opencode/label-history-pg-20261019-*`, bez nasłuchu TCP, wyłącznie socket
lokalny na porcie 56182. Baza końcowych testów: `kebab_mes_test_history`.
Po testach instancję zatrzymano; pliki i logi pozostawiono do odtworzenia testów.
Testy objęły m.in. addytywny upgrade legacy A4 i jego dokładne współrzędne,
powtórzenie DDL, równoległe rewizje, równoległe generowanie 100 sztuk,
idempotentne przygotowanie, jednego zwycięzcę `begin`, archiwalny dodruk po
zmianie danych/usunięciu szablonu i receptury, niezmienność ewidencji sztuk,
limity pamięci, zakaz UPDATE/DELETE historii, anulowanie i ręczny recovery.
Zaliczono również regresje produkcyjnego skanowania i pakowania na palety.

Frontend: testy zerwanego `begin`, timeout transportu, utraty potwierdzenia,
blokady niewłaściwego USB, pobrania pliku jako `exported`, odzyskania zadania po
kluczu i braku fallbacku z niedostępnej historii. Chromium testuje rzeczywisty
ekran w 375/1280 px oraz Studio w 800/1280/1920 px, z mockami API/BrowserPrint,
bez połączenia z drukarką. Zrzuty ekranu historii obejrzano. Pierwszy przebieg
E2E ujawnił błędne oczekiwanie testu: StrictMode w Vite wykonuje odczyt podglądu
dwukrotnie. Test teraz sprawdza brak **dodatkowych** odczytów bieżącego szablonu
podczas historycznego dodruku; powtórzony pełny przebieg 6/6 zaliczony.
Końcowy przegląd usunął zależność klucza operacji od `crypto.randomUUID()`:
na intranetowym HTTP używamy `getRandomValues` (128 bitów), bez zmiany generatora
QR sztuk. Ostatni Vitest i E2E obejmują środowisko bez `randomUUID`.

Logi: `/tmp/opencode/label-history-vitest-final.log`,
`/tmp/opencode/label-history-pytest-final.log`,
`/tmp/opencode/label-history-playwright-final.log`,
`/tmp/opencode/label-history-build.log`. Pozostają wcześniejsze ostrzeżenia
Browserslist/chunków i części testów React/Radix; brak błędów buildu lub testów.
Zmiany nie są zacommitowane ani wypchnięte. Nie modyfikowano `/opt/kebab/app`,
nie wykonano deploymentu ani migracji produkcyjnej.

**Kontynuacja — weryfikacja A4/PDF, 2026-10-20:**

| Weryfikacja | Wynik |
|---|---|
| Pełny Vitest | **240 plików / 3220 testów zaliczonych** |
| Ukierunkowany pytest, z rzeczywistym PostgreSQL | **258 zaliczonych, bez pominięć** |
| Chromium — Studio, historia ZPL, historia A4/PDF | **9 zaliczonych** |
| TypeScript i Vite build | zaliczone; `/tmp/opencode/mes-label-a4-history-build-20261020` |
| `git diff --check` oraz nowe pliki A4/historii | bez błędów whitespace |
| Windows/Tauri na urządzeniu, GC420t, rzeczywiste A4/300 DPI, VATAN | **nie wykonano** |

SQL obejmuje zachowanie starych zadań ZPL po dwukrotnym upgrade do A4, zgodność
wcześniejszych kluczy idempotencji, równoległe przygotowanie i `begin` dla obu
języków, odtworzenie dat/HALAL/slotów po zmianie danych i usunięciu klienta,
receptury oraz szablonu, brak modyfikacji ewidencji sztuk, niezmienność kontekstu,
walidację i rollback limitów oraz odmowę eksportu historycznego HTML jako PDF.
Pozostałe testy sprawdzają wcześniejsze importy EPL/ZPL, generowanie QR,
skanowanie, przyjęcie na stan i pakowanie na palety. Testy SQL uruchomiono tylko
na wcześniejszej odizolowanej instancji `/tmp/opencode/label-history-pg-20261019-*`,
baza `kebab_mes_test_history`, socket 56182, bez TCP. Po testach instancję zatrzymano.

Frontend: brak auto-print i podwójnej wysyłki w StrictMode; obsługa utraconego
`begin`, odzyskanie po kluczu, brak fallbacku z błędu historii, anulowanie,
niepoprawny slot, awaria obrazu/adaptera, opuszczenie strony podczas dekodowania
lub claim oraz powrót do tego samego URL bez przywrócenia starej zgody na druk.
Testy prawdziwego `pdf-lib` sprawdzają A4, milimetry, kalibrację, historyczny
drugi slot, wybrane sztuki z różnych arkuszy, `fit` i `fitStretch` z kwadratowym
QR. Dla testów fit syntetyczne są wyłącznie zdekodowane piksele wejścia cropu;
PDF/fonty/QR i odczyt operatorów wyjściowego PDF nie są mockowane.

Chromium używa rzeczywistych komponentów, QR i rendererów, ale **mockuje API
i wywołanie dialogu**, nie komunikuje się z drukarką. Ekrany A4 sprawdzono w
375/1280 px, Studio w 800/1280/1920 px. Pobrany PDF jest odczytywany w teście:
jedna strona 210 × 297 mm, jeden QR 40 mm w pierwotnym drugim slocie. Zrzuty
obu szerokości oraz wygenerowaną stronę PDF obejrzano. Wąski podgląd HTML ma
własne przewijanie poziome, bez rozciągania całej strony.

Logi końcowe: `/tmp/opencode/label-a4-vitest-final.log`,
`/tmp/opencode/label-a4-pytest-final.log`, `/tmp/opencode/label-a4-playwright-final.log`,
`/tmp/opencode/label-a4-build-final.log`; zrzuty i PDF: `/tmp/opencode/label-a4-e2e-final/`.
Pozostają ostrzeżenia Browserslist, wielkości chunków i wcześniejszych testów
React/Radix/jsdom. Zmiany nadal są niezatwierdzone w git. Bez push, deploymentu,
migracji produkcji i zmian w `/opt/kebab/app`. Zastane skrypty/korekty palet
ZAGROS/YALCIN i kopie konfiguracji OpenCode pozostawiono bez zmian.

## Kwalifikacja wspólnego wydania — 2026-10-27

Właściciel zatwierdził **wdrożenie gotowego etapu**, wspólnie z poprawkami
wydań częściowych POLAT/ZAGROS, oraz commit, push i standardową bramkę CI.
To nie jest deklaracja wykonania pełnej specyfikacji z sekcji „Pozostałe prace”.
EPL/Windows RAW, rozbudowane warstwy, kolejka wsadów i odbiór fizyczny pozostają
poza tym wydaniem. Nie wykonano testów drukarki GC420t, VATAN ani Windows.

Zakres etykiet: Studio/klasyczny A4, import obsługiwanego rastra EPL/ZPL,
walidacja QR, bezpieczne generowanie sztuk, historia rewizji i trwałe zadania
A4/ZPL, świadome dodruki ze snapshotów. Nie zmieniamy formatu QR ani ewidencji
sztuk. Zapisany stan transportu nie stanowi potwierdzenia fizycznego wydruku.

Kontrola przed wydaniem:

- Backend VPS odpowiada bazowemu commitowi `5dfebc0e` plus wcześniej wdrożona
  poprawka `pallets_service.py`; poprawka jest zachowana w kandydacie wydania.
- Nowa walidacja przyjmuje **5/5 istniejących szablonów A4** i ZPL generowany
  z **1/1 istniejącego projektu Zebra**. Nie dowodzi to zgodności fizycznej
  drukarki ani kompletności powiązania projektu z produktem.
- Pełny dump produkcji odtworzono wyłącznie w osobnej lokalnej bazie testowej.
  Dwa przebiegi migracji zachowały wszystkie dotychczasowe rekordy i kolumny
  **101 istniejących tabel** (porównanie liczności i SHA256 uporządkowanych danych).
- Chromium: **13/13** — Studio, historia A4/ZPL i dokumenty czterech scenariuszy
  wysyłek. Transport HTTP/drukarki mockowany; renderery PDF rzeczywiste.
- Frontend: **242 pliki / 3228 testów**, TypeScript i build zaliczone.
- Logi kwalifikacji: `/tmp/opencode/release-audit-20261027/`. Końcowy wynik
  backendu, wynik CI, SHA wydania i potwierdzenie wdrożenia wymagają osobnego
  odnotowania po ich zakończeniu; samo zatwierdzenie zakresu nie oznacza wdrożenia.

Jednorazowe skrypty korekt YALCIN/ZAGROS/POLAT, ich osobne testy i kopie
konfiguracji OpenCode nie są częścią wydania ani nie zostaną uruchomione.
Przed deploymentem wymagana świeża kopia DB/kodu/frontendu na VPS i plan
rollbacku kodu bez kasowania nowych tabel historii lub danych produkcyjnych.
