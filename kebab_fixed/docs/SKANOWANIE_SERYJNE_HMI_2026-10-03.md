# Skanowanie seryjne w HMI produkcji i magazynu — notatka dla serwisu (03.10.2026)

## Co się zmieniło

Pola skanu HMI (pasek skanera produkcji, pas skanowania magazynu) i nasłuch
skanera (menu magazynu, główny ekran produkcji) używają wspólnego bufora ramek
(`src/features/scan/buforSkanu.ts`). Granice kodów wyznacza treść, nie
przerwa w pisaniu:

| Kod | Kiedy się kończy |
|---|---|
| sztuka `U?<20 hex>` | od razu po 20. znaku hex |
| karta kartonu `SCARTON?<20 hex>` | od razu po 20. znaku hex |
| kartka palety `PAL\|zam\|nr`, adres `…/m/p/zam/nr` | Enter/Tab/CR/LF, STX, 800 ms ciszy albo POTWIERDZONY następny kod (patrz niżej) |
| inny kod | Enter/Tab/CR/LF albo 800 ms ciszy (tylko gdy wpisany w tempie skanera) |

Kartka palety bez sufiksu: znaki po numerze są trzymane jako podgląd.
Paleta wychodzi dopiero, gdy podgląd stanie się PEŁNĄ sztuką / kartą kartonu
(20 hex) albo kompletną kolejną kartką palety / adresem QR. Jeśli podgląd nie
pasuje do początku żadnego znanego kodu (`PAL|Zam1|12SPAM`,
`PAL|Zam1|12UNRELATED`) albo przy Enterze / ciszy jest niedokończony
(`PAL|Zam1|12U|ac82`), CAŁY odczyt jest odrzucany jako błąd „Nieczytelny
odczyt … zeskanuj ponownie” — poprawny prefiks palety NIE jest wysyłany.

Nasłuch skanera na menu magazynu (bez pola skanu) przejmuje Enter/Tab tylko
wtedy, gdy kończą skan: co najmniej 8 znaków w tempie skanera albo kompletna
kartka palety. Pojedyncze / powolne klawisze człowieka przepadają, a Enter
aktywuje przycisk jak zwykle. Pola skanu (pasek skanera na głównym ekranie
produkcji, pas magazynu) nadal pozwalają zatwierdzić Enterem dowolny wpisany
ręcznie kod.

Pola skanu ignorują tekst tymczasowy kompozycji IME (zatwierdzony tekst
wchodzi raz), Ctrl/Meta/Alt+Enter oraz wszystko, gdy pole jest zablokowane
(dialog) albo zamknięte — ogon i timer zablokowanego pola przepadają.

`?` = jeden dowolny znak nie-alfanumeryczny albo brak (inny układ klawiatury
skanera), CapsLock i prefiks AIM (`]Q1`, STX/ETX) są obsługiwane.

Ucięty kod sztuki/kartonu nie jest wysyłany jako sztuka — HMI pokazuje
„Niepełny odczyt … zeskanuj ponownie”. Bufor dłuższy niż 200 znaków bez końca
kodu jest odrzucany z komunikatem.

Mobilne ekrany (`useSkanAutoSubmit`) działają bez zmian.

## Produkcja: skan prosto z głównego ekranu (od 03.10.2026)

Na HMI produkcji NIE wybiera się już pozycji do skanowania i nie ma okna
„Skanuj tę pozycję”. Kierownik skanuje sztuki dowolnych pozycji na przemian,
od razu po wejściu na ekran, bez klikania:

- **Nasłuch na dokumencie + pole na pasku.** Skaner działa, gdy fokus stoi na
  body, wierszu planu albo przycisku. Pole skanu na pasku jest dla wklejenia /
  skanu z fokusem; nie zabiera fokusu innym polom. Inne pola tekstowe, IME,
  skróty i Tab/Shift+Tab działają normalnie.
- **Sufiks Enter/Tab skanu nie klika przycisku z fokusem** („Dodaj”, „Zakończ
  dzień”, „Wyloguj”) — jest przejmowany jako koniec kodu.
