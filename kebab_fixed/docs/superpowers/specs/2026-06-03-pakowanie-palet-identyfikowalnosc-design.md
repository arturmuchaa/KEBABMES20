# Projekt: Paleta jako jedyne pudełko — pakowanie sztuk skanem + identyfikowalność partii

Data: 2026-06-03
Status: zatwierdzony (oczekuje na plan implementacji)

## Kontekst i problem

Produkcja kebaba: pracownik dodaje sztuki w panelu produkcji i potwierdza je
(status `produced`). Następnego dnia biuro przygotowuje wydanie dla zamówienia
klienta (np. „20 × 40 kg"). Magazynier pakuje gotowe sztuki do pudełka (paleta =
jeden wielki karton) i skanuje QR każdej sztuki. **Zeskanowanie niewłaściwej
sztuki musi dać błąd.** Później skład palety jest potrzebny do dokumentu HDI
(handlowy dokument identyfikacyjny) — z rozbiciem na numery partii.

### Stan zastany (co już istnieje)

W systemie istnieją **dwa równoległe podsystemy „pudełek"**:

1. **Palety wydania** (`order_pallets`, `PalletsEditor`, `PalletLabelPrintPage`):
   - Biuro układa paletę z pozycji linii zamówienia, numeracja 1..N per zamówienie.
   - Etykieta z QR: token `PAL|<order_id>|<pallet_no>` / URL `/m/p/<order_id>/<pallet_no>`.
   - Skan palety zmienia status: `created → cold_storage → loaded` (skan CAŁEJ palety
     na checkpointach mroźni/załadunku przez `POST /api/pallets/scan`).
   - Powiązane z zamówieniem. **To jest biurowy „kreator pudełka z QR".**

2. **Kartony** (`cartons`, `cartons_service`, `MobilePakowaniePage`, `validate_pack`):
   - Operator **ręcznie** zakłada karton na telefonie (produkt, receptura, klient,
     ilość, waga).
   - Skanuje QR sztuk (`U|<id>`); `validate_pack` odrzuca błędną sztukę.
   - Brak powiązania z zamówieniem, brak druku etykiety.

Pola `finished_units` (już istnieją): `id`, `qr_code`, `plan_line_id`, `order_id`,
`client_name`, `product_type_id`, `recipe_id`, `tuleja`, `weight_kg`, `batch_no`,
`produced_date`, `status`, `carton_id`. Statusy sztuki: `planned → produced →
packed → shipped`.

### Decyzja

Dla użytkownika **paleta i karton to to samo** (1 paleta = 1 wielki karton, np.
20×40 kg lub 30×30 kg). **Ujednolicamy na palecie; byt „karton" znika.** Pakowanie
sztuk skanem podpinamy pod istniejącą paletę, a ręczne tworzenie kartonu na mobile
wyłączamy.

## Cel

1. Biuro tworzy pudełko (paletę) z zamówienia, jak dziś (`PalletsEditor`), i drukuje
   etykietę palety z QR.
2. Magazynier skanuje QR palety → skanuje sztuki do niej → walidacja odrzuca
   niewłaściwą sztukę. Magazynier **nie tworzy** pudełek.
3. System rejestruje, które **numery partii** trafiły do palety (do HDI).

## Poza zakresem (następny etap)

- Generowanie samego dokumentu HDI (PDF/wydruk). W tej iteracji dostarczamy tylko
  warstwę danych + endpoint składu partii, żeby HDI dało się dodać później.

## Architektura

### 1. Model danych

- **`order_pallets` = jedyne pudełko.** Zostaje głównym obiektem (już ma: `order_id`,
  `pallet_no`, pozycje `order_pallet_items[order_line_id, qty]`, `status`, QR).
- **`finished_units`**: dodać kolumnę `pallet_id TEXT` (przejmuje rolę `carton_id`).
  Indeks `idx_finished_units_pallet ON finished_units(pallet_id) WHERE pallet_id IS NOT NULL`.
