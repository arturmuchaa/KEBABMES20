# HMI produkcyjne — panel na hali

Data: 2026-08-24
Status: zatwierdzony do wdrożenia

## Po co

Właściciel zamówił komputery na stanowiska masowni i produkcji. **HMI masowania
już istnieje** (`MixingHmiV2Page` — panel maszyn, kg z partii, zmiana partii
FEFO), więc na masownię nie trzeba pisać nic: wystarczy podłączyć sprzęt.
Brakuje wyłącznie ekranu produkcyjnego.

Dziś produkcję raportuje `ProductionTabletPage` — ekran przeglądarkowy, nie
kiosk: bez własnego logowania, bez pełnego ekranu, bez kanału aktualizacji.
Nowy panel ma **wyglądać i zachowywać się jak HMI rozbiorowe v10**, a **działać
na zasadach tabletu produkcji**.

## Czego ten ekran NIE robi

Na start **tylko liczy sztuki**:

- **bez wagi** — nie ma mostu do RS232, nie ważymy wyrobu;
- **bez drukarki etykiet** — etykiety zostają tam, gdzie są dziś.

To decyzja właściciela i jest dobra: most do wagi i BrowserPrint są dwiema
najbardziej awaryjnymi rzeczami na hali, a do liczenia sztuk niepotrzebne.
Gdy po tygodniu okaże się, że hala chce ważyć — dołożymy, wiedząc po co.

## Warunek wstępny (poza kodem)

Ekran logowania kiosku pobiera operatorów **działu**. W bazie produkcyjnej
27 pracowników ma dział pusty, jeden ma `["rozbior"]` — do `produkcja`
**nie jest przypisany nikt**. Właściciel dopisze ludzi sam w kartotece.

Bez tego stanowisko stanie na ekranie logowania — i to w sposób mylący, bo
przy pustej liście ekran ponawia zapytanie w nieskończoność i wygląda jak
zepsuty serwer. **Poprawiamy to przy okazji** (dotyczy też kiosku rozbioru):
odpowiedź pusta z DZIAŁAJĄCEGO backendu jest odpowiedzią ostateczną — po kilku
próbach ekran ma powiedzieć wprost „Brak operatorów działu produkcja — ustaw
dział w kartotece", zamiast udawać, że się łączy.

## Start stanowiska

Identycznie jak rozbiór v10, ten sam kod ramy:

1. **Splash** — logo Księżyc, minimum 5 s (bez tego znika, zanim ktokolwiek je
   zobaczy).
2. **PIN operatora** działu `produkcja` — kafle z inicjałami, klawiatura
   ekranowa, wejście serwisowe przez przytrzymanie nagłówka.
3. **Plan dnia wczytuje się SAM** — bez wybierania z listy. Jeden dzień = jeden
   plan; gdyby wyjątkowo istniały dwa, ekran zapyta który.

Kiosk sprząta service workera przy każdym starcie (raz porwał start i serwował
dashboard MES z cache) i blokuje F5/F11/F12/Alt+F4.

**Operator ≠ wykonawca.** Zalogowany operator obsługuje stanowisko; sztuki
przypisuje się pracownikom wybieranym przy pozycji. Ten sam podział co na
rozbiorze.

## Ekran główny — LISTA, nie kafle

Kafle odpadają: plan ma około dziesięciu pozycji i nie zmieściłyby się bez
przewijania, a operator ma widzieć **całość naraz**.

Rozkład kolumn przeniesiony **1:1 z karty produkcji**, którą hala już zna
(`ProductionCardPrintPage`): ta sama kolejność, te same nazwy.

