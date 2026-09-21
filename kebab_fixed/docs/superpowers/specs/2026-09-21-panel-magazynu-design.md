# Panel magazynu — kiosk stanowiska magazynowego

**Data:** 2026-09-21
**Status:** projekt zatwierdzony w rozmowie, do przeczytania przed planem wdrożenia
**Prototyp:** https://claude.ai/artifact/B19Xw8PCYNGDCYWYrsPYE3

---

## 1. Po co to robimy

Magazyn jest ostatnim dużym obszarem zakładu bez własnego stanowiska w MES.
Rozbiór, masownia i produkcja mają kioski; magazyn ma telefon albo nic.

**Cel nadrzędny, sformułowany przez właściciela:** MES ma pracę *przyspieszać*
i eliminować błędy — nie tylko eliminować błędy kosztem tempa. To zdanie jest
kryterium odrzucenia dla każdego pomysłu w tym dokumencie i w trakcie
projektowania odrzuciło ich cztery (patrz §11).

**Konkretny błąd do wyeliminowania:** sztuki jednego klienta lądują w kartonie
innego klienta. Dzieje się to przy wózkach mieszanych — zakład stara się
trzymać jednego klienta i jedną gramaturę na wózku, ale nie zawsze się da.

## 2. Realia hali — ograniczenia, z których wynika cały projekt

Te fakty pochodzą od właściciela i są twardymi wejściami, nie założeniami:

| fakt | konsekwencja projektowa |
|---|---|
| Przyjęcie, pakowanie i załadunek dzieją się w **jednym pomieszczeniu** | jeden panel wystarczy |
| Kartony i wózki stoją **2–3 kroki od komputera** | ekran NIE może być kanałem potwierdzania każdej sztuki |
| Do spakowania bywa **90 sztuk × 10 kg** | każde dodatkowe dotknięcie mnoży się przez 90 |
| Wózek mroźniczy mieści **~50 sztuk**, bywa mieszany | tam powstają błędy i tylko tam trzeba pilnować |
| Pakowanie + (załadunek albo przyjęcie) naraz **prawie codziennie, do godziny** | podział ekranu musi być czasowy, nie stały |
| Skaner Zebra DS **bezprzewodowy**, drugi zamówiony | operator może skanować przy wózku |
| Skanery służą **wyłącznie MES-owi** (potwierdzone 21.09) | mogą pracować w USB CDC — patrz §7 |
| Komputer ma głośniki | werdykt może iść uchem |
| Wózki **nie są ponumerowane** | żadna ścieżka nie może na nich polegać |

## 3. Architektura

Kiosk magazynu idzie wzorcem rozbioru i masowni, a **nie** przez opakowanie
istniejących ekranów mobilnych.

```
magazyn.html  →  src/magazyn.tsx  →  MagazynHmiPage
                 (bez routera, bez stron biura)
```

- własny `src-tauri/tauri.magazyn.conf.json`, własny kanał aktualizacji
  `/api/desktop-updates/magazyn/latest.json`, tag `magazyn-<wersja>`
- wersja kiosku z **jego** pliku konfiguracyjnego (kioski nie mają bramki
  conf↔Cargo.toml, patrz `kebab-release-process`)
- rama i motyw: `features/kiosk/KioskFrame` + `features/hmi-theme/vars.ts`

**Dlaczego nie opakować ekranów mobilnych:** `MobileZaladunekPage` (863 linie),
`MobilePakowaniePage` i `MobileMrozniaPage` mają layout wymieszany z logiką
i są projektowane pod kciuk. Na 21" wyszedłby rozciągnięty telefon, a kiosk
ciągnąłby do bundla router i strony biura.

**Logikę dzielimy, nie kopiujemy.** Najtrudniejsze kawałki są już wydzielone
jako osobne moduły i kiosk bierze je bez zmian:
`features/scan/useSkanAutoSubmit`, `features/loading/scanMessages`,
`features/offline/validateScanLocally`, `features/offline/scanQueue`.
Gdyby ich nie było, ten wariant byłby zły.

