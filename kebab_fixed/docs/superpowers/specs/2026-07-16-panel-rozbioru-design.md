# Panel rozbioru — kontrola i korekty per partia

Data: 2026-07-16
Status: zaakceptowany (wybór mockupu „Lista partii + szukajka" + „na razie tylko wpisy")

## Problem

Feed w Statystykach rozbioru pokazuje wpisy tylko dla oglądanego dnia — biuro nie
widzi wczorajszych wpisów, więc nie ma jak ich poprawić (przycisk „Popraw" jest,
ale wpis znika z widoku). Właściciel chce ROZDZIELIĆ role stron: statystyki
zostają statystykami, a do kontroli i korekt powstaje osobny panel, w którym
widać WSZYSTKO per partia (partia 411 szła 2 dni — myślenie dniami jest mylne).

## Decyzje właściciela

1. **Widok = lista partii z szukajką** (numer/dostawca), najnowsza aktywność u góry.
   Klik partii rozwija: podsumowanie + wszystkie wpisy niezależnie od dnia, z edycją.
2. **Uboczne (grzbiety/kości zbiorcze) tylko do wglądu** w podsumowaniu partii —
   ich korekta z biura to osobna mechanika (palety/loty/WZ), świadomie poza zakresem.

## Rozwiązanie

### Backend

1. `GET /api/deboning/panel?limit=60` — partie z aktywnością rozbioru
   (JOIN LATERAL agregat po `deboning_entries` per `raw_batch_id`,
   LEFT JOIN `batch_byproducts`), sort po ostatniej aktywności DESC.
   Wiersz: `rawBatchId, batchNo, supplierName, materialName, status, kgReceived,
   kgAvailable, entriesCount, pendingCount, kgQuarter, kgMeat, backsKg, bonesKg,
   balancePct, firstAt, lastAt`. `balancePct` = (mięso+grzbiety+kości)/ćwiartka;
   sumy kg liczone TYLKO z wpisów `complete` (pending nie zawyża).
2. `GET /api/deboning/entries?raw_batch_id=...` — nowy filtr w istniejącym
   endpointcie (lazy-load wpisów po rozwinięciu partii).

RBAC: prefiks `/api/deboning` = dział rozbior LUB biuro — odczyt panelu przez
operatora nieszkodliwy (to te same dane co na HMI). Korekty i tak chroni
office-only `/correct`.

### Front

- Nowa strona `src/pages/office/DeboningControlPage.tsx`, trasa
  `/office/rozbior-panel`, sidebar sekcja „Rozbiór" → „Panel rozbioru".
- Lista partii (karty rozwijane): nagłówek = numer, dostawca, zakres dat
  aktywności, status, badge „w toku/zakończona"; podsumowanie = ćwiartka pobrana,
  mięso, grzbiety, kości, bilans %, kg na stanie; po rozwinięciu tabela wpisów
  (data+godzina, pracownik, ćwiartka, mięso, uzysk, status) z akcjami
  **Popraw** (pracownik/kg + powód) i **Zmień partię** przy każdym wpisie.
- Szukajka client-side po numerze partii i dostawcy.
- DRY: modale „Popraw" i „Zmień partię" WYCIĄGNIĘTE z DeboningReportsPage do
  `src/features/deboning/EntryFixDialogs.tsx` (`EntryCorrectionDialog`,
  `ChangeBatchDialog`) — używane przez obie strony; reports page refaktor
  na wspólne komponenty (bez zmiany zachowania).

## Zadania (plan)

A. Backend TDD: `tests/test_deboning_panel_db.py` (agregacja wielodniowa, merge
   ubocznych, partia bez wpisów niewidoczna, filtr `raw_batch_id`, pending nie
   zawyża sum) → `deboning_panel()` + filtr w `list_deboning_entries` + trasy.
B. Front: `EntryFixDialogs.tsx` (ekstrakcja) + refaktor DeboningReportsPage.
C. Front: `DeboningControlPage` + trasa + sidebar.
D. Weryfikacja (pytest/tsc/build/vitest) → deploy: backend cp + **systemctl
   restart** (NIE reload — patrz pamięć kebab-vps-deploy) + dist swap → push.

## Świadomie poza zakresem

- Korekta zbiorczych ubocznych z biura (osobny krok na życzenie).
- Storno wpisu z panelu (delete ma guard sesji+15 min — korekta kg załatwia potrzebę).
- Paginacja serwerowa (limit 60 partii ≈ 2 mies. pracy; szukajka client-side wystarcza).
