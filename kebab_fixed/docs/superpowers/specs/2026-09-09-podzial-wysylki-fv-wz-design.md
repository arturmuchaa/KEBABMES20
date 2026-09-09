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
   **Wynik musi trafiać DOKŁADNIE w podaną liczbę kilogramów** — jeśli trzeba,
   system przesuwa pojedynczą sztukę, byle się zgadzało.
2. **WZ na całość jest wewnętrzny** — klient go nie dostaje.
3. **Osobna seria wewnętrzna** dla tego WZ (nie mieszamy z serią WZ, która
   wychodzi do klientów).
4. **HDI na całość ZAWSZE, HDI do faktury OPCJONALNIE.** Do części na WZ nie
   wystawia się HDI w ogóle: „tylko HDI i na całość i HDI drugie do faktury,
   do WZ nie".
5. **Podział wpisywany na zamówieniu**, kiedykolwiek przed wyjazdem.

## Algorytm podziału

Właściciel (2026-09-09): „musimy zrobić tak, aby można było dzielić tak, jak ja
chcę — równo. Jeżeli chcę 8000 kg i 5005 kg, to musi się dać tak dzielić, wtedy
trzeba usunąć jakąś sztukę, tak aby trafić w ten podział".

Podział ma więc trafiać **DOKŁADNIE** w podaną liczbę, a nie tylko blisko.

Trzy kroki:

1. **Równomiernie** — każda pozycja oddaje na fakturę ten sam procent sztuk
   (`floor(qty × udział)`, reszta metodą największych reszt). To daje rozkład,
   w którym każda pozycja jest obecna po obu stronach.
2. **Dobicie do celu** — brakujące kilogramy nadrabiamy najmniejszą możliwą
   zmianą: najpierw przesunięcie jednej sztuki, potem wymiana dwóch
   (dodaj sztukę X, zabierz sztukę Y), potem trzech. Szukamy najmniejszego
   ruchu, żeby nie zepsuć równomierności z kroku 1.
3. **Gdy cel jest nieosiągalny** — pokazujemy najbliższą sumę, jaką da się
   złożyć z całych sztuk, i mówimy o tym wprost.

Kiedy cel jest nieosiągalny: wagi sztuk w zakładzie to wielokrotności 5 kg, więc
osiągalna jest **każda wielokrotność 5 kg** — czyli praktycznie każda liczba,
jaką poda klient. Nieosiągalne są tylko cele spoza tej siatki, na przykład
połowa nieparzystej sumy: 13 005 / 2 = 6502,5 kg → najbliżej 6500 kg (−2,5 kg).

Sprawdzone na YALCIN/Z/4/09/26 (21 pozycji, 486 szt, 13 005 kg):

| Cel | Wynik FV | Wynik WZ | Jak trafiono |
|---|---|---|---|
| **8000 kg** | **8000 kg** | **5005 kg** | wymiana 2 sztuk |
| 6000 kg | 6000 kg | 7005 kg | od razu, bez korekty |
| 9000 kg | 9000 kg | 4005 kg | przesunięcie 1 sztuki |
| 10 000 kg | 10 000 kg | 3005 kg | przesunięcie 1 sztuki |
| 50/50 (6502,5 kg) | 6500 kg | 6505 kg | cel nieosiągalny, najbliższe |

Dobicie do celu psuje równomierność tylko punktowo — jedna lub dwie pozycje
oddają o sztukę więcej lub mniej, niż wynikałoby z proporcji. Biuro widzi
wynik przed zatwierdzeniem i może poprawić ręcznie.

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

**Cel nieosiągalny z całych sztuk.** Dotyczy tylko celów spoza siatki 5 kg
(np. połowa nieparzystej sumy). Mitigacja: pokazujemy najbliższą osiągalną
sumę i mówimy o tym wprost, zamiast po cichu rozminąć się z tym, co biuro
uzgodniło z klientem.

## Zakres testów

- algorytm podziału: **trafienie CO DO KILOGRAMA** (8000 → dokładnie 8000),
  równomierność, sztuki całkowite, suma = całość, 50/50, cel nieosiągalny
  (najbliższa suma + informacja), cel większy niż zamówienie,
  zamówienie jednopozycyjne, cel 0;
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
