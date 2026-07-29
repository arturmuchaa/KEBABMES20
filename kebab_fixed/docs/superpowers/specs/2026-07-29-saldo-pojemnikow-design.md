# Saldo pojemników — kaliber na przyjęciu, księga ruchów, WZ na POJEMNIKI

Data: 2026-07-29

## Problem

Zakład obraca pojemnikami E2 i paletami (H1, PCV/plastik/europaleta/drewno)
z dostawcami i odbiorcami, ale MES ich **nie rozlicza**. Dziś liczba
pojemników istnieje w trzech miejscach i w żadnym nie tworzy salda:

- `CreateRawBatchModal.tsx:25,79` — `KG_PER_CONTAINER = 15`, `floor(kg/15)`,
  wyłącznie kafelek informacyjny w modalu. **Nic nie jest zapisywane.**
- `wz_service.py:1009` — `ceil(kg/15)` jako podpowiedź `containers` na
  pozycji WZ ćwiartki (uwaga: **inne zaokrąglenie niż w modalu przyjęcia**).
- `byproduct_lots.containers_available` — żywy licznik pojemników ubocznych,
  maleje przy WZ (`wz_service.py:388`), rośnie przy anulowaniu (`:630`).
  Dotyczy tylko grzbietów i kości i nie jest przypisany do kontrahenta.

Skutki:

1. Kaliber jest zaszyty na sztywno na 15 kg. Filet potrafi przyjść
   w pojemnikach po 20 kg, część dostaw jest niekalibrowana — system liczy
   wtedy fikcję.
2. Nie ma odpowiedzi na pytanie „ile pojemników wisi u Koko, a ile Koko wisi
   nam". Papierowy druk „WZ na POJEMNIKI" (skan w `saldo pojmenikow.pdf`)
   wypełniany jest ręcznie, poza systemem.
3. Palety (H1 / inne) nie są rejestrowane nigdzie.

## Zakres (decyzje użytkownika, 2026-07-29)

1. **Kaliber to przelicznik, nie typ pojemnika.** Pojemnik 15 kg i 20 kg to
   ten sam fizyczny E2 — saldo liczy SZTUKI E2 niezależnie od napełnienia.
   Druk zachowuje jeden wiersz „Ilość pojemników EURO2".
2. **Jedna kartoteka kontrahentów pojemnikowych**, łączona po NIP: firma
   będąca jednocześnie dostawcą i odbiorcą ma JEDNO saldo.
3. **Dokument „WZ na POJEMNIKI" to osobny dokument zdarzenia transportowego**
   (kierowca + środek transportu, kolumny Dostawa/odbiór i Zwrot naraz,
   własna numeracja). Przyjęcia surowca i WZ towaru tylko zasilają saldo
   ruchami — nie drukują tego dokumentu.
4. **Auto tam, gdzie system wie, ręczna korekta wszędzie.** Kości i grzbiety:
   pojemniki z ważeń HMI, z możliwością poprawienia, dopisania palet
   i potwierdzenia. Przyjęcie surowca: pojemniki z kalibru, palety ręcznie.
5. **Kolumna „Saldo" na druku = saldo narastająco po tym dokumencie**
   (przykład użytkownika: Koko przywiozło 400, wydajemy 400 → saldo 0).
6. Poza zakresem v1 (świadomie, YAGNI): wycena pojemników i obciążanie
   kontrahenta za braki, rezerwacje pojemników pod przyszłe wysyłki,
   inwentaryzacja stanu własnego magazynu pojemników (saldo jest
   *per kontrahent*, nie *per nasz magazyn*), kody kreskowe pojemników.

## Architektura

### Warstwa 1 — tożsamość kontrahenta

`suppliers` i `clients` to dziś dwie rozłączne tabele (`backend/init_db.py:32`
i `:125`), obie z kolumną `nip`. Fuzja tych tabel byłaby dużą, ryzykowną
migracją dotykającą przyjęć, zamówień, WZ, HDI i CMR. Zamiast tego dokładamy
**warstwę tożsamości wyłącznie na potrzeby pojemników**:

