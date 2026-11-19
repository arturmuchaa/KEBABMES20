# Okno druku i rejestr wydruków — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Każdy wydruk z MES biuro i PROTRIMA idzie przez nasze okno druku z opcjami ze sterownika (zasobnik, kolor, dwustronnie, papier, opcje Konica), z ustawieniami zapamiętanymi na komputerze, a serwer rejestruje każdy wydruk i pokazuje, które kartki palet wydrukowano.

**Architecture:** Część Windows aplikacji Tauri (`src-tauri/src/druk/`) czyta drukarki i PrintCapabilities, zamienia stronę na PDF (WebView2 PrintToPdf) i drukuje go przez PDFium na kontekście drukarki z DEVMODE z PrintTicketu. Wspólne okno React (`src/lib/druk/`) budowane z listy funkcji sterownika. Backend dostaje tabelę `print_log` i API rejestru; listy palet niosą datę ostatniego wydruku.

**Tech Stack:** Tauri 2 (Rust, crate `windows` z Win32 Printing/XpsPrint, `webview2-com`, `pdfium-render`, `quick-xml`), React + vitest, FastAPI + PostgreSQL (psycopg, `migrations.py`).

**Spec:** `docs/superpowers/specs/2026-11-19-okno-druku-design.md`

## Global Constraints

- Gałąź `feat/okno-druku-20261119`, worktree `/opt/kebab/wt-druk`; baza kodu = produkcja (`7a1c300c`).
- Kod Win32 tylko pod `#[cfg(windows)]`; na innych systemach komendy zwracają `Err("nieobsługiwane")`, a `cargo test` na Linuksie przechodzi.
- Skalowanie zawsze 1:1, bez dopasowania do strony (kartki z QR).
- Domyślnie: domyślna drukarka Windows, zasobnik 1 (opcja z „1” w nazwie, inaczej pierwsza), czarno-biały, 1 kopia.
- Ustawienia w `%APPDATA%\KebabMES\druk.json`, wspólne dla MES i PROTRIMA na komputerze, osobne na każdym komputerze (także kolory zasobników).
- Poza zakresem: Zebra/ZPL, kioski HMI (dziedziczą kod, nie są celem testów), podgląd w oknie.
- Wydruk nigdy nie przepada po cichu: błąd → komunikat + „Drukuj oknem systemowym” (dzisiejsze `print_page`).
- Rejestr nie blokuje druku: błąd zapisu → kolejka w `localStorage` (`druk.rejestr.kolejka`), ponowienie przy następnym wydruku i co 60 s.
- Teksty UI po polsku, zwykłym językiem (wzór: istniejące moduły PROTRIMA).
- Commity kończą się liniami atrybucji z sesji (Co-Authored-By / Claude-Session).

## Review Focus

1. Zapisana drukarka już nie istnieje (zmiana nazwy, odłączona) → okno wybiera domyślną Windows i pokazuje „Zapisana drukarka „X” jest niedostępna — wybrano domyślną”. Test w Task 5.
2. Zapisany ticket po aktualizacji sterownika ma opcje, których już nie ma → `PTMergeAndValidatePrintTicket` naprawia ticket, okno nie pada. Test parsera w Task 2 (opcja wybrana spoza listy → `wybrana = None`) i ścieżka w Task 3.
3. Serwer nie odpowiada przy zapisie rejestru → druk przechodzi, wpis czeka w kolejce i dochodzi później. Test w Task 4.
4. Druk części palet (zaznaczone 2 z 14) → w rejestrze i znacznikach tylko te 2. Test w Task 1 i Task 7.
5. Stary desktop bez nowych komend (`invoke` → „command … not found”) → `drukuj()` używa `print_page` jak dziś. Test w Task 6.

---

### Task 1: Rejestr wydruków (backend)

**Files:**
- Modify: `kebab_fixed/backend/app/migrations.py` (nowa tabela obok `cold_storage_weighings`)
- Create: `kebab_fixed/backend/app/services/druk_rejestr_service.py`
- Create: `kebab_fixed/backend/app/routes/druk.py` (rejestracja jak inne moduły w `main.py:244`)
- Modify: `kebab_fixed/backend/app/services/pallets_service.py` (`list_pallets`)
- Modify: `kebab_fixed/backend/tests/conftest.py` (TRUNCATE `print_log`)
- Test: `kebab_fixed/backend/tests/test_druk_rejestr_db.py`

