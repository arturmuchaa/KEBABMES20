# Projektor etykiet kebabów — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moduł PROTRIMA „Etykiety” (szablony A4 z PDF i Zebra 100 × 150 z PRN/PDF, pola przeciągane myszą, przypisanie klient/rodzaj/receptura) i druk etykiet sztuk z planu przez okno druku / Zebrę.

**Architecture:** Nowe tabele `label_designs` + `label_design_revisions` i serwis/route `/api/label-designs` (CRUD, dobór szablonu, import PRN). Front: czyste funkcje w `src/protrima/modules/etykiety/` (wartości pól, geometria A4, ZPL, raster PDF→^GFA), silnik PDF A4 (pdf-lib na żądanie), moduł projektora i integracja z `OknoEtykiet` planu.

**Tech Stack:** FastAPI + psycopg2 + Pillow; React + Vitest; pdf-lib + @pdf-lib/fontkit (już w repo), pdfjs-dist (już w repo), qrcode.

**Spec:** `docs/superpowers/specs/2026-11-27-projektor-etykiet-design.md`

## Global Constraints

- Wymiary w mm, lewy-górny róg; tekst w pt; QR w mm. A4 = 210 × 297 mm; tło PDF zawsze rozciągnięte na cały A4 (jak stary `buildVectorPdf`).
- `print_mode` ∈ `'a4' | 'zebra'`; `labels_per_sheet` ∈ {1, 2} (tylko A4); slot 2 = pozycje slotu 1 + `slot_offset` (domyślnie dx = 105 mm, dy = 0).
- Partia na etykiecie: `ddmmrr partia` (jak `numerKebaba`); waga „40 kg” — liczba wg `bold` pola, „ kg” zawsze zwykłe; data zamrożenia = data produkcji; termin = data produkcji + `recipes.shelf_life_days` (bez dodatkowego −1).
- Zebra: 203 dpi, `^CI28`, dane pól bez `^` i `~`; profil rolki z `ZEBRA_PROFILES` wg rozmiaru szablonu (100x150 / 80x100 / 50x80), inny rozmiar → błąd „brak rolki W × H”.
- Druk A4: `drukuj({ rodzaj: 'etykiety', tytul, pdfBase64, strict: true })`; sztuki oznaczane (`finishedUnitsApi.markLabelsPrinted`) dopiero po udanym druku.
- Szablon zawsze ma `client_id`; dobór: klient+rodzaj+receptura → klient+receptura → klient+rodzaj → sam klient; brak → etykieta systemowa (`etykietaSztukiZpl`, 100 × 150).
- Pole `box` ma `wMm, hMm, fill: 'none' | 'white'` (biała „zakrywka” starych wartości w tle) i `thickMm`; ZPL białego pola: `^GB…,…,…,W` z grubością = min(w,h) (wypełnienie), PDF: `drawRectangle` białym.
- Bez migracji starych szablonów; stare tabele nietknięte. Stare strony etykiet MES tylko do podglądu.
- Teksty UI po polsku, standard PROTRIMA (CommandBar, Dialog, Wybor, tokeny, jasny/ciemny); `autocomplete=off` działa globalnie.
- Testy DB: `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test_palety`; nigdy dwa pytesty na tej bazie naraz.

## Review Focus

1. Tło PDF nie-A4 (TRUVA: 259 × 367 mm) — pola muszą lądować tam, gdzie na podglądzie (podgląd też rozciąga tło do A4). Test w Task 4.
2. Pole wystające poza etykietę (np. QR przy krawędzi, obrót 90° na Zebrze) — projektor ostrzega, ZPL nie generuje `^FO` poza `^PW/^LL`. Test w Task 5.
3. Anulowanie okna druku nie oznacza sztuk jako wydrukowanych (strict). Test w Task 8.
4. Dwa aktywne szablony na to samo przypisanie — 409 z czytelnym komunikatem. Test w Task 1.
5. Pozycja planu bez `client_order_id`, tylko z `client_name` (pozycja z klawiatury z klientem) — dobór po nazwie/nazwie wyświetlanej klienta. Test w Task 3.

---

