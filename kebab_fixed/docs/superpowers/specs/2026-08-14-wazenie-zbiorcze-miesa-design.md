# Ważenie zbiorcze mięsa — równe palety i wózki dla masowni

Data: 2026-08-14
Ekran: kiosk rozbioru (HMI v10), nowy przycisk „Ważenie zbiorcze"
Backend: nowy `app/services/meat_pallets_service.py`, `app/routes/meat_pallets.py`

## Problem

Po rozbiorze mięso trafia do masowni w tym, co akurat stoi pod ręką: pięciu
ludzi odda po 100 kg, ktoś inny 40 kg, i na palecie ląduje nierówna zbieranina.
Operator masowania nie wie, ile na niej jest ani z jakich partii — musi ważyć
po raz drugi u siebie albo zgadywać.

Hala rozwiązuje to fizycznie: buduje **równe palety i wózki** (100, 200, 400,
600, 800 kg). Brakuje tylko dwóch rzeczy: kontroli, czy słupek naprawdę ma
100 kg, i **etykiety mówiącej, co na tej palecie leży**.

To NIE jest ruch magazynowy. Mięso już jest na stanie od chwili rozbioru —
ważenie zbiorcze tylko opisuje, jak zostało ułożone.

## Rozwiązanie

Nowy ekran w kiosku prowadzi operatora przez kompletowanie jednej palety albo
wózka, pilnuje wagi z tolerancją, sam proponuje skład partii wg FEFO i na
koniec drukuje etykietę. Skład zapisujemy — bez ruchów magazynowych.

## Kafelki celu

Kafelek niesie **cel łączny** i opcjonalnie **cel słupka**. Gdzie cel słupka
istnieje, ekran prowadzi słupek po słupku; gdzie go nie ma, operator dokłada
swobodnie aż do celu łącznego.

| kafelek | cel łączny | cel słupka | typowy nośnik |
|---|---|---|---|
| 100 kg | 100 | 100 (1 ważenie) | wózek |
| 200 kg | 200 | 200 (1 ważenie) | wózek |
| 400 kg | 400 | 100 (4 słupki) | paleta H1 |
| 600 kg | 600 | — (dowolne dokładki) | paleta H1 |
| 800 kg | 800 | 200 (4 słupki) | paleta H1 |

**Tolerancja ±0,5 kg** — na celu słupka tam, gdzie jest, i zawsze na celu
łącznym. W tolerancji przycisk zatwierdzenia robi się zielony; poza nią jest
aktywny, ale ostrzega (hala ma rację nad normą — to ważenie, nie wróżenie).

## Przepływ na ekranie

1. **Cel** — pięć kafelków jak wyżej.
2. **Nośnik** — paleta H1 (18 kg) i wszystkie wózki z ustawień firmy; ta sama
   lista i te same tary co przy rozbiorze i ubocznych (`byproductTareOptions`).
3. **Słupek** — waga na żywo, licznik „do celu brakuje 12,5 kg", pole liczby
   pojemników. Netto = brutto − tara nośnika − pojemniki × 2 kg (E2_TARE_KG).
   Nośnik odejmujemy TYLKO przy pierwszym słupku: potem paleta zostaje na
   wadze, a operator ją taruje.
4. **Kolejny słupek** — pasek „słupek 2 z 4" i suma dotychczasowa. Przy
   kafelku bez celu słupka pasek pokazuje samą sumę i ile brakuje.
5. **Skład partii** — ekran podsumowania z propozycją FEFO do zatwierdzenia.
6. **Zapis + druk** — jedna etykieta na paletę.

## Skład partii

Pula to loty mięsa z wolnymi kilogramami (`meatStockApi.list()`, sortowanie
`expiry_date ASC, lot_no ASC` — czyli od najstarszej partii). Propozycja:
bierz z najstarszego lotu, ile w nim jest, resztę z kolejnego.

    600 kg → 420 kg z partii 475 (tyle zostało) + 180 kg z 476

Operator może każdą pozycję podmienić albo poprawić kilogramy — fizycznie
mogło pójść inaczej (ktoś przywiózł nowszą partię w środku serii). Suma składu
musi się zgadzać z wagą palety; rozbieżność blokuje zapis.

