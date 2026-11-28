# PROTRIMA — dział Kontrahenci, poprawne dane z GUS/VIES, kontrola VAT UE przy wysyłce

Data: 2026-11-27 · gałąź `feat/protrima-kontrahenci-20261127` (od prod 866b0a1a, PROTRIMA 0.17.0)

## Po co

Właściciel (27.11): „Wdroż dział kontrahenci… pobieranie danych z GUS i VIES ładnie się
formatowało — dobrze pobierało kod pocztowy, miasto, ulicę i numer… VIES sprawdzał, czy
VAT UE jest aktywny, i przy każdej wysyłce zamówienia weryfikował, czy klient nadal ma
aktywny VAT UE.” Dopisane: „i dostawcy popraw, jeżeli chodzi o pobieranie danych”.
Decyzje: wariant 3 (lepszy parser MF + GUS REGON po kluczu), przy nieaktywnym VAT UE
**tylko ostrzeżenie — wtedy faktura z VAT** (nie blokada).

Powody, widoczne w danych prod (27.11):
- W PROTRIMA „Kontrahenci” to zaślepka — kartoteka żyje tylko w starym MES
  (`ClientsPage`, `SuppliersPage`).
- „GUS” = wykaz VAT MF (`wl-api.mf.gov.pl`), adres to jeden napis WIELKIMI literami,
  dzielony regexem `_parse_pl_address`. Skutki w kartotece: dostawca FARMEX ma adres
  „44/46” (ulica zgubiona), żaden z 14 dostawców nie ma miasta/kodu, klienci mają
  „ Košice” (spacja), kod „04022 ”, miasto „Benicassim, Castellón”, wieś bez ulicy
  „BRZEZIE 812 A”. Nie ma pola „kraj” — zgadujemy z prefiksu VAT.
- VIES wołany tylko przy zakładaniu karty, wynik nigdzie nie zapisany. Przy WDT (0 %)
  biuro potrzebuje dowodu, że nabywca miał ważny VAT UE w dniu dostawy.

## Cele

1. Moduł PROTRIMA „Kontrahenci”: kartoteka **odbiorców i dostawców** z pełną edycją
   (wszystko, co dziś ma stary MES), grupy odbiorców, nazwy do WZ/HDI. Dopracowany UX
   ([[protrima-ux-dopracowane]]): klawiatura, Enter/Esc, autofocus, błąd przy polu,
   puste stany, `autocomplete=off` (`src/lib/bezPodpowiedzi.ts`).
2. Pobieranie po NIP (PL) i VAT UE (zagranica) zwraca **rozpisane, ładnie sformatowane**
   pola: ulica (z numerem i lokalem), kod, miasto, kraj; pełna nazwa jak w rejestrze.
3. Status VAT UE odbiorcy zagranicznego zapisany w kartotece (aktywny / nieaktywny /
   nie sprawdzono / błąd sprawdzenia) z datą i **numerem potwierdzenia VIES**.
4. Przy każdej wysyłce (kurs i WZ z zamówienia) świeże sprawdzenie VIES, zapisane
   w historii z odnośnikiem do kursu/zamówienia; nieaktywny → czerwone ostrzeżenie
   i stawka krajowa na WZ.
5. Naprawa istniejących adresów: propozycje zmian do zatwierdzenia, bez cichego
   nadpisywania.

## Nie-cele

- MES nie wystawia faktur (Subiekt). „Faktura z VAT” = ostrzeżenie dla biura + domyślna
  stawka krajowa na WZ; nic nie wysyłamy do Subiekta.
- Brak blokady wysyłki czy dokumentów przy nieaktywnym VAT UE (decyzja właściciela).
- Sprawdzanie statusu czynnego podatnika VAT dla klientów polskich (biała lista) — nie
  zgłaszane. Rachunki bankowe z białej listy — nie.
- Stary MES dostaje tylko poprawiony parser i pole Kraj w formularzu (wspólne trasy);
  bez przebudowy jego ekranów.
- Rozliczeniowe ustawienia klienta zostają w module Rozrachunki (już tam są).

## Anty-cele (porażka, nawet jeśli „działa”)

- Pobranie danych **nadpisuje po cichu** to, co biuro poprawiło ręcznie.
- Awaria VIES (bywa niedostępny) zatrzymuje papiery kursu lub wystawienie WZ.
- Zgadywanie adresu bez pokazania surowego napisu — biuro musi widzieć oryginał.
- Zamiana wielkich liter w **nazwie firmy** (nazwa prawna idzie na wykazy HACCP i WZ
  jak w rejestrze — [[kebab-wykazy-kontrahentow]]).

## Ograniczenia

- Prod: Falkenstein 91.98.105.107, deploy wyłącznie przez SSH ([[deploy-sh-gotchas]]);
  zrzuty do akceptacji przed wydaniem; PROTRIMA podbić do 0.18.0.