### Task 1: Tabele i serwis szablonów (`/api/label-designs`)

**Files:**
- Modify: `backend/app/migrations.py` (tabele w liście statements)
- Create: `backend/app/services/label_designs_service.py`, `backend/app/routes/label_designs.py`, `backend/app/models/label_designs.py`
- Modify: `backend/app/main.py` (router)
- Test: `backend/tests/test_label_designs_db.py`

**Interfaces:**
- Produces: `list_designs() -> list[dict]` (bez teł, z `clientName`, `productTypeName`, `recipeName`); `get_design(id) -> dict` (pełny, camelCase: `id, name, clientId, productTypeId, recipeId, printMode, active, backgroundPdf, backgroundPng, backgroundZpl, widthMm, heightMm, dpi, sourceName, labelsPerSheet, slotOffset{dxMm,dyMm}, calibration{dxMm,dyMm,scale,fit,fitStretch}, fields[], slot2Fields{}, updatedAt, updatedBy`); `save_design(dto, actor) -> dict` (insert/update + wiersz w `label_design_revisions`); `delete_design(id)` (active=false); `resolve_design(client_id, product_type_id, recipe_id) -> dict|None`.
- Routes: `GET /api/label-designs`, `GET /api/label-designs/{id}`, `PUT /api/label-designs` (id w body = update), `DELETE /api/label-designs/{id}`.

- [ ] **Step 1: Failing tests** — `test_zapis_i_odczyt_szablonu_a4` (pola, sloty, kalibracja wracają 1:1, revision=1), `test_druga_wersja_dopisuje_rewizje` (revision 2, `updated_by`), `test_dobor_najbardziej_szczegolowy` (szablony: sam klient, klient+receptura, klient+rodzaj+receptura → resolve zwraca kolejno najszczegółowszy; inny klient → None), `test_dwa_aktywne_na_to_samo_przypisanie_409` (detail zawiera nazwę istniejącego szablonu), `test_usuniety_nie_jest_dobierany`, `test_zebra_wymaga_tla_i_rozmiaru` (400 bez `background_zpl` / `width_mm`).
- [ ] **Step 2: Run** `pytest tests/test_label_designs_db.py` → FAIL (brak modułu).
- [ ] **Step 3: Implement** tabele (`label_designs` z kolumnami ze specu + `created_at`; częściowy unikalny indeks na `(client_id, product_type_id, recipe_id) WHERE active`; `label_design_revisions(id, design_id, revision, snapshot JSONB bez teł, background_sha256, actor, created_at)`), serwis, model Pydantic (aliasy camelCase, `populate_by_name`), route; 409 przy naruszeniu indeksu.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(etykiety): szablony etykiet — tabele, serwis, dobór`.

### Task 2: Import `.prn` z ZebraDesigner (EPL2 i ZPL)

**Files:**
- Create: `backend/app/services/label_prn_import.py`
- Modify: `backend/app/routes/label_designs.py` (`POST /api/label-designs/import-prn`, multipart `file`, limit 4 MiB)
- Test: `backend/tests/test_label_prn_import.py` (bez DB)

**Interfaces:**
- Produces: `import_prn(source: bytes, dpi: int = 203) -> dict` → `{language, widthMm, heightMm, widthDots, heightDots, backgroundPng (data URL), backgroundZpl ("^GFA,…"), warnings: list[str]}`; `PrnImportError(ValueError)` z polskim komunikatem.

- [ ] **Step 1: Failing tests** (syntetyczne PRN zbudowane w teście): `test_epl_z_ustawieniami_przed_N` (linie `I8,A,001`, `Q1534,024`, `q831`, `rN`, `S3`, `D12`, `ZT`, `JF`, `OD`, `R32,0`, `f100`, `N`, `GW…`, `P1` → widthDots 831, heightDots 1534, piksel z GW czarny), `test_epl_lo_rysuje_kreske` (`LO292,753,3,83` → piksele 292..294 × 753..835 czarne), `test_epl_gw_bit_zero_czarny`, `test_zpl_gfa` (`^XA^PW800^LL1200^FO10,10^GFA,…^FS^XZ`), `test_tekst_epl_odrzucony_z_podpowiedzia` (`A10,10,0,3,1,1,N,"X"` → PrnImportError z „jako grafika”), `test_za_duzy_plik`, `test_gfa_wyniku_odtwarza_obraz` (dekodowanie `backgroundZpl` daje te same piksele).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — parser liniowy jak w `scratchpad/epl/parse.py` (GW czyta `wb*h` bajtów binarnie), komendy ustawień pomijane (lista prefiksów: `I Q q r S D Z J O R f U` oraz pusta linia), `LO/LE/LW/LS`(LS → błąd), koniec na `P`; ZPL: `^FO` + `^GFA` (ASCII hex, bez Z64) + `^GB`; obraz PIL `1`; `^GFA` z wierszy (hex, bez kompresji).
- [ ] **Step 4: Run** → PASS; ręcznie: `python3 -c` na `/root/yalcin najnowsza.prn` → 831 × 1534, PNG porównany wzrokowo z `scratchpad/epl/etykieta.png`.
- [ ] **Step 5: Commit** `feat(etykiety): import PRN z ZebraDesigner (EPL2 z ustawieniami i LO, ZPL GFA)`.

### Task 3: Dane sztuk i szablony dla planu

**Files:**
- Modify: `backend/app/services/finished_units_service.py` (`units_for_plan`)
- Modify: `backend/app/services/label_designs_service.py` (`designs_for_plan`), `backend/app/routes/label_designs.py` (`GET /api/label-designs/for-plan/{plan_id}`)
- Test: `backend/tests/test_label_designs_plan_db.py`

**Interfaces:**
- Consumes: `resolve_design` (Task 1).
- Produces: `units_for_plan` dodaje `clientId, productTypeId, recipeId, shelfLifeDays`; `designs_for_plan(plan_id) -> {line_id: {designId, name, printMode} | None}`; klient pozycji: `client_orders.client_id` po `client_order_id`, inaczej `clients` po `name`/`display_name` = `client_name`.

- [ ] **Step 1: Failing tests** — `test_sztuki_planu_niosa_klienta_i_termin`, `test_pozycja_z_zamowienia_dobiera_szablon_klienta`, `test_pozycja_tylko_z_nazwa_klienta_dobiera_po_nazwie_wyswietlanej`, `test_pozycja_bez_szablonu_none`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(etykiety): szablon i dane sztuk dla pozycji planu`.

