# HMI magazynu: zawartość kartonów i lokalizacje mroźni

## Układ po doprecyzowaniu wymiarów (2026-11-04)

- Źródło orientacji wejścia: `/root/KARTONY MROZNIA NOWE.pdf`.
- Właściciel podał **560 cm szerokości × 1080 cm głębokości**. Zastępuje to
  wcześniejszy model 63 stałych pól, który nie uwzględniał geometrii obrotu.
- Drzwi są u dołu, X od lewej ściany, Y od ściany wejściowej. Obie osie mają
  identyczną skalę. Współrzędne opisują lewy dolny narożnik palety, co 10 cm.
- Paleta ma 80 × 120 cm. Domyślnie bok 80 cm od drzwi (rotation=90);
  rotation=0 zachowuje wcześniejsze znaczenie: bok 120 cm od drzwi.
- Na szerokość wejdzie 7 × 80 cm albo 4 × 120 cm z pasem 80 cm. Możliwy
  jest układ mieszany, np. cztery szerokie i jedna wąska paleta.
- Obrót zmienia zajęty prostokąt. Ściany i kolizje blokują zapis; sąsiednie
  palety nie są automatycznie przesuwane. Operator wskazuje rzeczywiste ustawienie.
- „Pokaż pierwsze wolne położenie” jest tylko propozycją do zatwierdzenia.
  Mapa nie przydziela miejsc po samym otwarciu i nie zakłada szerokości przejazdów.
- Starsze adresy A–I/1–7 pozostają zapisane z pustymi współrzędnymi. Są
  wyświetlane jako wymagające potwierdzenia, bez zgadywania rzeczywistego miejsca.

## Obsługa

Lista kartonów pokazuje każdą pozycję: planowaną liczbę sztuk × kg,
recepturę, rodzaj, tuleję i osobno postęp pakowania. W mroźni zawartość
pochodzi ze sztuk, a przy braku skanów rozpis jest jawnie opisany jako rozpis.
Różne tuleje nie są łączone w jedną pozycję.

Po zapisanym ważeniu/wjeździe otwiera się mapa do wskazania miejsca. Także
„Zważ później” prowadzi do wyboru lokalizacji. Wjazd/ważenie i lokalizacja
są oddzielnymi zapisami: błąd sieci lub zamknięcie mapy nie usuwa ważenia.
Nie zgadujemy miejsca — karton bez przypisania jest widoczny jako „bez miejsca”.
Można uzupełnić je później, również dla kartonów istniejących przed zmianą.

Mapa pozwala wyszukać numer kartonu, klienta lub zamówienie, odczytać skład,
przenieść karton i obrócić paletę. Nazwę produktu i wyszukiwanie wpisuje się
klawiaturą dotykową z polskimi literami, cyframi, spacją i kasowaniem.
Przycisk zapisu pozostaje w stałej stopce; mapę można powiększyć.
Współrzędne i orientacja są widoczne na liście mroźni,
karcie kartonu otwieranej skanem i liście załadunku. Mapa odświeża się co 5 s.

### Czytelna zawartość i wyszukiwanie

Od razu po otwarciu mapy obok rzutu widoczne są karty wszystkich kartonów:
pełny numer, klient, każda pozycja ilość × kg, receptura i rodzaj mięsa.
Tuleje spoza standardu 45–65 cm są wyróżnione bursztynowo. Standardowe
tuleje pomijamy na skróconej karcie; nieznane nazwy pozostają widoczne.
Rozpis bez skanów nadal ma wyraźne oznaczenie. Skład mieszanego kartonu
nie jest redukowany do pierwszej receptury ani łączony po samej wadze.

Na małej mapie jest numer i znacznik nietypowej tulei, po powiększeniu
dochodzi skrót receptury/składu. Obie osie pozostają w tej samej skali.
Mapa i lista mają oddzielne przewijanie; dotknięcie karty wskazuje paletę,
a dotknięcie palety przewija listę do jej składu.

