# PROTRIMA Kontrahenci + GUS/VIES + VAT UE przy wysyłce — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dział „Kontrahenci” w PROTRIMA (odbiorcy + dostawcy), poprawnie rozpisane adresy z GUS/MF/VIES i zapisywana kontrola VAT UE przy każdej wysyłce (ostrzeżenie + stawka krajowa).

**Architecture:** Czyste funkcje adresowe w `backend/app/services/adresy.py` używane przez lookup GUS/MF/BIR i VIES; nowa usługa `vat_ue_service` z tabelą historii `vat_ue_checks` i statusem w `clients`; nowy moduł frontu `src/protrima/modules/kontrahenci/` na istniejących trasach `/api/clients`, `/api/suppliers`, `/api/client-groups`.

**Tech Stack:** FastAPI + psycopg (raw SQL, `app.db`), migracje w `backend/app/migrations.py`, React 18 + TS, vitest (jsdom), pytest.

**Spec:** `kebab_fixed/docs/superpowers/specs/2026-11-27-protrima-kontrahenci-design.md`

Katalog roboczy: `/opt/kebab/wt-kontrahenci/kebab_fixed` (gałąź `feat/protrima-kontrahenci-20261127`).
Testy DB: `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test_kontrahenci` (osobna baza; nigdy dwa przebiegi naraz).

## Global Constraints

- Prod = Falkenstein 91.98.105.107, deploy tylko przez SSH; ten host to stary serwer.
- Wywołania tras chronionych tylko przez `src/lib/api.ts` (`req()` z tokenem), nigdy surowy `fetch`.
- Kolejność źródeł PL: BIR (gdy `GUS_BIR_KEY`) → MF (`wl-api.mf.gov.pl`) → dataport (gdy `DATAPORT_API_KEY`).
- Nazwa firmy bez zmiany liter (jak w rejestrze); „ładne litery” tylko ulica i miasto.
- Ulica bez przedrostka „ul.”/„al.”/„pl.”/„os.” (tytuły typu „ks.”, „gen.”, „św.” zostają, małymi literami z kropką).
- Kod pocztowy: PL `NN-NNN`, CZ/SK `NNN NN`, NL `NNNN AA`, reszta same cyfry bez spacji.
- Nieaktywny VAT UE → tylko ostrzeżenie + domyślna stawka `VAT_KRAJOWY` (5 %) na WZ z zamówienia; nigdy blokada.
- VIES niedostępny (`blad`) nie zmienia `clients.vat_ue_status` ani stawki.
- Kontrola tylko dla odbiorców z krajem w UE ≠ PL (27 państw + `XI`; GR w VIES = `EL`).
- UI PROTRIMA: Enter zapisuje / Esc zamyka, autofocus pierwszego pola, błąd przy polu, `bezPodpowiedzi` (`src/lib/bezPodpowiedzi.ts`) na polach, puste stany.
- PROTRIMA wersja 0.18.0.

## Review Focus

1. Pobranie danych do ISTNIEJĄCEJ karty z ręcznie poprawionym adresem — nic nie może się nadpisać bez ptaszka (test w Task 9: `pobranie do istniejącej karty nie zaznacza wypełnionych pól`).
2. VIES pada w trakcie otwierania papierów kursu — papiery się otwierają, „Wystaw komplet” działa, plakietka szara z ostatnim pewnym wynikiem (test w Task 6 `test_wystaw_z_kursu_dziala_gdy_vies_pada` + Task 8 `plakietka blad pokazuje ostatni pewny wynik`).
3. Klient zagraniczny z pustym/zepsutym VAT (TAT DÖNER: kraj DE, brak NIP) — status `blad` z komunikatem „brak numeru VAT UE”, nie wyjątek 500 (test w Task 5 `test_brak_numeru_vat_to_blad_nie_500`).
4. Adres z MF, którego parser nie rozumie — pola puste, `surowy` zawsze zwrócony, UI pokazuje surowy napis (test w Task 1 `test_nieznany_format_zwraca_surowy` + Task 9).
5. Biuro poprawia stawkę VAT w wierszu ręcznie, potem przychodzi wynik VIES — ręcznie zmieniona stawka zostaje (test w Task 7 `zmiana statusu nie rusza ręcznie zmienionej stawki`).

---

### Task 1: Funkcje adresowe

**Files:**
- Create: `backend/app/services/adresy.py`
- Test: `backend/tests/test_adresy.py`