- Wywołania zewnętrzne tylko przez backend i `api.ts` z tokenem (nigdy surowy `fetch`
  — [[kebab-nip-lookup-robustnosc]]). MF zostaje źródłem głównym bez klucza; dataport
  dalej zapasem.
- Migracje w `backend/app/migrations.py` (idempotentne `ADD COLUMN IF NOT EXISTS`).
- Testy serwera na osobnej bazie, nigdy dwa naraz (mało RAM).

## Podejścia (rozważone)

1. **Lepszy parser MF** (bez klucza) — działa od razu, ale to dalej zgadywanie z jednego
   napisu.
2. **GUS REGON (BIR1.1)** — pola osobno, bez zgadywania; wymaga darmowego klucza
   z GUS (wniosek mailem, kilka dni), do tego czasu nic się nie poprawia.
3. **Oba — WYBRANE.** Teraz nowy parser MF + parser VIES per kraj; integracja BIR
   gotowa i sama się włącza po wpisaniu `GUS_BIR_KEY` do `/opt/kebab/config/.env`.
   Kolejność: BIR (gdy klucz) → MF → dataport.

## Rozwiązanie

### A. Pobieranie danych (backend)

Nowy moduł `app/services/adresy.py` (czyste funkcje, łatwe testy):
- `rozbij_adres_pl(napis) -> {ulica, kod, miasto, surowy}` — obsługa: prefiksy
  `UL./AL./PL./OS./RYNEK/KS./GEN./ŚW.` (prefiks typu ulicy usuwamy, tytuły zostają
  w nazwie: „ks. Kardynała Stefana Wyszyńskiego”), numer „12”, „12A”, „12 A”, „44/46”,
  „15B/15C”, „20B/3”, „LOK. 5”, wieś bez ulicy („DĄBROWA 55, 59-600 DĄBROWA” →
  ulica „Dąbrowa 55”), poczta inna niż miejscowość.
- `ladne_litery(napis)` — Title Case po polsku dla ulicy i miasta: „JANA
  KILIŃSKIEGO 17” → „Jana Kilińskiego 17”, „GÓRKI WIELKIE”, „Kraków”,
  małe spójniki/przyimki w środku („Gerasdorf bei Wien” zostaje), litery w numerze
  wielkie („812A”), myślniki („Bielsko-Biała”), skróty rzymskie (III).
  Pola z VIES/BIR, które już mają mieszane litery, zostają bez zmian.
- `rozbij_adres_vies(napis, kraj)` — VIES zwraca 1–3 linie w układzie zależnym od kraju.
  Reguły dla krajów z kartoteki: DE, AT, SK, CZ, SI, ES, FR, BE, IT, NL (+ ogólna):
  kod pocztowy wg wzorca kraju (DE/ES/FR/IT 5 cyfr, AT/SI/BE 4, SK/CZ „NNN NN”
  lub 5, NL „1234 AB”), miasto bez sufiksów kraju, usunięcie „---”, spacji brzegowych,
  części dzielnicy po „ - ” zostaje w mieście (Košice - Nad jazerom).
- **Kod pocztowy normalizowany do formatu kraju** (PL „NN-NNN”, CZ/SK „NNN NN”).
- `company_lookup_service.gus_lookup` zwraca nowy kształt (wstecznie zgodny — stare
  klucze zostają): `nazwa, nip, regon, ulica, kod_pocztowy, miasto, kraj:'PL', adres
  (surowy), zrodlo:'GUS'|'MF'|'dataport'`.
- `_lookup_bir(nip)` — SOAP BIR1.1 (`Zaloguj` → `DaneSzukajPodmioty` → sesja), parsowanie
  XML: `Ulica, NrNieruchomosci, NrLokalu, KodPocztowy, Miejscowosc`. Włączone tylko
  gdy `settings.gus_bir_key`. Błąd/timeout → None (dalej MF).
- `vies_service`: zapytanie **POST `/rest-api/check-vat-number`** z naszym
  numerem jako zapytującym (`requesterMemberStateCode='PL'`, `requesterNumber` = NIP
  zakładu z `get_company()`), żeby dostać `requestIdentifier` (numer potwierdzenia).
  Gdy POST zawiedzie, zapas: obecny GET. Wynik: `valid, name, address (rozbity),
  kraj, requestIdentifier, requestDate, userError`. Transient → 503 jak dziś.

### B. Model danych

`clients` i `suppliers`: `country TEXT NOT NULL DEFAULT ''` (ISO-2; pusty = wylicz
z prefiksu VAT, potem „PL”). Backfill w migracji: prefiks literowy NIP-u albo „PL”.

