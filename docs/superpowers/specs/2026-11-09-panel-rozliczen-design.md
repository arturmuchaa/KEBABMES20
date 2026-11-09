# Panel rozliczeń z odbiorcami (PROTRIMA) — projekt

Data: 2026-11-09 · Gałąź bazowa: `protrima-fundament` · Szkic wyglądu: https://claude.ai/artifact/VoU6PkHDpvVG3jcVhmPwfY

## 1. Po co

Biuro (Artur i szef) prowadzi należności od odbiorców w Excelu `PŁATNOŚCI.xlsx`: jedna zakładka na klienta, dwie kolumny obok siebie (WZ i FAKTURA), saldo każdej i „SALDO ŁĄCZNIE”. Arkusz jest pełen `#REF!`/`#VALUE!`, kwoty przepisuje się ręcznie, a klient nie widzi na papierze, ile jest winien.

Stary moduł `rozrachunki` w MES istnieje, ale nikt z niego nie korzysta („źle zrobiony”). Ten projekt go **zastępuje**.

Cel: po wystawieniu dokumentu kwota **sama** trafia na saldo klienta, wpłatę wpisuje się w kilka sekund, a na dokumencie dla klienta drukuje się czytelna tabelka aktualnych należności (data powstania, termin, dni po terminie). Ma się z tego korzystać intuicyjnie, łatwo i czytelnie — lepiej niż z Excela.

## 2. Jak działa handel (ustalenia z właścicielem)

- Wysyłkę często dzieli się: część kilogramów na **WZ**, część na **fakturę (FV)** — np. pół na pół albo 3 000 kg WZ + 9 000 kg FV. **Te same kilogramy nigdy nie są jednocześnie na WZ i na FV.** Dług liczy się więc raz: suma WZ + suma FV. (Pokrywające się wiersze w arkuszu ROJPAK to błąd arkusza.) Ustawienie per klient „licz tylko WZ / tylko FV / oba” ze starego modułu (`clients.settlement_basis`) **nie jest potrzebne**.
- **WZ i FV rozlicza się zawsze osobno.** Pieniądze wpłacone na WZ zamykają tylko WZ, pieniądze na FV — tylko FV. To dwie osobne „księgi” klienta.
- Typowo: WZ — gotówka przy odbiorze (termin = dzień wydania); FV — przelew, 7 dni od wystawienia. **Ale bywa odwrotnie** (WZ przelewem z terminem, FV gotówką). Forma płatności i termin to cechy dokumentu/wpłaty, nie rodzaju dokumentu.
- Klient często płaci częściowo, ratami, czasem więcej niż winien.
- Wpłata nieprzypisana do konkretnego dokumentu rozlicza **najpierw najstarsze** otwarte dokumenty danej księgi. Nadwyżka = **saldo na plus** (nadpłata) i zjada kolejne dokumenty tej księgi.
- Waluta: klienci zagraniczni — EUR (dokumenty i wpłaty w EUR), polscy — PLN. Waluta jest cechą kontrahenta. Bez przeliczania kursów.
- Konwencja znaku jak w Excelu: **minus = klient jest winien, plus = nadpłata.**

## 3. Cele / poza zakresem / czego unikać

**Cele**
1. Automatyczne obciążenie salda z WZ (gdy WZ ma ceny), aktualizowane przy edycji/anulowaniu WZ.
2. Ręczne wpisywanie faktur (do czasu integracji z Subiektem — wtedy faktury wpadają same; model musi to przewidzieć).
3. Szybkie wpisywanie wpłat z podglądem, co rozliczą.
4. Lista kontrahentów z saldami, sortowaniem i filtrami; karta klienta z pełną historią.
5. Wydruki: tabelka salda na WZ, osobne „Zestawienie należności”, „Historia rozliczeń za okres”.
6. Uwagi i dziennik ustaleń z przypomnieniami.

**Poza zakresem (teraz)**
- Integracja z Subiektem (tylko przygotować model: pole źródła/identyfikatora zewnętrznego faktury).
- Import wyciągów bankowych, maile/SMS-y z przypomnieniami, odsetki.
- Zobowiązania wobec dostawców (to tylko należności od odbiorców).
- Saldo pojemników zwrotnych — istniejąca, osobna funkcja; nie ruszać.
- Przenoszenie historii z Excela (start od salda otwarcia — p. 5).