**Interfaces:**
- Produces:
  - `KRAJE_UE: frozenset[str]` (ISO-2, z `XI`, bez `EL`; mapowanie `EL`→`GR` w `kraj_z_vat`)
  - `kraj_z_vat(nip: str) -> str` — prefiks literowy (`EL`→`GR`), cyfry/puste → `'PL'`
  - `ladne_litery(napis: str) -> str`
  - `normalizuj_kod(kod: str, kraj: str) -> str`
  - `rozbij_adres_pl(napis: str) -> dict` z kluczami `ulica, kod_pocztowy, miasto, surowy` (brak → `''`)
  - `rozbij_adres_vies(napis: str, kraj: str) -> dict` (te same klucze)

- [ ] **Step 1: Napisz testy** (parametryzowane tablice; wartości dokładnie):

```python
PL = [
  ("JANA KILIŃSKIEGO 17, 40-001 KATOWICE", "Jana Kilińskiego 17", "40-001", "Katowice"),
  ("UL. KWIATOWA 12, 48-300 NYSA", "Kwiatowa 12", "48-300", "Nysa"),
  ("ZALESIE 41F, 62-300 ZALESIE", "Zalesie 41F", "62-300", "Zalesie"),
  ("BRZEZIE 812 A, 32-002 BRZEZIE", "Brzezie 812A", "32-002", "Brzezie"),
  ("DŁUGA 15B/15C, 31-147 KRAKÓW", "Długa 15B/15C", "31-147", "Kraków"),
  ("PL. GRUNWALDZKI 20B, 50-001 WROCŁAW", "Grunwaldzki 20B", "50-001", "Wrocław"),
  ("KS.KARDYNAŁA STEFANA WYSZYŃSKIEGO 5, 87-100 TORUŃ", "ks. Kardynała Stefana Wyszyńskiego 5", "87-100", "Toruń"),
  ("PIOTRKOWSKA 44/46, 90-001 ŁÓDŹ", "Piotrkowska 44/46", "90-001", "Łódź"),
  ("LEGNICKA 208 LOK. 5, 54-200 WROCŁAW", "Legnicka 208/5", "54-200", "Wrocław"),
  ("OPOLSKA 7, 46-061 GÓRKI WIELKIE", "Opolska 7", "46-061", "Górki Wielkie"),
  ("AL. JANA PAWŁA II 12, 43-300 BIELSKO-BIAŁA", "Jana Pawła II 12", "43-300", "Bielsko-Biała"),
]
VIES = [
  ("DE", "Hauptstr. 21\n50667 Köln", "Hauptstr. 21", "50667", "Köln"),
  ("AT", "Hauptplatz 7\nAT-4490 St.Florian-Markt", "Hauptplatz 7", "4490", "St.Florian-Markt"),
  ("SK", "Hlavná 1200/4\n04011 Košice - mestská časť Juh\nSlovensko", "Hlavná 1200/4", "040 11", "Košice - mestská časť Juh"),
  ("CZ", "Polní 45\nHOSTIVICE\n253 01  HOSTIVICE", "Polní 45", "253 01", "Hostivice"),
  ("SI", "TRŽAŠKA CESTA 9 A, 1000 LJUBLJANA", "Tržaška Cesta 9A", "1000", "Ljubljana"),
  ("ES", "CALLE MAYOR 6 1 12001 BENICASSIM CASTELLON", "Calle Mayor 6 1", "12001", "Benicassim Castellon"),
  ("FR", "AV DE LA GARE 12/24\n93000 BOBIGNY", "Av de la Gare 12/24", "93000", "Bobigny"),
  ("BE", "Kerkstraat 10\n2000 Antwerpen", "Kerkstraat 10", "2000", "Antwerpen"),
  ("IT", "VIA DEI MILLE 323 \n12100 CUNEO CN\n", "Via dei Mille 323", "12100", "Cuneo CN"),
  ("NL", "Keizersgracht 1\n1015CJ Amsterdam", "Keizersgracht 1", "1015 CJ", "Amsterdam"),
]
```
Testy: `test_rozbij_pl[...]`, `test_rozbij_vies[...]`, `test_nieznany_format_zwraca_surowy` (`"BRAK ADRESU"` → ulica `''`, kod `''`, miasto `''`, surowy `"BRAK ADRESU"`), `test_ladne_litery_nie_rusza_mieszanych` (`"Hauptstr. 21"` bez zmian), `test_normalizuj_kod` (`("04022 ","SK")→"040 22"`, `("40001","PL")→"40-001"`, `("1015CJ","NL")→"1015 CJ"`, `(" 4490","AT")→"4490"`), `test_kraj_z_vat` (`"ATU12345675"→"AT"`, `"1112223334"→"PL"`, `"EL123"→"GR"`, `""→"PL"`).