### Task 4: Model etykiety (czyste funkcje)

**Files:**
- Create: `src/protrima/modules/etykiety/model.ts`, `src/protrima/modules/etykiety/model.test.ts`
- Modify: `src/lib/api.ts` (typy `LabelDesign`, `LabelField`, `LabelFieldKind`, `labelDesignsApi` z list/get/save/remove/importPrn/forPlan; `UnitForLabel` + `clientId, productTypeId, recipeId, shelfLifeDays`)

**Interfaces:**
- Produces: `RODZAJE_POL: Record<LabelFieldKind, {nazwa: string; domyslnie: Partial<LabelField>}>`; `wartosciPol(unit: UnitForLabel, opts: {orgCode?: string; razem?: number}) -> Record<LabelFieldKind, string>`; `PRZYKLAD: UnitForLabel`; `rozmiarStrony(d: LabelDesign) -> {w: number; h: number}` (A4 → 210 × 297, Zebra → widthMm × heightMm); `polePlotna(d, f, slot: 0|1) -> LabelField` (slot 2: nadpisanie z `slot2Fields[f.id]` albo f + slotOffset); `poZaEtykieta(d, f) -> boolean`; `przesun(f, dxMm, dyMm, d) -> LabelField` (krok 0,5 mm, obcięcie do strony).

