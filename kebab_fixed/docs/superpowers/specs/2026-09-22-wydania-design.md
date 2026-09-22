# Wydania — ślad skanowania, WZ zbiorczy dla klienta, nazwy ekranów, waluta

**Data:** 2026-09-22
**Status:** do przeczytania przed planem wdrożenia
**Poprzedza:** naprawa regresji `loading_status` (commit `832be2e`, już zrobiona)

---

## 1. Po co to robimy

Cztery zgłoszenia właściciela z 21–22.09.2026, wszystkie w jednym obszarze —
dokumenty wydania. Robimy je **razem, nie osobno**, bo wszystkie cztery
dotykają tej samej strony (`WzDocumentsPage`) i tego samego dokumentu.
Osobno znaczyłoby trzykrotne przerabianie tego samego ekranu.

| # | zgłoszenie |
|---|---|
| A | „chciałbym prześledzić etapy skanowania, czy gdzieś sztuka nie zginęła" |
| B | „na WZ dla klienta ogólna nazwa, a nie każda sztuka; na WM już każda sztuka" |
| C | „zmień Dokumenty WZ na Wydania magazynowe i dodaj Wydania zewnętrzne" |
| D | „uzupełnij ceny — nie mam możliwości zmienić już wtedy na euro" |

## 2. Co sprawdziłem w kodzie (fakty, nie założenia)

| ustalenie | dowód |
|---|---|
| `pallet_scans` zapisuje KAŻDY skan (`action`, `scanned_at`, `operator`, `vehicle_id`) | `migrations.py:78`, `:294` |
| **Nikt tej tabeli nie czyta** — zero `SELECT` w całym backendzie | przeszukanie `services/` i `routes/` |
| Nazwa pozycji per odbiorca JUŻ działa na WZ | `build_goods_wz_lines` woła `hdi_product_base` (`wz_service.py:407`) |
| Linie WZ klienta powstają z **pozycji zamówienia**, nie z partii | `wystaw_wz_klienta` → `build_wz_lines(_pozycje_niefakturowane(...))` |
| Linie WM powstają **per partia** i muszą takie zostać | `build_goods_wz_lines` — `recipe_id` i `batch_no` są kluczem weryfikacji |
| `update_wz_prices(wz_id, prices)` **nie przyjmuje waluty** | `wz_service.py:1085` |
| Edycja cen na ekranie już istnieje | `WzDocumentsPage` — `editMode: 'prices' \| 'full'` |

## 3. §A — Ślad skanowania

**To jest w 90% pokazanie tego, co już zbieramy.** Historia jest kompletna
wstecz, od pierwszego dnia działania skanera — po prostu nikt jej nigdy nie
odczytał.

**Nowa trasa:** `GET /api/pallets/{order_id}/slad-skanowania` — zwraca dla
każdej palety zamówienia listę zdarzeń w kolejności czasu:

```
Paleta P3   (620 kg · 24 szt)
  09:14  mroźnia           VLAD M.
  11:02  auto SOLÓWKA      VLAD M.
  11:07  COFNIĘTO          VLAD M.      ← ślad pomyłki zostaje
  11:09  auto SOLÓWKA      VLAD M.
  13:40  wydane            —            (finalize_loading)
```

**Gdzie to mieszka:** rozwijany panel pod dokumentem na liście wydań, w tym
samym miejscu co dzisiejszy rozjazd (`WzDocumentsPage` ma już taki panel dla
`loading_status === 'rozjazd'`). Kto szuka zgubionej sztuki, ten patrzy na
dokument — nie chcemy piątego ekranu.

**Co to odpowiada na pytanie „czy sztuka nie zginęła":** paleta, która ma
skan do mroźni i nie ma skanu na auto, stoi w chłodni. Paleta ze skanem
cofnięcia i bez ponownego skanu — została zdjęta i nikt jej nie wrócił.
Dziś obie sytuacje są niewidoczne.

**Świadomie NIE robimy** śladu per sztuka. `finished_units` nosi status
i `pallet_id`, ale skan w hali jest **skanem PALETY** — sztuk nikt nie
skanuje przy załadunku ([[kebab-zaladunek-skan-kartonu]]). Ślad per sztuka
udawałby dokładność, której w danych nie ma.

## 4. §B — WZ dla klienta zbiorczo, WM per partia