- [ ] **Step 2:** `cd backend && python3 -m pytest tests/test_adresy.py -q` → FAIL (brak modułu).
- [ ] **Step 3: Zaimplementuj** `adresy.py`. Zasady `ladne_litery`: działa tylko gdy napis nie ma małych liter; słowa → `capitalize()` z zachowaniem części po `-` i `.`; spójniki/przyimki w środku małymi (`dei, de, di, del, la, le, van, der, bei, am, an, im, und, nad, pod`); liczby rzymskie (`I..XX`) wielkie; tokeny z cyfrą (`9A`, `41F`) wielkie; tokeny 1–2 litery po nazwie miasta przy IT/ES (`CN`) wielkie. `numer + odstęp + pojedyncza litera` → sklejone (`812 A`→`812A`); `LOK. 5`/`M. 5` → `/5`. Kod PL szukany wzorcem `\d{2}-\d{3}`, VIES wzorcem kraju na linii od końca; prefiks `AT-`/`D-` przed kodem usuwany; linia samej nazwy kraju (`Slovensko`, `Deutschland`, `Österreich`, `Česká republika`) odrzucana; zduplikowana linia miasta (CZ) pomijana.
- [ ] **Step 4:** ten sam test → PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): funkcje rozbijania i formatowania adresów PL/UE`.

### Task 2: Lookup PL (BIR → MF → dataport) w nowym kształcie

**Files:**
- Modify: `backend/app/services/company_lookup_service.py`, `backend/app/config.py` (`gus_bir_key: str = os.environ.get("GUS_BIR_KEY", "")`)
- Test: `backend/tests/test_company_lookup.py` (rozszerzyć; istniejący `test_parse_pl_address_splits_street_and_postal` przepiąć na `adresy.rozbij_adres_pl`, `_parse_pl_address` usunąć)

**Interfaces:**
- Consumes: Task 1 (`rozbij_adres_pl`, `ladne_litery`, `normalizuj_kod`).
- Produces: `gus_lookup(nip) -> dict` z kluczami `nip, regon, nazwa, ulica, kod_pocztowy, miasto, kraj ('PL'), adres (surowy), zrodlo ('GUS'|'MF'|'dataport'), numer_budynku=None, numer_lokalu=None` (dwa ostatnie dla zgodności starego frontu — `ulica` zawiera już numer). `_lookup_bir(clean) -> dict | None`.

- [ ] **Step 1: Testy:** `test_mf_zwraca_rozbity_ladny_adres` (MF `workingAddress="JANA KILIŃSKIEGO 17, 40-001 KATOWICE"` → `ulica=="Jana Kilińskiego 17"`, `zrodlo=="MF"`, `adres` = surowy); `test_bir_pierwszy_gdy_klucz` (monkeypatch `settings.gus_bir_key="x"`, `_lookup_bir` zwraca dane → MF nie wołany, `zrodlo=="GUS"`); `test_bir_pominiety_bez_klucza` (`_lookup_bir` nie wołany); `test_bir_blad_spada_na_mf`; `test_nazwa_bez_zmiany_liter` (`"FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"` bez zmian).
- [ ] **Step 2:** `python3 -m pytest tests/test_company_lookup.py -q` → FAIL.
- [ ] **Step 3: Zaimplementuj.** `_lookup_bir`: SOAP 1.2 do `https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc` (`Zaloguj(pKluczUzytkownika)` → `sid`; `DaneSzukajPodmioty(pParametryWyszukiwania/Nip)` z nagłówkiem `sid`), wynik XML w `DaneSzukajPodmiotyResult` (pola `Regon, Nazwa, Ulica, NrNieruchomosci, NrLokalu, KodPocztowy, Miejscowosc`); `urllib` + `xml.etree`, timeout 10 s, każdy błąd → `None` + `logger.warning("bir.lookup.error")`. Ulica BIR: przedrostek `ul.` zdejmowany, `ladne_litery` nie rusza (mieszane litery). Brak ulicy (wieś) → `ulica = Miejscowosc + " " + nr`. Dataport: pola przepuszczone przez te same funkcje.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): GUS REGON (po kluczu) → MF → dataport, rozbity adres`.

### Task 3: VIES z numerem potwierdzenia i rozbitym adresem

**Files:**
- Modify: `backend/app/services/vies_service.py`
- Test: `backend/tests/test_vies.py` (istniejące testy mają przejść bez zmian asercji)

**Interfaces:**
- Consumes: Task 1 (`rozbij_adres_vies`, `kraj_z_vat`), `app.services.company_service.get_company()` (NIP zakładu; sprawdź import jak w `wz_service._seller_block`).
- Produces: `vies_check(vat: str, *, timeout: int = 15, attempts: int = 3) -> dict` (rzuca `HTTPException(503)` przy transient, `400` przy złym formacie); `vies_lookup(vat)` = `vies_check(vat)`. Klucze wyniku: dotychczasowe `vatNumber, countryCode, traderName, traderAddress, valid, userError` + `ulica, kodPocztowy, miasto, kraj, requestIdentifier, requestDate`.