Wyszukiwanie obejmuje numer, klienta, zamówienie, recepturę, rodzaj i tuleję.
Dokładny numer bez zer wiodących ma pierwszeństwo nad fragmentem innego numeru.
Wyniki pulsują na zielono (bez zmiany rozmiaru prostokątów); przy preferencji
ograniczenia animacji pozostają stale zielone. Brak wyników i kartony bez
potwierdzonego położenia mają jawny komunikat. Odświeżanie nie przewija mapy.

### Zamiana kartonów bez wolnego miejsca

Po wskazaniu kartonu: **Zamień miejscami → drugi karton na mapie/liście →
Zapisz zamianę**. Podgląd pokazuje oba numery, docelowe współrzędne i orientacje.
Każdy karton przejmuje istniejący prostokąt drugiego (wraz z jego obrotem),
więc operacja działa także w pełnej mroźni i nie wymaga fikcyjnego miejsca pośredniego.

POST `/api/magazyn/mroznia/zamiana` przyjmuje `first` i `second`, każde z
`kind`, `container_id`, `expected_revision`. Jedna transakcja, wspólna blokada
mapy i blokady obu kontenerów chronią przed równoległą zmianą oraz załadunkiem.
Sprawdzamy położenie, wersje, ściany i kolizje; błąd przy drugim zapisie wycofuje
całość. Powtórzone żądanie ze starymi wersjami zwraca konflikt, zamiast zamieniać
kartony z powrotem. Klient nie ponawia zamiany automatycznie.

### Towar bez skanowania

„Dodaj towar ręcznie” otwiera opis produktu (np. łój wołowy), położenie i obrót
palety 80 × 120 cm. Taki prostokąt jest bursztynowy i ma
napis TOWAR. Nie tworzy kartonu, sztuk ani ruchów magazynowych; blokuje
odkładanie palet tak samo jak istniejący karton. Po usunięciu towaru operator
dotyka kafelka i potwierdza „Zwolnij miejsce”. Można również zmienić opis.
Ręczne blokady i palety używają tej samej blokady transakcyjnej; zmiana opisu
lub zwolnienie sprawdzają wersję, aby nie usuwać nowszego oznaczenia.
Osobna tabela `cold_storage_blocked_slots` zachowuje opis, operatora i czas.
API: PUT `/api/magazyn/mroznia/zajete`, POST `/api/magazyn/mroznia/zajete/zwolnij`.

### Kolory zamówień podczas załadunku

Po dołożeniu zamówienia do auta serwer automatycznie nadaje mu wolny kolor
i oznaczenie K1, K2 itd. Ten sam znacznik występuje przy zamówieniu, przy
każdej jego palecie na liście załadunku oraz na rzucie otwartym przyciskiem
„Rzut mroźni · znajdź karton do załadunku”. Otwarta mapa od razu koloruje
kartony wszystkich zamówień wybranego auta. Legenda pokazuje klienta,
numer zamówienia, liczbę kartonów w mroźni i liczbę bez położenia.
Dotknięcie zamówienia w legendzie zawęża karty i przygasza pozostałe palety;
„Wszystkie zamówienia auta” przywraca wspólny widok. Pozostałe kartony
są szare. Ręcznie wpisany towar pozostaje opisany jako TOWAR.

Powiązanie odbywa się przez `orderId`, również dla kartonów magazynowych
z `linked_order_id`. Dwa zamówienia tego samego klienta mają oddzielne kolory.
Zielone wyszukiwanie pulsuje obramowaniem kolorowej palety, zachowując jej
kolor zamówienia; przy ograniczonych animacjach obramowanie jest stałe.
Podgląd dopasowuje całą podłogę do wysokości panelu, a powiększenie umożliwia
odczyt małych numerów i opisów. Kolor nie zmienia wymiarów palety.

`vehicle_loading_orders.color_index` jest trwały przez cały czas przypisania
zamówienia do auta: skan, odświeżenie, zmiana kolejności i usunięcie innego
zamówienia nie przepisują kolorów. Indeks unikalny `(vehicle_id, color_index)`
i trigger przydzielający najniższy wolny indeks pod blokadą auta chronią
równoczesne dodawanie na kilku stanowiskach. Migracja uzupełnia stare rekordy
i instaluje kolumnę/trigger w jednej transakcji, przed backfillem załadunków.
Po zdjęciu zamówienia jego kolor można ponownie wykorzystać.

