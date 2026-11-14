# WZ — pozycje dodatkowe (z ręki i z magazynu surowca)

Data: 2026-11-14 · Gałąź: `feat/protrima-dokumenty-20261114` (od prod a2e5103e) · Etap 1 z 2 (etap 2: moduł Dokumenty)

## Po co

Do dostaw dochodzą rzeczy spoza naszej drogi produkcja → wydanie:
- towar obcy, którego nie ma na żadnym stanie (np. **jogurt naturalny**) — wpisywany z ręki: nazwa, ilość, cena;
- surowiec z magazynu surowca, sprzedawany razem z wyrobem (np. **VATAN: yaprak + łój otokowy 15 kg**).

Dziś nie da się ich dopisać do WZ w PROTRIMA, a WZ z kursu (powstaje sama przy załadunku) nie da się w ogóle uzupełnić.

## Cele

1. W edytorze WZ PROTRIMA (z zamówienia i z magazynu) — dwa przyciski: **„+ Z magazynu surowca”** i **„+ Pozycja z ręki”**.
2. Na **już wystawionej WZ** (także z kursu) — **„Dopisz pozycję…”** z tymi samymi dwoma rodzajami; dopisaną pozycję można **usunąć** (pomyłka).
3. Pozycja z ręki: nazwa, ilość, j.m. (szt. / kg / opak.), cena za j.m., stawka VAT. **Nie rusza stanów.**
4. Pozycja z surowca: wybór partii (FEFO, wolne kg, data ważności), kg, cena/kg, VAT. **Zdejmuje stan** w chwili wystawienia/dopisania; usunięcie oddaje stan. Na wydruku trafia do istniejącej sekcji „Identyfikacja partii surowca (HDI)” z datami.
5. Wartość WZ i **saldo klienta w Rozrachunkach** uwzględniają pozycje dodatkowe.

## Nie-cele

- CMR i HDI wyrobu bez zmian (liczą się z planu/palet, nie z linii WZ). Łój nie trafia automatycznie na CMR — CMR ma już ręczne „pozycje dodatkowe towaru” (`goods_manual`).
- Faktury (Subiekt) — poza MES, bez zmian.
- Kartoteka towarów obcych (słownik „jogurt” z ceną) — nie teraz; nazwa wpisywana za każdym razem. Podpowiedź z ostatnio użytych nazw — tak (lekka, z istniejących WZ).

## Anty-cele (porażka mimo „działa”)

- Dopisany jogurt pokazuje **rozjazd załadunku** albo psuje „wydano” w zamówieniu / HDI / bilans.
- Łój schodzi ze stanu dwa razy albo nie wraca po usunięciu pozycji.
- Pozycja dopisana do dokumentu wewnętrznego WM, którego klient nie dostaje i którego Rozrachunki nie liczą — biuro myśli, że obciążyło klienta, a nie obciążyło.

## Jak działa dziś (ustalone w kodzie)

- `wz_documents.lines` = JSONB; `build_wz_lines` liczy wartość za kg (gdy `total_kg`) albo za szt.; VAT per pozycja.
- `POST /wz/manual` (`create_manual_wz`) już łączy wyrób (`stock_type='fg'`) z surowcem (`raw`/`meat`/`byproduct`), stempluje daty partii, robi rozchód; `GET /wz/stock/raw` daje stan surowca.
- `PATCH /wz/{id}/lines` — edycja tylko `source_type='manual'`.
- WZ z kursu: `source_type='order'`, `loading_id`; przy zamówieniu w całości na fakturę powstaje **WM** (seria WM, wewnętrzny), WZ klienta tylko dla części niefakturowanej.
- Weryfikacja załadunku (`loading_service`) kluczuje linie po (recipe_id, kg_per_unit, partia).
- Rozrachunki liczą brutto z linii WZ (`brutto_wz`); `synchronizuj_wz` przelicza.

## Podejścia (rozważone)

- **A.** Tylko w edytorze przed wystawieniem — odrzucone: nie obejmuje WZ z kursu.
- **B. (wybrane przez właściciela)** Edytor + „Dopisz pozycję” na wystawionej WZ, także z kursu.
- (C) Osobny dokument „WZ dodatkowa” na jogurt — odrzucone: drugi papier dla kierowcy i klienta, a klient chce jeden.

## Projekt

### Dane
- Każda linia dodatkowa ma `stock_type`: `'reczna'` (z ręki) albo istniejące `raw`/`meat`/`byproduct` (z surowca), oraz `line_id` (uuid) i `dopisana_at` (gdy dopisana po wystawieniu). Bez migracji schematu (JSONB).
- `total_kg` tylko gdy j.m. = kg; dla `reczna` w szt./opak. wartość = ilość × cena.