- **Pozycję wskazuje etykieta, rozpoznaje ją serwer.** Każdy skan to JEDEN
  `POST /finished-units/scan-produced` z `expected_plan_id` = plan widoczny
  w chwili odczytu i BEZ `plan_line_id`. Backend w jednej transakcji odrzuca
  sztukę z innego planu, ze zdjętej pozycji, z planu zamkniętego /
  potwierdzonego przez biuro / wysłanego przez tablet — przed jakąkolwiek
  zmianą sztuki i magazynu. Różne pozycje tego samego planu przechodzą.
  Odpowiedź niesie `planId`, `planLineId`, nazwę produktu, klienta, partię,
  wagę i `done/total` pozycji. Wywołanie bez `expected_plan_id` (mobilne,
  stary klient) działa jak dotąd.
- **Skan nie rusza ręcznego naliczania.** Nie zmienia `qtyDone`, wpisów pracy,
  zaznaczonej pozycji ani wybranej osoby. Pozycję ostatniego skanu widać jako
  osobny znacznik na liczniku skanu w wierszu planu.
- **Kolejka FIFO** wspólna dla nasłuchu i pola: jeden POST w locie, plan
  zamrożony w każdym rekordzie (zmiana planu na ekranie nie przekierowuje kodów
  już przyjętych). Przyjęcie do kolejki to nie sukces — „Zapisane” rośnie
  i krótki dźwięk gra dopiero po odpowiedzi serwera. Błąd jednej sztuki nie
  zatrzymuje następnych; nic nie jest ponawiane automatycznie.
- **Stały pasek skanera** (jedna linia nad planem): „Skaner gotowy” albo
  „Skaner wstrzymany: powód”, ostatnio rozpoznany produkt (z serwera),
  Zapisane / Oczekujące / Błędy. Oczekujące są neutralne; alarm dopiero przy
  ≥ 5 s bez postępu albo ≥ 100 kodach w kolejce. Lista błędów rozwija się
  pod paskiem (przewijana, z kodem i powodem), „Przeczytane” ją czyści.
  Pasek zmian biura przeszedł do nagłówka (wariant kompaktowy).
- **Kiedy skaner jest wstrzymany** (zero POST, kod trafia na listę błędów
  „Nie wysłano — skaner wstrzymany”): brak / ładowanie / nieaktualny plan,
  dzień wysłany do biura, przerwa, zakończenie dnia, każde okno (szczegóły,
  przepisanie, tuleja, statystyki, prognoza, foliowanie), ręczny zapis sztuk
  w toku, przerwy aktualnego planu jeszcze niewczytane. Po powrocie skaner
  odbiera sam, bez klikania.
- **Plan nieaktualny trwa do następnego UDANEGO odczytu listy planów.** Samo
  ruszenie ponowienia (wiszącego albo nieudanego) nie przywraca gotowości;
  zwykły odczyt co 5 s, który się udaje, skanera nie wyłącza.
- **Przerwy mają kontekst planu.** Do pierwszego odczytu przerw dla
  aktualnego planu (wejście na ekran, zmiana planu) skaner stoi z powodem
  „wczytywanie przerw” — trwająca przerwa z serwera nie ma okienka, w którym
  skany idą; stan przerw poprzedniego planu nie udaje stanu nowego.
- **Zmiana kontekstu zrzuca niekompletny kod.** Każda zmiana planu oraz
  przejście gotowy ↔ wstrzymany (w obie strony, np. otwarcie i zamknięcie
  okna) czyści ogon OBU buforów (nasłuch i pole). Ciąg dalszy kodu zaczętego
  przed zmianą (skaner pisze dalej) nie jest wysyłany: trafia na listę błędów
  jako „Przerwany odczyt … zeskanuj ponownie”, a jego Enter/Tab jest połykany
  jak sufiks. Kody już przyjęte do kolejki zostają ze swoim planem. Kod
  rozpoczęty w ≤ 800 ms po przerwanym ogonie jest traktowany jako jego ciąg
  dalszy (skaner Bluetooth zacina się do ~600 ms).
- **Kody w kolejce blokują** „Zakończ dzień”, „Wyloguj”, „Przerwa”, „Dodaj”,
  przepisanie, zmianę tulei oraz otwieranie okien: szczegóły pozycji
  (przycisk w panelu i przytrzymanie wiersza), foliowanie, prognozę
  i statystyki (przycisk wyłączony + strażnik synchroniczny; przytrzymanie
  wiersza pokazuje dymek „Poczekaj — zapisują się zeskanowane sztuki” zamiast
  okna). Ręczny wybór pozycji i osoby działa dalej. Zamknięcie karty
  przeglądarki pyta o potwierdzenie. Odmontowanie ekranu nie wypuszcza już
  nowych POST-ów.
