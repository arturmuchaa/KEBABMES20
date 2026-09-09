# Podział wysyłki na fakturę i WZ — projekt

**Data:** 2026-09-09
**Zamawiający:** właściciel (biuro)
**Stan:** do akceptacji przed implementacją

## Problem

Biuro (2026-09-09, na przykładzie YALCIN/Z/4/09/26 — 13 005 kg):

> „oni na fakturę chcą przeważnie ok. 8000 kg, a resztę na WZ, a ja aktualnie
> CMR i wszystko system wystawia na całość"

Klient chce część dostawy na fakturę, resztę na dokument WZ. System zna tylko
całość, więc biuro nie ma jak wystawić kompletu papierów i robi je poza MES-em.

Do tego kierowca bywa nocny — **dokumenty muszą dać się przygotować wcześniej**,
zanim ktokolwiek zamknie załadunek.

## Czego potrzebuje biuro

Dla jednej wysyłki 13 005 kg przy podziale 8000 / 5005:

| Dokument | Ilość | Odbiorca | Rusza magazyn |
|---|---|---|---|
| WZ wewnętrzny (nowa seria `WM`) | 13 005 kg | biuro | **TAK — jedyny** |
| WZ dla klienta (seria `WZ`) | 5 010 kg | klient | nie |
| CMR „na drogę" | 13 005 kg | kierowca | — |
| CMR pod fakturę | 7 995 kg | do FV | — |
| HDI na całość — **zawsze** | 13 005 kg | odbiorca | — |
| HDI do faktury — **opcjonalny** | 7 995 kg | do FV | — |

Faktura powstaje w Subiekcie — MES jej nie wystawia i nie będzie.

## Decyzje właściciela (2026-09-09)

1. **Podział równomierny po WSZYSTKICH pozycjach.** Nie wybieranie, które
   pozycje jadą na FV: „chcę, aby wszystkie pozycje były, ale mniej".
   Przy 50/50 całe zamówienie idzie na pół.
2. **WZ na całość jest wewnętrzny** — klient go nie dostaje.
3. **Osobna seria wewnętrzna** dla tego WZ (nie mieszamy z serią WZ, która
   wychodzi do klientów).
4. **HDI na całość ZAWSZE, HDI do faktury OPCJONALNIE.** Do części na WZ nie
   wystawia się HDI w ogóle: „tylko HDI i na całość i HDI drugie do faktury,
   do WZ nie".
5. **Podział wpisywany na zamówieniu**, kiedykolwiek przed wyjazdem.

## Algorytm podziału

Cel: rozdzielić sztuki tak, by suma kilogramów części fakturowanej była jak
najbliżej podanej liczby, a KAŻDA pozycja była obecna po obu stronach.

```
udział = cel_kg / kg_całości
dla każdej pozycji:  na_FV = floor(qty × udział)          # sztuki całkowite
potem, malejąco po reszcie z zaokrąglenia:
    dodaj 1 szt, jeśli zbliża sumę kg do celu
```

Sztuk nie da się dzielić, więc **wynik nigdy nie trafi co do kilograma** —
biuro widzi wyliczony podział i zatwierdza albo poprawia pojedynczą pozycję.

Sprawdzone na YALCIN/Z/4/09/26 (21 pozycji, 486 szt, 13 005 kg):

| Cel | Wynik FV | Wynik WZ | Odchyłka |
|---|---|---|---|
| 8000 kg | 7995 kg (299 szt) | 5010 kg (187 szt) | −5 kg |
| 50/50 (6502 kg) | 6515 kg (244 szt) | 6490 kg (242 szt) | +12 kg |

Udział pojedynczej pozycji mieści się w 58–63 % przy celu 8000 kg; wyjątki to
pozycje o 4–5 sztukach, gdzie jedna sztuka to 20–25 % pozycji.

## Model danych

**`client_order_lines.qty_invoice` (int, NULL)** — ile sztuk z tej pozycji idzie
na fakturę. `NULL` = brak podziału, zamówienie zachowuje się jak dziś.

*Pułapka:* `update_order` uzgadnia pozycje przez `_reconcile_lines_cx`
(dopasowanie po `id`, zapasowo po tożsamości produktu). Podział MUSI przeżyć
edycję zamówienia — inaczej powtórzy się historia znikających palet
(`kebab-zamowienia-kolejnosc-palety`). Test na to jest obowiązkowy.