- **`order_pallets.status`**: rozszerzyć cykl o fazę pakowania:
  `created → packing → packed → cold_storage → loaded`.
  - `packing` — rozpoczęto skanowanie sztuk (≥1 sztuka spakowana, niekomplet).
  - `packed` — komplet sztuk wszystkich pozycji palety zeskanowany.
  - Dotychczasowy `created → cold_storage` przejście (`pallets_service._TRANSITIONS`)
    zmienić tak, by `cold_storage` startował z `packed` (nie z `created`).
- **Wygaszenie kartonów**: `cartons`, `cartons_service`, route `cartons`, `cartonsApi`,
  `MobilePakowaniePage` (formularz tworzenia) — usunąć po weryfikacji że tabela
  `cartons` jest pusta w produkcji. Jeśli niepusta: pozostawić tabelę read-only,
  usunąć tylko ścieżki tworzenia/UI. `validate_pack` + jego testy → przenieść logikę
  do walidacji pakowania do palety (sekcja 2), nie usuwać bezpowrotnie.

### 2. Walidacja pakowania sztuki do palety

Nowy endpoint: `POST /api/pallets/{pallet_id}/pack` body `{ "code": "<qr>" }`.
Logika (port `validate_pack`, oparta o pozycje palety zamiast pojedynczego kartonu),
w transakcji z `FOR UPDATE` na palecie i sztuce:

1. Rozpoznaj `unit_id` z kodu (`parse_unit_qr`); brak → 400 „Nieprawidłowy kod QR sztuki".
2. Sztuka istnieje → inaczej 404 „Sztuka nie znaleziona".
3. `unit.status == 'produced'`:
   - `planned` → „Sztuka nie potwierdzona na produkcji".
   - `packed` → „Sztuka już spakowana".
4. `unit.order_id == pallet.order_id` → inaczej „Sztuka z innego zamówienia".
5. Sztuka pasuje do którejś **pozycji palety** po (`product_type_id`, `recipe_id`,
   `weight_kg`) — porównanie sztuki z linią zamówienia tej pozycji → inaczej
   „Inny produkt/waga niż na palecie".
   - Mapowanie sztuka→linia: po `order_id` + atrybuty produktu (`product_type_id`,
     `recipe_id`, `weight_kg`/`kg_per_unit`). Przy wielu pasujących liniach wybrać
     pozycję z wolnym miejscem.
6. Wybrana pozycja ma wolne miejsce (spakowane sztuki tej pozycji < `qty` pozycji)
   → inaczej „Pozycja palety pełna".
7. **Partia NIE jest kryterium** — różne `batch_no` w obrębie palety są dozwolone.
8. OK: `UPDATE finished_units SET status='packed', pallet_id=…`; przelicz licznik;
   gdy wszystkie pozycje skompletowane → `order_pallets.status='packed'`, inaczej
   `'packing'`.

Odpowiedź (sukces i błąd) w stylu `CartonScanResult`:
`{ ok, reason, packedQty, targetQty, palletStatus }` + na żywo skład partii
(sekcja 4). Klient: `beepOk`/`beepErr` + wibracja jak w obecnym `MobilePakowaniePage`.

### 3. Biuro — prawie bez zmian

- `PalletsEditor` (układanie palety z linii zamówienia) = „tworzenie pudełka". Zostaje.
- Etykieta palety z QR (`PalletLabelPrintPage`) = etykieta na karton. Zostaje
  (z poprawkami QR z wcześniejszej iteracji: quiet zone + ECC).
- Dodatek: w `PalletsEditor` / szczegółach palety pokazać postęp pakowania
  „12/20 szt zapakowane" oraz skład partii (sekcja 4).

### 4. Identyfikowalność partii (dane do HDI)

Skład partii palety jest **wyliczalny** z `finished_units` — nie wymaga osobnego
zapisu, bo `batch_no` jest na sztuce od produkcji:

```sql
SELECT batch_no, COUNT(*) AS szt, SUM(weight_kg) AS kg
FROM finished_units
WHERE pallet_id = %s
GROUP BY batch_no
ORDER BY batch_no;
```

