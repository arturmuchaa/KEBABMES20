# Kontrola HACCP przy przyjęciu surowca + podpisy elektroniczne

**Data:** 2026-08-31
**Status:** do zatwierdzenia
**Ekrany:** Przyjęcie surowca (biuro), Menu serwisowe kiosku Rozbiór (0099), karty 1.1.1 i 1.1.1/2

## Problem

Karta 1.1.1 „oPRP Rejestr przyjęcia artykułów pochodzenia zwierzęcego" ma trzynaście
kolumn (a–m). MES wypełnia dziś **pięć** — numer przyjęcia, dostawcę, asortyment, datę
i dokument. Osiem pozostałych zakład prowadzi długopisem albo nie prowadzi wcale:

| Kol. | Treść | Dziś |
|---|---|---|
| f | Ocena wizualna dostawy. Książka mycia pojazdu | długopis |
| g | Temperatura komory [°C] | długopis |
| h | Temperatura mięsa [°C] | długopis |
| i | Zgodność kg z zamówieniem i dokumentami | długopis |
| j | Uwagi | długopis |
| k | Ocena całej dostawy (K / N) | długopis |
| l | Wykonał | podpis odręczny |
| m | Sprawdził | podpis odręczny |

Komentarz w `src/lib/receptionRegisterRows.ts` mówi wprost, dlaczego: *„Tych nie
wypełniamy nigdy — nie ma ich skąd wziąć, a wydruk na koniec miesiąca i tak nie da
się już uzupełnić długopisem przy dostawie."* To przestaje być prawdą w chwili, gdy
system zacznie te dane zbierać przy przyjęciu.

Karta 1.1.1/2 (szczegółowa) drukuje się już prawie kompletna — brakuje wyłącznie
uwag i podpisu.

## Stan wyjściowy — co system już ma

Zbadane 2026-08-31 na `/opt/kebab/kebab_new/kebab_fixed`:

| Fakt | Znaczenie dla projektu |
|---|---|
| `receptions` — dokument dostawy, numer `12/08/2026`, grupy = numery porządkowe | jest do czego doczepić kontrolę |
| `PUT /api/receptions/{id}` przepisuje **cały** dokument (`ReceptionUpdate`) | pola HACCP **nie mogą** siedzieć w `receptions` — edycja dostawy by je wyzerowała |
| `progPrzyjecia()` w `features/raw-batches/storageState.ts` | progi już istnieją: mrożone ≤ −12 °C, czerwone ≤ +7 °C, drób ≤ +4 °C |
| `ReceptionRegisterPrintPage.tsx` + `GET /api/karty-haccp/rejestr-przyjecia/pdf?dane=1` | karta i mechanizm wydruku gotowe, brakuje danych |
| `workers.pin_hash`, `auth_service.login_pin()`, `verify_secret()` | tożsamość z PIN-em istnieje i jest już używana na HMI |
| `app_users` (biuro, hasło) i `workers` (hala, PIN) to **dwie różne** tożsamości | podpis musi wybrać jedną — patrz Decyzje |
| `features/deboning/ServiceMenu.tsx`, `SERVICE_CODE = '0099'`, przytrzymanie 3 s | miejsce na rysowanie wzoru podpisu istnieje |
| Modal serwisowy ma 380 px szerokości | pole rysowania **nie zmieści się w nim** — musi być osobną nakładką na pełny ekran |
| Kiosk ma frontend **wbudowany** | zmiana w menu serwisowym wymaga wydania: bump wersji + tag `rozbior-v10-*` |
| `audit_log` (middleware) zapisuje każde żądanie | ślad kto z biura otworzył dialog podpisu jest za darmo |
| Podpisów nie ma w systemie w żadnej postaci | wszystko od zera |

Wzór wypełnionej karty odczytany z `/root/hccap przyjecie - produkcja.pdf` (skan,
OCR): dostawa KOKO, ćwiartka, 01.08, temperatury w kolumnach g/h, ocena `b/z`,
kwalifikacja `K`.

## Decyzje

Podjęte przez właściciela 2026-08-31:

1. **Przyjęcie zapisuje się jak dziś; dane HACCP dochodzą później** (np. po pół
   godziny). Żadnej blokady zapisu. System ma się o brakujące dane **upominać**.