## 4. Ekran kafli

Cztery czynności, siatka 2×2. **Rzeczownik** do rozpoznania z metra, pod nim
**jedna linia czasownikiem**, pod kreską **żywy stan**.

```
PRZYJĘCIE                      KARTONY
Przyjmij dostawę z rampy       Spakuj karton z listy dnia
1/3 · 4 zawieszki do druku     2/7 · następny KIRMIZI 15 kg

WYDANIE                        MROŹNIA
Załaduj auto                   Wstaw lub wyjmij paletę
0/3 · na dziś 1 840 kg         12/14 · ostatnia 14:26
```

**Dlaczego nie czasowniki jak w masowni:** masownia ma dwa kafle i operator
krąży między nimi w kółko, więc zdanie na kaflu uczy. Magazyn ma cztery roboty
w czterech miejscach, a magazynier stoi już przy rampie albo przy aucie — on
wie, co robi. Kafel służy rozpoznaniu i stanowi.

### Trzy poziomy

Warstwa „którą konkretnie" jest sednem tego projektu — pierwsze podejście
wchodziło od razu w jedną dostawę / karton / auto wbite na sztywno.

| czynność | poziom 2 | poziom 3 |
|---|---|---|
| PRZYJĘCIE | dwa duże kafle: **surowiec / opakowania** → lista dostaw dnia | rozładunek, zawieszki, karta 1.1.1 |
| KARTONY | lista kartonów otwartych + pula do spakowania | pakowanie sztuk |
| WYDANIE | auta na rampie | załadunek palet |
| MROŹNIA | — (nie ma czego wybierać) | skan |

Surowiec i opakowania są rozdzielone, bo to **dwa różne dokumenty i dwie różne
karty HACCP** (opakowania: seria `DF`, karta 1.3.1, bez partii i bez
temperatury). Wspólny ekran musiałby połowę pól chować.

### Czego na tym ekranie NIE MA

Prototyp miał bursztynowe wołanie „Auto stoi na rampie". **Usunięte** — nikt
tej informacji nie wprowadza, a kazać biuru awizować podstawienie auta to
dokładanie roboty, żeby system powiedział coś, co magazynier widzi przez okno.

Zamiast tego kafel WYDANIE liczy z `client_orders.delivery_date`: **„na dziś
do wydania: 3 zamówienia · 1 840 kg"**. Dane już są, nikt nic nie wprowadza.
Kurs zakłada magazynier, gdy auto podjedzie — jak dziś.

## 5. Pakowanie — rdzeń projektu

### 5.1 Skąd się bierze lista (bez planowania)

**Kartony definiuje biuro** (klient, receptura, rodzaj, tuleja, gramatura,
ile sztuk) — magazyn ich nie zakłada, ale **musi je widzieć**. Natomiast
planu PAKOWANIA nie ma i nie będzie — właściciel: *„bo to niepotrzebna praca"*.

Ekran KARTONY pokazuje więc **dwie rzeczy naraz**: co pakować (kartony
z biura) i czym pakować (sztuki z produkcji).

Pula sztuk **wylicza się sama**:

> **Do spakowania = sztuki wyprodukowane, które nie leżą w żadnym kartonie
> ani na palecie** (`finished_units` z `carton_id IS NULL AND pallet_id IS NULL`),
> pogrupowane po (`product_type_id`, `recipe_id`, `tuleja`, `weight_kg`).

Nikt nic nie wprowadza.

**Pula jest grupowana po DNIU PRODUKCJI, a zaległości oznaczone.** Właściciel
(21.09.2026): *„chciałbym, żeby wiedział, co produkcja zrobiła poprzedniego
dnia i co zostało, np. nie ściągnięte z poprzednich dni, czego nie zdążyli
ściągnąć"*. To nie jest osobna funkcja — to ta sama pula z podziałem po
`produced_date`:

```
DO SPAKOWANIA
  wczoraj  20.09     32 szt   KIRMIZI 15 kg · YALCIN
  19.09              8 szt    YAPRAK 25 kg · DEM'S      ← zaległe
  18.09              3 szt    KIRMIZI 15 kg · YALCIN    ← zaległe
```