- [ ] **Step 1: Testy:** `test_post_z_zapytujacym_zwraca_numer_potwierdzenia` (mock `urlopen` sprawdza: metoda POST, URL `.../rest-api/check-vat-number`, body `requesterMemberStateCode=="PL"`, `requesterNumber` = NIP zakładu bez prefiksu; odpowiedź `{"valid":true,"requestIdentifier":"WAPIAAAAZ1x","requestDate":"2026-11-27T10:00:00.000Z","name":"Emin Handels GmbH","address":"Hauptplatz 7\nAT-4490 St.Florian-Markt"}` → `requestIdentifier=="WAPIAAAAZ1x"`, `ulica=="Hauptplatz 7"`, `kodPocztowy=="4490"`); `test_post_pada_zapas_get` (POST rzuca `HTTPError 500` → GET po staremu, `requestIdentifier==""`); `test_brak_nipu_zakladu_bez_zapytujacego` (pusty NIP firmy → body bez pól requester).
- [ ] **Step 2:** `python3 -m pytest tests/test_vies.py -q` → FAIL.
- [ ] **Step 3: Zaimplementuj.** POST body `{"countryCode","vatNumber","requesterMemberStateCode","requesterNumber"}`; odpowiedź POST ma `valid` (nie `isValid`) — obsłużyć oba. Pętla ponowień jak dziś, `attempts`/`timeout` z parametrów.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): VIES — numer potwierdzenia i rozbity adres`.

### Task 4: Migracje — kraj, status VAT UE, historia

**Files:**
- Modify: `backend/app/migrations.py` (dopisać na końcu listy, blok `# ── Kontrahenci / VAT UE (27.11.2026) ──`), `backend/app/models/clients.py` i `backend/app/models/suppliers.py` (`country: str = ""`), `backend/app/services/clients_service.py` i `suppliers_service.py` (zapis `country`; pusty → `kraj_z_vat(nip)`), `backend/tests/conftest.py` (`"vat_ue_checks"` do `_TRUNCATE`)
- Test: `backend/tests/test_kontrahenci_kraj_db.py`

**Interfaces:**
- Produces (schemat): `clients.country`, `suppliers.country` (`TEXT NOT NULL DEFAULT ''`), `clients.vat_ue_status TEXT NOT NULL DEFAULT ''`, `clients.vat_ue_checked_at TIMESTAMPTZ`, `clients.vat_ue_request_id TEXT NOT NULL DEFAULT ''`, tabela `vat_ue_checks` dokładnie jak w spec §B + indeks `(client_id, checked_at DESC)` i `(loading_id)`. Backfill: `UPDATE clients SET country = CASE WHEN nip ~ '^[A-Za-z]{2}' THEN upper(left(nip,2)) ELSE 'PL' END WHERE country=''` (to samo dla suppliers; `EL`→`GR`).

