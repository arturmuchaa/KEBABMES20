# PROTRIMA „Dokumenty” (etap 2a) — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Moduł „Dokumenty” w PROTRIMA: zakładki WZ / CMR / HDI z listą, filtrami, sortowaniem, podglądem PDF, drukiem pojedynczym i zbiorczym (jeden PDF) oraz działaniami (ceny, dopisz pozycję, anuluj, edycja CMR, anuluj HDI).

**Architecture:** Serwer dopisuje brakujące pola do istniejących list. Front: czyste funkcje w `dokumenty/model.ts` (normalizacja wierszy, filtr, sort, dostępność działań), ekran `DokumentyModule.tsx` w układzie workarea + dock (wzór: `RecepturyModule`), okna działań w `dokumenty/Okna.tsx`.

**Tech Stack:** FastAPI/psycopg2, React 18/TS, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-14-protrima-dokumenty-design.md`

## Global Constraints
- Filtry klient/okres/szukaj/stan wspólne dla zakładek; seria tylko WZ.
- Druk zbiorczy przez istniejące `polaczPdf`/`DrukujZaznaczone` (`wysylki/kurs.ts`, `wysylki/Papiery.tsx`).
- Podgląd = PDF z serwera (`wzApi.pdfUrl`, `cmrApi.pdfUrl`, `hdiApi.pdfUrl`) przez `fetchBlob` → blob URL w `<iframe>`.
- Działanie niedozwolone = przycisk wyłączony z podpowiedzią, nie ukryty i nie „błąd po kliknięciu”.
- Testy jak w etapie 1 (baza `kebab_mes_test_dokumenty`, vitest singleFork). Zrzuty przed wdrożeniem.

## Review Focus
1. Daty puste / w złym formacie w starych dokumentach — wiersz nie znika z „Wszystko”, nie psuje sortu (test Task 2).
2. Klient zapisany różnie (`buyer_name` vs `client_name`, wielkość liter) — filtr klienta łapie oba (test Task 2).
3. Anulowany dokument zaznaczony do druku zbiorczego — drukuje się (to papier archiwalny), ale „Anuluj” wyłączone (test Task 2).
4. Przełączenie zakładki przy zaznaczonych — zaznaczenie per zakładka, nie miesza id WZ z CMR (test Task 3).
5. PDF podglądu nie wczytał się (401/500) — komunikat z „Otwórz PDF” zamiast pustej ramki (test Task 3).

---

### Task 1: Serwer — pola list
**Files:** `backend/app/services/wz_service.py` (`list_wz`), `cmr_service.py` (`list_cmr`), `hdi_service.py` (`list_hdi`); Test: `backend/tests/test_dokumenty_listy_db.py`
**Produces:** WZ: `+ order_no, release_date, eur_rate, loading_id`; CMR: `+ order_id, order_no, scope, carrier_name, loading_id`; HDI: `+ order_id, order_no, scope, wz_id, loading_id`. `order_no` przez LEFT JOIN `client_orders` (WZ tylko gdy `source_type='order'`).
- [ ] Test: dokument z zamówienia ma `order_no`; ręczna WZ ma `order_no=None`; CMR ma `carrier_name`; HDI ma `scope`. RED → implementacja → GREEN; istniejące `test_wz*_db`, `test_hdi*_db`, `test_cmr*` zielone. Commit.

### Task 2: Model listy
**Files:** Create `src/protrima/modules/dokumenty/model.ts`, test `model.test.ts`
**Produces:**
- `type Rodzaj = 'wz' | 'cmr' | 'hdi'`; `interface Dok { rodzaj; id; numer; data: string /*ISO lub ''*/; klient; orderId?; orderNo?; stan: 'aktywny'|'anulowany'; etykietaStanu: string; seria?: 'WZ'|'WM'; wartosc?: number|null; waluta?: string; rodzajHdi?: string; przewoznik?: string; zrodlo: Record<string, unknown> }`
- `zWz(r)`, `zCmr(r)`, `zHdi(r)` → `Dok` (stan WZ: anulowany / rozjazd / załadowany / wystawiony; HDI niekompletny).
- `interface Filtr { szukaj; okres: 'dzis'|'7dni'|'miesiac'|'poprzedni'|'wszystko'|'zakres'; od?; do?; klient: string; stan: 'aktywne'|'anulowane'|'wszystkie'; seria: 'wszystkie'|'WZ'|'WM' }`; `filtruj(dok: Dok[], f: Filtr, dzis: string): Dok[]` (dokumenty bez daty widoczne tylko przy „wszystko”; klient porównywany bez wielkości liter i białych znaków).
- `sortuj(dok, kol: 'numer'|'data'|'klient'|'zamowienie'|'wartosc'|'stan', kier: 'asc'|'desc')` — numer sortowany naturalnie (WZ/2/11/26 < WZ/10/11/26, rok/miesiąc z numeru), puste daty na końcu.
- `dzialania(d: Dok): Record<'ceny'|'dopisz'|'anuluj'|'rozjazd'|'edytujCmr'|'anulujHdi', { ok: boolean; powod?: string }>` — anuluj WZ: nie dla anulowanych, nie dla `split_scope` (powód „anuluj komplet z zamówienia”), nie dla załadowanych z `source_type='order'` (powód „po załadunku…”); dopisz/ceny: nie dla anulowanych; rozjazd: tylko `loading_status='rozjazd'`.
- [ ] Testy: filtr okresów (granice miesiąca), klient różnie zapisany, seria WM, puste daty, sort naturalny numerów, dostępność działań (w tym Review Focus 1–3). RED → GREEN. Commit.

### Task 3: Ekran modułu
**Files:** Create `src/protrima/modules/dokumenty/DokumentyModule.tsx`, `Podglad.tsx`; modify `src/protrima/App.tsx` (render `t.key==='dokumenty'`), `shell/modules.tsx` (`W_PROTRIMA` + usuń wpis `JUZ_W_PROTRIMA.dokumenty`), paleta (`shell/CommandPalette.tsx` lub miejsce rejestracji poleceń modułów — polecenia „Dokumenty: WZ/CMR/HDI”), styles; Test `Dokumenty.test.tsx`
**Consumes:** model (Task 2), `wzApi.list`, `cmrApi.listDocs`, `hdiApi.listDocs`, `useZaznaczonePapiery`/`DrukujZaznaczone`.
- Zakładki z licznikami, pasek filtrów, tabela z sortem i ptaszkami (zaznaczenie per zakładka), dock z podglądem (`Podglad`: fetchBlob → blob URL; błąd → komunikat + „Otwórz PDF”), przyciski działań wg `dzialania()`, CommandBar (Odśwież, Drukuj zaznaczone), pasek stanu („Widoczne N z M”).
- [ ] Testy: lista z trzech źródeł i liczniki; filtr i szukaj zostają po zmianie zakładki; zaznaczenie per zakładka (RF4); sort po kliknięciu nagłówka; błąd PDF pokazuje komunikat (RF5); „Anuluj” wyłączone z podpowiedzią dla WM z kursu. RED → GREEN; `tsc` 0. Commit.

### Task 4: Okna działań
**Files:** Create `src/protrima/modules/dokumenty/Okna.tsx`; Test `Okna.test.tsx`
- `CenyWzDialog` (ceny per pozycja, waluta PLN/EUR + kurs NBP `fxApi.eurRate`, zapis `wzApi.updatePrices(id, prices, currency, eurRate)`), `AnulujDialog` (WZ `wzApi.cancel` / HDI `hdiApi.anuluj`, treść ostrzeżenia o zwrocie towaru), `EdycjaCmrDialog` (pola z `cmrApi.get`, zapis `cmrApi.update`), „Dopisz pozycję…” = `DopiszPozycjeDialog` z etapu 1, raport rozjazdu = tabela z `wzApi.quantityChain`.
- [ ] Testy: ceny z przecinkiem i EUR wysyłają poprawne DTO; anulowanie wymaga potwierdzenia i odświeża listę; błąd serwera pokazany w oknie. RED → GREEN. Commit.

### Task 5: Zrzuty, wersja 0.11.0, wdrożenie
- [ ] Zrzuty 1366×768 (lista WZ z filtrami, podgląd, CMR, HDI, okno cen) → akceptacja właściciela → wersja → CI → prod (kopia bazy, próba, deploy, smoke) → instalator.