```
PLAN NA 25.08.2026              120 / 340 szt  ·  4 200 / 11 900 kg
▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  35%                          [ Zakończ dzień ]
─────────────────────────────────────────────────────────────────────
⚠ PLAN ZMIENIONY: doszła KIRMIZI 10×40 kg · BULLI 90→120   [Rozumiem]
─────────────────────────────────────────────────────────────────────
 Lp │ ILOŚĆ   │ WAGA  │ RODZAJ  │ TULEJE   │ KLIENT     │ RAZEM  │ POSTĘP
  1 │ 20 szt. │ 35 kg │ WROCŁAW │ Tul. 120 │ Bulli sp.  │ 700 kg │ 12/20 ▓▓░
  2 │ 90 szt. │ 30 kg │ BULLI   │ Tul. 65  │ Kowalski   │2700 kg │  0/90 ░░░
  3 │ 40 szt. │ 12 kg │ KIRMIZI │ —        │ — magazyn —│ 480 kg │ 40/40 ▓▓▓
```

`RODZAJ` to nazwa receptury (fallback: rodzaj produktu), `TULEJE` to opakowanie
— dokładnie jak na karcie. Wiersze wysokie pod palec w rękawicy.

Z prawej strony **szyna materiałów dnia**: ile folii pobrano, log pobrań
(„06:10 — 40 rolek", „11:20 — dołożono 20"), przycisk dokładania i zakończenie
dnia. Świadomie z boku, nie w liście — to nie jest pozycja planu.

**NR PARTII świadomie NIE trafia na listę.** Na karcie bywa długi
(`2x472, 6xPP13, 1x472/PP13`) i zjadłby czytelność wiersza. Operator zobaczy go
po dotknięciu pozycji, czyli wtedy, gdy jest mu potrzebny.

## Wygląd — tożsamy z HMI rozbiorowym

Decyzja właściciela 24.08.2026: produkcja ma wyglądać **tak samo jak rozbiór**,
nie „podobnie". Ludzie chodzą między stanowiskami i nie mają się uczyć drugiego
interfejsu. Nic tu nie wymyślamy — bierzemy to, co już stoi na hali.

**Źródła prawdy:** `VARS` w `DeboningHmiV10Page.tsx` (kolory) i
`DeboningHmiV10Page.css` (krój). Nowy ekran importuje ten sam CSS fontu i
wstawia ten sam obiekt `VARS` — nie kopiuje wartości ręcznie.

| Element | Wartość z v10 |
|---|---|
| Tło / panel / tekst | `--bg #E7EAEE` · `--panel #FFFFFF` · `--ink #0F172A` · `--mut #5B6472` |
| Kreski | `--line #D8DEE6` · `--lineSoft #E2E5EA` |
| Akcent | `--accent #4F46E5` · `--accentSoft #EEF2FF` · pasek `--barBg #D3DBF7` |
| Bursztyn | `--amb #B45309` · `--ambSoft #FFFBF3` · `--ambLine #F3D9AE` |
| Zieleń / czerwień | `--success #16A34A` · `--successSoft #F0FDF4` · `--red #DC2626` |
| Liczby | `IBM Plex Mono HMI` (lokalny woff2, `/fonts/rozbior-v10/`), `tabular-nums` |
| Etykiety | krój systemowy, 9–13 px, `uppercase`, `letter-spacing .06–.14em` |
| Nagłówek | 76 px, `--barBg`, komórki rozdzielone `--lineSoft`, po prawej przyciski `h-9` |
| Przyciski | nagłówek `h-9 r-8` · główny `h-14 r-10` akcent · wtórny `h-12 r-10` kreska |
| Karty / modale | karta `r-12` · modal `480 px, r-14, cień 0 20px 60px -20px` + kwadrat ikony 56 px |
| Plakietki | `r-6`, 10 px, `uppercase`, tło soft + kreska w tonacji |
| Paski postępu | tor `--lineSoft`, wypełnienie `--barBg` w klamrach `--accent`, `r-8` |

**Font musi zostać lokalny.** Hala pracuje bez internetu, dlatego v10 wozi
`ibmplexmono-{500,600}-latin{,-ext}.woff2` w `public/fonts/rozbior-v10/`.
Nowy kiosk używa **tych samych plików**, nie CDN.

## Widok pozycji — liczenie