Endpoint: `GET /api/pallets/{pallet_id}/batch-breakdown` →
`[{ batchNo, qty, weightKg }, …]`. Konsumenci:
- **mobile** — na żywo podczas skanowania (np. „partia 030626333: 15, 030626334: 5");
- **biuro** — szczegóły palety;
- **przyszły dokument HDI** — źródło danych (poza zakresem tej iteracji).

### 5. Mobile — magazynier

- **Usunąć** formularz tworzenia kartonu z `MobilePakowaniePage`.
- Nowy przepływ (ekran „Pakowanie palet"):
  1. Magazynier **skanuje QR palety** (`PAL|...` lub URL `/m/p/...`) — reuse
     `pallets_service.parse_code`. Otwiera paletę: zamówienie, klient, pozycje,
     postęp X/Y, skład partii.
  2. Skanuje sztuki → walidacja (sekcja 2): licznik rośnie, błąd = czerwony + beep.
  3. Komplet → „Paleta zapakowana".
- **Lista palet do spakowania** (status `created`/`packing`) — magazynier widzi
  „jakie kartony są" i może wybrać z listy zamiast skanować QR.

### 6. Istniejące skanowanie palet (mroźnia/załadunek) — zostaje

Po `packed` paleta wchodzi w `cold_storage → loaded` przez obecny
`POST /api/pallets/scan`. Pakowanie sztuk to wcześniejsza faza tego samego cyklu
życia palety; checkpointy mroźni/załadunku bez zmian (poza startem `cold_storage`
z `packed` zamiast `created`).

## Obsługa błędów

| Sytuacja | Komunikat |
|---|---|
| zły/pusty kod QR sztuki | „Nieprawidłowy kod QR sztuki" |
| sztuka nieznaleziona | „Sztuka nie znaleziona" |
| status `planned` | „Sztuka nie potwierdzona na produkcji" |
| status `packed` | „Sztuka już spakowana" |
| inne zamówienie | „Sztuka z innego zamówienia" |
| niezgodny produkt/waga | „Inny produkt/waga niż na palecie" |
| pozycja pełna | „Pozycja palety pełna" |

Wszystkie błędy walidacji zwracane jako `{ ok: false, reason }` (HTTP 200, tak jak
obecny `scan_into_carton`), błędy strukturalne (zła paleta) jako HTTP 4xx.

## Testy

Port testów `test_unit_codes.py::test_validate_pack_*` na walidację pakowania do
palety:
- OK (sztuka pasuje, jest miejsce),
- zła waga / zły produkt,
- inne zamówienie,
- sztuka nie `produced`,
- sztuka już `packed`,
- pozycja palety pełna,
- **różne partie dozwolone** (nowy test: dwie sztuki różnych `batch_no` do tej samej
  pozycji → obie OK),
- `batch-breakdown` zwraca poprawne rozbicie (15/5 z przykładu).

## Migracja / sprzątanie

1. Migracja DB: `ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS pallet_id TEXT`
   + indeks. Status palety — bez zmiany schematu (kolumna `status TEXT` już jest),
   tylko nowe wartości.
2. Zweryfikować `SELECT count(*) FROM cartons` w produkcji (na starcie implementacji).
   Pusto → usunąć tabelę + kod kartonów. Niepusto → tabela read-only, usunąć ścieżki
   tworzenia/UI.
3. Usunąć mobilny formularz tworzenia kartonu; podmienić na pakowanie palet.

## Otwarte kwestie do rozstrzygnięcia w planie

- Czy `pallet_id` ma zostać obok `carton_id` (dla danych historycznych), czy migrować
  `carton_id → pallet_id`. Zależy od wyniku weryfikacji `cartons` (krok migracji 2).
- Dokładne mapowanie sztuka→pozycja palety, gdy paleta miesza kilka linii zamówienia
  o identycznych atrybutach produktu (mało prawdopodobne; wybór pozycji z wolnym
  miejscem rozwiązuje większość przypadków).