```sql
CREATE TABLE container_partners (
    id TEXT PRIMARY KEY,
    nip TEXT,                       -- znormalizowany: same cyfry
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_container_partners_nip
    ON container_partners(nip) WHERE nip IS NOT NULL AND nip <> '';

CREATE TABLE container_partner_links (
    partner_id TEXT NOT NULL REFERENCES container_partners(id),
    ref_type TEXT NOT NULL,         -- 'supplier' | 'client'
    ref_id TEXT NOT NULL,
    PRIMARY KEY (ref_type, ref_id)
);
```

`container_partners_service.resolve_partner(conn, ref_type, ref_id) -> partner_id`:

1. `container_partner_links` po (ref_type, ref_id) → jeśli jest, zwróć.
2. Wczytaj `suppliers`/`clients` po id, znormalizuj NIP (`re.sub(r"\D", "", nip)`).
3. NIP niepusty → `INSERT ... ON CONFLICT (nip) DO UPDATE` → partner istniejący
   lub nowy. **To jest miejsce, w którym dostawca i odbiorca o tym samym NIP
   scalają się w jednego partnera.**
4. NIP pusty → dopasowanie po znormalizowanej nazwie
   (`lower(regexp_replace(name, '\s+', ' ', 'g'))`) wśród partnerów bez NIP;
   brak trafienia → nowy partner.
5. Zapisz `container_partner_links` i zwróć id.

Istniejące kartoteki `suppliers` / `clients` pozostają nietknięte.

### Warstwa 2 — księga ruchów

Rozważone warianty:

| Wariant | Ocena |
|---|---|
| Doklejenie do `stock_movements` | ❌ CHECK na `VALID_MOVEMENT_TYPES`, jednostka kg, zaśmieca traceability mięsa |
| Saldo liczone „w locie" z przyjęć i WZ | ❌ nie da się zapisać zwrotu pustych pojemników bez towaru |
| **Osobna księga `container_movements`** | ✅ wybrane |

```sql
CREATE TABLE container_movements (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES container_partners(id),
    asset_type TEXT NOT NULL,       -- 'e2' | 'pallet_h1' | 'pallet_other'
    qty INTEGER NOT NULL,           -- ZE ZNAKIEM (patrz konwencja niżej)
    source_type TEXT NOT NULL,      -- 'raw_batch'|'wz'|'container_doc'|'manual'
    source_id TEXT,
    doc_id TEXT,                    -- FK do container_docs (patrz uwaga o kolejności)
    movement_date DATE NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT false,
    note TEXT DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_container_mov_partner ON container_movements(partner_id, asset_type);
CREATE INDEX idx_container_mov_source  ON container_movements(source_type, source_id);
CREATE INDEX idx_container_mov_date    ON container_movements(movement_date);
```