Starsze dni idą na górę i są wyróżnione — leżą najdłużej, więc mają
najkrótszy termin. Magazynier widzi zaległości, zanim zacznie dzisiejszą
robotę, bez pytania kogokolwiek.

**Karton otwarty przez kilka dni to stan normalny, nie wyjątek.** Scenariusz
zakładu wychodzi z modelu sam:

| dzień | co się dzieje |
|---|---|
| środa | produkcja robi 28 szt · 15 kg → wpadają do „do spakowania" |
| czwartek | magazynier pakuje je → karton **28/60, zostaje otwarty** |
| czwartek | produkcja robi 32 szt → dochodzą do puli |
| piątek | magazynier dopakowuje → karton **60/60 → etykieta** |

`stock_cartons` już trzyma otwarte kartony.

### 5.2 Karta QR na kartonie

Drukowana w chwili założenia kartonu, przyklejona do pudła. Niesie wszystko,
co trzeba wiedzieć bez patrzenia w ekran:

```
███████   KARTON 000318
██ ▄▄ ██  YALCIN
███████   KIRMIZI · UDO 100%
          tuleja METAL 80 cm
          15 kg × 60 szt · otwarty 18.09
```

**Dlaczego karta, a nie litery A/B/C ani lista na ekranie:** skan dzieje się
**przy kartonie, gdzie magazynier stoi**, a nie na ekranie oddalonym o trzy
kroki. Karton sam mówi, czym jest — nie trzeba niczego pamiętać.

### 5.3 Aktywny karton to DOMYSŁ, nie zamek

To rozstrzygnięcie problemu „czy przy każdej obcej sztuce muszę skanować
karton tam i z powrotem". **Nie.**

Sztuka niesie klienta i specyfikację, więc system zawsze wie, gdzie należy.
Aktywny karton służy tylko temu, żeby w typowym przypadku **móc milczeć**.

| skan | co robi system | dźwięk |
|---|---|---|
| sztuka pasuje do aktywnego kartonu | zapisuje tam | **cisza** |
| sztuka należy do **innego otwartego** kartonu | zapisuje **tam, gdzie należy**, ekran mówi który | krótki inny ton |
| sztuka nie pasuje do **żadnego** otwartego | **nie zapisuje** | ostry błąd, czerwony ekran |

Karta kartonu jest potrzebna raz, na starcie. Przy przejściu do innego kartonu
na dłużej — skanujesz go i on staje się cichy. Za jedną wpadającą sztuką nikt
nigdzie nie wraca.

### 5.4 Cisza znaczy dobrze

**Panel milczy, kiedy jest dobrze. Odzywa się tylko przy błędzie.**

Skaner pika, bo *odczytał kod* — to nie jest werdykt. Werdykt należy do panelu.
Magazynier nie czeka na potwierdzenie, nie patrzy na ekran, nie zatrzymuje
ręki: bierze, skanuje, wkłada, bierze następną. Zatrzymuje się dopiero, gdy
usłyszy ostry dźwięk.

To jedyna konstrukcja, w której skanowanie 90 sztuk nie spowalnia roboty —
bo skan **zastępuje** myślenie „czyja to sztuka, do którego kartonu", a nie
dokłada się do niego.

### 5.5 Błąd podpowiada, nie tylko krzyczy

W momencie odbicia system wie, gdzie sztuka należy:

> **✕ NIE DO TEGO KARTONU**
> Ta sztuka jest DEM'S · YAPRAK 25 kg — **karton 000320**

Magazynier nie szuka i nie zastanawia się. To jest dokładnie ten moment,
w którym dziś sztuka ląduje u złego klienta.

### 5.6 Dwóch pakujących do jednego kartonu

Działa i **jest już bezpieczne w kodzie**: `scan_unit_into_carton` bierze
`FOR UPDATE` na wierszu kartonu **i** sztuki w jednej transakcji. Dwa skany
w tej samej milisekundzie serializują się — drugi widzi stan po pierwszym.
Przy jednym wolnym miejscu drugi dostaje uczciwe „karton pełny", a ta sama
sztuka zeskanowana dwa razy — „już spakowana".

