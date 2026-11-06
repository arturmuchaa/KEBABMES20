# HMI magazynu: zawartość kartonów i lokalizacje mroźni

> **Obowiązuje (od 2026-11-05): stałe miejsca A–I / 1–7 i układ HMI 1.0.22.**
> Mapa w skali 560 × 1080 cm z wersji 1.0.23 została przez użytkownika
> odrzucona („musi być zrobione ze stałymi miejscami”) i wycofana
> 2026-11-05 06:37 UTC. Wersja **1.0.24** przenosi funkcje 1.0.23 — kolory
> zamówień, zawartość kartonów, zieloną wyszukiwarkę, zamianę miejsc i
> klawiaturę dotykową — na **gotowe kafelki**, bez siatki współrzędnych.
> Historia wycofanego rozwiązania: sekcja „Wycofana mapa w skali (1.0.23)”.

## Układ

- 63 gotowe kafelki: kolumny A–I, rzędy 1–7. Rząd 1 przy drzwiach, 7 w głębi.
  Kolejność i adresy są identyczne jak w HMI 1.0.22. Jeden karton lub jedno
  ręczne oznaczenie na miejsce.
- Rzut otwiera się **na pełnym ekranie**; kafelki wypełniają całą wysokość
  panelu (przy 1024 × 768 i 1366 × 768 wszystkie 7 rzędów są widoczne bez
  przewijania, również z otwartym panelem szczegółów).
- Obrót zapisuje orientację palety na tym miejscu (domyślnie dłuższym bokiem
  od drzwi; „Obróć o 90°” = krótszym bokiem). Obrót nie przesuwa sąsiadów
  i nie zmienia adresu. Fizyczne wymiary (pomieszczenie 560 × 1080 cm,
  paleta 80 × 120 cm) są informacją, a nie modelem ekranu.
- Miejsca nie są nigdy zgadywane: karton bez przypisania jest „bez miejsca”.

## Kafelek

Na kafelku: adres, numer kartonu bez zer wiodących, receptura (dla kartonu
mieszanego „MIX · n receptury” — nigdy pierwsza receptura za całość), ilość
(`12×15 kg` albo `18 szt · 2 poz.`), a w dolnym wierszu znacznik zamówienia
K1, K2… podczas załadunku albo znacznik orientacji oraz **T 80/100** dla
tulei spoza standardu 45–65 cm. Kafelek ręcznego towaru jest bursztynowy
z napisem ZAJĘTE i opisem. Gdy obok mapy jest otwarty panel szczegółów na
ekranie 768–1279 px, numer przechodzi pod adres, a ilość zostaje tylko na
karcie zawartości — dzięki temu cały rzut mieści się na jednym ekranie.

## Obsługa

Lista kartonów pokazuje każdą pozycję: planowaną liczbę sztuk × kg,
recepturę, rodzaj, tuleję i osobno postęp pakowania. W mroźni zawartość
pochodzi ze sztuk, a przy braku skanów rozpis jest jawnie opisany jako rozpis.
Różne tuleje nie są łączone w jedną pozycję.

Po zapisanym ważeniu/wjeździe otwiera się rzut do wskazania miejsca. Także
„Zważ później” prowadzi do wyboru lokalizacji. Wjazd/ważenie i lokalizacja
są oddzielnymi zapisami: błąd sieci lub zamknięcie mapy nie usuwa ważenia.
Miejsce można uzupełnić później, również dla kartonów sprzed zmiany.

Przeniesienie: karton → „Przenieś / obróć” → dotknięcie wolnego kafelka →
ewentualnie „Obróć o 90°” → „Zapisz miejsce” (stała stopka). Miejsce i
orientacja są widoczne na liście mroźni, na karcie kartonu otwieranej
skanem i na liście załadunku („Mroźnia · A1”, pod spodem orientacja).
Rzut odświeża się co 5 s; odświeżenie nie przewija mapy ani listy.

### Zawartość kartonów i wyszukiwanie

„Zawartość kartonów (n)” otwiera obok rzutu karty wszystkich kartonów: pełny
numer, klient, każda pozycja ilość × kg, receptura i rodzaj mięsa. Tuleje
spoza standardu są wyróżnione bursztynowo; nieznane nazwy pozostają widoczne.
Dotknięcie karty wskazuje kafelek, dotknięcie kafelka przewija listę do składu.