- [ ] **Step 1: Testy (DB):** `test_create_client_bez_kraju_wylicza_z_vat` (`nip="ATU12345675"` → `country=="AT"`); `test_create_supplier_z_krajem_zapisuje` (`country="IT"`); `test_list_clients_zwraca_vat_ue_status` (świeży klient → `vat_ue_status==""`).
- [ ] **Step 2:** `TEST_DATABASE_URL=… python3 -m pytest tests/test_kontrahenci_kraj_db.py -q` → FAIL.
- [ ] **Step 3:** migracje + modele + serwisy.
- [ ] **Step 4:** PASS; dodatkowo `python3 -m pytest tests/test_suppliers_routes.py tests/test_clients_hdi_names_db.py -q` → PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): kraj kontrahenta, status i historia VAT UE (migracje)`.

### Task 5: Usługa VAT UE + trasy

**Files:**
- Create: `backend/app/services/vat_ue_service.py`, `backend/app/routes/vat_ue.py` (rejestracja w `backend/app/main.py` obok `vies`; uprawnienia domyślne = biuro)
- Test: `backend/tests/test_vat_ue_db.py`

**Interfaces:**
- Consumes: Task 3 `vies_check`, Task 1 `KRAJE_UE`, `kraj_z_vat`, Task 4 schemat.
- Produces:
  - `sprawdz_klienta(client_id: str, *, context: str, order_id: str | None = None, loading_id: str | None = None, wz_id: str | None = None, operator: str = "", timeout: int = 15, attempts: int = 3) -> dict`
  - wynik `{client_id, vat_number, kraj, status: 'aktywny'|'nieaktywny'|'blad'|'nie_dotyczy', request_id, checked_at (ISO), komunikat, ostatni_pewny: {status, checked_at, request_id} | None}`
  - `sprawdz_kurs(loading_id: str, operator: str = "", timeout: int = 15, attempts: int = 3) -> list[dict]` (unikalni klienci zamówień kursu; tylko kraj ∈ UE ≠ PL; z `vehicle_loadings`/zapisanego kursu — ten sam zestaw zamówień co `loading_service.zaladunek(loading_id)["pozycje"]`)
  - `historia(client_id: str, limit: int = 50) -> list[dict]` (najnowsze pierwsze; pola tabeli + `order_no`, `wz_number`)
  - trasy: `POST /api/vat-ue/sprawdz-klienta/{client_id}` (body `{order_id?, wz_id?, context?='reczne'}`), `POST /api/vat-ue/sprawdz-kurs/{loading_id}`, `GET /api/vat-ue/historia/{client_id}`; `operator` z `request.state` jak w innych trasach biura.

Reguły: `nie_dotyczy` nie zapisuje historii. `blad` (HTTPException 503/400, brak numeru) zapisuje historię z `error`, nie zmienia `clients.vat_ue_*`. `aktywny`/`nieaktywny` aktualizuje `clients.vat_ue_status/checked_at/request_id`.

- [ ] **Step 1: Testy (DB, `vies_check` monkeypatch):** `test_aktywny_zapisuje_status_i_historie` (`request_id=="WAPI1"`, `clients.vat_ue_status=="aktywny"`, 1 wiersz w `vat_ue_checks` z `context=="reczne"`); `test_blad_nie_nadpisuje_statusu` (najpierw aktywny, potem 503 → `status=="blad"`, `ostatni_pewny.status=="aktywny"`, `clients.vat_ue_status=="aktywny"`, 2 wiersze historii); `test_klient_pl_nie_dotyczy` (0 wierszy); `test_klient_spoza_ue_nie_dotyczy` (`nip="CHE123"`, `country="CH"`); `test_brak_numeru_vat_to_blad_nie_500` (`country="DE"`, `nip=""` → `status=="blad"`, `komunikat` zawiera „brak numeru VAT UE”); `test_sprawdz_kurs_tylko_zagraniczni_raz_na_klienta` (kurs z 2 zamówieniami tego samego klienta AT + 1 PL → 1 wynik, `loading_id` zapisany).
- [ ] **Step 2:** FAIL. **Step 3:** implementacja. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): kontrola VAT UE z historią i trasy /api/vat-ue`.

### Task 6: Sprawdzenie przy wystawianiu z kursu (serwer)

**Files:**
- Modify: `backend/app/services/loading_service.py` (`wystaw_z_kursu`, ~898)
- Test: `backend/tests/test_vat_ue_db.py` (dopisać)

**Interfaces:**
- Consumes: Task 5 `sprawdz_kurs`.
- Produces: `vat_ue_service.dopelnij_kurs(loading_id: str, operator: str = "") -> None` — sprawdza klientów kursu bez wiersza `vat_ue_checks` z tym `loading_id`, `timeout=8, attempts=1`, każdy wyjątek łapany i logowany (`vat_ue.kurs.error`). Wołane na początku `wystaw_z_kursu`, POZA transakcją wystawienia.