**Do dopisania:** zamknięcie kartonu przez jedną osobę w chwili, gdy druga ma
sztukę w ręce, musi dać komunikat *„karton 000318 został zamknięty"*, a nie
ogólny błąd.

## 6. Wydanie, przyjęcie, mroźnia

**WYDANIE** — backend gotowy w całości (wdrożony 2026-09-21): wspólny stan
auta w `vehicle_loading_orders`, kody wyników skanu, ostrzeżenie
`out_of_sequence` o skanie poza kolejnością. Roboty wyłącznie po stronie
ekranu. Skan zapisuje tylko to, co wyjechało — **dokumenty wystawia biuro**.

**PRZYJĘCIE** — biuro zakłada dostawę (dostawca, partie, kg, często z OCR HDI),
magazyn **potwierdza fizycznie**: zawieszki na palety, temperatury, karta 1.1.1
kolumny f–k, podpis. Decyzja właściciela: najmniej pisania w rękawicach,
a kiosk robi to, czego biuro zrobić nie może — patrzy na towar.

**MROŹNIA — to nie jest czynność poboczna, tylko PRZEGUB procesu.**
Pierwsza wersja tej specyfikacji opisywała ją jako oddzielną robotę i to był
błąd. Mroźnia jest tym, co łączy pakowanie z załadunkiem:

```
KARTONY              MROŹNIA                        WYDANIE
pakowanie       →    skan = wjazd      →  czeka  →  skan = wyjazd na auto
karton pełny         do mroźni            (dni)     towar dawno gotowy
```

Właściciel (21.09.2026): *„po zakończeniu pakowania skan i wjazd do mroźni
i tam czeka na załadunek"*. Stąd bierze się zdanie „kartony pod załadunek są
już dawno przygotowane" — między spakowaniem a wyjazdem stoi mroźnia, nie
dzień roboty. **To jest też powód, dla którego pakowanie i załadunek są
niezależne:** drugi operator pakuje INNE zamówienia niż te, które właśnie
jadą. Gdyby uzupełniał to, co jedzie, dwa osobne pasy (§7.2) byłyby złym
pomysłem — potrzebny byłby jeden wspólny widok.

Sam skan: jeden kod przestawia jednostkę w obie strony. Bez pytania
o kierunek — co jest poza mroźnią, wjeżdża; co w mroźni, wyjeżdża. Pytanie
„wstawiasz czy wyjmujesz?" byłoby pytaniem o coś, co system już wie.

### Ogniwo, którego brakowało: karton → zamówienie

Między „karton pełny" a „skan palety przy załadunku" leży moment, w którym
towar przestaje być stanem magazynu, a staje się towarem konkretnego klienta.
Backend to ma: `stock_cartons.linked_order_id` oraz
`stock_carton_match_service.suggestions_for_order`, które podpowiada pasujące
kartony (klient + receptura + rodzaj + opakowanie + gramatura).