„⌨ Szukaj kartonu, klienta, receptury lub tulei” otwiera klawiaturę
dotykową (polskie litery, cyfry, spacja, kasowanie) — fizyczna klawiatura
ani systemowa klawiatura Windows nie są potrzebne. Wyszukiwanie obejmuje
numer, klienta, zamówienie, recepturę, rodzaj i tuleję. Dokładny numer bez
zer wiodących ma pierwszeństwo nad fragmentem innego numeru. Znalezione
kafelki **pulsują na zielono**, pozostałe są przygaszone; przy ograniczeniu
animacji pozostają stale zielone. Wynik („Znaleziono: n”, „bez przypisanego
miejsca: n” albo brak wyników) jest w stopce, więc wyszukiwanie nie zmienia
wielkości ani położenia kafelków.

### Zamiana kartonów bez wolnego miejsca

Karton → **Zamień miejscami → drugi karton na mapie/liście → Zapisz zamianę**.
Podgląd pokazuje oba numery, docelowe miejsca i orientacje. Każdy karton
przejmuje miejsce (i orientację) drugiego, więc operacja działa także w pełnej
mroźni i nie wymaga miejsca pośredniego. Oba kartony muszą mieć stałe miejsce.

POST `/api/magazyn/mroznia/zamiana` przyjmuje `first` i `second`, każde z
`kind`, `container_id`, `expected_revision`. Jedna transakcja, wspólna blokada
mapy i blokady obu kontenerów chronią przed równoległą zmianą oraz załadunkiem.
Błąd przy drugim zapisie wycofuje całość. Powtórzone żądanie ze starymi
wersjami zwraca konflikt, zamiast zamieniać kartony z powrotem. Klient nie
ponawia zamiany automatycznie.

### Towar bez skanowania

Dotknięcie wolnego kafelka → „⌨ Wpisz produkt” (np. łój wołowy, klawiatura
dotykowa) → „Zapisz towar”. Kafelek staje się bursztynowy (ZAJĘTE + opis).
Nie powstaje karton, sztuki ani ruchy magazynowe; miejsce jest zablokowane dla
palet tak samo jak przez karton. Po usunięciu towaru: dotknij kafelka →
„Zwolnij miejsce” → „Tak, zwolnij miejsce”. Można też zmienić opis.
Ręczne blokady i palety używają tej samej blokady transakcyjnej; zmiana opisu
lub zwolnienie sprawdzają wersję, aby nie usunąć nowszego oznaczenia.
Tabela `cold_storage_blocked_slots` zachowuje opis, operatora i czas.
API: PUT `/api/magazyn/mroznia/zajete`, POST `/api/magazyn/mroznia/zajete/zwolnij`.

### Kolory zamówień podczas załadunku

Po dołożeniu zamówienia do auta serwer nadaje mu wolny kolor i oznaczenie
K1, K2 itd. Ten sam znacznik jest przy zamówieniu, przy każdej jego palecie na
liście załadunku i na rzucie otwieranym przyciskiem „Rzut mroźni · znajdź
karton do załadunku”. Rzut od razu koloruje kafelki wszystkich zamówień auta
(4–5 zamówień = 4–5 kolorów); pozostałe kartony są szare. „Kolory zamówień
(n)” otwiera legendę: klient, numer zamówienia, liczba kartonów w mroźni
i bez miejsca. Dotknięcie zamówienia zawęża karty i przygasza inne kafelki;
„Wszystkie zamówienia auta” przywraca wspólny widok. Zielone wyszukiwanie
pulsuje obramowaniem, zachowując kolor zamówienia.

Powiązanie odbywa się przez `orderId`, również dla kartonów magazynowych
z `linked_order_id`. Dwa zamówienia tego samego klienta mają osobne kolory.
`vehicle_loading_orders.color_index` jest trwały przez cały czas przypisania
zamówienia do auta: skan, odświeżenie, zmiana kolejności i usunięcie innego
zamówienia nie przepisują kolorów. Indeks unikalny `(vehicle_id, color_index)`
i trigger przydzielający najniższy wolny indeks pod blokadą auta chronią
równoczesne dodawanie na kilku stanowiskach. Po zdjęciu zamówienia kolor
można wykorzystać ponownie.