**Interfaces:**
- Produces: tabela `print_log(id TEXT PK, rodzaj TEXT NOT NULL, tytul TEXT, order_id TEXT, pallet_ids TEXT[] NOT NULL DEFAULT '{}', dokument_id TEXT, drukarka TEXT, zasobnik TEXT, kopie INT NOT NULL DEFAULT 1, stron INT, komputer TEXT, operator TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now())`, indeksy `(order_id, at DESC)` i GIN na `pallet_ids`.
- Produces: `zapisz(wpis: dict, operator: str) -> dict`; `lista(order_id: str) -> list[dict]`; `POST /api/druk/rejestr` (body camelCase: `rodzaj, tytul, orderId, palletIds, dokumentId, drukarka, zasobnik, kopie, stron, komputer, klientId`), `GET /api/druk/rejestr?order_id=`.
- Produces: każdy element `list_pallets()` ma `ostatni_wydruk_at` (ISO albo null), `ostatni_wydruk_kto`, `liczba_wydrukow`; mapowanie frontu w `src/lib/api.ts` → `OrderPallet.lastPrintAt / lastPrintBy / printCount`.
- `klientId` = losowy identyfikator wpisu z frontu; ponowne wysłanie tego samego `klientId` nie dubluje wpisu (`id = klientId`, `ON CONFLICT DO NOTHING`).

- [ ] **Step 1: Testy** — `test_zapis_i_lista_dla_zamowienia` (zapis z `orderId`, `palletIds=[p1,p2]` → `lista` zwraca wpis z operatorem z sesji); `test_ponowny_klientId_nie_dubluje`; `test_list_pallets_niesie_ostatni_wydruk` (dwa wydruki p1 o 10:00 i 11:40, p2 raz, p3 nigdy → p1 `liczba_wydrukow == 2` i `ostatni_wydruk_at` = 11:40, p3 `None`); `test_wydruk_czesci_palet` (wpis z `[p2]` nie oznacza p1); `test_post_bez_rodzaju_400`.
- [ ] **Step 2:** `pytest tests/test_druk_rejestr_db.py -v` → FAIL (brak tabeli/modułu).
- [ ] **Step 3:** Migracja, serwis, trasa (`operator` przez `_subject_label` jak w `routes/magazyn.py:_operator`), log `druk.zapisany` z polami `rodzaj, order_id, pallet_ids, drukarka, zasobnik, kopie, komputer`. W `list_pallets` jedno zapytanie agregujące `print_log` po `unnest(pallet_ids)` dla id palet zamówienia.
- [ ] **Step 4:** test zielony + `pytest -q tests -k "not _db"` bez regresji.
- [ ] **Step 5:** Commit `feat(druk): rejestr wydruków i ostatni wydruk przy paletach`.

### Task 2: Odczyt drukarek i możliwości sterownika (Rust)

**Files:**
- Create: `kebab_fixed/src-tauri/src/druk/mod.rs` (komendy Tauri), `druk/mozliwosci.rs` (parser czysty), `druk/win.rs` (Win32, `#[cfg(windows)]`), `druk/ustawienia.rs` (plik JSON)
- Create: `kebab_fixed/src-tauri/tests/fixtures/bizhub-capabilities.xml` (przykładowy PrintCapabilities z zasobnikami 1–4, kolorem, duplexem, zszywaniem `ns0000:KMStaple…`, `psk:PageScaling`)
- Modify: `kebab_fixed/src-tauri/Cargo.toml` (`quick-xml`; pod `[target.'cfg(windows)'.dependencies]`: `windows` z funkcjami `Win32_Graphics_Printing`, `Win32_Storage_Xps_Printing`, `Win32_Graphics_Gdi`, `Win32_System_Com`)
- Modify: `kebab_fixed/src-tauri/src/lib.rs` (`generate_handler!` + `mod druk;`)

**Interfaces:**
- Produces (serde, camelCase do JS):
  - `struct Drukarka { nazwa: String, domyslna: bool }`
  - `struct Opcja { id: String, nazwa: String }`
  - `struct Funkcja { id: String, nazwa: String, opcje: Vec<Opcja>, wybrana: Option<String> }`
  - `struct Mozliwosci { funkcje: Vec<Funkcja>, ticket: String, kopieMax: u32 }`