### Serwer
- `POST /wz/{id}/pozycje` `{rodzaj:'reczna'|'surowiec', ...}` → dopisuje linię, przelicza `total_value`, rozchód surowca (ten sam kod co `create_manual_wz`), `_rebook_wz_containers`, synchronizacja rozrachunków.
- `DELETE /wz/{id}/pozycje/{line_id}` → tylko linie dodatkowe (`reczna` albo surowiec z `line_id`); surowiec wraca na stan (ruch CANCEL/korekta jak przy edycji ilości).
- Odmowa: WZ anulowana; WZ niewyceniana dla `reczna` bez ceny → cena opcjonalna (wtedy bez wartości).
- **Konsumenci linii pomijają `stock_type != 'fg'`**: weryfikacja załadunku, „wydano” zamówienia (`order_stock_service`/`orders_service`), HDI, podział kursu. Rozrachunki i suma wartości — liczą wszystko.
- Tworzenie WZ z edytora (`/wz/manual`, ścieżka z zamówienia) przyjmuje selekcje `stock_type='reczna'` bez `stock_id`.

### PROTRIMA
- `WzZamowienia`: pod tabelą pozycji dwa przyciski; „Z magazynu surowca” → okno z listą partii (szukaj, FEFO, wolne kg), pola kg / cena / VAT; „Z ręki” → nowy wiersz w tabeli z polami nazwa / ilość / j.m. / cena / VAT (VAT domyślny jak dla dokumentu z NIP-u). Wiersze dodatkowe oznaczone etykietą „z ręki” / „surowiec” i przyciskiem usuń.
- Wystawiona WZ: akcja **„Dopisz pozycję…”** w panelu zamówienia → Dokumenty oraz w Papierach kursu; okno z dwiema zakładkami (Z ręki / Z magazynu surowca). Lista pozycji dokumentu pokazuje dopisane z ikoną usuwania.
- Etap 2 (moduł Dokumenty) użyje tego samego okna.

### Testy
- Backend (`kebab_mes_test`): dopisanie `reczna` → wartość i saldo rosną, stan bez zmian, weryfikacja załadunku nadal „potwierdzony”; dopisanie surowca → stan −15 kg, usunięcie → +15 kg; odmowa dla anulowanej.
- Vitest: edytor wysyła selekcje `reczna`; okno „Dopisz pozycję” waliduje nazwę/ilość/cenę z przecinkiem.
- Zrzuty do akceptacji przed wdrożeniem.

## WM i WZ — zasada (właściciel 14.11) i przegląd logiki

**WM = wszystko, co wyszło z magazynu (rusza stan). WZ = dokument dla klienta do zapłaty (obciąża Rozrachunki).**

Przegląd kodu 14.11 — zgodne z zasadą:
- Kurs (`wystaw_z_kursu` → `wystaw_komplet`): zawsze WM na całość (jedyny rozchód) + WZ klienta tylko na część niefakturowaną (bez ruchu magazynu). Całość na fakturę → sam WM, płaci faktura z Subiekta.
- Rozrachunki liczą tylko serię WZ (+ numery FV z kursu); WM nigdy (`rozrachunki_service`, `rozliczenia_wz`).
- Wyjątek (świadomy): WZ ręczna z magazynu (Wyrób gotowy → Wydaj) i zamówienia sprzed 24.09.2026 — jeden dokument serii WZ robi obie rzeczy (rusza stan i jest do zapłaty). Bez zmian.

### Pozycje dodatkowe wg zasady
| Sytuacja | Jogurt (z ręki) | Łój (z magazynu surowca) |
|---|---|---|
| Jeden WZ (bez podziału) | na WZ | na WZ (stan schodzi) |
| WM + WZ klienta | tylko na WZ klienta | na WM (stan schodzi) + ta sama pozycja z ceną na WZ klienta (bez ruchu stanu) — ptaszek „do zapłaty na WZ”, domyślnie zaznaczony |
| Sam WM (całość na FV) | zablokowane: „ten kurs idzie na fakturę z Subiekta — dopisz tam” | na WM (stan schodzi), bez wartości dla Rozrachunków |

Usunięcie pozycji usuwa obie kopie (WM i WZ klienta) i oddaje stan.

### Waluta (właściciel 14.11)
Ceny pozycji dodatkowych zawsze w **walucie dokumentu**: PLN albo EUR z kursem NBP (tab. A) już zapisanym na WZ (`currency`, `eur_rate`). Okno dopisywania pokazuje walutę dokumentu przy polu ceny (zł / €) i — dla EUR — kurs; nie przelicza i nie pozwala mieszać walut na jednym dokumencie. W edytorze przed wystawieniem pozycje idą za walutą wybraną dla WZ (zmiana waluty = ceny tych pozycji wpisuje się na nowo, z ostrzeżeniem).

### Wydruk WM
- Tytuł jak na WZ: „Wydanie zewnętrzne” + numer (WM/…); **bez czerwonego paska** „DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI” i bez tej notatki w uwagach (nowe WM jej nie dostają; przy starych wydruk ją pomija).

## Zostawione budującemu

Wygląd okien w stylu PROTRIMA (zrzuty), komunikaty, kolejność dopisanych pozycji (na końcu dokumentu).