**Decyzja właściciela 22.09.2026:** grupujemy po **rodzaju + recepturze** —
to jest wasza pozycja cennikowa („kebab z kurczaka ma inną cenę niż yaprak") —
a nazwę bierzemy z **reguły, która już istnieje** (`hdi_product_base` + `mode`
z kartoteki odbiorcy: `type_recipe` / `type` / `recipe`).

```
WZ DLA KLIENTA (YALCIN)
Lp  Nazwa                    Ilość      Cena    Wartość
 1  KEBAB UDO KIRMIZI       420,0 kg   12,50   5 250,00
 2  KEBAB MIX YAPRAK        250,0 kg   13,80   3 450,00
                                    RAZEM:   8 700,00
```

**Dlaczego nie „zawsze KEBAB MROŻONY":** przy dwóch pozycjach cennikowych
klient zobaczyłby dwie linie o identycznej nazwie i różnej cenie. Odrzucone
przez właściciela na rzecz wariantu wyżej.

**Dlaczego grupujemy po cenniku, a nie po cenie:** ceny uzupełnia się **po**
wystawieniu dokumentu (§D), więc w chwili składania linii cen jeszcze nie ma.
Podział musi wynikać z czegoś, co wtedy już wiadomo.

**Co się scala:** pozycje różniące się wyłącznie **gramaturą i tuleją**
(dziś osobne linie zamówienia) wchodzą w jedną linię z sumą kilogramów.

**WM zostaje BEZ ZMIAN — per partia. To nie jest przeoczenie, tylko warunek
poprawności:** `verify_wz_against_loaded` porównuje dokument z zawartością
auta po kluczu (receptura, waga sztuki, **partia**). Zbiorcza linia ten klucz
niszczy i każdy poprawny załadunek wychodziłby jako rozjazd — ta klasa błędu
kosztowała już rundę poprawek (`build_goods_wz_lines`, review C1,
2026-09-11). Na szczęście życzenie właściciela i warunek techniczny mówią to
samo: *„na WM już każda sztuka"*.

## 5. §C — Nazwy i podział ekranów

**JEDNA strona z dwiema zakładkami, nie dwa ekrany** (decyzja właściciela
22.09.2026, po przedstawieniu obu wariantów).

```
WYDANIA                       (menu: dziś „Dokumenty WZ")
┌──────────────────┬──────────────────┐
│ ZEWNĘTRZNE (WZ)  │ MAGAZYNOWE (WM)  │
└──────────────────┴──────────────────┘
  ▲ domyślna
```

| zakładka | zawiera | kolumny |
|---|---|---|
| **Zewnętrzne** (pierwsza, domyślna) | WZ dla klientów + ręczne WZ | numer · klient · data · kg · wartość · **waluta** · „uzupełnij ceny" |
| **Magazynowe** | dokumenty WM | numer · klient · data · kg · **POTWIERDZONY / ROZJAZD** · **ślad skanowania** |

Podział po `doc_series` (`'WZ'` vs `'WM'`) — jedyne pole, które te dwa byty
rozróżnia bez zgadywania. Ręczne WZ (bez zamówienia) idą na **Zewnętrzne**:
są papierem dla kontrahenta, nie wydaniem wewnętrznym.

**Zewnętrzne jako pierwsza i domyślna** — to papier, który biuro dotyka
najczęściej (ceny, wydruk dla kierowcy).

**Dlaczego zakładki, a nie dwa ekrany** (rozważone i odrzucone):

1. **Jedno zamówienie rodzi OBA dokumenty** — przy podziale na fakturę
   powstaje WM na całość i WZ klienta na część niefakturowaną. Dwa ekrany
   znaczyłyby skakanie, żeby zobaczyć jedną wysyłkę.
2. **Biuro szuka po kliencie i dacie, nie po rodzaju dokumentu.** Wybór
   ekranu wymagałby wiedzy, której szukający zwykle nie ma.
3. Pasek boczny biura jest już długi.

Dwa osobne ekrany byłyby lepsze, gdyby to były roboty **dwóch różnych osób**
(jedna prowadzi rozchód magazynu, druga papiery kontrahentów). W tym zakładzie
robi to jedna osoba — stąd zakładki.

**Znacznik potwierdzenia i ślad skanowania siedzą przy WM**, bo to on opisuje
faktyczny załadunek. **Ceny i waluta przy WZ**, bo to on idzie do kontrahenta.

## 6. §D — Ceny i waluta

**Ceny działają.** `update_wz_prices` + `editMode: 'prices'` uzupełniają je
na wystawionym dokumencie. To nie jest zepsute.

**Waluty nie da się ruszyć** — `update_wz_prices(wz_id, prices)` nie ma jej
w sygnaturze, a `currency` jest parametrem **wyłącznie przy tworzeniu**
(`wz_service.py:594`, `:815`). Dokument wystawiony z kursu dostaje domyślne
`PLN` i zostaje z nim na zawsze. Stąd: *„nie mam możliwości zmienić już wtedy
na euro"*.

**Zmiana:** `update_wz_prices(wz_id, prices, currency=None, eur_rate=None)` —
gdy waluta podana, nadpisuje ją na dokumencie razem z cenami. Na ekranie
edycji cen dochodzi przełącznik **PLN / EUR**, a przy EUR pole kursu.

**Kurs NBP:** `fx_service` istnieje. Przy wyborze EUR podpowiadamy kurs
średni NBP z dnia wystawienia, z możliwością nadpisania — tak samo jak przy
tworzeniu dokumentu, żeby nie było dwóch różnych reguł na tę samą liczbę.

**Bramka zostaje:** WZ o statusie `potwierdzony` dalej odmawia zmiany cen
(409). Waluta nie może być furtką do edycji zamkniętego dokumentu.

## 7. Kolejność prac

1. **§C nazwy i podział ekranów** — najpierw, bo §A i §D dokładają elementy
   do tych ekranów. Odwrotna kolejność znaczy przerabianie ich dwa razy.
2. **§D waluta** — najmniejsza zmiana, jeden parametr i przełącznik.
3. **§A ślad skanowania** — nowa trasa (tylko odczyt) + panel.
4. **§B WZ zbiorczy** — na końcu, bo dotyka treści papieru idącego do
   kontrahenta; chcę mieć resztę stabilną, zanim ruszę dokument.

## 8. Czego to nie załatwia

- **Ślad nie sięga sztuk** — skan w hali jest skanem palety (§3).
- **Nie ruszamy dokumentów już wystawionych.** Zbiorcze linie dotyczą WZ
  wystawianych OD WDROŻENIA; stare zostają, jakie były. Przepisywanie
  wystawionego papieru kontrahenta byłoby zmianą dokumentu po fakcie.
- **Nie dodajemy cennika per klient.** Ceny dalej wpisuje biuro ręcznie;
  grupowanie po pozycji cennikowej tylko im to ułatwia.
- **Waluta nie przelicza wstecz.** Zmiana PLN→EUR na dokumencie z cenami
  podmienia walutę i kurs, ale **nie przelicza wpisanych kwot** — biuro
  wpisuje ceny w docelowej walucie. Automatyczne przeliczanie cen
  kontrahenta byłoby zgadywaniem.
