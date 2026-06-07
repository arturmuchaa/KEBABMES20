# SP-1 — Rdzeń dokumentu WZ (Wydanie Zewnętrzne)

Data: 2026-06-07
Status: spec do przeglądu

## Kontekst i cel

Sprzedaż towaru w Kebab MES musi kończyć się dokumentem **WZ** (Wydanie
Zewnętrzne). Reguła biznesowa (potwierdzona z właścicielem):

- **Sprzedaż towaru → zawsze WZ + HDI**; klient **zagraniczny → dodatkowo CMR**.
- **Sprzedaż produktów ubocznych (ABP: kości/grzbiety) → WZ + dokument handlowy
  ABP** (kat. 3 wg Reg. (WE) 1069/2009 — osobny od HDI).

HDI i CMR już istnieją (`hdi_service`, `cmr_service`, druk przez headless
Chrome). **WZ nie istnieje** — to świadomie odłożony punkt C-4 roadmapy
([[kebab-wydanie-dokumenty-roadmap]]).

Ta specka obejmuje **wyłącznie SP-1 — rdzeń WZ**: encję dokumentu, numerację,
serwis, wydruk i API. Jest fundamentem wielokrotnego użytku dla:

- **SP-2** (osobna specka) — przyciski WZ/HDI/CMR na wydaniu kebabów (`dispatches`).
- **SP-3** (osobna specka) — model sprzedaży/utylizacji ABP + WZ + dokument ABP.

SP-2 i SP-3 są **poza zakresem** tej specki.

## Podejście

Klon architektury **HDI** — sprawdzony wzorzec w tym repo: dedykowana tabela,
numeracja `NN/MM/RR`, idempotencja per źródło, druk strony React przez headless
Chrome (`pdf_render.render_url_to_pdf`), lista/archiwum. Spójne z HDI/CMR, niskie
ryzyko, brak nowych bibliotek PDF.

Odrzucone: (B) generyczna polimorficzna tabela „documents" — rozjeżdża się ze
wzorcem per-typ (`hdi_documents`, `cmr_documents`); (C) WZ jako sekcja wydania bez
osobnej encji — brak numeracji/archiwum, słabe prawnie.

## Model danych

Tabela `wz_documents` (migracja idempotentna w `app/migrations.py::_DDL`):

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | TEXT PK | cuid |
| `number` | TEXT | `WZ/NN/MM/RR` (np. `WZ/7/06/26`) |
| `source_type` | TEXT | `'dispatch'` \| `'byproduct'` (rozszerzalne) |
| `source_id` | TEXT | id źródła (wydanie / lot ABP) — może być NULL dla WZ ręcznego |
| `seller` | JSONB | wystawca: name, address, nip, email (z ustawień firmy) |
| `buyer_name` | TEXT | nabywca/odbiorca |
| `buyer_address` | TEXT | adres odbiorcy |
| `buyer_nip` | TEXT | NIP odbiorcy (opcjonalny) |
| `valued` | BOOLEAN | true = pokazuj cenę i wartość (sprzedaż) |
| `lines` | JSONB | `[{name, qty, unit, price, value, batch_no?}]` |
| `total_value` | NUMERIC(12,2) | suma wartości pozycji |
| `place` | TEXT | miejsce wystawienia (z ustawień firmy, np. miasto) |
| `issued_date` | DATE | data wystawienia |
| `release_date` | DATE | data wydania (domyślnie = issued_date) |
| `status` | TEXT | `'wstepny'` \| `'wystawiony'` |
| `notes` | TEXT | uwagi |
| `created_at` | TIMESTAMPTZ | |

Indeksy: `(source_type, source_id)`, `(number)`, `(issued_date)`.

## Numeracja

`WZ/NN/MM/RR` — licznik **miesięczny**, identycznie jak HDI. Stan w
`app_settings` (klucz `wz_seq`, jsonb `{ "MM/RR": N }`). Numeracja przydzielana w
transakcji (`FOR UPDATE`/atomowy upsert) — brak dziur przy współbieżności.

**Idempotencja:** `generate_wz(source_type, source_id, ...)` z istniejącym
`(source_type, source_id)` zwraca **ten sam** dokument (nie nabija numeru). Dopóki
`status='wstepny'`, ponowne wywołanie odświeża treść (pozycje, nabywcę),
zachowując numer — jak `generate_hdi`. WZ ręczny (`source_id=NULL`) zawsze nowy.

## Komponenty

- `app/services/wz_service.py`:
  - `next_wz_number(conn, today) -> str` — czysta-ish (licznik), testowalna logika formatu w helperze `format_wz_number(seq, month, year)`.
  - `build_wz_lines(items, valued) -> (lines, total)` — **czysta**: mapuje pozycje
    na `{name, qty, unit, price, value}`, liczy `value = round(qty*price, 2)` i sumę.
  - `generate_wz(source_type, source_id, buyer, items, valued, place, dates) -> dict` — idempotentny upsert.
  - `list_wz(filters)`, `get_wz(id)`, `wz_pdf(id)`.
- `app/routes/wz.py`: `POST /api/wz`, `GET /api/wz`, `GET /api/wz/{id}`,
  `GET /api/wz/{id}/pdf`. Rejestracja w `app/main.py` (import-tuple + pętla).
- Front: strona `/office/wz/:id/druk` (`WzPrintPage`) + lista `/office/wz`
  (`WzDocumentsPage`, styl jak `HdiDocumentsPage`). `wzApi` w `src/lib/api.ts`.

## Układ wydruku (standard WZ)

Nagłówek: „WZ — Wydanie zewnętrzne" + `number`; **miejsce i data wystawienia**.
Dwa bloki: **Sprzedający/Wystawca** (firma: nazwa, adres, NIP — z ustawień) i
**Odbiorca/Nabywca** (nazwa, adres, NIP). Tabela pozycji:
`Lp | Nazwa towaru | Ilość | j.m. | Cena jedn. | Wartość` (kolumny Cena/Wartość
tylko gdy `valued=true`; inaczej WZ ilościowe). Pod tabelą: **Razem** (gdy
wartościowy). Stopka: **data wydania**, pola podpisów „Wydał" / „Odebrał".
Druk 1:1 przez headless Chrome (`self_base_url` + `?pdf=1`), plik `WZ_{number}.pdf`.

## Obsługa błędów

- Brak pozycji → `400 „WZ wymaga co najmniej jednej pozycji"`.
- `valued=true` a pozycja bez ceny → cena `0`, wartość `0` (nie blokuje; ostrzeżenie w logu).
- `get_wz`/`wz_pdf` nieistniejący id → `404`.
- Render PDF bez Chrome → `502` z czytelnym komunikatem (jak HDI).

## Testy (czyste, jak istniejące w `backend/tests/`)

- `format_wz_number`: `(7, 6, 2026) -> "WZ/7/06/26"`, zero-padding miesiąca.
- `build_wz_lines`: wartość = qty×price zaokrąglona; suma; `valued=false` → bez cen.
- idempotencja: dwa `generate_wz` na to samo źródło → ten sam numer (test na poziomie logiki numeru/uperta — z atrapą licznika lub mały test integracyjny zgodny ze stylem repo).

## Poza zakresem (kolejne specki)

- SP-2: wpięcie WZ/HDI/CMR w `dispatches` + flaga „klient zagraniczny".
- SP-3: `byproduct_lots` wynik sale/disposal + ceny domyślne (kości 0,02 / grzbiety 0,5) + dokument handlowy ABP.
- Konfigurator pozycji wydruku (jak CMR) — tylko jeśli okaże się potrzebny.