```
← 20 szt. × 35 kg · WROCŁAW · Tul. 120 · Bulli sp.          12 / 20 szt
  NR PARTII: 1x470, 19x472
─────────────────────────────────────────────────────────────────────
 [ DAWID ]  [ DENYS ]  [ NAZAR ]

        Wykonano 12 z 20 · pozostało 8 szt.

        ┌─────┐        3          ┌─────┐
        │  −  │     = 105 kg      │  +  │
        └─────┘                   └─────┘

        [        Zapisz 3 szt. · DAWID        ]

 KTO ILE ZROBIŁ:  DAWID 8 szt. · DENYS 4 szt.
```

- **Minus / liczba / plus**, jak w tablecie produkcji, i jeden przycisk zapisu.
  **Bez klawiatury** — w rękawicy trafia się w duży przycisk, nie w cyfry
  (decyzja właściciela 24.08.2026, po odrzuceniu pola do wpisywania).
- **Przelicznik na kilogramy pod liczbą** — operator widzi, ile mięsa zapisuje.
- **Kilku pracowników na jedną pozycję** — ekran rozlicza, kto ile zrobił
  (tablet trzyma to jako listę wpisów per pozycja).
- **Wybrany pracownik ZOSTAJE na czas serii**, a jego nazwisko stoi na
  przycisku zapisu.

To świadome odstępstwo od rozbioru, gdzie pracownik odznacza się po każdym
zapisie. Tamta decyzja (14.08.2026) wzięła się z wpisów lądujących na złej
osobie przy POJEDYNCZYCH ważeniach. Przy liczeniu `+1` odznaczanie po każdej
sztuce byłoby nie do zniesienia — więc zamiast odznaczać, **pokazujemy dużym
drukiem, na kogo lecą sztuki**.

## Plan zmieniony w ciągu dnia

Tego tablet nie ma wcale, a jest potrzebne: biuro edytuje plan w trakcie zmiany
i hala musi się o tym dowiedzieć.

Ekran odpytuje plan cyklicznie i **porównuje z tym, co operator ostatnio
widział**. Różnica pojawia się jako pasek, który **NIE znika sam** — operator
musi go potwierdzić, żeby zmiana nie przeszła niezauważona przy hałasie.

Pasek nazywa konkret:
- pozycja **dodana** — „doszła KIRMIZI 10×40 kg",
- ilość **zmieniona** — „BULLI 90→120 szt",
- pozycja **usunięta** — „zdjęto WROCŁAW 20×35",
- zmieniona receptura, tuleja albo klient.

Porównanie planów to **czysta funkcja z testami** (`planDiff`) — to jedyne
miejsce w tym ekranie, gdzie łatwo o cichy błąd, a cichy błąd znaczy, że hala
produkuje według nieaktualnego planu.

Odświeżanie idzie przez `useLiveRefresh` — jeden rejestr źródeł, bez ręcznie
utrzymywanej listy (patrz incydent zamrożonego licznika na rozbiorze).

## Przerwa

Produkcja ma około **trzech przerw dziennie**. Bez nich tempo liczone od
pierwszego zapisu sztuki jest zaniżone o czas, którego nikt nie przepracował.

Przycisk **Przerwa** stoi w prawej szynie ekranu głównego. Po dotknięciu
zasłania ekran komunikatem i **blokuje dodawanie sztuk** — dopóki operator jej
nie wyłączy, zapis jest odmawiany.

```
┌──────────────────────────────────────────┐
│                 PRZERWA                   │
│                 14 min                    │
│  Liczenie sztuk jest wstrzymane.          │
│  Żeby zapisać robotę, wyłącz przerwę.     │
│          [ Wracam do pracy ]              │
└──────────────────────────────────────────┘
```

