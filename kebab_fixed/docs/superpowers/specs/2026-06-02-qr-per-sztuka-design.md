# Identyfikowalność per sztuka (QR) + walidacja przy pakowaniu — projekt

**Data:** 2026-06-02
**Status:** projekt do zatwierdzenia
**Zakres:** całość, 3 fazy w jednym dokumencie

## Problem i kontekst

Każdy kebab to osobna sztuka (10–80 kg, ~500–700 szt./dzień, różne receptury / tuleje /
klienci). Dziś brak identyfikacji pojedynczej sztuki i brak zabezpieczenia przy pakowaniu —
operator magazynu może włożyć złą sztukę do kartonu (np. kebab 30 kg do kartonu „40 kg",
albo produkt innego klienta).

**Realny proces (niezmieniany):**
1. **Biuro** planuje i **drukuje etykiety** (z gotowym numerem partii, wagą i QR). Każdy klient
   ma **inny format** etykiety: jedni 1/2 A4, inni 1/4 A5, inni z drukarki Zebra.
2. **Produkcja** formuje kebab, foliuje, **nakleja etykietę**, odkłada do mroźni.
3. **Następnego dnia magazyn** pakuje w kartony pod zamówienie (np. Zagros 20×40) lub na stan
   („na górkę").

**Cel:** każda sztuka ma unikalny QR → identyfikacja w dowolnym momencie (produkt, waga,
klient, partia wsadowa → rozbiór → dostawca, oraz gdzie sztuka jest). Przy pakowaniu skan
sztuki waliduje zgodność z linią zamówienia/kartonem i blokuje pomyłkę.

**Twardy warunek:** skanowanie musi być szybkie i bezpieczne. Dwa punkty skanu: **produkcja**
(potwierdzenie QC po powieszeniu na wózek, tryb ciągły, wykrycie dubli) oraz **magazyn**
(walidacja przy pakowaniu, tam gdzie powstają pomyłki). Oba w trybie skan-skan-skan z dużym
wskaźnikiem zielony/czerwony + dźwięk, bez wpisywania z klawiatury.

### Co już istnieje (do ponownego użycia)
- Druk etykiet z QR: `src/pages/office/PalletLabelPrintPage.tsx` — biblioteka `qrcode`
  (`QRCode.toDataURL`) + HTML/CSS `@page` + `window.print()`.
- Skan QR palet: token `PAL|<order_id>|<pallet_no>`, tabela `pallet_scans`,
  endpoint `POST /api/pallets/scan`, lookup `/api/pallets/lookup`, skaner PWA
  (`src/features/pwa/usePwaPage.ts`).
- Identyfikowalność wsadu: `finished_goods.batch_no = "ddmmrr <wsad>"`, lineage do
  `seasoned_meat` → `deboning_entries` → `raw_batches` → dostawca.
- Plan produkcji: `production_plans` / `production_plan_lines` (źródło numeru partii i składu).

## Założenia / decyzje
- **Klient jest na etykiecie** (kebab planowany pod konkretne zamówienie).
- **Numer partii pochodzi z planu produkcji** — przy generowaniu etykiet znany z linii planu.
- **Termin przydatności liczony automatycznie:** `data_produkcji + dni_przydatności`, gdzie
  **`dni_przydatności` to nowe pole receptury** wpisywane przy tworzeniu/edycji receptury
  (np. 365 dla „gold kebab"). Dodać kolumnę `shelf_life_days` do `recipes` + pole w formularzu
  receptury. (Uogólnienie obecnego sztywnego „+5 dni" z masowania.)
- **QR koduje krótki, unikalny ID sztuki** (nieprzezroczysty); wszystkie dane i lineage w bazie.
- **Sztuki jednorodne w obrębie linii planu** (np. 20× Zagros 40 kg, ta sama receptura/tuleja/
  partia) — produkcja nakleja dowolną z 20 etykiet na dowolny z 20 kebabów (wspólny SKU+partia).
- **Produkcja skanuje jako potwierdzenie QC:** po uformowaniu, streczu, etykiecie i powieszeniu
  na wózek do mroźni operator skanuje sztuki (pojedynczo lub kilka po sobie). Skan potwierdza
  „wyprodukowano", wiąże sztukę z wózkiem, i **wykrywa duble** (ten sam QR drugi raz = błąd).
  To dwa skany na sztukę (produkcja-potwierdzenie + magazyn-pakowanie) — świadomie akceptowane.
- **„Na górkę":** produkcja na stan dostaje etykietę z pseudo-klientem `STAN/MAGAZYN`;
  właściwy klient przypisywany przy pakowaniu/wydaniu.

## Integracja z głównym MES (zasada: warstwa detalu, NIE osobny silos)

`finished_units` to **warstwa detalu (pojedyncza sztuka) POD istniejącymi encjami**, a nie równoległy
system. Wszystko spina się z głównym MES:
- **Planowanie produkcji** (`production_plans`/`production_plan_lines`) jest źródłem — sztuki
  powstają z linii planu (`generate_units_from_plan_line`), dziedziczą partię wsadową i klienta.
- **Wyrób gotowy** (`finished_goods`, batch-level) **pozostaje rekordem zbiorczym**, na którym
  opiera się reszta MES (magazyn, stany, raporty, wysyłka). Sztuki linkują się do tej samej partii
  przez **`batch_no`** (klucz rollupu, jest indeks `idx_finished_units_batch`); `finished_goods.qty`
  danej partii = liczba jej sztuk. **Nie budujemy drugiego systemu stanów** — sztuki to warstwa
  detalu pod istniejącym wyrobem gotowym.
- **Identyfikowalność** — sztuka → `batch_no` → istniejący lineage (wsad → rozbiór → ćwiartka →
  dostawca) oraz w przód: sztuka → karton → **istniejące palety** (`order_pallets`/`pallet_scans`)
  → pojazd. Wycofanie po partii znajduje sztuki → kartony → wysyłki. Reużycie, nie duplikacja.
- **Zamówienia/klienci/receptury** — sztuki używają istniejących `client_orders`, `recipes`,
  `product_types`; żadnych równoległych słowników.

Reguła praktyczna: zanim dodasz nową tabelę/encję, sprawdź czy nie wystarczy link do istniejącej.

## Architektura — 4 fazy

### Wspólny model danych
Nowa tabela **`finished_units`** (jedna sztuka kebaba):
- `id` (cuid), `qr_code` (krótki unikalny token, np. `U|<id>`), `qr_seq`
- `plan_line_id` (źródło), `order_id` / `client_name` (lub `STAN`)
- `product_type_id`, `recipe_id`, `tuleja` (etykieta/rozmiar), `weight_kg`
- `batch_no` (`ddmmrr <wsad>` z planu), `produced_date`
- `status`: `planned` → `produced` (skan na produkcji, na wózku/mroźnia) → `packed` → `shipped`
- `trolley_id` (wózek, na który zeskanowano przy odkładaniu do mroźni), `produced_at`
- `carton_id` (null do spakowania), `created_at`
- Lineage: przez `batch_no` → istniejące `finished_goods` / `seasoned_meat` (bez duplikacji).

Nowa tabela **`cartons`**: `id`, `order_id`/`client_name`, `product_type_id`, `recipe_id`,
`target_qty`, `target_weight_kg`, `packed_qty`, `status` (`open`→`full`→`palletized`),
`pallet_id` (wpięcie w istniejące palety), `created_at`, `closed_at`.

Token QR sztuki: `U|<unit_id>` (analogicznie do `PAL|...`). Endpoint lookup zwraca pełną kartę.

### Faza 1 — Fundament: sztuki + QR + druk etykiet per klient

**Backend:**
- Generowanie sztuk z linii planu: dla linii (klient, 20×40 kg, receptura, tuleja, partia)
  tworzy 20 rekordów `finished_units` (status `planned`) z unikalnymi `qr_code`.
- `next_seq('unit_seq')` dla `qr_seq`; `qr_code = f"U|{id}"`.
- Endpoint: `POST /api/finished-units/from-plan-line/{plan_line_id}` → lista sztuk.
- Endpoint lookup: `GET /api/finished-units/lookup?code=U|<id>` → karta sztuki + lineage + status.

**Etykiety — szablony per klient+receptura, dwa tory (potwierdzone z użytkownikiem):**

Cztery pola dynamiczne wstrzykiwane przez MES na etykietę: **QR**, **data produkcji**,
**numer partii**, **termin przydatności**. Waga z planu produkcji.

- **Tor ZPL (klienci „z Zebry"):** użytkownik eksportuje etykietę z Zebra Designer jako **ZPL**
  z placeholderami (`{{QR}}`, `{{PARTIA}}`, `{{DATA_PROD}}`, `{{TERMIN}}`, `{{WAGA}}`). MES
  podstawia wartości, generuje QR natywnie w ZPL (`^BQ`) i wysyła do drukarki Zebra. Wierność 1:1.
- **Tor „tło + pola" (klienci A4 / 1/2 A4 / 1/4 A5, „z Worda"):** użytkownik eksportuje swój
  gotowy wygląd do **PDF/PNG** (statyczne tło) i wgrywa pod klienta+recepturę; w MES **stawia
  pozycje 4 pól** (QR, data prod., partia, termin) — raz, wizualnie. Przy druku MES nakłada
  wartości + QR (`qrcode`) na tło i drukuje (`window.print()`/PDF), N etykiet na arkusz.
- **Rejestr szablonów** `label_templates`: `client_id`, `recipe_id`, `kind` (`zpl`|`overlay`),
  `asset` (treść ZPL lub plik tła), `field_positions` (JSON: x/y/rozmiar dla 4 pól), `page_size`.
  Klucz **(klient + receptura)** — bo ten sam klient ma inną etykietę dla każdej receptury
  (inny skład dodatków). **Reguła UX: system prosi o etykietę TYLKO RAZ** przy pierwszej nowej
  kombinacji klient+receptura (brak szablonu → kreator wgrania/ustawienia pól), potem **pamięta**
  i używa automatycznie.
- Po wydruku sztuki pozostają `planned` — przejście na `produced` następuje przy **skanie
  produkcyjnym** (Faza 2), nie przy druku.

### Faza 2 — Produkcja: skan potwierdzający (QC + wózek)

**Stanowisko produkcji (skaner ręczny + mały ekran/tablet):** po uformowaniu, streczu,
naklejeniu etykiety i powieszeniu sztuki na wózek do mroźni operator **skanuje QR**.
- Tryb **ciągły** (skan-skan-skan) — pojedynczo lub kilka sztuk po sobie na ten sam wózek.
- Backend: `status planned→produced`, `produced_at=now`, `trolley_id` = bieżący wózek.
- **Duble = błąd:** skan QR sztuki o statusie `produced` (lub wyżej) → czerwony + sygnał
  („sztuka już zeskanowana"), brak podwójnego zliczenia.
- Licznik na ekranie: ile sztuk z linii planu już potwierdzonych vs zaplanowanych
  (np. „Zagros 40 kg: 12/20") — operator widzi, czy wszystko zrobione bez pomyłki.
- Endpoint: `POST /api/finished-units/scan-produced` `{ code, trolley_id? }` → wynik
  (ok / duplikat / nieznany QR), wzorzec jak `/pallets/scan`.

**Po co:** potwierdzenie zgodności plan↔wyprodukowane, wczesne wykrycie pomyłek/dubli,
rejestracja na którym wózku sztuka pojechała do mroźni (lokalizacja).

### Faza 3 — Pakowanie w magazynie (skan + walidacja)

**Ekran pakowania (tablet/PC + skaner ręczny lub stacjonarny):**
1. Operator wybiera **linię zamówienia / otwiera karton** (klient, produkt, target qty, np. 20×40).
2. **Skanuje każdą sztukę** (QR) → backend waliduje:
   - sztuka potwierdzona na produkcji (`status == produced`)? (inaczej „nie zeskanowana na produkcji")
   - SKU sztuki (produkt+tuleja+waga) == linia kartonu? klient zgodny (lub `STAN`)?
   - sztuka nie spakowana wcześniej (`status != packed`)?
   - nie przekroczono `target_qty`?
   - → ✓ zielony + bip, `packed_qty++`, `unit.status=packed`, `unit.carton_id=...`;
   - → ✗ czerwony + sygnał, czytelny powód („30 kg — karton wymaga 40 kg", „inny klient",
     „już spakowana").
3. `packed_qty == target_qty` → karton `full`. Karton → paleta (istniejący skan palet).

**Endpoint:** `POST /api/cartons/{carton_id}/scan` `{ code }` → wynik walidacji (wzorzec jak
`/pallets/scan`). Tworzenie kartonu: `POST /api/cartons` z linii zamówienia.

**Przepustowość:** wybór linii raz na karton, potem skan-skan-skan; duży wskaźnik zielony/
czerwony + dźwięk; auto-zliczanie; brak wpisywania z klawiatury.

### Faza 4 — Identyfikacja w dowolnym momencie + wpięcie w wysyłkę

- **Skan QR sztuki** (skaner PWA / telefon) w dowolnej chwili → **karta sztuki**: produkt,
  waga, klient, `batch_no` → wsad → rozbiór → ćwiartka → dostawca; status i lokalizacja
  (mroźnia / karton / paleta / wysłana).
- **Hierarchia skanu:** sztuka (`U|...`) → karton (`cartons`) → paleta (`PAL|...`, istniejące)
  → pojazd/wysyłka (istniejące `pallet_scans.vehicle_id`).
- Reużycie skanera PWA i `pallet_scans` (dodać `unit_scans` analogicznie albo wspólny log).
- Wsteczne wycofanie: po `batch_no` znajdź wszystkie `finished_units` → kartony → palety →
  wysyłki/klientów (krok w przód), zgodnie z [[recall containment]] z numeracji partii.

## Obsługa błędów
- Skan nieznanego/uszkodzonego QR → czytelny komunikat, brak crasha.
- Skan sztuki już spakowanej → blokada + info gdzie jest.
- Druk: brak szablonu klienta → fallback domyślny + ostrzeżenie w biurze.
- Walidacja na **dokładnej zgodności SKU** (produkt + tuleja + waga nominalna z planu), bez
  pomiaru wagi przy pakowaniu — waga to wartość planowana SKU, więc porównanie jest dokładne.

## Testy
1. Generowanie sztuk z linii planu (20×40) → 20 rekordów, unikalne QR, status `planned`.
2. Lookup QR → poprawna karta + lineage do dostawcy.
3. Druk: 3 formaty (1/2 A4, 1/4 A5, Zebra) renderują N etykiet z poprawnym QR/partią/wagą.
4. Skan produkcyjny OK: skan sztuki `planned` → `produced`, `trolley_id` ustawiony, licznik 12/20.
5. Skan produkcyjny DUBEL: ponowny skan sztuki `produced` → czerwony „już zeskanowana", brak zliczenia.
6. Pakowanie OK: skan sztuki `produced` 40 kg do kartonu 40 kg → zielony, `packed_qty++`.
7. Pakowanie BŁĄD: skan 30 kg do kartonu 40 kg → czerwony, brak zliczenia.
8. Pakowanie BŁĄD: inny klient → czerwony.
9. Pakowanie BŁĄD: sztuka `planned` (nie zeskanowana na produkcji) → czerwony „nie potwierdzona na produkcji".
10. Podwójny skan przy pakowaniu → blokada „już spakowana".
11. Przekroczenie target_qty → blokada.
12. Karton pełny → status `full`, wpięcie w paletę (skan `PAL|...`).
13. „Na górkę": etykieta `STAN`, pakowanie do kartonu stanowego; przypisanie klienta przy wydaniu.
14. Wycofanie: po `batch_no` lista sztuk → kartony → palety → klienci.

## Otwarte punkty do ustalenia w planie
- Dokładne pola i wymiary 3 szablonów etykiet (do mockupów wizualnych w planie).
- Czy „na górkę" pakuje się od razu w kartony, czy luzem w mroźni do czasu sprzedaży.
- Sprzęt magazynu: skaner ręczny vs stacjonarny + ekran (potwierdzić przy planie).