2. **Wpis robi biuro** w formularzu przyjęcia. Docelowo powstanie przy rampie, ale
   tam nie ma dziś komputera — rekord i endpoint mają być na to gotowe bez przeróbek.
3. **Jedna para temperatur na dostawę** — komory i mięsa, zawsze **najwyższy** odczyt,
   zgodnie z instrukcją 1.1. Nie lista odczytów, nie pomiar per numer porządkowy.
4. **Wzór podpisu rysuje się wyłącznie na HMI rozbioru**, w menu serwisowym pod 0099.
   To jedyny dotykowy ekran, jaki zakład ma.
5. **Podpisujący = osoba z kartoteki pracowników** (`workers`). Konsekwencja decyzji 4:
   HMI zna tylko tę tożsamość. Karta HACCP i tak wymaga człowieka, nie loginu.
6. **Podpis składa się w biurze**, wybierając osobę z listy — **z PIN-em**. Wybrana
   osoba podchodzi i wbija swój PIN. Sam wybór z listy nie wystarcza.
7. **Dwa osobne uprawnienia** nadawane w panelu Pracownicy: „Podpis: wykonał"
   i „Podpis: sprawdził". Kolumna m ma węższą grupę (kierownik, technolog).
8. **Ta sama osoba może podpisać obie role** — system ostrzega, nie blokuje
   (w sobotę bywa jeden człowiek).
9. **Zakres pól:** komplet kolumn f–m **plus** działanie korygujące przy ocenie N
   (opis niezgodności, podjęte działanie, godzina). Dane transportu i kontrola
   dokumentów weterynaryjnych — odrzucone, poza zakresem.
10. **Karta 1.1.1 staje się w pełni elektroniczna.** Wydruk na koniec miesiąca idzie
    do segregatora i nie jest już uzupełniany długopisem. Pusty druk zostaje jako
    awaryjny.

## Architektura

### Dane: osobna tabela, nie kolumny w `receptions`

```sql
CREATE TABLE reception_checks (
    reception_id   TEXT PRIMARY KEY REFERENCES receptions(id) ON DELETE CASCADE,
    visual         TEXT,            -- kol. f: 'bz' | 'N'
    temp_chamber   NUMERIC(4,1),    -- kol. g: NAJWYŻSZY odczyt
    temp_meat      NUMERIC(4,1),    -- kol. h: NAJWYŻSZY odczyt
    kg_match       TEXT,            -- kol. i: 'bz' | 'N'
    notes          TEXT NOT NULL DEFAULT '',   -- kol. j
    verdict        TEXT,            -- kol. k: 'K' przyjęta | 'N' odmowa
    nc_description TEXT NOT NULL DEFAULT '',   -- działanie korygujące przy N
    nc_action      TEXT NOT NULL DEFAULT '',
    nc_at          TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL
);
```

Wszystkie pola oceny są `NULL`-owalne, bo wpis powstaje po zapisaniu dostawy.

**Dlaczego nie kolumny w `receptions`:** `PUT /api/receptions/{id}` przepisuje cały
dokument. Ktoś poprawi kilogramy, a formularz bez sekcji HACCP po cichu wyzeruje
zmierzoną temperaturę. To jest ten sam rodzaj cichej straty danych, który wystąpił
przy korektach rozbioru (`kebab-rozbior-bledy-operatora`). Osobna tabela jest na to
odporna z definicji.

**Dlaczego nie uniwersalna `haccp_checks`:** każda karta księgi ma inny zestaw pól.
Wspólna tabela byłaby workiem na `NULL`-e. YAGNI.

### Podpisy: dwie tabele, mechanizm ogólny od początku