- Produces (czyste, testowalne wszędzie): `fn parsuj_mozliwosci(caps_xml: &str, ticket_xml: &str) -> Result<Vec<Funkcja>, String>`; `fn ustaw_opcje(ticket_xml: &str, funkcja_id: &str, opcja_id: &str) -> Result<String, String>`; `fn zasobnik_domyslny(f: &Funkcja) -> Option<String>`.
- Produces (komendy Tauri): `druk_drukarki() -> Result<Vec<Drukarka>, String>`; `druk_mozliwosci(drukarka: String, ticket: Option<String>) -> Result<Mozliwosci, String>`; `druk_ustaw_opcje(ticket: String, funkcja: String, opcja: String) -> Result<String, String>`; `druk_ustawienia_czytaj() -> Result<String, String>` (zawartość `druk.json` albo `"{}"`); `druk_ustawienia_zapisz(json: String) -> Result<(), String>` (zapis atomowy: plik tymczasowy + rename).
- Reguły parsera: pomija funkcje z jedną opcją i `psk:PageScaling`; nazwa z `psk:DisplayName`, a bez niej id bez prefiksu; `wybrana` = opcja z ticketu, gdy istnieje na liście, inaczej `None`. Kolejność: najpierw `PageInputBin|JobInputBin`, `PageOutputColor`, `JobDuplexAllDocumentsContiguously`, `PageMediaSize`, `PageMediaType`, potem reszta w kolejności z XML.

- [ ] **Step 1: Testy** w `druk/mozliwosci.rs` (`#[cfg(test)]`): `zasobniki_maja_nazwy_ze_sterownika` (4 opcje, nazwy z DisplayName); `kolejnosc_najczestsze_na_gorze`; `pomija_skalowanie_i_jednoopcyjne`; `opcja_spoza_listy_daje_none`; `ustaw_opcje_podmienia_tylko_ta_funkcje`; `zasobnik_domyslny_wybiera_z_jedynka`; w `ustawienia.rs`: `brak_pliku_daje_puste`, `zapis_i_odczyt`.
- [ ] **Step 2:** `cd src-tauri && cargo test druk` → FAIL.
- [ ] **Step 3:** Parser (`quick-xml`), ustawienia (ścieżka z `std::env::var("APPDATA")`, w testach katalog tymczasowy przez parametr), komendy; `win.rs`: `EnumPrintersW` (PRINTER_ENUM_LOCAL|CONNECTIONS, poziom 4), `GetDefaultPrinterW`, `PTOpenProvider` + `PTGetPrintCapabilities` (ticket wejściowy albo domyślny użytkownika przez `PTConvertDevModeToPrintTicket` z `DocumentPropertiesW`), `PTMergeAndValidatePrintTicket` dla zapisanego ticketu.
- [ ] **Step 4:** `cargo test` zielony na Linuksie; `cargo check --target x86_64-pc-windows-msvc` przechodzi w CI Windows (Task 8).
- [ ] **Step 5:** Commit `feat(druk): drukarki i opcje sterownika z PrintCapabilities`.

### Task 3: Druk PDF i okno sterownika (Rust)

**Files:**
- Create: `kebab_fixed/src-tauri/src/druk/pdf.rs` (czysta geometria + PDFium), `druk/webview.rs` (PrintToPdf)
- Modify: `druk/win.rs`, `druk/mod.rs`, `Cargo.toml` (`pdfium-render` z dynamicznym ładowaniem `pdfium.dll` obok exe; `webview2-com` w wersji zgodnej z Tauri 2)

**Interfaces:**
- Consumes: `Mozliwosci.ticket` (Task 2).
- Produces: `druk_ustawienia_sterownika(drukarka: String, ticket: String) -> Result<String, String>` (nowy ticket; anulowanie okna → zwraca wejściowy); `druk_strona_pdf(window) -> Result<String, String>` (PDF base64 bieżącej strony: bez marginesów, z tłem, rozmiar z `@page`); `druk_pdf(drukarka: String, pdf: String, ticket: String, kopie: u32, od: Option<u32>, do_: Option<u32>, tytul: String) -> Result<u32, String>` (liczba wydrukowanych stron).
- Produces (czyste): `fn umiesc_strone(szer_pt: f32, wys_pt: f32, dpi_x: i32, dpi_y: i32, offset_x: i32, offset_y: i32) -> (i32, i32, i32, i32)` — prostokąt rysowania w pikselach urządzenia, skala 1:1, przesunięty o fizyczny margines.