Gdy w puli jest mniej mięsa, niż waży paleta (loty niedoszacowane albo część
rozbioru jeszcze niezapisana), propozycja pokrywa tyle, ile się da, a resztę
zostawia w wierszu „do przypisania" — zapis wymaga wtedy ręcznego wskazania
partii. Cicha podmiana na „ostatni lot" byłaby zgadywaniem w miejscu, gdzie
zgadywanie kosztuje identyfikowalność.

Propozycja jest **wyliczana, nie rezerwowana** — nie ruszamy `kg_reserved`,
bo to nie jest wydanie mięsa. Dwie palety kompletowane równolegle mogą
teoretycznie wskazać ten sam lot; to świadoma cena za brak ruchów.

## Zapis

Dwie tabele, żadnych `stock_movements`:

```sql
CREATE TABLE meat_pallets (
  id            TEXT PRIMARY KEY,
  pallet_no     TEXT UNIQUE NOT NULL,   -- PAL/14/08/26/3
  target_kg     NUMERIC NOT NULL,       -- cel z kafelka
  stack_kg      NUMERIC,                -- cel słupka albo NULL
  kg_net        NUMERIC NOT NULL,       -- zważone łącznie
  containers    INTEGER NOT NULL,
  carrier_label TEXT NOT NULL,          -- „H1" / „wózek 6,5"
  carrier_kg    NUMERIC NOT NULL,
  operator      TEXT,
  production_date DATE NOT NULL,        -- dzień produkcyjny (getProductionDate)
  expiry_date   DATE,                   -- najkrótszy termin ze składu
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE meat_pallet_lots (
  id         TEXT PRIMARY KEY,
  pallet_id  TEXT NOT NULL REFERENCES meat_pallets(id) ON DELETE CASCADE,
  lot_no     TEXT NOT NULL,             -- numer partii mięsa (meat_stock.lot_no)
  kg         NUMERIC NOT NULL,
  seq        INTEGER NOT NULL
);
```

Numer palety: sekwencja dzienna, wzór jak sesje rozbioru (`ROZ/14/08/26/3`),
czyli `PAL/14/08/26/3`.

Słupków osobno nie zapisujemy — do masowni jedzie paleta jako całość, a suma
i liczba pojemników wystarczają do kontroli przy odbiorze.

## Etykieta 50×80 mm

Ten sam most co uboczne (Zebra BrowserPrint), nowy moduł
`meatPalletLabelZpl.ts`:

```
MIĘSO                       ← frakcja
PAL/14/08/26/3              ← numer palety
[QR: PAL/14/08/26/3]
──────────────
600,0 kg · 30 pojemników
──────────────
Partie:
475 — 420,0 kg
476 — 180,0 kg
──────────────
Prod. 14.08.2026
Ważn. 19.08.2026
```

Skład drukujemy do **czterech** partii; przy większej liczbie ostatni wiersz
to „+ N kolejnych" i pełny skład zostaje w bazie pod numerem palety. Cztery,
bo tyle mieści się na 80 mm wysokości przy czytelnym foncie.

QR niesie numer palety — masownia zeskanuje go, gdy powstanie tam ekran
odbioru (poza zakresem).

## Testy

Czysta logika (vitest):
- podział FEFO: jeden lot pokrywa cel; dwa loty; lot z resztą 0,5 kg;
  za mało mięsa w puli → propozycja niepełna z ostrzeżeniem,
- tolerancja: 100,4 kg w normie, 100,6 poza; suma słupków kontra cel łączny,
- netto słupka: tara nośnika tylko przy pierwszym, pojemniki przy każdym,
- ZPL: numer palety, QR, skład do 4 partii, „+ N kolejnych" przy piątej,
  szerokość wierszy mieszcząca się w taśmie (jak w etykiecie ubocznych).

Backend (pytest, baza testowa):
- zapis palety ze składem; `pallet_no` rośnie w obrębie dnia,
- suma składu ≠ waga palety → 400 i nic nie zapisane,
- **żadnych `stock_movements`** po zapisie palety (regresja: to ma NIE ruszać
  stanu),
- dodruk: `GET /api/meat-pallets/{no}` zwraca skład do ponownego wydruku.

## Poza zakresem

- Ekran odbioru na masowni (skanowanie QR) — osobna robota.
- Rozbijanie palety z powrotem i korekta składu po zapisie.
- Jakiekolwiek ruchy magazynowe, rezerwacje i wpływ na plan masowania.