- [ ] **Step 1: Failing tests** — wartości: `weight` „40 kg”, `batch` „281126 724”, `prod_date` = `freeze_date` „28.11.2026”, `best_before` z 364 dni „27.11.2027”, `unit_no` „3/29”; slot 2 z domyślnym przesunięciem 105 mm i z nadpisaniem; `poZaEtykieta` dla QR 30 mm na x = 85 mm Zebry 100 mm → true; `przesun` nie wychodzi poza stronę; tło nie-A4 nie zmienia `rozmiarStrony` A4 (Review Focus 1).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(etykiety): model pól etykiety`.

### Task 5: ZPL dla szablonu Zebry i raster PDF → ^GFA

**Files:**
- Create: `src/protrima/modules/etykiety/zpl.ts`, `zpl.test.ts`, `src/protrima/modules/etykiety/raster.ts`, `raster.test.ts`

**Interfaces:**
- Consumes: `wartosciPol`, `polePlotna` (Task 4).
- Produces: `zplSzablonu(d: LabelDesign, unit: UnitForLabel, opts) -> string`; `profilRolki(d) -> ZebraProfileId` (rzuca „Brak rolki W × H mm”); `bityDoGfa(bits: Uint8Array, wDots: number, hDots: number) -> string`; `pdfDoTlaZebry(file: File, wMm: number, hMm: number, dpi = 203) -> Promise<{png: string; gfa: string}>` (pdfjs, próg luminancji 160).

- [ ] **Step 1: Failing tests** — `^XA`, `^CI28`, `^PW799`, `^LL1199` dla 100 × 150; tło `^FO0,0^GFA…`; pole obrócone 90° → `^A0R`; QR → `^BQN,2,m` z m z mm (30 mm ≈ m 8 przy 203 dpi); `^` i `~` w danych wycięte; pole poza etykietą pominięte i nie daje `^FO` > PW (Review Focus 2); `bityDoGfa` 16 × 2 → `^GFA,4,4,2,…` z poprawnym hex.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(etykiety): ZPL szablonu Zebry i raster PDF`.

### Task 6: Silnik PDF A4

**Files:**
- Create: `src/protrima/modules/etykiety/pdfA4.ts`, `pdfA4.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: `transformacjaA4(d: LabelDesign, srcW: number, srcH: number) -> {Sx, Sy, Tx, Ty}` (reguły starego `buildVectorPdf`: tło → A4, kalibracja dx/dy/skala względem środka; `fit` pomijamy w pierwszej wersji — wspólne pole formularza ukryte); `punktPola(d, f, slot, t) -> {xPt, yPt, sizePt}`; `zbudujPdfA4(d, units, opts: {orgCode?: string; razemNaPozycje: Record<string, number>}) -> Promise<string /* base64 */>` (pdf-lib i fontkit przez `import()`, Liberation Sans z `src/assets/fonts`, Times/Courier standardowe, QR przez `qrcode` z `UNIT_QR_OPTIONS`).

- [ ] **Step 1: Failing tests** — `transformacjaA4` dla skali 100 % i dx 0 → identyczność; dla skali 99,5 % → środek strony stały; `punktPola` dla pola x 32,2 mm, y 22,2 mm, 36 pt → xPt ≈ 91,28, yPt ≈ 841,89 − 62,93 − 36; `zbudujPdfA4` z 3 sztukami i 2 na arkusz → PDF z 2 stronami (pdf-lib `getPageCount`), strona A4 595,28 × 841,89.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(etykiety): silnik PDF A4 etykiet`.

### Task 7: Moduł PROTRIMA „Etykiety” (projektor)

**Files:**
- Create: `src/protrima/modules/etykiety/EtykietyModule.tsx`, `Plotno.tsx`, `PanelPola.tsx`, `ListaSzablonow.tsx`, `NowySzablon.tsx`, `etykiety.test.tsx`
- Modify: `src/protrima/shell/modules.tsx` (klucz `etykiety`, sekcja Produkcja, W_PROTRIMA), `src/protrima/App.tsx`, `src/protrima/styles/modules.css` (klasy `et-*`)

**Interfaces:**
- Consumes: `labelDesignsApi`, Task 4–6; `useStudioHistory` (`src/features/labels/useStudioHistory.ts`) do cofania.
- Produces: `EtykietyModule({active, setCtx, setCmds})`.