- [ ] **Step 1: Testy** (`pdf.rs`): `a4_przy_600dpi_bez_skalowania` (595×842 pt, 600 dpi, offset 100 → x = −100, szer = 4958 px); `zakres_stron_poza_dokumentem_blad`.
- [ ] **Step 2:** `cargo test druk::pdf` → FAIL.
- [ ] **Step 3:** `win.rs`: ticket → DEVMODE (`PTConvertPrintTicketToDevMode`, `kPTJobScope`), `dmCopies` = kopie, `CreateDCW`, `StartDocW(tytul)`, na stronę `StartPage` → PDFium `render_into` na DC → `EndPage`, `EndDoc`; okno sterownika: `DocumentPropertiesW(hwnd okna, …, DM_IN_PROMPT|DM_IN_BUFFER|DM_OUT_BUFFER)` → ticket. `webview.rs`: `window.with_webview` → `ICoreWebView2_7::PrintToPdf` do pliku tymczasowego, czekanie na handler, odczyt + usunięcie pliku.
- [ ] **Step 4:** `cargo test` zielony; próba ręczna w Task 8.
- [ ] **Step 5:** Commit `feat(druk): druk PDF z ustawieniami sterownika i okno ustawień Konica`.

### Task 4: Warstwa JS druku

**Files:**
- Create: `kebab_fixed/src/lib/druk/typy.ts`, `natywny.ts`, `ustawienia.ts`, `rejestr.ts`, `rodzaje.ts`
- Test: `kebab_fixed/src/lib/druk/ustawienia.test.ts`, `rejestr.test.ts`

**Interfaces:**
- Consumes: komendy Task 2–3, `POST /api/druk/rejestr` (Task 1).
- Produces:
  - `type RodzajDruku = 'kartki-palet' | 'wz' | 'wm' | 'cmr' | 'hdi' | 'lista-kompletacji' | 'zamowienie' | 'rozrachunki' | 'rozliczenie-dostawy' | 'paski-wyplat' | 'plan-masowania' | 'inne'` i `NAZWA_RODZAJU: Record<RodzajDruku, string>` (np. `'kartki-palet': 'Kartki palet'`).
  - `interface UstawieniaDokumentu { drukarka: string; ticket: string; kopie: number }`; `interface UstawieniaDruku { dokumenty: Partial<Record<RodzajDruku, UstawieniaDokumentu>>; koloryZasobnikow: Record<string /*drukarka*/, Record<string /*opcja id*/, string /*kolor*/>> }`.
  - `czytajUstawienia(): Promise<UstawieniaDruku>`; `zapiszDokument(r: RodzajDruku, u: UstawieniaDokumentu): Promise<void>`; `zapiszKolor(drukarka: string, opcjaId: string, kolor: string): Promise<void>`.
  - `natywny`: `drukarki()`, `mozliwosci(drukarka, ticket?)`, `ustawOpcje(ticket, funkcja, opcja)`, `ustawieniaSterownika(drukarka, ticket)`, `stronaPdf()`, `drukujPdf({drukarka, pdfBase64, ticket, kopie, od?, do?, tytul})`, `dostepny(): Promise<boolean>` (false poza Tauri albo gdy `druk_drukarki` nie istnieje).
  - `interface WpisRejestru { rodzaj: RodzajDruku; tytul: string; orderId?: string; palletIds?: string[]; dokumentId?: string; drukarka?: string; zasobnik?: string; kopie: number; stron?: number }`; `zarejestruj(w: WpisRejestru): Promise<void>` (nigdy nie rzuca; nadaje `klientId`, przy błędzie dokłada do kolejki `druk.rejestr.kolejka`); `wyslijZaleglosci(): Promise<number>`.

- [ ] **Step 1: Testy** — `ustawienia`: `brak_pliku_daje_puste_ustawienia`, `zapis_dokumentu_nie_rusza_innych`; `rejestr`: `blad_serwera_trafia_do_kolejki_i_nie_rzuca`, `wyslijZaleglosci_wysyla_i_czysci` (ten sam `klientId`), `uszkodzona_kolejka_w_localStorage_nie_psuje_druku`.
- [ ] **Step 2:** `npx vitest run src/lib/druk` → FAIL.
- [ ] **Step 3:** Implementacja (invoke przez dynamiczny import `@tauri-apps/api/core` jak w `src/lib/print.ts`; `localStorage` w try/catch).
- [ ] **Step 4:** testy zielone.
- [ ] **Step 5:** Commit `feat(druk): warstwa JS — ustawienia na komputerze, rejestr z kolejką`.

### Task 5: Okno druku

**Files:**
- Create: `kebab_fixed/src/lib/druk/OknoDruku.tsx`, `src/lib/druk/okno-druku.css` (tokeny PROTRIMA z `src/protrima/styles`, działa też w MES)
- Test: `kebab_fixed/src/lib/druk/OknoDruku.test.tsx`