## Spójność i API

- `GET /api/magazyn/mroznia/plan` — układ, kartony, skład, lokalizacje.
- `PUT /api/magazyn/mroznia/lokalizacja` — rodzaj/id, x_cm, y_cm, obrót,
  oczekiwana wersja lokalizacji. Obie trasy wymagają istniejącego uprawnienia `wydanie`.
- `cold_storage_positions`: unikalny kontener, FK, współrzędne i obrót,
  ograniczenia ścian/siatki, operator i czas zapisu. `slot` nowych pozycji
  ma format X160Y360. Ręczne oznaczenia mają stały klucz M… niezależny od ruchu.
- Zapis w transakcji z blokadą kontenera i advisory lockiem: dwa stanowiska
  nie mogą przypisać nachodzących na siebie prostokątów, również przy różnych
  narożnikach i mieszanych orientacjach. Konflikt = HTTP 409.
- Wersja chroni przed nadpisaniem przeniesienia przez drugiego operatora.
  Ponowienie identycznego zapisu jest idempotentne.
- Triggery zwalniają miejsce przy wyjeździe, załadunku, wydaniu lub zmianie
  wjazdu. Dotyczy również starych klientów mobilnych, bez zmian ich kodu.
- Cofnięcie załadunku **nie przywraca** automatycznie poprzedniego miejsca:
  mogło już zostać zajęte, a fizyczne odstawienie wymaga wskazania miejsca.
- Ponowne ważenie kartonu pozostającego w mroźni zachowuje lokalizację.

## Weryfikacja i wdrożenie

Testy SQL geometrii wykonywano wyłącznie na oddzielnej bazie
`kebab_mes_test_geometry_20261104` (kopii wcześniejszej bazy testowej).
Sprawdzono 7/4 palety w szerokości, ściany, obrót, stykające się krawędzie,
kolizje z towarem ręcznym, równoległe zapisy, wyjazd/załadunek i migrację starych pól.
Testy Playwright korzystają wyłącznie z atrap API (bez zapisów produkcyjnych).
Pokrywają skalę i obrót przy 1024/1366 px, dotyk przy 375 px oraz wpisanie
„Łój wołowy” samymi dotknięciami klawiatury ekranowej.

Po dodaniu zawartości, wyszukiwania i zamiany: 74 testy backendu (w tym
zamiana przy 63 zajętych miejscach, różne orientacje, współbieżność i rollback),
31 testów komponentów oraz 7 testów Playwright przeszło. Testy przeglądarkowe
sprawdzają pulsowanie, czytelne karty, wyszukiwanie bez klawiatury fizycznej,
skalę i dotykową zamianę; nie wykonują zapisów na produkcji.

Weryfikacja kolorów: 72 testy backendu (kolory, synchronizacja załadunku,
zawartość palet i lokalizacje), 45 testów frontendu oraz 13 testów Playwright
przeszło. Sprawdzono 5 jednocześnie dodawanych zamówień, migrację starej
tabeli, dwa zamówienia jednego klienta, kartony magazynowe, brak położenia,
filtr legendy, wyszukiwanie dotykiem, ograniczone animacje i zniknięcie
załadowanego kartonu z mapy. Podglądy kolorów sprawdzono przy 1024 i 1366 px.
Typecheck, build i kontrola białych znaków również przeszły.

Zmiana nie została wdrożona na produkcję. Nowe DDL jest addytywne,
idempotentne i instalowane jako jedna transakcja przez istniejący runner
migracji. Przyszłe wdrożenie wymaga osobnej zgody, kopii bazy i aplikacji
oraz istniejącej procedury deploymentu. Przy wycofaniu aplikacji można
pozostawić tabelę i triggery: starszy kod ignoruje lokalizacje. Nie usuwać
zapisanych przypisań przy rollbacku.