`clients` (status ostatniego sprawdzenia, dla listy i dokumentów):
`vat_ue_status TEXT NOT NULL DEFAULT ''` (`aktywny|nieaktywny|blad|''`),
`vat_ue_checked_at TIMESTAMPTZ`, `vat_ue_request_id TEXT DEFAULT ''`.

Nowa tabela historii (dowód dla urzędu):
```
vat_ue_checks(id TEXT PK, client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  vat_number TEXT, status TEXT, request_id TEXT, vies_name TEXT, vies_address TEXT,
  error TEXT, context TEXT  -- 'kartoteka' | 'kurs' | 'wz' | 'reczne'
  loading_id TEXT, order_id TEXT, wz_id TEXT, operator TEXT, checked_at TIMESTAMPTZ DEFAULT now())
```
`blad` (VIES niedostępny) **nie** nadpisuje `vat_ue_status` aktywny/nieaktywny —
zapisuje się tylko w historii; w kartotece zostaje ostatni pewny wynik.

### C. Kontrola VAT UE przy wysyłce

Dotyczy wyłącznie odbiorców zagranicznych z UE (`is_foreign_nip` + kraj w UE).
Usługa `vat_ue_service.sprawdz(client_id, context, ids, operator)` → wynik + zapis.

- **Papiery kursu** (PROTRIMA Wysyłki → Papiery / `wystaw_z_kursu`): przy otwarciu okna
  papierów front woła `POST /api/vat-ue/sprawdz-kurs/{loading_id}` — sprawdza każdego
  zagranicznego odbiorcę kursu. Wiersz odbiorcy pokazuje plakietkę:
  zielona „VAT UE aktywny · potw. WAPIAAAAX…”, czerwona „VAT UE NIEAKTYWNY — wystaw
  fakturę z VAT 5 %”, szara „VIES nie odpowiada — ostatni wynik z DD.MM: aktywny ·
  Sprawdź ponownie”. Wystawienie nigdy nie czeka na VIES ani nie jest blokowane.
  `wystaw_z_kursu` po stronie serwera dopisuje sprawdzenie, jeśli w tym kursie go
  jeszcze nie było (gdy ktoś pominie okno) — z limitem czasu 8 s, błąd nie przerywa.
- **WZ z zamówienia** (PROTRIMA Zamówienia → WZ, `WzZamowienia`): to samo przy
  otwarciu formularza (`POST /api/vat-ue/sprawdz-klienta/{client_id}?order_id=`),
  plakietka nad pozycjami.
- **Stawka**: `stawkaVatDlaNabywcy(nip, vatUeStatus)` — zagranica + `nieaktywny` →
  `VAT_KRAJOWY` (5 %), inaczej jak dziś. Biuro dalej może zmienić stawkę w wierszu.
  Status `blad` nie zmienia stawki (zostaje ostatni pewny wynik).
- Magazyn (HMI „Zakończ” załadunku) — bez zmian, bez sprawdzania.

### D. Moduł PROTRIMA „Kontrahenci” (`src/protrima/modules/kontrahenci/`)

Układ jak inne moduły (lista po lewej + karta po prawej):
```
┌ Kontrahenci ─────────────[Odbiorcy | Dostawcy]──[Szukaj…]──[+ Dodaj]─[Grupy]─[Popraw adresy]┐
│ YALCIN  Emin Handels GmbH    AT  ATU12345675  ● aktywny 27.11 │ Karta: Emin Handels GmbH      │
│ TRUVA   Truva gastro s.r.o.  CZ  CZ12345678   ● aktywny 27.11 │ Dane firmy | Dokumenty | Wysył│
│ FUDI    FUDI SP. Z O.O.      PL  1112223334   —               │ ka/miejsce | Historia VAT UE  │
└───────────────────────────────────────────────────────────────┴───────────────────────────────┘
```
- Lista: nazwa wyświetlana + pełna, kraj, NIP/VAT, miasto, status VAT UE (kropka
  + data), grupa; sort, wyszukiwanie (nazwa/NIP/miasto), filtr „VAT UE nieaktywny /
  nie sprawdzony”.
- Karta odbiorcy — sekcje: **Dane firmy** (nazwa pełna, wyświetlana, NIP/VAT UE, REGON,
  kraj, ulica, kod, miasto, kontakt, telefon, e-mail, język dokumentów), **Dokumenty**
  (tryb nazw HDI, nazwy na WZ, własne nazwy receptur, nadzór halal, usługi),
  **Miejsce przeznaczenia** (nazwa/adres/miasto + ptaszki HDI/CMR), **VAT UE**
  (status, numer potwierdzenia, „Sprawdź teraz”, historia sprawdzeń z odnośnikami
  do kursów/WZ).
- Karta dostawcy: dane firmy jak wyżej + WNI (numer weterynaryjny), zakres dostaw
  (karta 1.3.2), pojemniki na paletę.