**`client_orders.invoice_kg_target` (numeric, NULL)** — co wpisało biuro; służy
do pokazania odchyłki i do ponownego przeliczenia po edycji zamówienia.

**`wz_documents.doc_series` (text, default `'WZ'`)** — `'WZ'` albo `'WM'`.
Numeracja WM działa jak WZ i HDI: licznik w tabeli `sequences` pod kluczem
`wm_no:RRMM`, numer `WM/NN/MM/RR`. Zwolnione numery wracają do puli tak samo
jak przy WZ (`numery_zwolnione`).

**`cmr_documents.scope`** — `'calosc' | 'fv' | 'wz'`.
**`hdi_documents.scope`** — tylko `'calosc' | 'fv'`; do części na WZ HDI nie
powstaje. HDI na całość jest wymagany zawsze (także bez podziału), HDI do
faktury wystawia się na życzenie.
Bez podziału zostaje `'calosc'`, czyli dzisiejsze zachowanie.

## Który dokument rusza magazyn

**Wyłącznie WZ wewnętrzny (`WM`), na całość.** WZ dla klienta i oba CMR-y nie
wykonują żadnego ruchu magazynowego.

To jest najważniejsza reguła tego projektu: dwa dokumenty na tę samą wysyłkę
kuszą, żeby oba zdejmowały stan, a wtedy magazyn schodzi podwójnie i wychodzi
na minus. Test musi tego pilnować wprost.

Ścieżka załadunkowa z 2026-09-09 (`kebab-zaladunek-skan-kartonu`) wystawia dziś
WZ z serii `WZ` przy zamknięciu auta. Po tej zmianie:
- **zamówienie z podziałem** — komplet wystawia biuro wcześniej, a załadunek
  tylko weryfikuje zgodność z `WM` (mechanizm `verify_wz_against_loaded` już
  istnieje i jest przetestowany);
- **zamówienie bez podziału** — bez zmian, jak dziś.

## Interfejs

Na ekranie zamówienia przycisk **„Podział na fakturę"**:

1. pole „na fakturę [kg]" + skrót „50/50",
2. tabela podglądu: pozycja, zamówione, na FV, na WZ, % — z sumami i odchyłką,
3. każdą pozycję da się poprawić ręcznie (sumy przeliczają się na bieżąco),
4. „Zapisz podział" — sam podział, bez dokumentów,
5. „Wystaw komplet dokumentów" — WM, WZ, 2× CMR, HDI na całość;
   HDI do faktury osobnym przyciskiem, bo bywa niepotrzebny.

Dokumenty można wystawić w dowolnym momencie przed wyjazdem. Wystawione
wcześniej są zamrożone — treść dokumentu nie zmienia się po fakcie
(`kebab-hdi-rodzaj-w-nazwie`).

## Ryzyka

**Podwójny rozchód magazynu.** Największe. Mitigacja: jedno miejsce robiące
ruch (`WM`), test na to, że pozostałe dokumenty nie tworzą `stock_movements`.

**Podział ginie przy edycji zamówienia.** Mitigacja: test edycji zamówienia
z podziałem; przeliczenie na `invoice_kg_target`, gdy zmieniły się ilości.

**Dwie serie na papierze.** Biuro musi wiedzieć, że `WM` nie wychodzi do
klienta. Mitigacja: dopisek na wydruku „DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ
KLIENTOWI".

**Zaokrąglenie.** Nie da się usunąć; pokazywana odchyłka i ręczna korekta.

## Zakres testów

- algorytm podziału: równomierność, sztuki całkowite, suma = całość, 50/50,
  cel większy niż zamówienie, zamówienie jednopozycyjne, cel 0;
- podział przeżywa edycję zamówienia;
- **tylko `WM` tworzy ruch magazynowy** — pozostałe dokumenty nie;
- numeracja `WM`: własny licznik, zwolniony numer wraca do puli;
- CMR w wariantach `calosc` / `fv`;
- HDI na całość powstaje zawsze, HDI do faktury tylko na żądanie,
  a do części na WZ nie powstaje ŻADEN;
- zamówienie bez podziału zachowuje się dokładnie jak dziś (regresja).

## Poza zakresem

- wystawianie faktur w MES (zostaje Subiekt),
- podział po asortymencie („te pozycje na FV, tamte na WZ") — właściciel
  wybrał równomierny,
- rozliczanie części niefakturowanej w czasie.