UI: lewa kolumna — szablony pogrupowane klientem + szukajka + „Nowy szablon”; środek — płótno 1:1 (zoom 50–400 %, dopasuj), tło PNG rozciągnięte na stronę, linijki mm, siatka 0,5 mm, pola jako przeciągalne prostokąty z podglądem przykładowej wartości (czcionka w px = pt × skala), slot 2 półprzezroczysty; prawa — właściwości pola (X/Y mm, czcionka Arial/Times/Courier, pt, pogrubienie, wyrównanie, obrót 0/90/180/270 tylko Zebra, rozmiar QR mm, tekst dla `static_text`, szer./wys. dla `box`), „Dodaj pole”, zakładki „Przypisanie” (Wybor klient/rodzaj/receptura, „każdy” = '') i „Druk” (A4: 1/2 na arkusz, przesunięcie slotu 2, kalibracja dx/dy/skala; Zebra: rozmiar i rolka). Klawiatura: strzałki 0,5 mm / Shift 5 mm, Delete, Ctrl+Z/Ctrl+Shift+Z, Ctrl+S. Komendy: Zapisz, Próbny druk, Usuń szablon, Nowy. Ostrzeżenie przy polu poza etykietą i QR < 18 mm. Nowy szablon: wybór „A4 z PDF” / „Zebra z PRN” / „Zebra z PDF” + plik.

- [ ] **Step 1: Failing tests** — `nowy szablon A4 z PDF: wybór pliku, dodanie pola Waga, zapis wysyła printMode a4 i pole`, `strzałka przesuwa zaznaczone pole o 0,5 mm, Shift o 5 mm, Ctrl+Z cofa`, `przypisanie wymaga klienta`, `szablony pogrupowane klientem`, `pole poza etykietą pokazuje ostrzeżenie`, `próbny druk A4 woła drukuj z rodzajem etykiety, Zebra woła drukujEtykiety`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(etykiety): projektor etykiet w PROTRIMA`.

### Task 8: Druk etykiet z planu

**Files:**
- Modify: `src/protrima/modules/plan-produkcji/OknoEtykiet.tsx`, `PlanProdukcji.test.tsx`

**Interfaces:**
- Consumes: `labelDesignsApi.forPlan`, `labelDesignsApi.get`, `zbudujPdfA4`, `zplSzablonu`, `profilRolki`, `etykietaSztukiZpl` (systemowa), `drukuj` (`@/lib/print`, `strict: true`), `drukujEtykiety`.
- Produces: okno z grupami „A4 (PDF)”, „Zebra”, „Etykieta systemowa” (z ostrzeżeniem o braku szablonu); pole „Kod HALAL” pamiętane w `localStorage` pod `protrima.etykiety.halal.<designId>`; przyciski per grupa drukują niewydrukowane sztuki grupy; dodruk pojedynczej sztuki tą samą drogą.

- [ ] **Step 1: Failing tests** — `pozycja z szablonem A4 drukuje PDF przez okno druku i oznacza sztuki`, `anulowanie okna druku nie oznacza sztuk` (drukuj rzuca „Wydruk anulowany” → markLabelsPrinted nie wołane — Review Focus 3), `pozycja bez szablonu: ostrzeżenie i etykieta systemowa na Zebrze`, `szablon Zebry: ZPL z tłem szablonu`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(etykiety): druk etykiet sztuk z planu wg szablonów`.

### Task 9: Stary MES, wersja, zrzuty

**Files:**
- Modify: `src/pages/office/LabelTemplateSetupPage.tsx`, `ZebraDesignerPage.tsx`, `ZebraLabelEditorPage.tsx` (baner „Etykiety projektuje się w PROTRIMA”, zapis wyłączony), `src-tauri/tauri.protrima.conf.json` (0.17.0)
- Test: istniejące testy tych stron + nowy test baneru w jednej z nich.

- [ ] **Step 1:** failing test baneru; **Step 2:** FAIL; **Step 3:** implement; **Step 4:** PASS + pełne `npx vitest run` i pełny pytest (osobno, nie naraz na tej samej bazie).
- [ ] **Step 5:** zrzuty (seed: szablon A4 z PDF-wzoru, szablon Zebra z syntetycznego PRN; 1920 jasny/ciemny, 1366) do artefaktu akceptacji; commit `feat(etykiety): stary MES tylko podgląd etykiet; PROTRIMA 0.17.0`.