**Czego unikać (porażka, nawet jeśli „działa”)**
- Dług policzony podwójnie (WM na saldzie, ten sam dokument dwa razy, faktura wpisana dwa razy).
- Kwota na saldzie zmienia się bez śladu, kto/kiedy/dlaczego.
- Liczby w panelu i na wydruku różnią się od siebie.
- Excelowy chaos: dziesiątki kolumn, ukryte reguły. Ekran ma odpowiadać na pytanie „kto ile wisi i od kiedy” w sekundę.
- Dług przypisany niewłaściwemu kontrahentowi (dwie karty o podobnej nazwie).

## 4. Użytkownicy i miejsce w systemie

- Użytkownicy: **tylko biuro** — Artur i szef (role `office` i `admin`). Kierowcy i hale nie mają dostępu.
- Interfejs: moduł **Rozrachunki** w PROTRIMA (obszar Sprzedaż; klucz `rozrachunki` jest już w `src/protrima/shell/modules.tsx`, na razie zaślepka). Dopisać do `W_PROTRIMA`. Wygląd zgodny z PROTRIMA (tokeny, gęste tabele Windows-ERP, jak w szkicu).
- Backend: istniejący FastAPI w `kebab_fixed/backend`.
- Stary ekran rozrachunków w MES, jego blok salda na WZ (`BlokSalda`, `/api/rozrachunki/na-dokumencie`) oraz kartka „Rozliczenie dostawy” (`RozliczenieDostawyPage`, `POST /api/rozrachunki/dostawa/{order_id}`, link w `ZaladunekDrukPage`) zostają zastąpione — w miejscu linku przy druku załadunku pojawia się nowe „Zestawienie należności” (p. 10.2). *(Właściciel, 09.11: „nowe rozliczenia zrób”.)* Z istniejącego `rozrachunki_service.py` warto przejąć sprawdzoną logikę przypisania WZ do kontrahenta (p. 6.1). Tabele starego modułu (`client_opening_balances`, `client_charges`, `client_payments`, kolumny `settlement_*` w `clients`) — budowniczy sprawdza na produkcji, czy zawierają dane, i decyduje: przebudować/rozszerzyć czy zastąpić nowymi. Właściciel z nich nie korzysta, więc danych do zachowania nie ma, chyba że produkcja pokaże inaczej.

## 5. Start: saldo otwarcia

- **Globalna data startu rozliczeń** (ustawienie zakładu, domyślnie 09.11.2026). Do sald liczą się tylko WZ i faktury z datą wystawienia **od dnia startu włącznie** — wcześniejsze siedzą w saldzie otwarcia. *(Decyzja projektanta: data jest globalna, żeby nowi klienci po starcie byli liczeni automatycznie bez żadnego ustawiania; „od dnia startu włącznie” vs „po” — budowniczy ustala jednoznacznie i pokazuje w UI.)*
- Biuro wpisuje każdemu klientowi saldo otwarcia **osobno dla WZ i dla FV** (kwota ze znakiem: minus dług, plus nadpłata), z notatką. Brak wpisu = 0.
- Opcjonalne pole „zaległe od” (data): wtedy dni po terminie salda otwarcia liczą się od tej daty, nie od dnia startu.
- Saldo otwarcia zachowuje się jak najstarszy dokument w swojej księdze („Saldo otwarcia WZ/FV”): spłaca się pierwsze i pojawia na wydrukach. Dodatnie saldo otwarcia to nadpłata.
- Zmiana salda otwarcia — z wpisem w historii.

## 6. Dokumenty (obciążenia)

Każdy dokument należy do jednej księgi klienta (WZ albo FV) i ma: numer, datę wystawienia, kwotę brutto w walucie klienta, termin płatności, domyślną formę płatności (gotówka/przelew), uwagi, źródło (MES WZ / ręcznie / w przyszłości Subiekt), stan.