**Interfaces:**
- Consumes: Task 4.
- Produces: `<OknoDruku rodzaj tytul zrodlo onZamknij />`, gdzie `zrodlo: { typ: 'strona' } | { typ: 'pdf'; pdfBase64: string }`; po wydruku woła `onZamknij({ wydrukowano: true, drukarka, zasobnik /*nazwa opcji*/, kopie, stron })`, po anulowaniu `onZamknij({ wydrukowano: false })`, po wyborze starego okna `onZamknij({ systemowe: true })`.
- Układ jak w spec: drukarka; pola ze sterownika w kolejności z `Mozliwosci` (pierwsze pięć widoczne, reszta pod „Więcej ustawień drukarki”); kopie; strony (wszystkie / od–do); „Ustawienia drukarki…”; „zapamiętaj dla <NAZWA_RODZAJU>” (domyślnie zaznaczone); Anuluj / Drukuj. Zasobnik pokazuje „<nazwa ze sterownika> – <kolor>” i ma obok edycję koloru.

- [ ] **Step 1: Testy** (natywny zamockowany): `startuje_z_zapisanych_ustawien_rodzaju`; `pierwszy_raz_zasobnik_1_i_czarno_bialy`; `brak_zapisanej_drukarki_wybiera_domyslna_z_komunikatem` (tekst „Zapisana drukarka „X” jest niedostępna — wybrano domyślną”); `pola_bez_koloru_i_duplexu_ukryte`; `wiecej_ustawien_zwiniete`; `enter_drukuje`; `zapamietaj_zapisuje_ustawienia_rodzaju`; `blad_druku_pokazuje_komunikat_i_przycisk_systemowy`; `kolor_zasobnika_zapisany_per_drukarka`.
- [ ] **Step 2:** `npx vitest run src/lib/druk/OknoDruku.test.tsx` → FAIL.
- [ ] **Step 3:** Komponent (zmiana opcji → `ustawOpcje` na tickecie; zmiana drukarki → `mozliwosci(nowa)`).
- [ ] **Step 4:** testy zielone.
- [ ] **Step 5:** Commit `feat(druk): okno druku z opcjami sterownika`.

### Task 6: Podpięcie wszystkich wydruków

**Files:**
- Create: `kebab_fixed/src/lib/druk/DrukHost.tsx` (montuje okno na żądanie, kolejka jednego okna naraz)
- Modify: `kebab_fixed/src/lib/print.ts` (`drukuj(opcje)`), punkt montażu w `src/App.tsx` (MES) i `src/protrima/App.tsx`
- Modify (z `window.print()` na `drukuj`): `src/protrima/modules/orders/druk/ZamowienieDruk.tsx`, `KartkiPalet.tsx`, `ListaKompletacji.tsx`, `src/protrima/modules/plan-masowania/Okna.tsx`, `src/protrima/modules/stock/StanDlaKlienta.tsx`, `src/pages/office/RozliczenieDostawyPage.tsx`, `PaySlipsPrintPage.tsx`, `SignatureVerificationPage.tsx`, `RozrachunkiDrukPage.tsx`, `FinishedGoodsPage.tsx`
- Modify: `src/protrima/modules/wysylki/kurs.ts` (`drukujZaznaczone` → okno ze źródłem `pdf`, rodzaj z papieru)
- Test: `kebab_fixed/src/lib/print.test.ts`

**Interfaces:**
- Consumes: Task 4–5.
- Produces: `drukuj(opcje?: { rodzaj?: RodzajDruku; tytul?: string; rejestr?: Omit<WpisRejestru, 'rodzaj'|'tytul'|'kopie'>; pdfBase64?: string; strict?: boolean; beforePrint?: () => void }): Promise<void>`. Bez `rodzaj` → `'inne'`. Poza Tauri: `window.print()` + `zarejestruj` z `kopie: 1`. W Tauri bez nowych komend: `print_page` (dzisiejsza ścieżka). Po udanym druku: `zarejestruj` z danymi z okna. `autoDrukuj` dostaje te same opcje.
- `KartkiPalet.tsx` przekazuje `rodzaj: 'kartki-palet'`, `rejestr: { orderId, palletIds: <id drukowanych palet> }`; `RozrachunkiDrukPage` `'rozrachunki'` itd. według `NAZWA_RODZAJU`.