**Kolejność w `migrations.py`:** `container_partners` → `container_docs` →
`container_movements` → `ALTER ... ADD CONSTRAINT` dla `doc_id`.
`migrations.py` wykonuje listę instrukcji po kolei, więc FK na tabelę
zdefiniowaną niżej rozsypałoby migrację — a `run_migrations()` **połyka błędy
pojedynczych instrukcji** (patrz pamięć „Migracje padają cicho"), więc taki
błąd byłby niewidoczny aż do pierwszego zapisu. Po deployu weryfikujemy DANE
(`SELECT` na nowych tabelach), nie flagę `migrations.done`.

**Konwencja znaku (jedyna, obowiązująca wszędzie):**

- `qty > 0` — pojemniki przyjechały DO NAS (dostawa surowca w pojemnikach
  dostawcy). Saldo rośnie = **my jesteśmy winni**.
- `qty < 0` — pojemniki wyjechały OD NAS (WZ towaru, zwrot pustych).
  Saldo maleje = **oni są winni**.

**Saldo(partner, asset) = `SUM(qty)`** — jeden licznik obsługuje oba kierunki,
dokładnie jak kolumna „Saldo" na druku. Saldo 0 = rozliczone.

Kolumny `direction` NIE ma — kierunek to znak `qty`. Dzięki temu saldo jest
zwykłą sumą i nie da się go policzyć źle.

### Warstwa 3 — księgowanie różnicowe (append-only)

Ruchy z przyjęć i WZ muszą nadążać za edycją dokumentów źródłowych: WZ można
edytować (`update_wz_lines`, `wz_service.py:485`) i anulować (`cancel_wz`,
`:626`). Inwariant „no data loss" zabrania kasowania i cichych update'ów,
więc korekta = **dopisanie różnicy**, nigdy nadpisanie.

Jeden prymityw w `container_ledger_service.py`:

```python
def book_target(conn, *, partner_id, asset_type, source_type, source_id,
                target_qty, movement_date, note="", confirmed=False) -> int:
    """Doprowadza sumę ruchów dla (source_type, source_id, asset_type)
    do target_qty, dopisując RÓŻNICĘ. Zwraca dopisaną deltę (0 = bez zmian)."""
```

- `booked = SELECT COALESCE(SUM(qty),0) FROM container_movements
   WHERE source_type=%s AND source_id=%s AND asset_type=%s`
- `delta = target_qty - booked`; `delta == 0` → nic nie rób (idempotencja)
- `delta != 0` → `INSERT` jednego wiersza z `qty = delta`

Anulowanie dokumentu źródłowego = `book_target(..., target_qty=0)`. Historia
zostaje w całości, saldo wraca do zera.

Wołający:

| Miejsce | target_qty |
|---|---|
| `raw_batches_service.create_raw_batch` (po INSERT, w tej samej transakcji) | `+containers_count`, `+pallets_h1`, `+pallets_other` |
| `raw_batches_service` — edycja/anulowanie partii | przeliczone lub 0 |
| `wz_service.create_manual_wz` (po INSERT) | `−Σ containers` z pozycji, `−pallets_h1`, `−pallets_other` |
| `wz_service.update_wz_lines` | przeliczone z nowych pozycji |
| `wz_service.cancel_wz` | 0 |
| `container_docs_service` (zapis dokumentu pojemnikowego) | `in_qty − out_qty` per asset, `confirmed=true` |

**Tylko WZ ręczne.** WZ z zamówienia (`create_wz_from_order`) nie księguje
nośników: `update_wz_lines` i `cancel_wz` odrzucają dokumenty niereczne, więc
zaksięgowany stamtąd ruch nie dałby się skorygować ani cofnąć. Palety pod
wyrób gotowy z zamówień to osobna iteracja.

Ruchy automatyczne startują z `confirmed = false` i **liczą się do salda**
(to najlepsze oszacowanie, jakie system ma). Flaga oznacza tylko „biuro tego
jeszcze nie przejrzało" i steruje sekcją „Do rozliczenia".

### Warstwa 4 — kaliber

```sql
ALTER TABLE raw_batches ADD COLUMN container_kg NUMERIC(6,2);   -- NULL = niekalibrowany
ALTER TABLE raw_batches ADD COLUMN containers_count INTEGER;
ALTER TABLE raw_batches ADD COLUMN pallets_h1 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE raw_batches ADD COLUMN pallets_other INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wz_documents ADD COLUMN pallets_h1 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wz_documents ADD COLUMN pallets_other INTEGER NOT NULL DEFAULT 0;
```

Palety są na poziomie **dokumentu**, nie pozycji: transport wiezie N palet
łącznie, nie N palet na każdą partię. Pojemniki odwrotnie — zostają na
pozycji (`lines[].containers`), bo wynikają z masy konkretnej partii.

Czysta funkcja w `app/utils/containers.py` (testowana bez DB):

```python
def containers_for_kg(kg: float, container_kg: float | None) -> int | None:
    """Liczba pojemników dla masy. None = niekalibrowany (operator wpisuje ręcznie)."""
    if container_kg is None or container_kg <= 0:
        return None
    if kg <= 0:
        return 0
    return math.ceil(kg / container_kg)
```

**Ujednolicenie zaokrąglenia na `ceil`.** Dziś modal przyjęcia liczy `floor`,
a `wz_service` `ceil`. Niepełny pojemnik to nadal jeden fizyczny pojemnik,
więc `ceil` jest poprawny fizycznie; `floor` gubiłby jeden pojemnik na
każdej niepełnej dostawie i saldo rozjeżdżałoby się od pierwszego dnia.
Zmiana dotyczy `CreateRawBatchModal.tsx:79` — kafelek „+X kg reszty" zostaje
jako informacja, ale nie zmniejsza już liczby pojemników.

Dozwolone kalibry: **15 kg**, **20 kg**, **niekalibrowany**. Lista trzymana
jako stała w `app/utils/containers.py` i eksportowana przez API, żeby front
i backend nie rozjechały się przy dokładaniu kolejnego kalibru.

Na WZ: `stock_raw()` (`wz_service.py:1009`) zamiast `int(-(-kg // 15))` liczy
z kalibru partii — `containers_for_kg(kg_available, r["container_kg"])`.
Dla partii niekalibrowanych (`container_kg IS NULL`) podpowiedź jest
proporcjonalna do wydawanej masy:
`round(containers_count * kg_available / kg_received)`, a gdy `containers_count`
jest puste — `None` (operator wpisuje ręcznie). Pozycje `meat` (mięso z/s)
zostają bez zmian: korzystają z `e2_count` z wpisów rozbioru, czyli
z **policzonych**, a nie wyliczonych pojemników.

Selektor kalibru pojawia się w:

- `CreateRawBatchModal` — jedno pole na całą dostawę (obok „Nr faktury / PZ"),
  domyślnie 15 kg, plus pola `pojemniki` (edytowalne, prefill z wyliczenia),
  `palety H1`, `palety inne`.
- `WzNewPage` — per pozycja, obok istniejącego pola `containersStr`
  (`WzNewPage.tsx:587`), oraz `palety H1` / `palety inne` na poziomie
  dokumentu.

### Warstwa 5 — dokument „WZ na POJEMNIKI"

```sql
CREATE TABLE container_docs (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL,           -- POJ/NN/MM/RR
    seq INTEGER NOT NULL DEFAULT 0,
    year_month TEXT NOT NULL,       -- 'RRMM'
    partner_id TEXT NOT NULL REFERENCES container_partners(id),
    partner_snapshot JSONB DEFAULT '{}',  -- nazwa/adres/NIP na moment wystawienia
    seller JSONB DEFAULT '{}',            -- get_company() na moment wystawienia
    doc_date DATE NOT NULL,
    driver TEXT DEFAULT '',
    vehicle TEXT DEFAULT '',
    lines JSONB DEFAULT '[]',       -- [{asset_type, in_qty, out_qty}]
    balance_after JSONB DEFAULT '{}',     -- {asset_type: saldo po dokumencie}
    status TEXT NOT NULL DEFAULT 'wystawiony',  -- 'wystawiony'|'anulowany'
    notes TEXT DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_container_docs_partner ON container_docs(partner_id);
CREATE INDEX idx_container_docs_ym ON container_docs(year_month);
```

Numeracja wzorowana 1:1 na `wz_service._insert_wz` — `MAX(seq)+1` per
`year_month` w tej samej transakcji co INSERT, format
`POJ/{seq}/{MM}/{RR}` (`format_container_doc_number`).

Zapis dokumentu (jedna transakcja):

1. `resolve_partner` (jeśli wybrano dostawcę/odbiorcę z kartoteki).
2. INSERT `container_docs` z numerem.
3. Per wiersz: `book_target(source_type='container_doc', source_id=doc_id,
   asset_type=..., target_qty=in_qty − out_qty, confirmed=True)`.
4. Przelicz saldo per asset **po** zaksięgowaniu i zapisz w `balance_after`
   — druk musi pokazywać saldo zamrożone na moment wystawienia, żeby
   ponowny wydruk po kolejnych ruchach dawał ten sam dokument.

Anulowanie: `status='anulowany'` + `book_target(..., target_qty=0)` dla
każdego wiersza. Bez kasowania (wzorzec `cancel_wz`).

### API — `app/routes/containers.py` → `/api/containers/...`

Domyślna reguła `permission_for_path` zwraca `"office"`
(`auth/permissions.py:100`), więc nowy prefiks nie wymaga zmian w RBAC.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/containers/calibers` | lista kalibrów (15, 20, niekalibrowany) |
| GET | `/api/containers/balances` | salda wszystkich partnerów per asset (+ filtr `?q=`, `?nonzero=1`) |
| GET | `/api/containers/partners/{id}` | kartoteka: dane, salda, ruchy, dokumenty |
| GET | `/api/containers/movements` | `?partnerId=&from=&to=&unconfirmed=1` |
| PATCH | `/api/containers/movements/{id}` | korekta ilości (dopisuje deltę) + `confirmed` |
| POST | `/api/containers/movements` | ruch ręczny (`source_type='manual'`) |
| GET/POST | `/api/containers/docs` | lista / wystawienie dokumentu |
| GET | `/api/containers/docs/{id}` | dokument do druku |
| POST | `/api/containers/docs/{id}/cancel` | anulowanie |
| GET | `/api/containers/statement` | `?partnerId=` (wymagany) `&from=&to=` — saldo otwarcia, ruchy, saldo zamknięcia |

Warstwy: route → `container_docs_service` / `container_ledger_service` /
`container_partners_service` → `db.py`. Routes cienkie, zgodnie z CLAUDE.md.

Podział na trzy serwisy zamiast jednego pliku jest celowy: `partners` ma jedną
odpowiedzialność (tożsamość po NIP), `ledger` jedną (saldo i księgowanie
różnicowe), `docs` jedną (numeracja i dokument). Każdy testowalny osobno,
żaden nie przekracza ~250 linii.

### Frontend

**Nowa strona** `src/pages/office/ContainerBalancePage.tsx` →
`/office/saldo-pojemnikow`, pozycja w `OfficeSidebar.tsx` w sekcji z
„Dokumenty WZ" (ikona `Boxes`).

- Tabela partnerów w stylu Subiekt (wzorzec `RawStockPage`): nazwa, NIP,
  znacznik `dostawca / odbiorca / oba`, saldo E2, saldo H1, saldo inne.
  Sortowanie po każdej kolumnie, filtr tekstowy, przełącznik „tylko
  niezerowe". Saldo dodatnie i ujemne rozróżnione semantycznie (amber = my
  winni, emerald = rozliczone, red = oni winni) — kolor tylko semantyczny,
  zgodnie z design systemem.
- Klik w wiersz → `ContainerPartnerCard` (wzorzec kartoteki partii
  `RawStockBatchCard`): salda u góry, pod nimi historia ruchów
  (data, dokument źródłowy, asset, +/−, saldo narastająco), sekcja
  **„Do rozliczenia"** = ruchy `confirmed=false` z inline korektą
  i przyciskiem „Potwierdź", oraz przyciski „Nowy dokument pojemnikowy"
  i „Potwierdzenie salda za okres".
- `ContainerDocModal` — wystawienie dokumentu: partner, data, kierowca,
  środek transportu, 3 wiersze (E2 / H1 / inne) z kolumnami
  Dostawa/odbiór i Zwrot, podgląd salda po zapisie, uwagi. Prefill
  z niezbilansowanych ruchów partnera.

**Druki** (samodzielne strony, wzorzec `MixingPlanPrintPage` /
`SanitaryCheckPrintPage`, auto-print po załadowaniu, `?pdf=1` wyłącza):

1. `/office/pojemniki/:id/druk` — `ContainerDocPrintPage`.
   `@page { size: A4 landscape; margin: 0 }`. Strona podzielona na dwie
   połowy po 148,5 mm; ta sama treść dwa razy, dolna kopia oznaczona
   `ORYGINAŁ` / `KOPIA` w rogu. Układ 1:1 ze skanem: ramka
   Dostawca (z `seller` = `get_company()`, **nie hardcode** — dane firmy
   są w Ustawieniach firmy) | „WZ na POJEMNIKI NR" + Data dostawy/odbioru
   + Kierowca | Odbiorca; niżej Środek transportu i tabela 3×3
   (Dostawa/odbiór [szt.] | Zwrot [szt.] | Saldo); na dole Podpis dostawcy |
   Uwagi | Podpis odbiorcy. Logo `/logo-ksiezyc-print.png` w ramce Dostawcy.
   Kolumna **Saldo = `balance_after[asset]`** (narastająco po dokumencie).
2. `/office/pojemniki/raport/druk?partnerId=&from=&to=` —
   `ContainerStatementPrintPage`, **A4 pionowo** (mieści znacznie więcej
   wierszy ruchu). Nagłówek z danymi obu stron i zakresem dat, tabela:
   saldo otwarcia → wiersze ruchu (data, dokument, opis źródła, +/− per
   asset) → saldo zamknięcia. Stopka z miejscem na podpisy obu stron.

### Uboczne — kości i grzbiety

`byproduct_lots.containers_available` zostaje jedynym źródłem liczby
pojemników ubocznych (bez zmian w mechanizmie ważeń HMI). Zmiany:

- `stock_raw()` dokłada do pozycji `byproduct` liczbę palet z
  `batch_byproducts.backs_pallets` / `bones_pallets`
  (`len(pallets)`, przez helper analogiczny do `pallet_containers`).
- `WzNewPage` pokazuje przy pozycjach ubocznych wyliczone pojemniki i palety
  jako **edytowalne** pola; poprawka operatora jest tym, co trafia do
  `book_target`.
- Ruch z takiego WZ startuje `confirmed=false` i ląduje w „Do rozliczenia",
  gdzie biuro go potwierdza. To realizuje „system liczy, ale czasem się różni
  — możliwość poprawienia, dopisania palet i potwierdzenia".

## Obsługa błędów

- Brak NIP i brak dopasowania nazwy → tworzony jest nowy partner. Świadomie:
  lepszy osobny wiersz do ręcznego scalenia niż ciche wrzucenie ruchu na
  cudze saldo. Strona salda pokazuje przycisk „Scal z…" (v1: tylko
  ostrzeżenie o partnerach bez NIP; scalanie to fast-follow).
- `qty` niecałkowite lub ujemne w formularzu → 400 z komunikatem PL.
  Pojemniki i palety to zawsze liczby całkowite ≥ 0 na wejściu; znak nadaje
  serwis, nie użytkownik.
- Anulowany dokument źródłowy zaksięgowany dwukrotnie → niemożliwe:
  `book_target` jest idempotentne (delta = 0).
- Wyścig na numerze dokumentu → `MAX(seq)+1` w tej samej transakcji co
  INSERT, jak w `_insert_wz`.
- Druk bez `RENDER_TOKEN_SECRET` → jak pozostałe dokumenty; strona druku
  przyjmuje `x-render-token` (wzorzec istniejący).

## Testy

Bez DB (`backend/tests/`, czysta logika):

- `containers_for_kg`: 300 kg / 15 → 20; 305 kg / 15 → **21** (ceil);
  300 kg / 20 → 15; `container_kg=None` → `None`; `kg=0` → 0.
- `format_container_doc_number(7, "2607")` → `"POJ/7/07/26"`.
- normalizacja NIP: `"513-006-44-78"` → `"5130064478"`.
- saldo = suma `qty`: `[+400, −400]` → 0; `[+400, −150]` → 250.

Z DB (`TEST_DATABASE_URL=postgres:p@localhost:55437/kebab_mes_test` —
bez tej zmiennej testy DB cicho się pomijają):

- `resolve_partner`: dostawca i klient o tym samym NIP → **ten sam**
  `partner_id`; dwa wywołania dla tego samego ref → jeden partner.
- Przyjęcie 6000 kg, kaliber 15 → ruch `+400` E2 na partnerze dostawcy.
- `book_target` idempotentne: dwa wywołania z tym samym `target_qty` →
  jeden wiersz ruchu.
- Korekta z 400 na 380 → dopisany wiersz `−20`, suma 380, **stary wiersz
  nietknięty**.
- WZ towaru na 100 pojemników → ruch `−100`; `cancel_wz` → dopisane `+100`,
  saldo wraca do stanu sprzed WZ.
- Dokument pojemnikowy: przyjęcie +400 (dostawa), dokument z `out_qty=400`
  → saldo 0, `balance_after.e2 == 0`.
- `statement(from, to)`: saldo otwarcia + suma ruchów w oknie = saldo
  zamknięcia.

## Kolejność wdrożenia

1. Migracje + `app/utils/containers.py` + testy czystej logiki.
2. `container_partners_service` + `container_ledger_service` + testy DB.
3. Podpięcie `book_target` do `raw_batches_service` i `wz_service`
   (przyjęcie, WZ, edycja pozycji, anulowanie) + testy DB.
4. `container_docs_service` + numeracja + anulowanie + testy DB.
5. `routes/containers.py`, rejestracja w `main.py`, klient w `src/lib/api.ts`.
6. Kaliber w `CreateRawBatchModal` (ceil!) i `WzNewPage` + palety.
7. `ContainerBalancePage` + kartoteka partnera + `ContainerDocModal`.
8. Druki: dokument (A4 poziomo, 2 kopie) i potwierdzenie salda (A4 pionowo).
9. `npx tsc --noEmit`, `npm run build`, `pytest -q`, smoke-test na dev.

Deploy dopiero po obowiązkowym diffie prod↔repo
(`diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app`)
— prod bywa do przodu z hotfixami, które trzeba najpierw scommitować.