## Spójność i API

- `GET /api/magazyn/mroznia/plan` — kolumny, rzędy, kartony (z `orderId`),
  skład, lokalizacje, ręczne oznaczenia.
- `PUT /api/magazyn/mroznia/lokalizacja` — `kind`, `container_id`, `slot`
  (`A1`–`I7`), `rotation` (0/90), `expected_revision`. Trasy wymagają
  istniejącego uprawnienia `wydanie`.
- `cold_storage_positions`: unikalny kontener i unikalne miejsce, FK, obrót,
  operator i czas zapisu.
- Zapis w transakcji z blokadą kontenera i advisory lockiem: dwa stanowiska
  nie zajmą tego samego miejsca. Konflikt = HTTP 409 z numerem miejsca.
- Wersja chroni przed nadpisaniem przeniesienia przez drugiego operatora.
  Ponowienie identycznego zapisu jest idempotentne.
- Triggery zwalniają miejsce przy wyjeździe, załadunku, wydaniu lub zmianie
  wjazdu. Dotyczy również starych klientów mobilnych, bez zmian ich kodu.
- Cofnięcie załadunku **nie przywraca** automatycznie poprzedniego miejsca:
  mogło już zostać zajęte, a fizyczne odstawienie wymaga wskazania miejsca.
- Ponowne ważenie kartonu pozostającego w mroźni zachowuje lokalizację.

### Pozostałości po 1.0.23 w produkcyjnej bazie

Cofnięcie 1.0.23 przywróciło tylko pliki — migracje bazy zostają. W bazie są
więc nieużywane kolumny `x_cm`, `y_cm` i luźniejsze ograniczenia `slot`
(dopuszczają `X…Y…` i `M…`). Kod 1.0.24 ich nie używa i **nie należy ich
usuwać** ani zaostrzać ograniczeń migracją, jeśli w tabelach mogą być takie
wiersze (migracja by się wywróciła). Karton, któremu 1.0.23 zapisała adres
`X…Y…`, jest pokazywany jako „bez przypisanego miejsca”: operator wskazuje
stały kafelek, a zapis z wersją tego wiersza zastępuje stary adres. Zamiana
takiego kartonu jest odrzucana, dopóki nie dostanie stałego miejsca.

## Wycofana mapa w skali (1.0.23)

1.0.23 (commit `187c9d2b`, tag `magazyn-1.0.23`, wdrożona 2026-11-05 05:12 UTC)
zastąpiła 63 pola rzutem 560 × 1080 cm: współrzędne co 10 cm, obrót zmieniający
prostokąt 80 × 120 cm, kolizje i ściany. Użytkownik ocenił ten styl jako zły
i zażądał powrotu do stałych miejsc. 06:37 UTC przywrócono pliki `4065dee3`
(`deploy/rollback.sh all`) i kanał instalatora 1.0.22; smoke przeszedł,
zachowano 32 kartony i 3 ręczne zajęcia. Wydanie GitHub 1.0.23 oznaczono jako
WYCOFANE. Kopie i raport: `/opt/kebab/releases/magazyn-plan-kolory-20261104/`.
Próba generalna przed 1.0.23 wykazała zastaną różnicę partii 679 (stan 0,
księga raw 30 kg) — wpisana do `deploy/znane_rozjazdy.txt`, bez korekt danych.

## Weryfikacja 1.0.24

Testy SQL wyłącznie na lokalnych, izolowanych bazach testowych
(`kebab_mes_test_fixed_slots_*_20261105`), testy Playwright wyłącznie na
atrapach API — bez zapisów produkcyjnych. Zakres: stałe adresy i obrót,
zajęte/nieaktualne miejsca, wyścig dwóch stanowisk, wyjazd/załadunek/cofnięcie,
ręczny towar, zamiana w pełnej mroźni (61 oznaczeń + 2 kartony), wycofanie
połowy zamiany, równoległe zamiany, kolory pięciu zamówień, pozostałości
`X…Y…`, pełny ekran 1024/1366 px z panelem i bez, dotyk przy 375 px,
klawiatura dotykowa z polskimi literami. Wyniki: `2026-11-05-magazyn-1.0.24-release.md`.