```sql
-- WZÓR: rysowany raz na HMI, jeden na osobę
CREATE TABLE signature_samples (
    worker_id  TEXT PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    png        TEXT NOT NULL,          -- data:image/png;base64
    created_at TIMESTAMPTZ NOT NULL
);

-- AKT PODPISANIA: jeden wiersz na każdy podpis pod dokumentem
CREATE TABLE document_signatures (
    id            TEXT PRIMARY KEY,
    doc_type      TEXT NOT NULL,       -- 'reception_check'
    doc_id        TEXT NOT NULL,
    role          TEXT NOT NULL,       -- 'wykonal' | 'sprawdzil'
    worker_id     TEXT NOT NULL REFERENCES workers(id),
    signer_name   TEXT NOT NULL,       -- MIGAWKA nazwiska
    png           TEXT NOT NULL,       -- KOPIA wzoru z chwili podpisu
    content_hash  TEXT NOT NULL,       -- sha256 podpisanej treści
    signed_at     TIMESTAMPTZ NOT NULL,
    superseded_at TIMESTAMPTZ          -- podpis unieważniony zmianą danych
);
CREATE UNIQUE INDEX uq_document_signatures_active
    ON document_signatures (doc_type, doc_id, role)
    WHERE superseded_at IS NULL;
CREATE INDEX idx_document_signatures_doc
    ON document_signatures (doc_type, doc_id);
```

Mechanizm jest ogólny (`doc_type`, `doc_id`) od pierwszego dnia, bo „Wykonał /
Sprawdził" stoi też na raporcie rozbioru 2.1.1, zaleceniu produkcyjnym 2.5.1
i karcie temperatur 5.1.1.1. Koszt ogólności to jedna kolumna tekstowa.

Trzy własności, na których stoi wiarygodność:

**Obrazek i nazwisko są kopiowane, nie referencjonowane.** Gdyby wydruk sięgał do
`signature_samples`, przerysowanie wzoru zmieniłoby dokumenty sprzed roku, a odejście
pracownika z firmy mogłoby je wyczyścić. Kopia w wierszu podpisu zamraża stan z chwili
złożenia.

**`content_hash` wiąże podpis z treścią.** Liczony z kanonicznej reprezentacji
podpisywanych danych: numer przyjęcia, dostawca, data dostawy, suma kg, oraz komplet
pól `reception_checks`. Serializacja stabilna (posortowane klucze, `Decimal` jako
tekst z ustaloną liczbą miejsc, `None` jako pusty string) — inaczej hash zmienia się
sam z siebie i unieważnia poprawne podpisy.

**Zmiana danych po podpisaniu unieważnia podpis.** `PUT /reception-checks/{id}`
porównuje nowy hash z hashem aktywnych podpisów; różnica ustawia im `superseded_at`.
Wiersze zostają w bazie (historia), ale karta ich nie drukuje, a ekran żąda podpisania
od nowa. Bez tego „podpis elektroniczny" jest obrazkiem, który da się przykleić do
dowolnej treści — i to jest pierwszy zarzut, jaki postawi audytor.

**Akt podpisania to osobne uwierzytelnienie, nie sesja.** Zalogowana sesja biura
znaczy tylko tyle, że ktoś zostawił otwartą przeglądarkę. Podpis wymaga PIN-u
podpisującego, weryfikowanego przez istniejące `verify_secret(pin, workers.pin_hash)`.
Błędne próby liczone tak jak przy logowaniu (`_record_failure` / `_reset_failures`),
z tą samą blokadą czasową.

### Uprawnienia

```sql
ALTER TABLE workers ADD COLUMN IF NOT EXISTS can_sign_performed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS can_sign_checked   BOOLEAN NOT NULL DEFAULT false;
```

Dwa checkboxy w karcie pracownika. Dialog podpisu filtruje listę po uprawnieniu
odpowiadającym kolumnie, a backend sprawdza je **ponownie** przy zapisie — filtr
w UI nie jest kontrolą dostępu.

### API

| Metoda | Ścieżka | Rola |
|---|---|---|
| `GET` | `/api/receptions/{id}/check` | wpis HACCP dostawy wraz z podpisami i ich aktualnością; dla dostawy bez wpisu zwraca **pusty szkic**, nie 404 — brak wpisu jest stanem normalnym, nie błędem |
| `PUT` | `/api/receptions/{id}/check` | zapis/aktualizacja wpisu; unieważnia podpisy przy zmianie treści |
| `GET` | `/api/receptions/haccp-pending?days=14` | dostawy bez kompletu — źródło kafla na pulpicie i znaczników na liście |
| `POST` | `/api/signatures` | złożenie podpisu: `{docType, docId, role, workerId, pin}` |
| `GET` | `/api/signatures/eligible?role=wykonal` | pracownicy z uprawnieniem **i** z wzorem podpisu |
| `GET` | `/api/signature-samples/{workerId}` | wzór do podglądu (kiosk) |
| `PUT` | `/api/signature-samples/{workerId}` | zapis wzoru: `{png, pin}` — kiosk, po kodzie 0099 |