- [ ] **Step 1: Testy:** `test_wystaw_z_kursu_dopelnia_sprawdzenie` (brak wpisu → po wystawieniu 1 wpis `context=="kurs"`); `test_wystaw_z_kursu_nie_dubluje` (wpis już jest → `vies_check` nie wołany); `test_wystaw_z_kursu_dziala_gdy_vies_pada` (`vies_check` rzuca `RuntimeError` → dokumenty wystawione jak bez zmiany). Kurs testowy zbuduj fixture'ami jak w istniejących testach wystawiania z kursu (`grep -l wystaw_z_kursu backend/tests`).
- [ ] **Step 2–4:** FAIL → implementacja → PASS; plus cały plik testów wystawiania z kursu PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): wystawienie z kursu dopełnia kontrolę VAT UE (bez blokady)`.

### Task 7: Front — API, stawka VAT, plakietka, WZ z zamówienia

**Files:**
- Modify: `src/lib/api.ts` (typy `NipCompany`, `ViesCompany` o nowe pola; `vatUeApi`; `kontrahenciApi` z Task 10; `country`, `vatUeStatus`, `vatUeCheckedAt`, `vatUeRequestId` w mapowaniu klienta i `CreateClientDto`; `country` w dostawcy), `src/features/wz/wzVat.ts`, `src/protrima/modules/orders/wz/model.ts`, `src/protrima/modules/orders/wz/WzZamowienia.tsx`, `src/protrima/modules/orders/wz/DopiszPozycjeDialog.tsx`
- Create: `src/protrima/modules/kontrahenci/VatUeBadge.tsx`
- Test: `src/features/wz/wzVat.test.ts`, `src/protrima/modules/orders/wz/` (istniejący test WZ — dopisać), `src/protrima/modules/kontrahenci/VatUeBadge.test.tsx`

**Interfaces:**
- Consumes: Task 5 trasy.
- Produces:
  - `export type VatUeStatus = 'aktywny' | 'nieaktywny' | 'blad' | 'nie_dotyczy' | ''`
  - `export interface VatUeWynik { clientId: string; vatNumber: string; kraj: string; status: VatUeStatus; requestId: string; checkedAt: string; komunikat: string; ostatniPewny: { status: VatUeStatus; checkedAt: string; requestId: string } | null }`
  - `vatUeApi.sprawdzKlienta(clientId: string, opts?: { orderId?: string; wzId?: string; context?: string }): Promise<VatUeWynik>`, `vatUeApi.sprawdzKurs(loadingId: string): Promise<VatUeWynik[]>`, `vatUeApi.historia(clientId: string): Promise<VatUeHistoria[]>`
  - `stawkaVatDlaNabywcy(nip, vatUe?: VatUeStatus): number` — zagranica + `'nieaktywny'` → `VAT_KRAJOWY`
  - `zNabywca(f, buyer, vatUe?)` i nowa `zeStatusemVatUe(f: FormWz, przed: VatUeStatus, po: VatUeStatus): FormWz` (zmienia tylko wiersze ze stawką domyślną dla `przed`)
  - `<VatUeBadge wynik={VatUeWynik | null} ladowanie={boolean} onPonow={() => void} />`. Teksty: aktywny → „VAT UE aktywny · potw. {requestId}”; nieaktywny → „VAT UE NIEAKTYWNY — wystaw fakturę z VAT 5 %”; blad → „VIES nie odpowiada — ostatni wynik z {DD.MM}: {status} · Sprawdź ponownie” (bez ostatniego: „VIES nie odpowiada — nie sprawdzono · Sprawdź ponownie”); nie_dotyczy → nic.

- [ ] **Step 1: Testy:** `wzVat.test.ts`: `stawkaVatDlaNabywcy('ATU1','nieaktywny')===5`, `('ATU1','aktywny')===0`, `('ATU1','blad')===0`, `('1112223334','nieaktywny')===5`. Test formularza WZ (jsdom, mock `vatUeApi.sprawdzKlienta` → nieaktywny): wiersze z 0 % mają 5 %, widać tekst „VAT UE NIEAKTYWNY”; `zmiana statusu nie rusza ręcznie zmienionej stawki` (wiersz ręcznie 8 % zostaje 8 %); `formularz działa gdy sprawdzenie rzuca` (badge szary, pola edytowalne). `VatUeBadge.test.tsx`: cztery stany i `onPonow` po kliknięciu „Sprawdź ponownie”.
- [ ] **Step 2:** `npx vitest run src/features/wz/wzVat.test.ts src/protrima/modules/orders/wz src/protrima/modules/kontrahenci/VatUeBadge.test.tsx` → FAIL.
- [ ] **Step 3:** implementacja. W `WzZamowienia` sprawdzenie raz po załadowaniu `clientId` (i ponownie po zmianie odbiorcy), badge nad pozycjami; `DopiszPozycjeDialog` bierze status z `clientsApi` karty nabywcy (bez nowego sprawdzenia).
- [ ] **Step 4:** PASS + `npx tsc --noEmit` czysto.
- [ ] **Step 5:** commit `feat(kontrahenci): VAT UE na WZ z zamówienia — plakietka i stawka krajowa przy nieaktywnym`.

### Task 8: Papiery kursu — plakietki VAT UE

**Files:**
- Modify: `src/protrima/modules/wysylki/PapieryKursu.tsx`
- Test: `src/protrima/modules/wysylki/PapieryKursu.test.tsx`

**Interfaces:**
- Consumes: Task 7 `vatUeApi.sprawdzKurs`, `VatUeBadge`.

- [ ] **Step 1: Testy:** po wczytaniu kursu woła `sprawdzKurs(kursId)` raz; wiersz odbiorcy z `client_id` = wynik pokazuje plakietkę (nieaktywny → tekst „wystaw fakturę z VAT 5 %”); `plakietka blad pokazuje ostatni pewny wynik`; „Sprawdź ponownie” woła `sprawdzKlienta(clientId, {context:'kurs'})` i podmienia plakietkę tego klienta; odrzucone `sprawdzKurs` → „Wystaw komplet” dalej aktywny.
- [ ] **Step 2–4:** FAIL → implementacja (stan `vatUe: Record<clientId, VatUeWynik>`, plakietka w nagłówku wiersza odbiorcy w sekcji „Do wystawienia” i w liście wystawionych) → PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): papiery kursu pokazują status VAT UE odbiorców`.

