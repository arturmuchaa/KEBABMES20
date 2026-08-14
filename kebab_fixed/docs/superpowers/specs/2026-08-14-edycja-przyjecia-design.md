# Edycja przyjęcia w pełnym formularzu dostawy

Data: 2026-08-14
Strona: `/office/raw-batches` (`src/features/raw-batches/`)
Backend: `app/routes/receptions.py`, `app/services/receptions_service.py`,
`app/services/raw_batches_service.py`

## Problem

Dostawę rejestruje się w **pełnoekranowym formularzu** (`ReceptionForm`, 885
linii): dostawca, numer dokumentu, pozycje HDI, podział na numery porządkowe,
kalibry i nośniki — wszystko na jednym ekranie, z sumą kontrolną względem HDI.

Edytuje się ją w **modalu na osiem pól** (`EditRawBatchModal`, 185 linii),
który dotyczy JEDNEJ partii i nie pokazuje ani dokumentu, ani pozostałych
numerów porządkowych, ani nośników. Biuro nie wie, co właściwie edytuje.

Trzy dziury, które to okno ukrywa:

1. **Nie da się zmienić rodzaju surowca.** `update_batch` nie rusza
   `material_type_id`. Dostawa fileta wpisana jako mięso z/s (prod 2026-08-14,
   ADAM WĄSIK, FA/274/08/2026, 167 kg, nr 479) nie miała żadnego wyjścia
   z poziomu aplikacji — poprawiona ręcznie SQL-em.
2. **Filet i mięso z/s w ogóle nie dają się edytować.** Ich kilogramy leżą
   w locie `meat_stock`, a `update_batch` zmienia tylko `raw_batches` — więc
   edycja jest zablokowana strażnikiem, żeby nie rozjechać dostawy z magazynem.
3. **Nie da się poprawić podziału dostawy.** Jedno auto rozpisane na trzy
   numery porządkowe można poprawiać tylko numer po numerze, bez widoku
   całości i bez możliwości dołożenia albo zdjęcia numeru.

## Rozwiązanie

Edycja otwiera **ten sam formularz co przyjęcie**, wypełniony danymi dostawy.
Zapisuje się **cały dokument naraz**, jedną transakcją, a backend sam wylicza,
co zmienić, co dołożyć i co anulować.

### Dlaczego nie inaczej

- **Zestaw drobnych operacji per pozycja** (front woła `PUT /raw-batches/{id}`,
  `cancel`, `POST` po kolei) — brak atomowości. Dokument zapisany w połowie
  rozjeżdża księgę i saldo pojemników bez śladu, dlaczego; orkiestracja
  lądowałaby w przeglądarce. Tę samą pułapkę odrzuciliśmy przy anulowaniu
  całej dostawy (`cancel_reception`).
- **Anulowanie i przyjęcie od nowa pod maską** — kasuje historię: nowe id
  partii, nowe loty, nowe daty utworzenia. Kartoteka partii i traceability
  tracą wątek. W systemie, którego sensem jest identyfikowalność — odpada.

## API

### `PUT /api/receptions/{reception_id}`

Przyjmuje **ten sam kształt co `POST /api/receptions`** (nagłówek dokumentu +
grupy = numery porządkowe z pozycjami dostawcy). Zwraca dokument po zapisie
(jak `GET`) plus `warnings`.

Backend porównuje przysłany dokument ze stanem w bazie:

| sytuacja | działanie |
|---|---|
| pozycja istnieje w bazie i w żądaniu | aktualizacja pól |
| pozycja tylko w żądaniu (bez id) | utworzenie partii pod tym dokumentem |
| pozycja tylko w bazie | anulowanie przez `_cancel_batch_cx` |

Wszystko w jednej transakcji: cokolwiek odpadnie, nie zapisuje się nic.