- **Liczniki skanu** pozycji i suma „Zeskanowane” biorą `done/total`
  z odpowiedzi skanu (nie optymistyczne +1). Odczyt postępu wysłany PRZED
  potwierdzeniem nie cofa licznika; odczyt wysłany PO nim jest autorytatywny.
  Dubel i błąd nic nie zmieniają. Zmiana planu unieważnia te potwierdzenia.
- **Odświeżanie planu i postępu skanów** robi jeden harmonogram
  (`harmonogramOdswiezania.ts`): co 5 s także bez skanów (zmiany biura), po
  udanych zapisach jedno odświeżenie po ~600 ms ciszy, nie częściej niż co
  1,5 s i nie później niż 5 s od pierwszego nieodświeżonego zapisu; jeden
  odczyt naraz. Te dwa źródła wyszły z `useLiveRefresh` ekranu (inne źródła
  i ekrany bez zmian).

Symulacja (testy jednostkowe, natychmiastowe API, NIE pomiar sprzętu): seria
100 kodów co 50 ms → 100 POST i 1–3 odświeżenia planu+postępu w 5 s + ciszy
(zamiast ~100 par GET); 500 kodów z wolną pierwszą odpowiedzią → 500 POST
w kolejności, najwyżej 1 w locie; 20 szybkich skanów na stronie → ≤ 2 odczyty
postępu. Test integracyjny strony (`productionHmiPage.test.tsx`, „pomiar”):
100 kodów co 50 ms z natychmiastowym API → oczekiwane 100 POST, najwyżej
1 w locie, bez lookupu, ≤ 3 odczyty listy planów i ≤ 3 odczyty postępu po
odjęciu odczytów inicjalnych; faktyczne liczby test wypisuje na konsolę.
Wynik przebiegu z 04.10.2026 (symulacja w jsdom, natychmiastowe API — NIE
pomiar na stanowisku): 100 POST, najwyżej 1 w locie, 2 odczyty listy planów,
2 odczyty postępu, 0 lookupów (seria 100 kodów co 50 ms, 5 s + cisza).
Nic z tego nie zostało wdrożone.

## Zalecenie konfiguracji skanera

**Ustaw w skanerze sufiks Enter (CR) albo Tab.** HMI działa i bez sufiksu, ale:

- kartka palety bez sufiksu wychodzi dopiero po 800 ms ciszy (numer palety
  ma zmienną długość — „1” może być początkiem „12”),
- obcy/nieznany kod bez sufiksu nie ma pewnej granicy; jeśli zaraz za nim
  przyjdzie następny kod, oba pójdą jako jeden błędny kod (zostanie
  zgłoszony jako błąd, nie zniknie),
- kartka palety z doklejonym nieznanym ciągiem jest odrzucana w całości —
  z sufiksem takie sklejenie w ogóle nie powstaje.

Sufiks daje pewną granicę dla każdego rodzaju kodu. Enter/Tab przychodzący
po kodzie sztuki, który już się zamknął sam, jest ignorowany (nie robi
pustego ani podwójnego skanu, Tab nie przenosi fokusu).

## Procedura testu seryjnego na stanowisku (do wykonania przez serwis)

Nie wykonano na sprzęcie — opis do realnej próby. Czasów skanera ani API nie
mierzono.

Produkcja (główny ekran, bez wyboru pozycji):

1. Wejdź na ekran produkcji, nic nie klikaj. Pasek: „Skaner gotowy”.
2. Zeskanuj seryjnie ok. 20–30 etykiet z RÓŻNYCH pozycji na przemian
   najszybciej, jak się da, raz skanerem z sufiksem Enter, raz bez sufiksu;
   część z fokusem na „Dodaj” / „Zakończ dzień”.
3. Sprawdź: „Zapisane” = liczba etykiet, „Oczekujące” spada do zera, liczniki
   skanu rosną na właściwych pozycjach, żaden przycisk się nie uruchomił,
   zaznaczona pozycja i osoba w panelu się nie zmieniły, `qtyDone` bez zmian.