Blokada jest tu **celowa i jest całą pointą** (decyzja właściciela
24.08.2026, po odrzuceniu wariantu „przerwa kończy się sama przy pierwszym
zapisie"). Jedyna możliwa pomyłka — zapomniana przerwa — poprawia się wtedy
sama, bo operator zderza się z nią przy pierwszej sztuce. Przerwa kończąca się
po cichu ukrywałaby ten sam błąd i **zawyżała tempo**, a tempa nikt później nie
zweryfikuje.

Suma przerw odchodzi od czasu pracy przy liczeniu **kg/godz.** i stoi obok
czasu pracy na podsumowaniu dnia.

## Statystyki zmiany — osobny ekran

Wyniki pracowników **nie wchodzą na ekran główny** — mają nie mieszać się
operatorowi w robocie (ta sama zasada co na rozbiorze). Są pod przyciskiem
„Statystyki zmiany", jeden ekran, tabela:

| Pracownik | Kilogramy | Sztuki | Kg / godz. | Co robił |
|---|---|---|---|---|
| DAWID | 1 940 | 64 | 746 | 5 × 40 kg · 12 × 35 kg · 10 × 20 kg |

**Tempo liczymy w kilogramach, nie w sztukach** — sztuka sztuce nierówna,
40 kg i 10 kg to inna praca, a tempo w sztukach karałoby za robienie dużych
kebabów. Kolumna „co robił" rozbija sztuki na wagi, więc widać, czy ktoś miał
lekki dzień, czy ciężki.

Kolejność liczb wszędzie jest ta sama i wynika z tego, czym mierzy się
produkcja: **kilogramy → sztuki → tempo (kg/godz.)**.

## Zakończenie dnia — podsumowanie

Kolejność jak wyżej, kilogramy jako liczba główna:

```
Wyprodukowano          7 190 kg
Sztuk                    213 szt.  · 4 pozycje planu
Tempo                    982 kg/godz. · 7 godz. 20 min pracy · 55 min przerw
Folia pobrana             60 rolek  · 40 rano + 20 o 11:20
Ile rolek zostało?        [  5  ]
Zużyto na produkcję       55 rolek  · tyle wejdzie w koszt dnia
```

## Folia stretch — zużycie do kosztów

Operator pobiera rano rolki, dokłada w ciągu dnia, a przy zamykaniu **zwraca to,
czego nie zużył**. Zużycie liczymy jako **pobrane − zwrócone**, nie z pamięci:
zwrot jest ruchem magazynowym w drugą stronę, więc stan zgadza się bez
inwentaryzacji, a koszt dnia opiera się na rolkach, które ktoś fizycznie
policzył na koniec zmiany.

Decyzje właściciela: folia leży w **opakowaniach**, a **pobranie zdejmuje stan
od razu** (rolki fizycznie schodzą z magazynu rano).

### Co już jest

`packaging` ma `kg_available` / `kg_used` / `unit`, a `use_packaging`
(`PATCH /api/packaging/{id}/use`) zdejmuje stan natychmiast i pilnuje, żeby nie
zejść poniżej zera. To pokrywa **pobranie i dokładanie** bez żadnej zmiany.

### Czego brakuje — do dorobienia

1. **Kartoteka folii stretch.** Dziś w `packaging` są wyłącznie tuleje
   (KARTON/METAL). Folię trzeba założyć jako pozycję z jednostką „rolka".
2. **Zwrot na magazyn.** `use_packaging` przyjmuje tylko ilości dodatnie,
   a `receive_packaging` zakłada NOWĄ dostawę (podbija `kg_initial`), więc
   zwrot przez niego zafałszowałby ilość kiedykolwiek przyjętą. Potrzebny
   osobny ruch: oddaje do `kg_available` i zdejmuje z `kg_used`, ze strażnikiem
   „nie można zwrócić więcej, niż pobrano".
3. **Zużycie PER DZIEŃ produkcyjny.** `packaging.kg_used` to licznik narastający
   — nie odpowie na pytanie „ile folii poszło 25.08". Do kosztów potrzebny
   zapis per dzień: pobrania, dokładki i zwrot, z sumą. Bez tego cała funkcja
   nie robi tego, po co powstaje.

Zapis pobrań i zwrotu musi też **przeżyć zamknięcie dnia** — koszt liczy się
po fakcie, czasem po tygodniu.

## Zasady — te same co tablet produkcji

Backend **bez zmian**, wszystkie endpointy istnieją i działają:

- postęp pozycji: `productionPlansApi.updateLineProgress`,
- zakończenie dnia: `tabletFinish` → wyrób gotowy,
- cofnięcie: `tabletReopen`,
- biuro kwituje osobno (`office-confirm`).

## Infrastruktura kiosku

Nowy kiosk to nie sam ekran. Wzorzec z rozbioru v10 wymaga sześciu rzeczy:

| Element | Uwaga |
|---|---|
| `produkcja.html` | wejście, ze skryptem sprzątającym service workera |
| `src/produkcja.tsx` | rama: splash, PIN, bramka, blokady kiosku |
| `vite.config.ts` | wpis w `rollupOptions.input` + stała wersji z conf |
| `src-tauri/tauri.produkcja.conf.json` | okno pełnoekranowe, identyfikator, adres aktualizacji |
| `.github/workflows/tauri-produkcja.yml` | build instalatora + publikacja na kanał |
| `backend/app/routes/desktop_updates_produkcja.py` | **własny moduł kanału** — kanały NIE są generyczne |

Plus katalog na instalatory na VPS.

## Podział na pliki

Logikę wyjmujemy do czystych modułów **od razu**. `DeboningHmiV10Page` ma
3000 linii i kosztowało to 24.08.2026 trzy awarie w warstwie okablowania —
tego błędu nie powtarzamy.

| Plik | Odpowiedzialność |
|---|---|
| `features/production-hmi/planDiff.ts` | porównanie planów (czysta logika) |
| `features/production-hmi/planProgress.ts` | sumy kg/szt, postęp, stan pozycji |
| `features/production-hmi/shiftStats.ts` | tempo kg/godz., czas pracy minus przerwy, rozbicie per pracownik |
| `features/production-hmi/breakState.ts` | stan przerwy: start, suma, blokada zapisu |
| `features/production-hmi/components/PlanList.tsx` | lista pozycji |
| `features/production-hmi/components/LineCounter.tsx` | liczenie + rozliczenie per pracownik |
| `features/production-hmi/components/PlanChangedBanner.tsx` | pasek zmiany |
| `features/production-hmi/components/BreakOverlay.tsx` | nakładka przerwy |
| `features/production-hmi/components/ShiftStats.tsx` | statystyki zmiany |
| `pages/tablet/ProductionHmiPage.tsx` | kompozycja |

## Testy

- **Czysta logika** (node): `planDiff` — dodanie, usunięcie, zmiana ilości,
  zmiana receptury/tulei/klienta, brak zmian; `planProgress` — sumy i stany;
  rozliczenie folii — pobrane − zwrócone, zwrot większy niż pobranie odrzucony;
  `shiftStats` — tempo kg/godz. z odjętym czasem przerw, rozbicie na wagi sztuk;
  `breakState` — trwająca przerwa odmawia zapisu, suma przerw rośnie.
- **Komponenty** (jsdom): lista pokazuje kolumny karty produkcji; licznik
  `−`/`+` bez klawiatury i przelicznik na kg; rozliczenie per pracownik; pasek
  zmiany nie znika bez potwierdzenia; **przerwa zasłania ekran i przycisk zapisu
  nie zapisuje, dopóki nie zostanie wyłączona**.
- **Okablowanie** (harness jak dla rozbioru, od pierwszego dnia): plan wczytuje
  się sam po zalogowaniu; `+1` wysyła właściwą pozycję i pracownika; zmiana
  planu w tle podnosi pasek.

## Sprawdzian gotowości

Operator wchodzi rano, loguje się PIN-em, widzi cały plan dnia bez dotykania
czegokolwiek, liczy sztuki jednym palcem, a gdy biuro zmieni plan — dowiaduje
się o tym z ekranu, a nie od kogoś, kto akurat przechodził obok.