- **Pobieranie danych**: jedno pole „NIP lub VAT UE” + przycisk „Pobierz” (Enter).
  Cyfry/`PL…` → GUS/MF, inny prefiks → VIES. Wynik w panelu porównania:
  pole · obecne · pobrane · ptaszek „przejmij” (domyślnie zaznaczone tylko puste
  pola i różnice przy nowym kontrahencie; przy istniejącym — nic nie zaznaczone
  poza pustymi). Pod spodem surowy adres ze źródła i nazwa źródła (GUS/MF/VIES).
- **Grupy odbiorców** — okno jak w starym MES (`ClientGroupsModal`), w stylu PROTRIMA.
- **Popraw adresy** — lista kontrahentów, dla których parser daje inny wynik niż
  zapisany (z bieżących pól, bez wołania rejestrów; opcjonalnie „Pobierz z rejestru”
  per wiersz). Wiersz: obecne → proponowane, ptaszek; „Zastosuj zaznaczone”.
- Usuwanie = dezaktywacja (jak dziś `active=false`).
- Wejście z innych modułów: link z zamówienia/kursu otwiera kartę kontrahenta.

### E. Trasy (nowe / zmienione)

- `GET /api/gus/{nip}`, `GET /api/vies/lookup?vat=` — nowy kształt (wstecznie zgodny).
- `POST /api/vat-ue/sprawdz-klienta/{client_id}` (`order_id`, `wz_id` opcjonalnie),
  `POST /api/vat-ue/sprawdz-kurs/{loading_id}`, `GET /api/vat-ue/historia/{client_id}`.
- `GET /api/kontrahenci/propozycje-adresow`, `POST /api/kontrahenci/zastosuj-adresy`.
- `clients`/`suppliers` create/update przyjmują `country`.
- Uprawnienia: jak `/api/clients` (biuro).

### F. Stary MES

`GusLookup`/`ViesLookup` korzystają z nowego kształtu (gotowe pola zamiast
`viesAddress()` po stronie frontu), formularze klienta i dostawcy dostają pole Kraj.

## Testy

- `test_adresy.py`: tabela prawdziwych przypadków (wszystkie adresy z kartoteki prod
  27.11 + MF-owe warianty: wieś, „44/46”, „KS.”, „PL.”, poczta ≠ miejscowość) i VIES
  per kraj (próbki odpowiedzi DE/AT/SK/CZ/SI/ES/FR/BE/IT/NL).
- `test_company_lookup.py` (istniejący) rozszerzony: kolejność BIR → MF → dataport,
  BIR wyłączony bez klucza.
- `test_vat_ue.py` (baza): zapis historii, `blad` nie nadpisuje statusu, kurs sprawdza
  tylko zagranicznych z UE, `wystaw_z_kursu` działa przy padniętym VIES.
- vitest: `stawkaVatDlaNabywcy` z nieaktywnym, moduł Kontrahenci (dodanie, pobranie,
  panel porównania, Enter/Esc), plakietki w Papierach kursu i WZ.
- Zrzuty PROTRIMA do akceptacji przed wydaniem.

## Decyzje właściciela (27.11)
- Wariant 3; dostawcy też objęci.
- Nieaktywny VAT UE → tylko ostrzeżenie, faktura z VAT.

## Moje decyzje (do sprawdzenia przy czytaniu)
- Sprawdzenie przy otwarciu papierów kursu i formularza WZ, nie na magazynie.
- VIES niedostępny → nie zmienia statusu ani stawki; ostatni pewny wynik + „Sprawdź ponownie”.
- Stawka „z VAT” = 5 % (VAT_KRAJOWY, wyrób spożywczy), zmienialna w wierszu.
- Nazwa firmy zostaje jak w rejestrze (bez zmiany liter); ładne litery tylko ulica i miasto.
- Numer potwierdzenia VIES zapisywany z naszym NIP-em jako zapytującym.
- Klucz GUS BIR: właściciel składa wniosek do GUS; do tego czasu działa MF.
- Ulica bez przedrostka „ul.” (jak dziś w kartotece i jak u klientów zagranicznych);
  przedrostek ze źródła (MF „UL.”, BIR „ul.”) usuwamy, żeby kartoteka była jednolita.
- „Popraw adresy” proponuje też zmianę WIELKICH liter ulicy/miasta na zwykłe — każdą
  zmianę biuro zatwierdza ptaszkiem.
- Kraje UE: stała lista ISO-2 (27 państw + XI dla Irlandii Płn.) w `vat_ue_service`;
  spoza UE (CH, GB, NO…) — bez sprawdzania VIES, plakietka „poza UE”.

## Zostawione wykonawcy
- Dokładna lista wyjątków dla Title Case i wzorców VIES — z testów na danych prod.
- Wygląd plakietek i panelu porównania w ramach design systemu PROTRIMA.
