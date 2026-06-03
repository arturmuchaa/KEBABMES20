# Projekt (Część A): Pakowanie sztuki do palety po KLIENCIE, nie po zamówieniu

Data: 2026-06-03
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: [[2026-06-03-pakowanie-palet-identyfikowalnosc-design]] (rozszerza świeżo wdrożoną walidację)

## Kontekst i problem

W iteracji „pakowanie sztuk do palety" walidacja sprawdza:

```python
if (unit.get("order_id") or "") != (pallet_order_id or ""):
    return False, "Sztuka z innego zamówienia", None
```

To jest za ostre dla realnego przepływu produkcji. Przykłady użytkownika:

1. **Łączenie stanu z nową paletą.** 01.06 robimy 5×20 kg dla Zagros „na stan" (bez
   bieżącego zamówienia albo na starsze). Zamówienie przychodzi 10.06 — dorabiamy 35
   sztuk i pakujemy do jednej palety **35 nowych + 5 z 01.06** = karton 40 szt. Te 5
   sztuk ma inne (lub puste) `order_id` niż paleta z 10.06 → obecny kod **odrzuca** je
   jako „Sztuka z innego zamówienia".
2. **Produkcja na stan.** Część sztuk powstaje bez konkretnego zamówienia (klient
   `STAN`) i ma trafić do dowolnej palety pasującej SKU/klientowi.

Kebaby tego samego klienta i tego samego SKU (produkt + receptura + waga) są
**wymienne** — nie ma znaczenia, do którego zamówienia fizycznie trafią, dopóki zgadza
się klient i SKU.

### Stan zastany (istotny)

- `validate_pack_to_pallet(unit, pallet_order_id, planned_by_key, packed_by_key)`
  w `backend/app/utils/unit_codes.py` — sprawdza `order_id` (do zmiany).
- Stara walidacja kartonów `validate_pack` (ta sama plik) dopasowywała po **kliencie**
  z sentinelem `STAN`:
  ```python
  carton_client = (carton.get("client_name") or "")
  if carton_client and carton_client != "STAN" and (unit.get("client_name") or "") != carton_client:
      return False, "Inny klient niż w kartonie"
  ```
  Czyli dopasowanie po kliencie już istniało — dodając `order_id` zrobiliśmy je za ostre.
- `_pallet_pack_state(conn, pallet_id)` w `pallets_service.py` pobiera paletę, pozycje
  i sztuki; zwraca `(pallet, order_id, planned_by_key, packed_by_key)`. NIE pobiera
  klienta palety.
- `client_orders` ma kolumnę `client_name`. `order_pallets.order_id` → `client_orders.id`.
- `finished_units` ma `order_id`, `client_name`, `status`, `product_type_id`,
  `recipe_id`, `weight_kg`.
- Testy: `backend/tests/test_pack_to_pallet.py` (zawiera `test_different_order` —
  do zastąpienia).

## Cel

Pozwolić pakować do palety każdą sztukę `produced`, która pasuje **klientem + produkt
+ receptura + waga**, niezależnie od `order_id`, i przy spakowaniu **zaalokować** sztukę
do zamówienia palety.

## Poza zakresem (kolejne specy)

- **Część B:** model wydania zewnętrznego (palety i/lub sztuki luzem, pojazd, wiele
  klientów). [[wydanie-zewnetrzne]]
- **Część C:** dokumenty WZ / HDI / CMR. [[dokumenty-wydania]]
- Wydanie luzem (skan sztuk poza paletą) — należy do Części B.

## Architektura

### 1. Reguła klienta (zastępuje regułę zamówienia)

Sentinel klienta „na magazyn" = produkcja bez konkretnego klienta. Kanoniczna nazwa to
**`na magazyn`**; rozpoznajemy też pusty string oraz starą wartość `STAN` (dane
historyczne) — porównanie **bez rozróżniania wielkości liter**.

Sztuka pasuje do palety pod względem klienta, gdy zachodzi którykolwiek:

- sztuka jest „na magazyn" (`unit.client_name` ∈ zbiorze magazynowym) → **wildcard**,
  wchodzi do palety dowolnego klienta;
- paleta jest „na magazyn" (`pallet_client` ∈ zbiorze magazynowym) → przyjmuje dowolną
  sztukę;
- `unit.client_name == pallet_client` (po normalizacji wielkości liter/spacji).

W przeciwnym razie: błąd **„Inny klient niż na palecie"**.

Partia (`batch_no`) i `order_id` **NIE** są kryterium — różne partie i różne (lub puste)
zamówienia w obrębie palety są dozwolone.

### 2. Zmiana sygnatury czystej funkcji

`backend/app/utils/unit_codes.py`:

```python
def validate_pack_to_pallet(unit, pallet_client, planned_by_key, packed_by_key):
    ...
```

- Parametr `pallet_order_id` → `pallet_client` (string, nazwa klienta palety).
- Kolejność walidacji:
  1. `status != produced` → „Sztuka już spakowana" / „Sztuka nie potwierdzona na produkcji".
  2. **Reguła klienta** (sekcja 1) → „Inny klient niż na palecie".
  3. `key not in planned_by_key` → „Inny produkt/waga niż na palecie".
  4. pozycja pełna → „Pozycja palety pełna".
  5. OK → `(True, "", key)`.