Nagłówek dokumentu: data przyjęcia, numer dokumentu/HDI, uwagi. Dostawca,
numer przyjęcia (`reception_no`), tryb usługowy i skan HDI zostają nietknięte
(patrz „Poza zakresem").

## Strażnik: pozycja „ruszona"

Numer porządkowy jest **zamrożony**, gdy istnieje choć jedno: wpis rozbioru,
zużycie lotu mięsa (`kg_used`/`kg_reserved`/`kg_in_process` > 0 albo
`kg_available < kg_initial`), ważenie ubocznych. To ten sam warunek, którym
`_batch_used_reason_cx(for_cancel=True)` dopuszcza anulowanie — logika
mieszka w jednym miejscu, nie w dwóch.

- Zamrożoną pozycję wolno przysłać **tylko bez zmian**. Zmiana albo usunięcie
  → **409** z numerem porządkowym w treści („Numer 472 jest w rozbiorze").
- Reszta dokumentu edytuje się normalnie — dokument z jedną ruszoną pozycją
  nie blokuje pozostałych.
- Backend porównuje wartości sam; nie ufa temu, że front wyszarzył wiersz.

## Zmiana rodzaju surowca

Dozwolona **tylko na nietkniętej pozycji**. Trzy przypadki, każdy z ruchami
domykającymi księgę — nigdy cichym `UPDATE`:

| z → na | co się dzieje |
|---|---|
| filet ↔ mięso z/s | podmiana `material_type_id`/`material_name` na dostawie i na locie; kilogramy zostają na miejscu (oba rodzaje żyją w `meat_stock`) |
| filet/z-s → ćwiartka | lot znika z magazynu mięsa (ruch OUT `meat`, kg 0, status `CANCELLED`), kilogramy wracają na `raw_batches.kg_available` ruchem IN `raw` |
| ćwiartka → filet/z-s | powstaje lot w `meat_stock` (ruch IN `meat`), `kg_available` dostawy schodzi do zera ruchem OUT `raw` |

Reguła kolejności: ruch magazynowy **przed** zmianą stanu — `create_stock_movement`
waliduje żywy stan i przy wyzerowanym polu odrzuciłby własny ruch.

## Zmiana kilogramów na filecie i mięsie z/s

Pociąga za sobą lot: `kg_initial` i `kg_available` idą razem z dostawą, a
różnicę księguje ruch korygujący (`source_type='reception_edit'`). To jest ta
dziura, przez którą edycja takich dostaw była w ogóle zablokowana.

Dla ćwiartki bez zmian: kilogramy żyją na dostawie.

## Formularz

`ReceptionForm` dostaje tryb `mode: 'create' | 'edit'`:

- nagłówek „Edycja dostawy 16/08" zamiast „Nowa dostawa";
- dane wczytane z `GET /api/receptions/{id}` — zwraca już dokument, numery
  porządkowe i partie dostawcy pod każdym z nich (`_attach_details`);
- **wiersz zamrożony**: wyszarzony, bez kosza, z powodem („w rozbiorze",
  „mięso poszło do masowania");
- przycisk zapisu woła `PUT` zamiast `POST`;
- reszta sekcji (podział, kalibry, nośniki, kontrola sumy HDI) działa jak przy
  przyjęciu — to ten sam komponent, nie kopia.

Nowa trasa `/office/raw-batches/:receptionId/edycja` (`ReceptionFormPage`
w trybie edycji). Ołówek w `RawBatchesTable` prowadzi tam zamiast otwierać
modal; pokazuje się dla każdej nieanulowanej dostawy — o tym, czego nie wolno
tknąć, mówi formularz, a nie brak przycisku.

`EditRawBatchModal` znika razem ze stanem `editBatch` w `RawBatchesPage` —
nic innego go nie używa.

## Testy

Backend (`tests/test_reception_edit_db.py`, baza testowa):

- poprawka kg i ceny na nietkniętej ćwiartce → zmiana na dostawie, księga się
  domyka;
- poprawka kg na filecie → lot idzie razem z dostawą, ruch korygujący jest;
- filet → mięso z/s → rodzaj zmienia się na dostawie i na locie, kilogramy
  bez zmian;
- filet → ćwiartka → lot zdjęty, kilogramy wracają na dostawę, suma ruchów
  lotu = 0;
- dołożenie numeru porządkowego → nowa partia pod tym samym dokumentem;
- zdjęcie numeru → partia anulowana, numer wraca do puli;
- zmiana zamrożonej pozycji → 409 i **nic** się nie zapisuje (także pozostałe
  pozycje zostają bez zmian);
- dokument z jedną zamrożoną pozycją → reszta zapisuje się poprawnie.

Front (vitest): mapowanie dokumentu z API na grupy formularza i z powrotem
(prefill ↔ payload), oznaczanie wierszy zamrożonych.

## Ryzyka

- **Diff po stronie backendu to sedno.** Pozycje trzeba parować po `id` partii,
  nie po numerze porządkowym — numer bywa zmieniany, a przy dołożeniu wiersza
  jeszcze nie istnieje.
- **Numer porządkowy zdjęty z dokumentu wraca do puli** (`ANUL-<id>`), więc
  ponowny zapis tego samego numeru w tym samym dokumencie musi tworzyć partię,
  a nie odbijać się o `UNIQUE`.
- **Saldo pojemników** przelicza się przy każdej zmianie nośników — istniejące
  `_book_batch_containers` robi to różnicowo i trzeba je wywołać także w
  ścieżce edycji, inaczej dostawca zostanie z fantomowym saldem.
- Migracje nie są potrzebne: schemat się nie zmienia.

## Poza zakresem

- Wymiana skanu HDI (jest osobny przycisk „wskaż skan").
- Zmiana numeru dokumentu przyjęcia (`reception_no`) — numer jest kluczem
  ludzkim w rejestrze i na wydrukach.
- **Zmiana dostawcy** — przesuwa saldo pojemników między kontrahentami i
  unieważnia opis wypalony na skanie HDI. Pole w trybie edycji jest zablokowane
  z podpowiedzią „zła firma? anuluj dostawę i wpisz ponownie". Osobna robota,
  jeśli okaże się potrzebna.
- **Przełączenie dostawy na tryb usługowy** (i z powrotem) — to inna seria
  numerów przyjęcia („48U"), więc zmiana wymagałaby przenumerowania dokumentu.
- Edycja dostawy, w której **wszystkie** pozycje są ruszone — formularz się
  otworzy, ale nie da się nic zapisać. To świadome: biuro ma widzieć dokument
  i powód blokady.
