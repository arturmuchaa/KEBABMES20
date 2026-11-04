# HMI magazynu: zawartość kartonów i lokalizacje mroźni

## Uzgodniony układ

- Źródło orientacji wejścia: `/root/KARTONY MROZNIA NOWE.pdf`.
- Właściciel potwierdził, że **7 × 9 oznacza miejsca paletowe**, nie metry.
- 63 logiczne miejsca: kolumny A–I od lewej, rzędy 1–7 od drzwi w głąb.
- Drzwi u dołu schematu. Nie odwzorowujemy wymiarów pomieszczenia ani
  szerokości dróg transportowych; nie jest to plan bezpieczeństwa/ewakuacji.
- Jedna paleta/karton na miejsce. Paleta 120 × 80 cm, domyślnie dłuższym
  bokiem od strony drzwi; obrót 90° nie tworzy dodatkowych miejsc.

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
przenieść karton i obrócić paletę. Adres jest widoczny na liście mroźni,
karcie kartonu otwieranej skanem i liście załadunku. Mapa odświeża się co 5 s.

### Towar bez skanowania

W trybie podglądu dotknięcie wolnego miejsca pokazuje „Oznacz jako zajęte”
z opcjonalnym opisem (np. łój wołowy). Taki kafelek jest bursztynowy i ma
napis ZAJĘTE. Nie tworzy kartonu, sztuk ani ruchów magazynowych; blokuje
odkładanie palet tak samo jak istniejący karton. Po usunięciu towaru operator
dotyka kafelka i potwierdza „Zwolnij miejsce”. Można również zmienić opis.
Ręczne blokady i palety używają tej samej blokady transakcyjnej; zmiana opisu
lub zwolnienie sprawdzają wersję, aby nie usuwać nowszego oznaczenia.
Osobna tabela `cold_storage_blocked_slots` zachowuje opis, operatora i czas.
API: PUT `/api/magazyn/mroznia/zajete`, POST `/api/magazyn/mroznia/zajete/zwolnij`.

## Spójność i API

- `GET /api/magazyn/mroznia/plan` — układ, kartony, skład, lokalizacje.
- `PUT /api/magazyn/mroznia/lokalizacja` — rodzaj/id, miejsce, obrót,
  oczekiwana wersja lokalizacji. Obie trasy wymagają istniejącego uprawnienia `wydanie`.
- `cold_storage_positions`: unikalne miejsce i unikalny kontener, FK,
  ograniczenia miejsca/obrotu, operator i czas zapisu.
- Zapis w transakcji z blokadą kontenera i advisory lockiem: dwa stanowiska
  nie mogą przypisać dwóch kartonów do tego samego miejsca. Konflikt = HTTP 409.
- Wersja chroni przed nadpisaniem przeniesienia przez drugiego operatora.
  Ponowienie identycznego zapisu jest idempotentne.
- Triggery zwalniają miejsce przy wyjeździe, załadunku, wydaniu lub zmianie
  wjazdu. Dotyczy również starych klientów mobilnych, bez zmian ich kodu.
- Cofnięcie załadunku **nie przywraca** automatycznie poprzedniego miejsca:
  mogło już zostać zajęte, a fizyczne odstawienie wymaga wskazania miejsca.
- Ponowne ważenie kartonu pozostającego w mroźni zachowuje lokalizację.

## Weryfikacja i wdrożenie

Testy SQL wykonywano wyłącznie na oddzielnej bazie
`kebab_mes_test_mroznia_20261104`. Testy Playwright korzystają wyłącznie
z atrap API (bez skanów ani zapisów produkcyjnych). Pokrywają mapę przy
1024/1366 px oraz przewijanie i klawiaturę przy 375 px.

Zmiana nie została wdrożona na produkcję. Nowe DDL jest addytywne,
idempotentne i instalowane jako jedna transakcja przez istniejący runner
migracji. Przyszłe wdrożenie wymaga osobnej zgody, kopii bazy i aplikacji
oraz istniejącej procedury deploymentu. Przy wycofaniu aplikacji można
pozostawić tabelę i triggery: starszy kod ignoruje lokalizacje. Nie usuwać
zapisanych przypisań przy rollbacku.