### Task 9: Moduł PROTRIMA „Kontrahenci” — lista, karty, pobieranie

**Files:**
- Create: `src/protrima/modules/kontrahenci/KontrahenciModule.tsx`, `model.ts`, `KartaOdbiorcy.tsx`, `KartaDostawcy.tsx`, `PobierzDane.tsx`, `kontrahenci.css` (jeśli moduły mają własne style — wzorować się na `receptury`), testy `model.test.ts`, `Kontrahenci.test.tsx`
- Modify: `src/protrima/App.tsx` (~448: `if (t.key === 'kontrahenci') return <KontrahenciModule active={isActive} setCtx={setTabCtx} setCmds={setCmds} />`), `src/protrima/shell/modules.tsx` (`'kontrahenci'` do `W_PROTRIMA`, `info` usunąć), `src/protrima/shell/modules.test.ts`

**Interfaces:**
- Consumes: `clientsApi`, `suppliersApi`, `companyApi`, Task 7 (`VatUeBadge`, `vatUeApi`).
- Produces (`model.ts`):
  - `type Rodzaj = 'odbiorcy' | 'dostawcy'`
  - `filtruj<T extends { name: string; displayName?: string; nip?: string; city?: string }>(lista: T[], szukaj: string): T[]` (bez wielkości liter i polskich znaków)
  - `zrodloDlaNumeru(wpis: string): 'gus' | 'vies' | null` (10 cyfr lub `PL`+10 → gus; 2 litery + ≥2 znaki → vies; inaczej null)
  - `interface PolePorownania { pole: 'name'|'nip'|'regon'|'address'|'postalCode'|'city'|'country'; etykieta: string; obecne: string; pobrane: string; przejmij: boolean }`
  - `porownanie(obecne: Partial<Formularz>, pobrane: Partial<Formularz>, nowy: boolean): PolePorownania[]` — `przejmij` = `nowy ? pobrane !== '' : (obecne === '' && pobrane !== '')`; pola z identyczną wartością pomijane
  - `zastosuj(form, wiersze): form`

UI (spec §D): lista po lewej (kolumny: nazwa wyświetlana/pełna, kraj z flagą `FlagIcon`, NIP/VAT, miasto, status VAT UE kropką z datą, grupa), przełącznik Odbiorcy/Dostawcy, szukaj (`/` fokusuje), filtr „VAT UE nieaktywny / nie sprawdzony”, „+ Dodaj” (Ctrl+N). Karta po prawej z sekcjami jak w spec; zapis Ctrl+S / przycisk; „Usuń” = dezaktywacja z potwierdzeniem. `PobierzDane`: pole „NIP lub VAT UE” + Enter → tabela porównania z ptaszkami + „Surowy adres ({zrodlo}): …” + „Przejmij zaznaczone”. Przy odbiorcy z UE sekcja VAT UE: badge, „Sprawdź teraz” (`context:'reczne'`), historia (`vatUeApi.historia`) z datą, statusem, numerem potwierdzenia, kursem/zamówieniem.

Wejście z innych modułów: `useApp().openModule('kontrahenci')` + zapamiętany wybór w `sessionStorage['protrima.kontrahenci.wybrany'] = clientId` (moduł czyta go przy montażu i czyści). Link na nazwie odbiorcy w nagłówku zamówienia (`src/protrima/modules/orders/OrderDetail.tsx`) i w wierszu odbiorcy w `PapieryKursu`.

- [ ] **Step 1: Testy:** `model.test.ts` — `zrodloDlaNumeru('1112223334')==='gus'`, `('ATU12345675')==='vies'`, `('12')===null`; `porownanie` nowy vs istniejący (`pobranie do istniejącej karty nie zaznacza wypełnionych pól`); `filtruj('kosice')` znajduje „Košice”. `Kontrahenci.test.tsx` (jsdom, mock API danymi z kartoteki prod): lista pokazuje odbiorców, przełącznik na dostawców; dodanie: wpis NIP + Enter → porównanie → „Przejmij” wypełnia pola → Enter zapisuje (`clientsApi.create` z `country`); MF zwraca pusty adres rozbity → widać surowy napis; Esc zamyka kartę bez zapisu; karta dostawcy ma WNI i zakres dostaw; ustawiony `sessionStorage['protrima.kontrahenci.wybrany']` otwiera kartę tego klienta.
- [ ] **Step 2–4:** FAIL → implementacja → PASS + `npx tsc --noEmit`.
- [ ] **Step 5:** commit `feat(protrima): dział Kontrahenci — odbiorcy i dostawcy, pobieranie z GUS/VIES`.