`PUT /signature-samples/{workerId}` wymaga PIN-u tej osoby, nie tylko kodu
serwisowego: kod 0099 otwiera menu, ale nie upoważnia kierownika do narysowania
cudzego podpisu.

### Ekrany

**Formularz przyjęcia — sekcja „Kontrola HACCP"** (`ReceptionForm.tsx`). Widoczna po
zapisaniu dostawy, wypełniana kiedykolwiek później. Pola: ocena wizualna (b/z · N),
temperatura komory, temperatura mięsa, zgodność kg (b/z · N), uwagi, ocena całej
dostawy (K · N), a przy jakimkolwiek N — trzy pola działania korygującego. Pod spodem
dwa sloty podpisu: „Wykonał" i „Sprawdził".

Temperatury walidowane przez istniejące `progPrzyjecia(kategoria, stan)`; przekroczenie
progu nie blokuje zapisu (dostawa mogła być odrzucona — to trzeba zapisać), tylko
zaznacza pole i podpowiada wypełnienie działania korygującego.

**Dialog podpisu.** Wybór osoby z listy zawężonej do uprawnionych, podgląd jej wzoru,
pole PIN, przycisk „Podpisz". Osoba bez wzoru nie pojawia się na liście, a dialog
tłumaczy dlaczego: *„Brak wzoru podpisu — narysuj go na HMI rozbioru: przytrzymaj 3 s,
kod 0099, «Wzory podpisów»."* Wybór tej samej osoby, która podpisała już drugą rolę,
daje ostrzeżenie („Ta sama osoba podpisze wykonanie i sprawdzenie") z możliwością
kontynuowania — decyzja 8.

**Ocena `N` = odmowa przyjęcia.** Kwalifikacja `N` w kolumnie k oznacza, że dostawy
nie przyjęto — a przyjęcie jest już w systemie i **dodało surowiec na magazyn**,
bo wpis HACCP powstaje później. Zapis `verdict='N'` nie może zostawić tego stanu bez
komentarza: dialog pyta *„Dostawa odrzucona — anulować przyjęcie i zdjąć surowiec ze
stanu?"* i prowadzi do **istniejącej** ścieżki anulowania przyjęcia
(`kebab-anulowanie-przyjecia`). Sam wpis HACCP zostaje niezależnie od decyzji: karta
1.1.1 rejestruje również dostawy odrzucone, bo służy ocenie dostawców. Automatycznego
anulowania nie robimy — cofnięcie ruchów magazynowych to decyzja człowieka.

**HMI rozbioru — „Wzory podpisów"** (`ServiceMenu.tsx`). Nowy kafel w menu pod 0099.
Otwiera **nakładkę na pełny ekran** (modal serwisowy ma 380 px, pole rysowania się
w nim nie mieści): lista pracowników → wybór osoby → PIN → pole rysowania → podgląd →
zapis. Kierownik przechodzi listę raz i wywołuje kolejne osoby.

`SignaturePad` — goły `<canvas>` + Pointer Events, ten sam kod pod palec i pod mysz.
**Bez biblioteki zewnętrznej**: CSP w Tauri jest restrykcyjne i już raz kosztowało
zakład czas (`tauri-okna-i-inline-skrypty`). Normalizacja przy zapisie: przycięcie do
bounding boxa rysunku, skala do 600×200 px, czarny na przezroczystym tle, PNG base64.

**Upomnienia.** Trzy miejsca, żadnej blokady:
* po zapisaniu przyjęcia — baner „Dostawa zapisana. Uzupełnij kontrolę HACCP" z przyciskiem;
* lista przyjęć (`RawBatchesTable.tsx`) — znacznik w wierszu: `HACCP: brak` / `bez podpisów` / komplet;
* pulpit (`DashboardPage.tsx`) — kafel „Przyjęcia bez kompletu HACCP: 3".

Pulpit pokazuje **stan, nie archiwum** (`kebab-pulpit-stan-nie-archiwum`), więc kafel
liczy wyłącznie otwarte braki z ostatnich 14 dni.

**Karty.** `receptionRegisterRows.ts` — `mainRows()` dostaje kolumny f–k z
`reception_checks`, a l/m jako `<img>` z aktywnych podpisów. Karta 1.1.1/2 dostaje
kolumnę „Podpis" — podpis „wykonał" z przyjęcia powtórzony przy każdym numerze
porządkowym tej dostawy, dokładnie jak na papierze. Wiersze zostają 9,5 mm (1.1.1)
i 10,5 mm (1.1.1/2), skala obrazka dopasowana do wysokości kratki.

Podpis unieważniony (`superseded_at IS NOT NULL`) **nie drukuje się wcale**. Pusta
kratka jest uczciwa; podpis pod zmienioną treścią nie jest.

Nagłówkowy komentarz `receptionRegisterRows.ts` — do przepisania. Zdanie „tych nie
wypełniamy nigdy" przestaje być prawdą i zostawione wprowadzałoby w błąd.

## Etapy

**Faza 1 — dane i upomnienia.** `reception_checks`, API wpisu, sekcja w formularzu,
znaczniki na liście, kafel na pulpicie, kolumny f–k na karcie 1.1.1. Działa samodzielnie:
karta robi się kompletniejsza jeszcze przed podpisami.

**Faza 2 — podpisy.** Obie tabele, uprawnienia w kartotece, `SignaturePad`, kafel
w menu serwisowym, dialog podpisu, kolumny l–m, kolumna „Podpis" na 1.1.1/2.
Wymaga **wydania kiosku**: bump wersji + tag `rozbior-v10-*`, bo hala ma frontend
wbudowany i sam deploy na VPS nic tam nie zmieni.

**Faza 3 — HMI przy rampie.** Gdy stanie tam komputer. Rekord, endpoint i komponent
rysowania już istnieją; dochodzi wyłącznie ekran wpisu.

## Testy

* `receptionRegisterRows.test.ts` — rozszerzony o kolumny f–m, w tym przypadek podpisu
  unieważnionego (kratka ma zostać pusta).
* Nowy test kanonicznej treści i hasha: zmiana temperatury o 0,1 °C **musi** zmienić
  hash; zmiana kolejności kluczy **nie może**.
* Test unieważniania: zapis wpisu po podpisaniu ustawia `superseded_at` i zwalnia
  indeks unikalny pod nowy podpis.
* Test uprawnień: `POST /signatures` z pracownikiem bez `can_sign_checked` w roli
  `sprawdzil` → 403, mimo poprawnego PIN-u.
* Test PIN-u: błędny PIN nie tworzy wiersza podpisu i podbija `failed_attempts`.
* Test oceny `N`: zapis `verdict='N'` **nie** rusza sam z siebie stanu magazynu ani
  ruchów — anulowanie pozostaje osobną, świadomą czynnością.
* Testy backendu uruchamiane z **pełnym** `TEST_DATABASE_URL`
  (`postgresql://postgres:p@localhost:55437/kebab_mes_test`) — bez tego testy bazy
  cicho się pomijają i dają fałszywą zieloną (`kebab-backend-test-db`).
* Test komponentu sekcji HACCP — ekran z temperaturami, ta sama zasada co ekrany
  z kilogramami (`kebab-narzedzia-wdrozeniowe`).

## Świadomie poza zakresem

* Dane transportu (nr rejestracyjny, godzina przyjazdu, plomba, rejestrator auta).
* Kontrola dokumentów weterynaryjnych jako osobne haczyki.
* Rysowanie wzoru w biurze myszą — komponent to umożliwi, trasa nie powstaje.
* Podpisy na kartach 2.1.1, 2.5.1 i 5.1.1.1 — mechanizm jest na nie gotowy, wpięcie
  to osobna praca.
* Twarda blokada zapisu przyjęcia bez kompletu HACCP — odrzucona świadomie.
