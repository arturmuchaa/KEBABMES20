# Panel masowania — kiosk hali (projekt)

Data: 2026-09-17
Prototyp: artefakt `Panel masowania` (`claude.ai/artifact/Sn1GVZUkJ2qHg7RtDrUzq6`, wersja 0.9)
Ustalenia hali: `kebab-masownia-hmi-prototyp` (pamięć)

## Po co

Masownia pracuje dziś na ekranie `MixingHmiV2Page` pomyślanym jak tablet: jedno
zlecenie, jedna maszyna, wybór partii z listy. Hala pracuje inaczej — trzy
masownice chodzą po 50 minut, operator w tym czasie odważa przyprawy na
następne wsady, a mięso przyjeżdża paletami z ważenia zbiorczego. Prototyp
0.9 opisuje ten rytm i został przyjęty bez zastrzeżeń; ten dokument zamienia
go w ekran podpięty do MES.

Jedyna zmiana wobec prototypu: **wybór mięsa ma szanować plan biura**.

## Zakres

W zakresie:

- nowy kanał kiosku `masowanie` (osobne wejście, osobny instalator, jak „produkcja");
- dwa tory pracy z prototypu: przygotowanie przypraw do pojemnika i załadunek maszyny;
- kafelki mięsa z bramką partii wybranych przez biuro;
- waga przypraw przez istniejący most RS232;
- szkielet mostu dozownika wody, gotowy pod moduł RS-485.

Poza zakresem:

- `MixingHmiV2Page` i `MixingTabletPage` — zostają nietknięte do czasu odbioru
  nowego panelu przez halę;
- księgowanie masowania (`finish_mixing_session`) — panel je woła, nie przepisuje;
- sterowanie dozownikiem DW-1C przez Modbus — dochodzi po dokupieniu modułu.

## Skąd się bierze kafelek mięsa

Jedno źródło prawdy: partie z `meat_stock`. Pochodzenie partii nie ma znaczenia —
mięso z rozbioru i mięso kupione na zewnątrz (z/s, filet z mostka, indyk) leżą
w tej samej tabeli, więc zakup pokazuje się sam, bez osobnej ścieżki.

Dla każdej partii panel buduje kafelki:

1. **Kafelek palety** — dla każdej palety z ważenia zbiorczego (`meat_pallets`),
   która ma jeszcze wolne kilogramy. Pokazuje numer `PAL/…`, kg wolne, skład
   partii i termin przydatności.
2. **Kafelek partii (paleciak)** — dla kilogramów partii, których nie obejmuje
   żadna paleta. Operator wpisuje zważone kg z klawiatury numerycznej, bo
   paleciak z wagą nie jest podpięty do systemu. Tędy idą filet z mostka,
   indyk i każde mięso, którego hala nie waży zbiorczo.

Kilogramy wolne palety = `kg_net` palety − suma kg pobranych z tej palety przez
wsady (`mixing_charge_pallets`). Kilogramy partii poza paletami = wolne kg
partii − suma wolnych kg jej palet; ujemny wynik znaczy zero, nie błąd.

## Bramka partii

Czysta funkcja `src/features/masownia/meatGate.ts`, bez zależności od React i API.

Wejście: kafelki mięsa + partie zlecenia (`order.meatLots`, czyli wybór biura
z planowania masowania). Wyjście: te same kafelki z flagą `allowed` i powodem
odmowy do wyświetlenia.

Reguły:

- **Zlecenie bez partii** (biuro nie wskazało nic) → wszystkie kafelki dostępne.
  Na produkcji to częsty przypadek: z 12 ostatnich zleceń 8 nie ma ani jednej
  partii.
- **Zlecenie z partiami** → dostępne tylko kafelki z tych partii. Reszta zostaje
  na ekranie, ale szara i nieklikalna, z podpisem, którą partię wskazało biuro.
  Operator ma widzieć, że mięso jest — tylko nie to.
- **Paleta mieszana** (skład z dwóch partii) jest dostępna wyłącznie wtedy, gdy
  **wszystkie** jej partie są na liście biura. Inaczej jeden dotyk wciągnąłby do
  wsadu partię spoza planu, a po zamknięciu pokrywy nikt tego nie odkręci.
- Kafelki niedozwolone nie znikają i nie przesuwają siatki — operator ma stały
  układ ekranu.

### Pułapka: rezerwacja zeruje wolne kilogramy

Partia 524 (Filet z mostka wołowego) ma na produkcji `kg_available = 0` przy
`kg_reserved = 600`, bo biuro zaplanowało ją w całości na `MAS/15/09/26`. Kafelki
partii wybranych przez biuro powstają więc **ze zlecenia**, a nie z filtra
„wolne kg > 0". Filtr wolnych kilogramów rządzi tylko kafelkami spoza planu.

To ta sama pułapka, co w `kebab-masownia-hmi-v2`: `kgAvailable` z `mapMeatStock`
jest już netto (`kg_free`) i nie wolno odejmować `kgReserved` drugi raz.

## Dwa tory pracy

Masownica chodzi 50 minut, więc panel rozdziela to, co przy maszynie, od tego,
co obok niej.

**Tor 1 — przygotowanie przypraw.** Zlecenie + wielkość wsadu → przyprawy
odważone do ponumerowanego pojemnika (1–6). Bez maszyny, bez palet, bez wody.
Można przygotować do sześciu wsadów naprzód. Pojemnik rezerwuje kilogramy
zlecenia, żeby operator nie rozpisał dwa razy tego samego.

**Tor 2 — załadunek.** Wolna maszyna + pojemnik z przyprawami + kafelki mięsa +
woda → start. Przy maszynie operator **wskazuje numer pojemnika**, który trzyma;
pomyłka dwóch pojemników tej samej receptury o różnym wsadzie jest po zamknięciu
pokrywy niewykrywalna, więc bramka stoi tutaj.

Odbiór z masownicy: operator waży paleciakiem i wpisuje odczyt z klawiatury.
Obok stoi wartość wyliczona z receptury.

Wielkości wsadu: masownica 1 → 200 kg, 2 → 200 kg, 3 → 600 kg, mniej jest
normalne. System po cichu przepuszcza do +60 kg ponad nominał, ale **zapasu nie
pokazuje na ekranie** — wypisany „max 660" zrobiłby z niego normę.

## Model danych

Nowe tabele (migracje w `backend/app/migrations.py`):

```
mixing_spice_carts          pojemnik z odważonymi przyprawami
  id, cart_no (1..6), order_id, recipe_id, kg_target,
  status ('prepared' | 'dumped' | 'cancelled'),
  ingredients JSONB           [{seq, name, qty, unit, weighed, manual}]
  created_at, dumped_at, charge_id

mixing_charges              wsad stojący w masownicy
  id, order_id, machine_id, cart_id, kg_meat, water_l, batch_no,
  status ('mixing' | 'done' | 'cancelled'),
  started_at, finished_at, session_id

mixing_charge_pallets       skład mięsny wsadu
  id, charge_id, pallet_id (NULL = paleciak), lot_no, meat_stock_id, kg
```

`mixing_charges` istnieje po to, żeby paleta znikała z ekranu w chwili
załadowania, a nie dopiero po odbiorze — inaczej dwa wsady wzięłyby tę samą
paletę. Przy odbiorze wsad woła **istniejące** `finish_mixing_session` z
alokacjami z `mixing_charge_pallets` i zapisuje zwrócone `session_id`.
Księgowanie (ruchy magazynowe, `seasoned_meat`, `kg_done`, numer partii
przyprawionej) zostaje bez zmian — to najgorętsza ścieżka modułu.

## API

```
GET    /api/masownia/mieso                  kafelki: palety + partie bez palet
GET    /api/masownia/pojemniki              pojemniki w toku
POST   /api/masownia/pojemniki              załóż pojemnik (zlecenie + kg)
PATCH  /api/masownia/pojemniki/{id}         zapisz odważony składnik
DELETE /api/masownia/pojemniki/{id}         anuluj (zwalnia kg zlecenia)
GET    /api/masownia/wsady                  wsady w maszynach
POST   /api/masownia/wsady                  załaduj: maszyna + pojemnik + mięso + woda
PATCH  /api/masownia/wsady/{id}/odbior      kg z paleciaka → finish_mixing_session
```

Wszystko pod RBAC jak reszta `/api/mixing*`.

## Sprzęt

**Waga przypraw — teraz.** Panel masowni dostaje własny `scale.json`
(port, `stabilityTolKg` 0,01 kg — działka wagi przypraw, nie najazdowej).
Most `scale.rs` działa bez przeróbek; jedyna zmiana to zaszyta na sztywno nazwa
katalogu `ProgramData\Rozbior HMI`, która musi zależeć od kiosku, żeby dwa
stanowiska nie deptały sobie konfiguracji.

Bramka: odczyt musi zgadzać się z recepturą w tolerancji **0,05 kg** i dopiero
wtedy panel puszcza dalej — automatycznie, bez dotyku. Gdy waga nie jest
podłączona, pojawia się ręczne potwierdzenie ze śladem „ręcznie" na pozycji;
przy sprawnej wadze bramka trzyma i przycisku nie ma.

**Dozownik wody — na gotowo.** `src-tauri/src/doser.rs` + hook `useDoser()`
o tym samym kształcie co waga (`connected`, `dosedL`, `start()`), domyślnie
`enabled: false`, konfiguracja w `doser.json`. Dopóki modułu RS-485 nie ma,
panel przyjmuje litry z klawiatury w oknie **±3%** (dokładność DW-1C wg
producenta; węższe okno zgłaszałoby błąd, którego urządzenie nie potrafi
uniknąć). Po dokupieniu modułu Modbus dochodzi w `doser.rs` — ekran bez zmian.

## Wdrożenie

Nowy kanał kiosku, wzorowany na „produkcja":

- `masowanie.html`, `src/masowanie.tsx`, wejście w `vite.config.ts`;
- `src-tauri/tauri.masowanie.conf.json` + kanał aktualizacji `masowanie`;
- wspólna rama `KioskFrame` (`KioskGuards`, `SplashGate`) i motyw `hmi-theme`.

`MieszanieRoute` i tryby v1/v2 zostają bez zmian — hala ma ścieżkę odwrotu.

## Pułapki do pilnowania

- `kgAvailable` = `kg_free`, już netto — nie odejmować `kgReserved` drugi raz.
- `create_stock_movement(OUT, meat)` waliduje żywy stan: ruch **przed**
  dekrementem `kg_available` (`kebab-stock-movement-order`).
- `LogRecord` — zarezerwowane klucze w `extra` wybuchają dopiero na poziomie
  INFO (`python-logrecord-reserved-keys`).
- 401 w kiosku robi przeładowanie do PIN-u, nie `/login` (`kebab-kiosk-401-redirect`).
- Bump wersji w conf kiosku jest obowiązkowy — bez niego auto-update nie zejdzie
  na panel (`kebab-release-process`).
- Testy DB wymagają pełnego `TEST_DATABASE_URL` i jednego przebiegu naraz.

## Testy

- `meatGate.test.ts` — brak partii w zleceniu, partie wskazane, paleta mieszana
  z partią spoza planu, partia w całości zarezerwowana (przypadek 524).
- `meatTiles.test.ts` — składanie kafelków: paleta częściowo pobrana, partia bez
  palet, partia z paletami i resztą na paleciaku.
- Testy DB: pojemnik rezerwuje kg zlecenia, wsad zdejmuje kg palety, odbiór
  zamyka wsad i nie księguje dwa razy.
- E2E: plan biura z jedną partią → na panelu klikalna tylko ona.

## Kolejność prac

1. Bramka partii i model kafelków (czyste funkcje, testy).
2. Backend: pojemniki, wsady, endpoint mięsa.
3. Ekran 1:1 z prototypu + kanał kiosku.
4. Waga przypraw + szkielet dozownika.
5. E2E, próba generalna, deploy.