### Task 10: Grupy odbiorców i „Popraw adresy”

**Files:**
- Create: `backend/app/services/kontrahenci_adresy_service.py`, `backend/app/routes/kontrahenci.py` (rejestr w `main.py`), `src/protrima/modules/kontrahenci/GrupyDialog.tsx`, `PoprawAdresyDialog.tsx`
- Test: `backend/tests/test_kontrahenci_adresy_db.py`, `src/protrima/modules/kontrahenci/PoprawAdresy.test.tsx`

**Interfaces:**
- Consumes: Task 1, Task 4; istniejące API grup (`ClientGroupsModal` — te same wywołania `api.ts`).
- Produces:
  - `propozycje() -> list[dict]` — `{rodzaj:'odbiorca'|'dostawca', id, nazwa, obecne:{address,postal_code,city,country}, proponowane:{…}}` tylko gdy różne. Źródło propozycji: złożony napis `address, postal_code city` przez `rozbij_adres_pl` (kraj PL) albo `normalizuj_kod` + `ladne_litery` (kraj ≠ PL); brak rejestrów zewnętrznych.
  - `zastosuj(zmiany: list[{rodzaj, id, address, postal_code, city, country}]) -> {zmieniono: int}` w jednej transakcji.
  - `GET /api/kontrahenci/propozycje-adresow`, `POST /api/kontrahenci/zastosuj-adresy`; front `kontrahenciApi.propozycjeAdresow()`, `kontrahenciApi.zastosujAdresy(zmiany)`.

- [ ] **Step 1: Testy:** backend: `" Košice"`/`"04022 "` (SK) → `"Košice"`/`"040 22"`; `"JANA KILIŃSKIEGO 17"`+`"40-001"`+`"KATOWICE"` → `"Jana Kilińskiego 17"`, `"Katowice"`; poprawny adres nie trafia na listę; `zastosuj` zmienia tylko wskazane id. Front: lista wierszy obecne → proponowane, domyślnie wszystkie zaznaczone, odznaczenie jednego → `zastosujAdresy` bez niego; pusta lista → „Wszystkie adresy wyglądają dobrze”.
- [ ] **Step 2–4:** FAIL → implementacja (GrupyDialog = port `ClientGroupsModal` w komponentach PROTRIMA `Dialog`) → PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): grupy odbiorców i poprawa adresów w kartotece`.

### Task 11: Stary MES — nowy kształt lookupu i pole Kraj

**Files:**
- Modify: `src/components/ui/GusLookup.tsx`, `src/components/ui/ViesLookup.tsx`, `src/pages/office/ClientsPage.tsx` (usunąć `viesAddress`/`splitPostalCity`/`gusAddress` — brać `ulica/kod/miasto` z serwera; pole Kraj), `src/pages/office/SuppliersPage.tsx` (pole Kraj, nowy kształt)
- Test: istniejące testy stron + `npx tsc --noEmit`

- [ ] **Step 1:** test jsdom dla `ClientsPage` formularza: wynik VIES z `ulica:"Hauptstr. 21", kodPocztowy:"50667", miasto:"Köln"` wypełnia pola 1:1.
- [ ] **Step 2–4:** FAIL → implementacja → PASS.
- [ ] **Step 5:** commit `feat(kontrahenci): stary MES korzysta z rozbitego adresu z serwera, pole Kraj`.

### Task 12: Wersja, pełne testy, zrzuty do akceptacji

**Files:**
- Modify: wersja PROTRIMA 0.18.0 (te same pliki co przy 0.17.0: `git show c068d217 --stat` pokazuje, gdzie podbijano)

- [ ] **Step 1:** `TEST_DATABASE_URL=… python3 -m pytest -q` (backend całość) → zielone (znany flaky test tempa odnotować, jeśli padnie).
- [ ] **Step 2:** `npx vitest run` i `npx tsc --noEmit` → zielone.
- [ ] **Step 3:** lokalny stos (osobna baza `kebab_mes_test_zrzuty_kontrahenci` z kopią kartoteki klientów/dostawców z prod, backend + vite `protrima.html`), zrzuty: lista odbiorców, karta z VAT UE + historia, pobieranie z porównaniem (PL i UE), „Popraw adresy”, papiery kursu z plakietką nieaktywny, WZ z zamówienia ze stawką 5 %. VIES/GUS w zrzutach zamockowane.
- [ ] **Step 4:** artefakt ze zrzutami → link właścicielowi; czekać na akceptację przed wydaniem.
- [ ] **Step 5:** commit `chore(protrima): 0.18.0 — Kontrahenci`.