### 6.1 WZ z MES — automatycznie
- **Kwota długu = kwota do zapłaty z WZ, czyli brutto** (właściciel, 09.11): klient polski — z VAT (zwykle 5%), klient zagraniczny — netto, bo VAT 0%. Liczona z pozycji WZ (netto + VAT wg stawki na każdej pozycji), tak samo jak „Razem brutto” na wydruku WZ (`WzDocumentView.tsx`) — **nie** z `total_value`, który jest netto. Wspólna funkcja liczenia brutto dla wydruku WZ i rozliczeń, żeby kwoty się nie rozjechały. Klient z polskim NIP i WZ bez żadnej stawki VAT → ostrzeżenie w panelu (prawdopodobny błąd wyceny), nie zgadujemy stawki.
- **Data dokumentu WZ = data wydania** (`release_date`), gdy pusta — data wystawienia (`issued_date`); tak jak stary moduł. Od niej liczy się odcięcie na dacie startu, kolejność „od najstarszych”, termin i dni po terminie. *(Decyzja projektanta.)*
- Liczą się dokumenty z `wz_documents`: seria **WZ** (zwykłe WZ i „WZ klienta” z podziału wysyłki, `split_scope='wz_klienta'`). **Seria WM nigdy** (WZ wewnętrzny na całość dostawy, zostaje w biurze).
- WZ wchodzi na saldo, **gdy ma ceny** (wyceniony, `total_value > 0`). WZ wstępna bez cen nie jest długiem; na karcie klienta może być widoczna jako „czeka na ceny”, bez kwoty.
- **Edycja WZ** (ceny, ilości, korekta po załadunku) → kwota na saldzie zmienia się sama, a w historii dokumentu jest wpis „kwota zmieniona z X na Y, data, kto”.
- **Anulowanie WZ** → znika z salda (z wpisem w historii). Wpłaty, które były do niej przypisane, nie giną — przechodzą na kolejne otwarte WZ albo zostają nadpłatą (wynika z p. 7).
- Przypisanie do kontrahenta: `wz_documents` nie ma `client_id`. Kolejność: przez zamówienie (`source_type='order'` → `client_orders.client_id`), dopiero potem po NIP/nazwie nabywcy — tak jak w obecnym `rozrachunki_service._obciazenia_z_wz` (powód: w kartotece są karty o tej samej nazwie handlowej). WZ, których nie da się jednoznacznie przypisać, trafiają na listę „WZ bez kontrahenta” w panelu do ręcznego przypisania — nigdy nie zgadujemy po cichu.
- Waluta: dokument bierze walutę z WZ (`wz_documents.currency`). Jeśli różni się od waluty kontrahenta — wyraźne ostrzeżenie w panelu, bez przeliczania. *(Decyzja projektanta.)*
- Termin: data wydania + domyślny termin WZ klienta (**domyślnie 0 dni** — potwierdzone 09.11; zastępuje wrześniowe „WZ +1 dzień”, czyli `TERMINY_DOMYSLNE` w `rozrachunki_saldo.py` do zmiany). Biuro może zmienić termin i formę płatności dla konkretnej WZ.
- Mechanizm synchronizacji (wyzwalacz przy zapisie WZ, przeliczanie przy odczycie, zadanie okresowe) — **wybór budowniczego**; warunek: saldo w panelu i na wydruku jest zawsze zgodne z aktualnym stanem WZ.

### 6.2 Faktury — ręcznie
- Formularz: kontrahent, numer, data wystawienia, kwota brutto, termin (domyślnie data + termin FV klienta, **domyślnie 7 dni** od wystawienia — potwierdzone 09.11; zastępuje wrześniowe „14 dni”), forma płatności (domyślnie przelew), uwagi.
- Numer faktury unikalny w obrębie kontrahenta (ochrona przed podwójnym wpisem — już jest indeks w starym schemacie).
- Faktura korygująca: kwota ujemna w księdze FV. *(Decyzja projektanta.)*
- Edycja i usunięcie — z powodem, zostaje ślad.
- Przygotowanie pod Subiekt: pole identyfikatora zewnętrznego; przyszły import dopasuje ręcznie wpisane faktury po numerze zamiast tworzyć duplikaty.

### 6.3 Stan dokumentu
`zapłacony` (z datą zamknięcia i „zapłacono po N dniach”), `częściowo zapłacony`, `w terminie` / `termin dziś` / `termin jutro` / `za N dni`, `po terminie N dni` (N = dziś − termin, tylko gdy zostało coś do zapłaty), `czeka na ceny` (WZ bez cen), `anulowany` (tylko w historii).

## 7. Wpłaty i rozliczanie