Pomocniczo dodać predykat (porównanie po normalizacji: `strip().lower()`):
```python
# Kanoniczna nazwa magazynowa: "na magazyn". "STAN" — legacy. "" — brak klienta.
_STOCK_CLIENTS = {"", "na magazyn", "magazyn", "stan"}

def _is_stock(client) -> bool:
    return (client or "").strip().lower() in _STOCK_CLIENTS

def _client_matches(unit_client, pallet_client) -> bool:
    if _is_stock(unit_client) or _is_stock(pallet_client):
        return True
    return (unit_client or "").strip().lower() == (pallet_client or "").strip().lower()
```

### 3. Serwis: pobranie klienta palety + alokacja przy spakowaniu

`backend/app/services/pallets_service.py`:

- `_pallet_pack_state` dodatkowo pobiera klienta palety:
  ```python
  order = cx_query_one(conn,
      "SELECT client_name FROM client_orders WHERE id=%s", (order_id,))
  pallet_client = (order or {}).get("client_name") or ""
  ```
  i zwraca go w krotce: `(pallet, order_id, pallet_client, planned_by_key, packed_by_key)`.
- `pack_unit_into_pallet` woła `validate_pack_to_pallet(unit, pallet_client, ...)`.
- Przy sukcesie **alokuje** sztukę do zamówienia palety — rozszerzony UPDATE:
  ```python
  cx_execute(conn,
      "UPDATE finished_units SET status=%s, pallet_id=%s, order_id=%s, client_name=%s WHERE id=%s",
      (PACKED, pallet_id, order_id, pallet_client, unit_id))
  ```
  Dzięki temu sztuka „na stan"/ze starego zamówienia zostaje poprawnie przypisana do
  bieżącego zamówienia (spójność wysyłki/raportów/HDI).

### 4. Brak zmian w API/froncie

Endpoint `POST /api/pallets/{id}/pack` i mobilny przepływ bez zmian — zmienia się tylko
logika dopasowania po stronie serwera. Komunikat błędu „Sztuka z innego zamówienia"
znika, pojawia się „Inny klient niż na palecie" (gdy realnie inny klient).

## Obsługa błędów

| Sytuacja | Komunikat |
|---|---|
| status `planned` | „Sztuka nie potwierdzona na produkcji" |
| status `packed` | „Sztuka już spakowana" |
| inny realny klient (nie STAN) | **„Inny klient niż na palecie"** |
| niezgodny produkt/waga | „Inny produkt/waga niż na palecie" |
| pozycja pełna | „Pozycja palety pełna" |

(Sztuka na stan `STAN`/pusty klient oraz sztuka tego samego klienta — przechodzą.)

## Testy

Aktualizacja `backend/tests/test_pack_to_pallet.py`:

- **Usunąć/zastąpić** `test_different_order` (kryterium `order_id` znika).
- Pomocnik `_unit` zyskuje pole `client` (domyślnie np. `"Zagros"`).
- Nowe/zmienione testy walidacji (czysta funkcja, sygnatura `pallet_client`):
  - `test_same_client_ok` — klient sztuki == klient palety → OK.
  - `test_stock_unit_wildcard_ok` — `unit.client_name == "na magazyn"` (oraz `""` i legacy
    `"STAN"`) do palety „Zagros" → OK.
  - `test_stock_pallet_accepts_any` — `pallet_client == "na magazyn"`, sztuka „Zagros" → OK.
  - `test_client_match_case_insensitive` — `"Zagros"` vs `"zagros "` → OK (normalizacja).
  - `test_different_client_rejected` — sztuka „Kowalski" do palety „Zagros" → błąd,
    „klient" w reason.
  - Zachować: `test_not_produced`, `test_already_packed`, `test_wrong_product_or_weight`,
    `test_position_full`, `test_different_batches_allowed`, `test_pallet_line_key_rounds_weight`.
  - `test_combine_stock_and_fresh` — dwie sztuki: jedna `client="Zagros"` z `order_id="O_old"`,
    druga `client="STAN"` bez order_id; obie do palety klienta „Zagros" → obie OK (to jest
    główny scenariusz użytkownika 35 nowych + 5 ze stanu).

Walidacja jest czysta, więc testy nie dotykają DB. Alokację (`order_id`/`client_name`
na sztuce po spakowaniu) opisujemy w planie jako krok serwisowy zweryfikowany w ręcznym
e2e (brak harnessu DB w testach jednostkowych tego repo dla warstwy serwisowej palet).

## Migracja / sprzątanie

Brak zmian schematu. Tylko logika + testy.

## Otwarte kwestie

- Rozstrzygnięte: sentinel magazynowy to **„na magazyn"** (kanoniczny), z rozpoznaniem
  pustego stringa oraz legacy `STAN`/`MAGAZYN`, bez rozróżniania wielkości liter.
  Zbiór w stałej `_STOCK_CLIENTS`, łatwo rozszerzalny.