4. Zeskanuj tę samą etykietę drugi raz — „już zeskanowana” na liście błędów.
5. Zeskanuj etykietę z innego dnia / planu — „Sztuka z innego planu — odłóż ją”.
6. Otwórz okno (np. Statystyki) albo przerwę i zeskanuj — pasek „wstrzymany”,
   skan na liście błędów, nic nie poszło na serwer. Zamknij — skaner odbiera sam.
   Przy kodach w kolejce (wolna sieć) okna i przytrzymanie wiersza się nie
   otwierają.
7. Odłącz sieć na chwilę w trakcie serii — nieudane skany na liście błędów jako
   „Błąd połączenia — wynik niepewny”; „Zakończ dzień” / „Wyloguj” zablokowane
   do rozliczenia kolejki. Sprawdź licznik pozycji przed ponowieniem.
8. Przy kilkunastu błędach lista ma się przewijać i pokazywać każdy kod.

Magazyn (pakowanie):

1. Na menu zeskanuj kartkę kartonu i od razu kilka etykiet sztuk (bez czekania).
2. Sprawdź: karton się otwiera, wszystkie sztuki trafiają do kartonu po kolei,
   licznik „odebrano N · zapisuję…” przy polu spada do zera.
3. Powtórz seryjnie na otwartym pakowaniu (fokus w polu) oraz na wydaniu sztuk
   — „Przekaż do biura” ma być zablokowane, dopóki skany czekają na zapis.

## Ograniczenia

- Brak zapisu offline i gwarancji „dokładnie raz” — skan, którego zapis się
  nie powiódł, trzeba powtórzyć ręcznie (HMI nie ponawia go automatycznie,
  bo wynik nieudanego zapisu bywa niepewny). Dubel rozstrzyga backend.
- Błąd bez odpowiedzi serwera (sieć, przerwane połączenie, 5xx) jest pokazywany
  jako wynik NIEPEWNY — HMI nie twierdzi, że nic nie zapisano. Tylko odmowa
  serwera (4xx) jest pokazywana jako „Nie weszła”.
- Pas skanowania magazynu: ekrany same obsługują błędy zapisu. Gdyby obsługa
  skanu rzuciła wyjątek, pas pokazuje trwały komunikat z kodem i gra dźwięk
  błędu; kolejka idzie dalej, bez automatycznego ponawiania.
- Harmonogram odświeżania obejmuje wyłącznie plan i postęp skanów HMI
  produkcji. Pozostałe źródła ekranu (załoga, folia, opakowania, tempo,
  przerwy) nadal odświeża `useLiveRefresh` co 5 s, a ręczny zapis sztuk nadal
  czyta świeży plan (`byId`) i odświeża listę po zapisie.
- Ręczne kontrolki („Dodaj”, przepisanie, tuleja) są wyłączone, dopóki skany
  czekają w kolejce; przy ciągłej serii skanów chwilowo migają.
- Wiszący POST (brak odpowiedzi bez błędu) trzyma kolejkę i blokadę wyjścia —
  pasek podnosi alarm po 5 s. Kod niewysłany przepada dopiero z zamknięciem
  karty (przeglądarka pyta o potwierdzenie).
- Stare okno `ScanPanel` zostało w kodzie (z testami), ale ekran produkcji go
  nie używa; `LineCounter.onScanLine` jest opcjonalne i nie jest podawane.
- Granica kartki palety bez sufiksu wymaga potwierdzenia następnego kodu albo
  800 ms ciszy; przy niejednoznaczności odczyt jest odrzucany (do powtórzenia).
- Brak wdrożenia — zmiana jest tylko w repozytorium.

## Docelowe wydanie (plan, nie status)

- Instalatory: Produkcja HMI **1.0.8** (tag `produkcja-1.0.8`), Magazyn HMI
  **1.0.13** (tag `magazyn-1.0.13`). Biuro bez zmiany wersji.
- Kolejność: najpierw backend (obsługa `expected_plan_id`), dopiero potem web
  i instalatory Tauri.
- Faktyczny status wdrożenia potwierdza osoba wdrażająca; ta notatka go nie
  stwierdza.