- Wpłata: kontrahent, **księga (WZ albo FV)**, forma (gotówka/przelew — niezależna od księgi), kwota w walucie klienta, data, uwagi (np. „zapłacił kierowcy”), kto wpisał.
- Opcjonalnie: wskazanie konkretnego dokumentu (gdy klient w tytule przelewu podał numer faktury). Wtedy wpłata idzie najpierw na ten dokument, reszta — od najstarszych.
- Reguła rozliczenia w księdze: najpierw wpłaty przypięte do dokumentów, potem pozostałe wpłaty w kolejności daty na otwarte dokumenty od najstarszego (data wystawienia, potem numer). Niewykorzystana reszta = nadpłata, która automatycznie pokrywa dokumenty wystawione później. Rozliczenie jest **deterministyczne i przeliczalne od zera** po każdej zmianie (edycja/anulowanie WZ, usunięcie wpłaty), więc nie ma „rozjechanych” powiązań.
- W formularzu wpłaty — podgląd na żywo: „ta wpłata rozliczy: FV 528/2026 7 280,00 → zapłacona; FV 541/2026 7 720,00 z 12 342,20 → zostaje 4 622,20; nadwyżka +X zostaje jako saldo na plus” (jak w szkicu).
- Usunięcie/edycja wpłaty — z powodem, ślad w historii.
- Saldo księgi = suma wpłat i dodatnich sald otwarcia − suma dokumentów (ujemne = dług). Saldo łączne = saldo WZ + saldo FV.

## 8. Ekrany

### 8.1 Lista kontrahentów (wejście do modułu)
- Na górze sumy **osobno dla PLN i EUR**: należności razem, w tym po terminie; gotówka z WZ do odebrania; nadpłaty.
- Tabela: kontrahent, waluta, saldo WZ, saldo FV, saldo łącznie, kwota po terminie, najstarsza zaległość (pigułka: „41 dni po terminie” czerwona / „termin za 3 dni” bursztynowa / „w terminie” / „nadpłata” / „rozliczony”), znacznik przypomnienia z dziennika (p. 9).
- **Sortowanie po każdej kolumnie** (klik w nagłówek, drugi klik odwraca); domyślnie najdłużej zalegający na górze; zapamiętanie ostatniego wyboru.
- Filtry: wszyscy / po terminie / nadpłaty / z przypomnieniem na dziś / PLN / EUR; wyszukiwanie po nazwie i NIP.
- Na liście są kontrahenci z jakimkolwiek saldem, dokumentem lub saldem otwarcia; rozliczeni na końcu (wyszarzeni).
- Dodatkowo, gdy są: pasek „WZ bez kontrahenta (N)” i „WZ w innej walucie niż kontrahent (N)”.

### 8.2 Karta klienta
- Nagłówek: nazwa, NIP, waluta, domyślne terminy i formy płatności (WZ, FV) — edytowalne w ustawieniach karty; **stała notatka o kliencie** (np. „płaci w piątki”, „limit 20 000 €”).
- Kafelki: saldo WZ, saldo FV, saldo łącznie (z kwotą po terminie i najstarszą zaległością).
- Przyciski: **+ Wpłata**, **+ Faktura**, **Drukuj saldo** (zestawienie na dzień / historia za okres), saldo otwarcia.
- Dwie tabele obok siebie (jak dwie kolumny w Excelu; na wąskim oknie jedna pod drugą): **WZ** i **Faktury** — data, numer, kwota, zapłacono, zostało, termin, stan, uwagi. **Pełna historia**, także zapłacone dokumenty (z datą zamknięcia i liczbą dni do zapłaty); przełącznik „ukryj zapłacone”; filtr okresu (ten miesiąc / kwartał / rok / od–do / wszystko — domyślnie wszystko, najnowsze na górze).
- Klik w dokument → szczegóły: wpłaty, które go pokryły, historia zmian (kwota, termin), uwagi.
- Lista wpłat: data, księga, forma, kwota, na co poszła, kto wpisał, uwagi.
- Dziennik ustaleń (p. 9).

## 9. Uwagi i dziennik ustaleń
- Uwagi przy dokumencie (np. „brakuje 426 €, reklamacja”), przy wpłacie, stała notatka przy kliencie.
- Dziennik ustaleń na karcie klienta: data, kto, treść („05.11 dzwoniłem, obiecał zapłacić do 10.11”), opcjonalna **data przypomnienia** — tego dnia (i później, dopóki nie odhaczone) klient jest wyróżniony na liście kontrahentów. *(Propozycja projektanta; właściciel prosił o „miejsce na uwagi”.)*