**Przypina biuro** (potwierdzone 21.09.2026) — klikając w sugestie przy
zamówieniu. Udział magazyniera kończy się więc na skanie do mroźni i wraca
dopiero przy załadunku, co znaczy, że **piąty kafel („skompletuj zamówienie")
nie jest potrzebny**. Magazyn kartony tylko WIDZI — nie zakłada ich i nie
przypina.

## 7. Dwa skanery

### 7.1 Rozróżnianie — Raw Input

Zdarzenia klawiatury w webview nie niosą tożsamości urządzenia, ale kiosk to
Tauri: Rust dostaje ją z Windows **Raw Input** (`WM_INPUT`) przy każdym znaku.
Most tego kształtu robiliśmy już dwa razy — `src-tauri/src/scale.rs`
(RS232 → zdarzenia) i `doser.rs`.

**Idziemy w USB CDC.** Skanery służą wyłącznie MES-owi (potwierdzone przez
właściciela 21.09.2026), więc utrata trybu klawiatury nic nie kosztuje —
a zyskujemy dwie rzeczy naraz:

- **rozróżnianie skanerów jest darmowe i pewne** — każdy to osobny port
  szeregowy, zamiast przechwytywania klawiatury przez Raw Input
- **czerwona dioda na skanerze wraca do gry** — w CDC komputer wysyła
  skanerowi komendy, więc zła sztuka może zapalić się operatorowi w ręce,
  a nie tylko na ekranie oddalonym o trzy kroki

Przestawienie skanera to jeden kod kreskowy z instrukcji Zebry, odwracalny.

Most idzie wzorcem `src-tauri/src/scale.rs` (port szeregowy → zdarzenia do
ekranu) — tylko dwa porty zamiast jednego. Ten kształt robiliśmy już dwa razy
(`scale.rs`, `doser.rs`), więc to nie jest nowe terytorium.

**Zapasowo:** gdyby CDC okazał się kłopotliwy na tym konkretnym egzemplarzu,
Raw Input (`WM_INPUT`) daje samo rozróżnianie bez zmiany trybu skanera —
kosztem czerwonej diody. Reszta projektu jest niezależna od tego wyboru.

### 7.2 Podział ekranu 30 / 70

> **Ekran dzieli się tylko wtedy, gdy skanery patrzą na co innego.**

| sytuacja | ekran |
|---|---|
| jeden skaner | pełna szerokość |
| dwa skanery, **ten sam karton** | pełna szerokość — wspólny kontekst |
| pakowanie + załadunek / przyjęcie | **30 % pakowanie / 70 % czynność** |
| dwa różne kartony | dzieli się — dwa konteksty |
| czynność skończona | wraca na pełny ekran |

**Pakowanie dostaje 30 %, bo potrzebuje najmniej ekranu — działa na ciszy.**
Wystarczy numer kartonu, klient i ile brakuje. Załadunek i przyjęcie
potrzebują list i postępów.

**Pakowanie kurczy się do LEWEJ, czynność wjeżdża z PRAWEJ.** Treść pakowania
zostaje przyklejona do lewej krawędzi i nic jej nie przeskakuje przez ekran.

Pasy przypisują się same, bez żadnego ustawiania — kody są rozróżnialne:
karta kartonu i sztuka → pakowanie, paleta → załadunek, zawieszka → przyjęcie.

Przejście ~300 ms, z poszanowaniem `prefers-reduced-motion`. Zwijanie po
zakończeniu czynności albo po kilku minutach ciszy — **nigdy w trakcie
skanowania**. Ekran przestawiający się pod ręką jest gorszy niż podzielony.

### 7.3 Dźwięk i błąd

- **Ton błędu przypisany do SKANERA, nie do pasa.** Dwóch pakujących do jednego
  kartonu dzieli jeden pas — przy wspólnym tonie żaden nie wiedziałby, czyja
  to wpadka.
- **Błąd zawsze dostaje cały ekran** na 2–3 s, z nazwą skanera, po czym ekran
  wraca do 30/70. W pasku 30 % czerwony alarm dałby się przeoczyć. Załadowca
  zobaczy przez chwilę cudzy błąd — to lepsze niż pakowacz, który swojego nie
  zobaczył.

## 8. Co trzeba dorobić w backendzie

| rzecz | stan |
|---|---|
| wspólny stan auta, kody skanu, `out_of_sequence` | **jest** (2026-09-21) |
| `scan_unit_into_carton` z blokadami | **jest** |
| walidacja sztuki (`validate_pack_to_pallet`) | **jest** — odrzuca „inny klient" |
| kolejka offline pakowania | **jest** |
| przyjęcia, zawieszki, karta 1.1.1 z podpisem | **jest** |
| **pula „do spakowania"** (sztuki bez kartonu i palety, grupowane po specyfikacji) | **do zrobienia** |
| **routing sztuki do właściwego otwartego kartonu** | **do zrobienia** |
| **karta QR kartonu + jej wydruk** | **do zrobienia** |
| **kanał aktualizacji `magazyn`** | **do zrobienia** |
| most Raw Input dla dwóch skanerów | **do zrobienia** |

## 9. Kolejność prac (plastry)

Pionowy plaster: rama kiosku + ekran kafli + jedna czynność domknięta,
wdrożona i sprawdzona w hali. Reszta po wydeptanej ścieżce.

**Decyzja otwarta — do rozstrzygnięcia przed planem:**

- **A. WYDANIE jednopasmowo.** Backend gotowy, roboty tylko na ekranie, sprawdza
  ramę kiosku i motyw bez ryzyka nowego modelu danych. **Ale:** skoro pakowanie
  i załadunek idą równolegle prawie codziennie, panel zajęty załadunkiem
  blokuje pakowacza — załadunek musiałby chwilowo zostać na telefonie.
- **B. KARTONY z dwoma pasami od razu.** Trafia tam, gdzie realnie ginie towar,
  ale wymaga puli „do spakowania", routingu, karty QR i mostu dwóch skanerów
  naraz. Większy pierwszy krok.

## 10. Testy

Zgodnie z regułą repo — każdy ekran, na którym operator wprowadza liczby
trafiające do księgi, dostaje test komponentu (`*.test.tsx`, jsdom).

- **routing sztuki**: pasuje do aktywnego / pasuje do innego otwartego /
  nie pasuje do żadnego — trzy ścieżki z §5.3, testowane jako czysta logika
- **dwóch pakujących do jednego kartonu**: test DB na równoległy skan przy
  jednym wolnym miejscu (wzorzec z `test_vehicle_loading_sync_db.py`)
- **podział ekranu**: kontekst wspólny → jeden pas; różny → 30/70; błąd →
  pełny ekran
- **pula do spakowania**: sztuka spakowana znika z puli; sztuka z wczoraj
  widoczna pod filtrem dnia
- daty w fixture'ach **względne** (`kebab-fixture-daty-wzgledne`)

## 11. Odrzucone pomysły i dlaczego

Zapisane, żeby nie wracały.

| pomysł | dlaczego odrzucony |
|---|---|
| Kafle nawigacyjne z licznikiem `3/4` (pierwszy artefakt) | menu przebrane za kafle; wchodziło od razu w jedną rzecz wbitą na sztywno |
| Wołanie „auto stoi na rampie" | nikt tej informacji nie wprowadza; awizacja = robota dla biura |
| Litery A/B/C na kartonach | karta QR niesie pełną specyfikację i nic nie trzeba pamiętać |
| Skan wózka przed pakowaniem | wózki nie są numerowane; `trolley_id` to opcjonalne pole tekstowe wpisywane ręcznie — oparcie się na nim = robota dla kierownika produkcji |
| Przycisk „wszystkie 60 do tego kartonu" | zapisuje dane bez fizycznej kontroli — właściciel odrzucił, bo celem jest eliminacja błędów |
| Skan kartonu przy KAŻDEJ sztuce | przy trzech kartonach naraz mnoży ruchy tam, gdzie najmniej pomaga |
| Opakowanie ekranów mobilnych w ramę kiosku | rozciągnięty telefon na 21" + router i strony biura w bundlu kiosku |

## 12. Czego ten projekt NIE załatwia

- Jeśli magazynier zignoruje ekran i dźwięk, sztuka pojedzie w złym pudle,
  a system będzie twierdził, że jest dobrze. Żaden układ bez skanowania kartonu
  przy każdej sztuce tego nie wyklucza.
- **Nie ma logowania operatora** — do ustalenia, czy kiosk magazynu ma PIN jak
  masownia.
- Nie obsłużone: „auto przyjechało, a palety są w mroźni" oraz jedno zamówienie
  na dwa auta.
- Trzy czynności naraz (przyjęcie + pakowanie + załadunek) — przy dwóch
  skanerach niemożliwe; trzeci skaner wymagałby przemyślenia układu.
- Drugi panel przy rampie zostaje decyzją zakupową. To oprogramowanie nie ma
  udawać, że rozwiązuje brak drugiego stanowiska.
