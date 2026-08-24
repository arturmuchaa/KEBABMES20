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

**NR PARTII świadomie NIE trafia na listę.** Na karcie bywa długi
(`2x472, 6xPP13, 1x472/PP13`) i zjadłby czytelność wiersza. Operator zobaczy go
po dotknięciu pozycji, czyli wtedy, gdy jest mu potrzebny.

## Widok pozycji — liczenie

```
← 20 szt. × 35 kg · WROCŁAW · Tul. 120 · Bulli sp.          12 / 20 szt
  NR PARTII: 1x470, 19x472
─────────────────────────────────────────────────────────────────────
 [ DAWID ]  [ DENYS ]  [ NAZAR ]
                  ┌────────────────┐
                  │      + 1       │       [ wpisz liczbę ]
                  └────────────────┘
 KTO ILE ZROBIŁ:  DAWID 8 szt. · DENYS 4 szt.
```

- **Wielki `+1`** i obok pole na wpisanie liczby — oba wejścia, tak jak
  zdecydował właściciel.
- **Kilku pracowników na jedną pozycję** — ekran rozlicza, kto ile zrobił
  (tablet trzyma to jako listę wpisów per pozycja).
- **Wybrany pracownik ZOSTAJE na czas serii**, a jego nazwisko stoi wielkim
  drukiem nad licznikiem.

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
| `features/production-hmi/planProgress.ts` | sumy szt/kg, postęp, stan pozycji |
| `features/production-hmi/components/PlanList.tsx` | lista pozycji |
| `features/production-hmi/components/LineCounter.tsx` | liczenie + rozliczenie per pracownik |
| `features/production-hmi/components/PlanChangedBanner.tsx` | pasek zmiany |
| `pages/tablet/ProductionHmiPage.tsx` | kompozycja |

## Testy

- **Czysta logika** (node): `planDiff` — dodanie, usunięcie, zmiana ilości,
  zmiana receptury/tulei/klienta, brak zmian; `planProgress` — sumy i stany.
- **Komponenty** (jsdom): lista pokazuje kolumny karty produkcji; licznik `+1`
  i wpisanie liczby; rozliczenie per pracownik; pasek zmiany nie znika bez
  potwierdzenia.
- **Okablowanie** (harness jak dla rozbioru, od pierwszego dnia): plan wczytuje
  się sam po zalogowaniu; `+1` wysyła właściwą pozycję i pracownika; zmiana
  planu w tle podnosi pasek.

## Sprawdzian gotowości

Operator wchodzi rano, loguje się PIN-em, widzi cały plan dnia bez dotykania
czegokolwiek, liczy sztuki jednym palcem, a gdy biuro zmieni plan — dowiaduje
się o tym z ekranu, a nie od kogoś, kto akurat przechodził obok.