## 10. Wydruki

Wszystkie w walucie klienta, z danymi firmy, z podglądem przed drukiem i zapisem do PDF (do wysłania mailem). Liczby identyczne z panelem (wspólne źródło obliczeń).

### 10.1 Tabelka salda na WZ
- Drukuje się na WZ wychodzącej do klienta (zwykła WZ i WZ klienta z podziału; **nie** na WM).
- Treść „Stan rozliczeń na dzień DD.MM.RRRR — dokumenty niezapłacone”: **dwie osobne tabelki** — WZ i Faktury — kolumny: dokument, data wystawienia, termin płatności, kwota, zapłacono, pozostało, dni po terminie; suma pod każdą; na dole „Razem do zapłaty” i „W tym po terminie”. Saldo otwarcia jako wiersz „Saldo otwarcia” z datą.
- **Dokumenty po terminie na czerwono** (właściciel, 09.11) — cały wiersz (WZ i faktury) w kolorze czerwonym i dodatkowo pogrubiona liczba dni po terminie, żeby było czytelne także na drukarce czarno-białej. Na zestawieniu 10.2 i historii 10.3 tak samo.
- Stopka: „Wpłaty zaksięgowane do DD.MM.RRRR. Jeżeli zapłacili Państwo w ostatnich dniach, prosimy uznać zestawienie za nieaktualne.”
- Gdy brak należności: jedna linia „Brak należności — dziękujemy”. Gdy klient ma nadpłatę: linia „Nadpłata: X”. *(Decyzja projektanta.)*
- Czy tabelka uwzględnia samą drukowaną WZ — tak, jeśli jest wyceniona (stan na moment druku).

### 10.2 „Zestawienie należności” (osobna kartka)
- Ta sama treść co 10.1, na osobnej stronie A4 z nagłówkiem firmy i klienta.
- **Przy wysyłce:** dostępna zawsze w zestawie dokumentów wysyłki/załadunku; gdy wysyłka idzie w całości na fakturę (brak WZ), system sam proponuje ją do druku. (Faktury powstają w Subiekcie — nie dodamy na nich własnej tabelki.)
- **Z panelu:** z karty klienta, „na dzień” (domyślnie dziś).

### 10.3 „Historia rozliczeń za okres”
- Z karty klienta, wybór okresu: ten miesiąc / poprzedni miesiąc / od–do.
- Saldo na początek okresu → wszystkie dokumenty i wpłaty w kolejności dat (z saldem narastającym), osobno dla WZ i FV → saldo na koniec. Jak wyciąg bankowy — do wyjaśniania „ja to już zapłaciłem”.

## 11. Historia zmian i bezpieczeństwo
- Każda zmiana kwoty dokumentu, wpłaty, salda otwarcia, terminu: wpis kto/kiedy/co/z czego na co/powód (dla usunięć powód obowiązkowy).
- Usunięte wpłaty i faktury nie znikają z bazy — są oznaczone i widoczne w historii.
- Uprawnienia: odczyt i zapis — `office` i `admin`. Serwer pilnuje uprawnień.
- Kwoty jako `NUMERIC`, zaokrąglenie do groszy/centów; formatowanie polskie (`1 234,56 zł`, `1 234,56 €`).

## 12. Ograniczenia wdrożeniowe
- Praca na gałęzi wychodzącej z `protrima-fundament` (worktree `/opt/kebab/wt-protrima-fundament`).
- Przed wdrożeniem zmian wyglądu — zrzuty ekranu do akceptacji właściciela.
- Produkcja: serwer Falkenstein (91.98.105.107), wdrożenie przez SSH; ten host (hel1) nie jest produkcją.
- Migracje bazy w istniejącym mechanizmie `backend/app/migrations.py` (idempotentne).

## 13. Zostawione budowniczemu
- Schemat tabel (rozszerzenie starych vs nowe), mechanizm synchronizacji WZ, sposób przechowywania przypisań wpłat (zapisane vs liczone przy odczycie) — przy zachowaniu reguł z p. 6–7.
- Podział na komponenty, API, testy (logika rozliczeń: TDD, przypadki brzegowe — wpłata większa niż dług, anulowanie WZ z wpłatą, korekta ujemna, edycja ceny po wpłacie, saldo otwarcia dodatnie).
- Szczegóły układu wydruku w granicach p. 10 (wzór: szkic, zakładka 3).
