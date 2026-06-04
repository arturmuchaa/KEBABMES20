# CMR — Etap 1: wystawianie z biura + słownik „Przewoźnicy" (projekt)

**Data:** 2026-06-04
**Status:** zaakceptowany kierunek, do przeglądu specu
**Kontekst:** część C-4 roadmapy ([[kebab-wydanie-dokumenty-roadmap]]). Równolegle do HDI.

## Cel

Umożliwić wystawienie międzynarodowego listu przewozowego **CMR** **per zamówienie**,
ręcznie z biura (jak HDI), z danymi przewoźnika ze słownika. Druk/PDF wierny wzorowi
(`/root/cmr wzor.pdf`, pola 1–24, 4 kopie). Etap 2 (integracja ze skanowaniem magazynu:
HDI wstępny→potwierdzony + CMR auto przy załadunku) — osobny spec, po Etapie 1.

## Zakres Etapu 1 (co wchodzi)

1. **Słownik „Przewoźnicy"** (`carriers`) — CRUD jak Kontrahenci/Dostawcy.
2. **Dokument CMR** (`cmr_documents`) — budowa z zamówienia + payload, **numeracja ciągła
   od 1** (bez resetu), stała per zamówienie (idempotentna jak HDI).
3. **Formularz CMR** (modal w biurze na liście zamówień) — przewoźnik, nr rej., nr FV,
   instrukcje, franco, towary (zbiorczy „KEBAB MROŻONY" + ręczne pozycje).
4. **Druk + PDF** — strona druku (pola 1–24, **4 kopie** = 4 strony A4), endpoint
   `/api/cmr/{id}/pdf` przez headless Chrome (to samo `render_url_to_pdf` co HDI).
5. **Lista „Dokumenty CMR"** + pozycje w menu („Przewoźnicy", „Dokumenty CMR").

**Poza zakresem (Etap 2):** generowanie/uzupełnianie CMR i weryfikacja HDI przy skanowaniu
magazynu; nr rej./przewoźnik podpowiadany z pojazdu w mobilnym załadunku.

## Model danych

### Tabela `carriers` (słownik przewoźników)
```
id           TEXT PRIMARY KEY
name         TEXT NOT NULL
address      TEXT DEFAULT ''
postal_code  TEXT DEFAULT ''
city         TEXT DEFAULT ''
country      TEXT DEFAULT ''        -- np. "PL", "SI"
nip          TEXT DEFAULT ''
vat_eu       TEXT DEFAULT ''        -- VAT UE (pole 16 na CMR)
default_plate TEXT DEFAULT ''       -- domyślny nr rej. (podpowiedź w formularzu)
phone        TEXT DEFAULT ''
notes        TEXT DEFAULT ''
active       BOOLEAN NOT NULL DEFAULT true
created_at   TIMESTAMPTZ DEFAULT now()
```
Model `CarrierCreate` (Pydantic) z tymi polami. Serwis `carriers_service.py`:
`list_carriers()`, `create_carrier()`, `update_carrier()`, `deactivate_carrier()` —
wzorzec 1:1 z `clients_service.py`. Route `/api/carriers` (GET/POST/PUT/PATCH deactivate).

### Tabela `cmr_documents`
```
id           TEXT PRIMARY KEY
number       TEXT NOT NULL          -- wyświetlany numer (ciągły, np. "1", "2", ...)
seq          INTEGER NOT NULL       -- globalna sekwencja od 1
order_id     TEXT
client_name  TEXT DEFAULT ''
carrier_id   TEXT
status       TEXT NOT NULL DEFAULT 'wystawiony'
payload      JSONB NOT NULL DEFAULT '{}'   -- migawka wszystkich pól (poniżej)
issue_date   TEXT DEFAULT ''
created_at   TIMESTAMPTZ DEFAULT now()
```
Indeksy: `idx_cmr_order(order_id)`, `idx_cmr_created(created_at)`.

**Numeracja ciągła:** klucz w tabeli `sequences` = `cmr_seq` (globalny). `generate_cmr`
pobiera `MAX(seq)+1` z `cmr_documents` (lub `sequences`), startuje od 1, **nigdy nie
resetuje**. Numer stały per zamówienie: jeśli CMR dla `order_id` istnieje → zwracamy ten
sam (idempotencja jak w `hdi_service.generate_hdi`), a payload odświeżamy z formularza.

### `payload` (migawka pól CMR)
```jsonc
{
  "sender":   { "name","address","postal_code","city","country","nip" },      // pole 1 (firma)
  "consignee":{ "name","address","city","country","nip" },                    // pole 2 (klient)
  "delivery_place": "…",                                                       // pole 3 (miejsce przeznaczenia)
  "load_place": "…", "load_date": "RRRR-MM-DD",                               // pole 4
  "attachments": { "hdi_number": "…", "invoice_no": "…" },                     // pole 5 (HDI auto + FV ręcznie)
  "goods": [ { "name":"KEBAB MROŻONY","qty":N,"kg":W,"auto":true },            // pola 6–9 (zbiorczo + ręczne)
             { "name":"Jogurt","qty":N,"kg":W } ],
  "gross_kg": W_total,                                                         // pole 11
  "instructions": "TRANSPORT MROŻNICZY -22",                                   // pole 13
  "franco": "Franco RUDAWA",                                                   // pole 14
  "carrier": { "name","address","postal_code","city","country","nip","vat_eu","plate" }, // pole 16
  "established_place": "…", "established_date": "RRRR-MM-DD"                    // pole 21
}
```

## Budowa treści (serwis `cmr_service.py`)

`build_cmr(order_id, form)`:
1. `order` z `client_orders`; klient po `client_id` (fallback nazwa) — jak w HDI.
2. **Sender** = `get_company()`. **Consignee/delivery_place** = klient (name/adres/nip;
   delivery_place z `dest_*` jak `unload` w HDI).
3. **Towar auto:** suma z `production_plan_lines` (qty_done>0) tego zamówienia →
   `{ name:"KEBAB MROŻONY", qty:Σqty_done, kg:Σ(qty_done*kg_per_unit), auto:true }`
   (to samo źródło co HDI). Łączymy z `form.goods_manual` (ręczne pozycje: jogurt itp.).
4. **gross_kg** = suma `kg` wszystkich pozycji towaru.
5. **Załączniki:** `hdi_number` = `SELECT number FROM hdi_documents WHERE order_id=%s`
   (najnowszy; pusty gdy brak); `invoice_no` = z formularza.
6. **Carrier:** z `carriers` po `form.carrier_id` → migawka do payload; `plate` z formularza
   (domyślnie `default_plate`).
7. Domyślne: `instructions="TRANSPORT MROŻNICZY -22"`, `franco="Franco {load_place_city}"`,
   `load_place`/`established_place` = miejsce załadunku firmy, daty = dziś.

`generate_cmr(order_id, form)`: idempotentne per `order_id` (jak HDI) — istnieje → update
payload, zachowaj numer; brak → nowy `seq=MAX+1`, `number=str(seq)`.
`get_cmr(id)`, `list_cmr()`.

## Mapowanie pól CMR 1–24 (druk)

| Pole | Treść |
|---|---|
| 1 Nadawca | firma (sender) |
| 2 Odbiorca | klient (consignee) |
| 3 Miejsce przeznaczenia | delivery_place |
| 4 Miejsce/data załadowania | load_place + load_date |
| 5 Załączone dokumenty | „HDI {hdi_number}" + „FV {invoice_no}" |
| 6–9 Cechy/ilość/rodzaj/towar | lista `goods` (zbiorczy + ręczne) |
| 10 Nr statystyczny | puste |
| 11 Waga brutto | gross_kg |
| 12 Objętość | puste |
| 13 Instrukcje nadawcy | instructions |
| 14 Postanowienia o przewoźnym | franco |
| 15 Za pobraniem | puste |
| 16 Przewoźnik | carrier (name/adres/nip/vat_eu) + nr rej. (plate) |
| 17–20 | puste (kolejni przewoźnicy/zastrzeżenia/uzgodnienia/do zapłaty) |
| 21 Wystawiono w / data | established_place + established_date |
| 22–24 | puste ramki na podpis/pieczęć (nadawca/przewoźnik/odbiorca) |

Etykiety pól **stałe, trójjęzyczne PL/EN/DE** (jak na oryginalnym druku CMR i wzorze).

## Frontend

- **`CarriersPage`** — strona słownika (sekcja „Kontrahenci" w menu, pod „Dokumenty HDI"),
  wzorzec `ClientsPage` (lista + formularz dodaj/edytuj/dezaktywuj).
- **Formularz CMR** — modal otwierany przyciskiem **„CMR"** na liście zamówień
  (`ClientOrdersPage`, obok „HDI"): wybór przewoźnika (select ze słownika), nr rej.
  (prefill `default_plate`), nr FV, instrukcje (prefill), franco (prefill), lista towarów
  (linia kebaba auto + „dodaj pozycję" name/qty/kg). „Generuj" → `cmrApi.generate(orderId, form)`
  → otwiera druk.
- **`CmrPrintPage`** (`/office/cmr/:id/druk`) — odwzorowanie wzoru: ramki 1–24, **4 kopie**
  (nagłówki: „Kopia dla nadawcy/odbiorcy/przewoźnika/firmy") = 4 strony A4 (każda
  `page-break-after`), `?pdf=1` wyłącza auto-print. Layout tabelaryczny w ramkach jak wzór.
- **`CmrDocumentsPage`** (`/office/cmr`) — lista jak `HdiDocumentsPage` (numer, klient,
  przewoźnik, data; sort domyślnie numer malejąco; akcje Pobierz PDF / Drukuj / Otwórz).
  Pozycja menu „Dokumenty CMR" pod „Dokumenty HDI".
- **API klienta** (`api.ts`): `carriersApi` (list/create/update/deactivate),
  `cmrApi` (generate/get/listDocs/pdfUrl).

## Druk/PDF

Endpoint `GET /api/cmr/{id}/pdf` — analogicznie do HDI: `render_url_to_pdf(self_base_url +
"/office/cmr/{id}/druk?pdf=1")`, attachment `CMR_{numer}.pdf`. 4 kopie = 4 strony A4
(CMR ma sztywny układ — bez dynamicznego skalowania jak HDI; pozycji towaru mało).

## Testy (pytest, czyste funkcje)

- `build_cmr`/składanie towaru: suma qty/kg z plan_lines + scalenie pozycji ręcznych;
  `gross_kg` = suma; pozycja auto „KEBAB MROŻONY".
- Załączniki: `hdi_number` pobrany z `hdi_documents` po order_id; pusty gdy brak; `invoice_no`
  z formularza.
- Numeracja ciągła: pierwszy CMR = „1"; kolejny = „2"; ten sam order_id → ten sam numer
  (idempotencja), payload odświeżony.
- Carrier: migawka z `carriers` po id; `plate` z formularza nadpisuje `default_plate`.

Weryfikacja wizualna PDF względem `/root/cmr wzor.pdf`.

## Pliki (mapa)

**Backend (nowe):** `services/carriers_service.py`, `services/cmr_service.py`,
`routes/carriers.py`, `routes/cmr.py`, `models/carriers.py`, `models/cmr.py`,
`tests/test_cmr.py`. **Zmiany:** `migrations.py` (tabele `carriers`, `cmr_documents`,
sekwencja), `main.py` (rejestracja routerów).

**Frontend (nowe):** `pages/office/CarriersPage.tsx`, `pages/office/CmrPrintPage.tsx`,
`pages/office/CmrDocumentsPage.tsx`, `components/cmr/CmrFormModal.tsx`. **Zmiany:**
`App.tsx` (trasy), `layouts/OfficeSidebar.tsx` (menu), `pages/office/ClientOrdersPage.tsx`
(przycisk „CMR"), `lib/api.ts` (`carriersApi`, `cmrApi`).

## Otwarte/decyzje domyślne (do potwierdzenia w przeglądzie)

- Numer wyświetlany: zwykła liczba „1", „2"… (bez zer wiodących). Można zmienić na
  zero-padding (np. „000001"), jeśli wolisz jak na wzorze.
- 4 kopie A4 (potwierdzone). Status CMR: jednolity „wystawiony" w Etapie 1
  (potwierdzanie przy skanowaniu — Etap 2).