- [ ] **Step 1: Testy** `print.test.ts`: `poza_tauri_window_print_i_rejestr`; `stary_desktop_bez_komend_uzywa_print_page`; `udany_druk_rejestruje_dane_z_okna`; `anulowanie_nie_rejestruje`; `systemowe_po_bledzie_wola_print_page`.
- [ ] **Step 2:** `npx vitest run src/lib/print.test.ts` → FAIL.
- [ ] **Step 3:** Implementacja i podmiana 10 miejsc + `drukujZaznaczone`; `grep -rn "window.print()" src --include=*.tsx | grep -v test` zwraca tylko `src/lib/print.ts`.
- [ ] **Step 4:** `npx vitest run` (całość) i `npx tsc --noEmit -p .` zielone.
- [ ] **Step 5:** Commit `feat(druk): wszystkie wydruki przez okno druku i rejestr`.

### Task 7: Znaczniki „wydrukowano” przy paletach

**Files:**
- Modify: `kebab_fixed/src/lib/api.ts` (`mapPallet` → `lastPrintAt`, `lastPrintBy`, `printCount`), `src/protrima/data/model.ts` (`Pallet.lastPrintAt?`, `lastPrintBy?`), `src/protrima/data/mapuj.ts`
- Modify: `src/protrima/modules/orders/tabs/Pallets.tsx` (karta palety + licznik w nagłówku), `src/components/orders/PalletsEditor.tsx`, `src/protrima/styles/modules.css`
- Test: `src/protrima/modules/orders/OrderDetail.test.tsx` (albo nowy `tabs/Pallets.test.tsx`), `src/components/orders/palletsEditor.test.tsx`

**Interfaces:**
- Consumes: pola z Task 1.
- Teksty: na karcie „wydrukowano 19.11 11:40 · am” (+ „· 2×” gdy `printCount > 1`); brak wydruku → „kartka niewydrukowana” w kolorze ostrzeżenia; nagłówek zakładki: „N palet bez kartki” (`ile`/`odm` z `data/tekst`), ukryty przy 0.

- [ ] **Step 1: Testy**: `paleta_bez_wydruku_ma_ostrzezenie`; `paleta_drukowana_dwa_razy_pokazuje_2x`; `licznik_palet_bez_kartki` (3 z 14); to samo w `palletsEditor.test.tsx`.
- [ ] **Step 2:** testy → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** `npx vitest run src/protrima src/components/orders` zielone.
- [ ] **Step 5:** Commit `feat(druk): znacznik wydruku kartek przy paletach`.

### Task 8: Budowa Windows, PDFium, próba w biurze i wydanie

**Files:**
- Modify: `.github/workflows/tauri-protrima.yml`, `tauri-produkcja.yml`, `tauri-protrima-test.yml` (krok: pobranie `pdfium-win-x64` z `bblanchon/pdfium-binaries`, wersja przypięta, suma SHA256 w workflow; `cargo test --manifest-path src-tauri/Cargo.toml` na `windows-latest`)
- Modify: `kebab_fixed/src-tauri/tauri.protrima.conf.json`, `tauri.produkcja.conf.json` (`bundle.resources` z `pdfium.dll`; podbicie wersji), `kebab_fixed/package.json` (wersja PROTRIMA)
- Create: `docs/superpowers/plans/2026-11-19-okno-druku-proba.md` (lista próby w biurze)

- [ ] **Step 1:** Workflow testowy PROTRIMA (`protrima-test`) buduje instalator z `pdfium.dll`; `cargo test` na Windows zielony.
- [ ] **Step 2:** Próba na jednym komputerze biura z bizhubem, wg listy: drukarki widoczne; zasobniki 1–4 z nazwami; zmiana zasobnika drukuje z właściwego; kolor/czarno-biały; dwustronnie; „Ustawienia drukarki…” otwiera okno Konica i wybór wraca; kartka palety skanuje się na skanerze mroźni (1:1); WZ z PDF serwera; ustawienia przeżywają restart; wpis w rejestrze i znacznik przy palecie; serwer wyłączony (zła sieć) → druk przechodzi, wpis dochodzi po powrocie. Wynik zapisany w pliku próby.
- [ ] **Step 3:** Zrzuty okna druku i znaczników przy paletach → akceptacja właściciela.
- [ ] **Step 4:** Wdrożenie backendu (`KEBAB_REPO=<release>/kebab_fixed bash deploy/deploy.sh backend` na 91.98.105.107, po zielonym CI), potem tagi wydania PROTRIMA i MES produkcja (auto-aktualizacja).
- [ ] **Step 5:** Commit wersji i workflow `chore(druk): pdfium w instalatorach, wersje PROTRIMA i MES`.
