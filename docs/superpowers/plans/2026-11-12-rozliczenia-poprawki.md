# Rozrachunki — poprawki właściciela po pierwszym dniu (12.11.2026)

Gałąź `rozliczenia-poprawki` (worktree `/opt/kebab/wt-rozl-poprawki`, od `protrima-fundament` 22079856 = produkcja). Kod w `kebab_fixed/`.
Moduł Rozrachunki działa na produkcji od 12.11.2026 (serwer 22079856, PROTRIMA 0.7.5). Spec bazowy: `docs/superpowers/specs/2026-11-09-panel-rozliczen-design.md`. Ten dokument jest jednocześnie specem i planem poprawek.

## Wymagania właściciela (słowa właściciela, 12.11.2026)

1. **Wybór klientów w rozrachunkach.** Właściciel wybiera, którzy kontrahenci wchodzą do rozrachunków. Przykład: „Katarzyna Księżyc” ma się nie pojawiać.
2. **Ile kg wziął klient i jaki zrobił obrót**, z wyborem okresu: miesiąc, rok, od początku itp.
   - Kilogramy bierze system. Przy podziale liczy, ile wydano na FV, a ile na WZ.
3. **Numer faktury z papierów kursu.** Gdy biuro wystawia dokumenty po załadunku z numerem FV, system sam dopisuje fakturę do rozrachunków.
   - Decyzja właściciela: **FV bez kwoty**. Faktura ma numer, datę i kg, a kwotę wpisuje biuro (z Subiekta). Do salda wchodzi dopiero z kwotą.
4. **Usunąć podpowiedzi (placeholdery) z pól formularzy**, np. w dzienniku ustaleń.
5. **Dziennik ustaleń → „Notatki”.** Notatkę można usunąć.
6. **Ładniejszy wydruk dla klienta**: z logo zakładu, ogólnie ładnie.
7. **WZ „nie licz do rozrachunków”.** Czasem WZ to nie są pieniądze dla zakładu, więc trzeba móc ją ukryć albo nie liczyć. FV zawsze są liczone, dla nich tej opcji nie ma.
8. **Data startu rozliczeń: 12.11.2026**, już ustawiona na produkcji. Zmianę trzeba ukryć i zablokować, żeby nikt jej przypadkowo nie zmienił.
10. **Dodanie kontrahenta do rozrachunków bez dokumentów** (np. TRUVA — teraz nie ma transportu, ale ma zaległości). Trzeba móc mu wpisać saldo otwarcia bez wystawiania nowych dokumentów.
11. **Saldo otwarcia nie wchodzi do obrotu ani kg** — liczymy od dzisiaj (od daty startu).
9. **KPI na liście.** „Należności łącznie”, a obok „Po terminie”.
   - Dziś −26 280 świeci na czerwono, choć klient jest w terminie. To błąd: **na czerwono tylko to, co po terminie / wymagalne**.
   - Dodatkowo KPI „łączny obrót” i „ile kg sprzedane”, za wybrany okres.

## Decyzje projektowe (controller)

- **D1. Wyłączenie klienta.**
  - Nowa kolumna `clients.rozl_wylaczony BOOLEAN NOT NULL DEFAULT false`. Ustawia ją okno Ustawienia klienta (przełącznik „Prowadź rozrachunki”) i wpisuje do `rozl_historia`.
  - Wyłączony klient: nie ma go na liście, w sumach ani w KPI. Na jego WZ i w papierach kursu nie drukuje się saldo (bramka C1 dostaje ten warunek). Jego WZ nadal synchronizują się do księgi, więc dane nie giną.
  - Lista ma filtr-chip „Wyłączeni (N)”. Pokazuje wyłączonych z akcją „Przywróć do rozrachunków”, żeby dało się cofnąć.
- **D2. WZ nie liczona.**
  - Kolumny `rozl_dokumenty.nie_licz BOOLEAN NOT NULL DEFAULT false`, `nie_licz_powod TEXT`. Dotyczy tylko dokumentów rodzaju WZ; dla FV API odmawia (400).
  - Ustawianie i cofanie: w `SzczegolyDokumentu`, z obowiązkowym powodem, wpis do historii.
  - Nieliczona WZ nie wchodzi do salda, „po terminie”, kg, obrotu, zestawienia ani tabelki na WZ.
  - Na karcie jest wyszarzona z tagiem „nie liczona” i ukryta za przełącznikiem „Pokaż nieliczone (N)”.
  - Synchronizacja z MES nigdy nie nadpisuje `nie_licz`.
- **D3. Kilogramy i obrót.**
  - `rozl_dokumenty.kg NUMERIC(12,3)`:
    - WZ z MES: suma kg pozycji WZ, wypełniana przez synchronizację, także wstecznie dla istniejących wierszy;
    - FV z kursu: kg części fakturowanej;
    - FV ręczna: pole „kg” w oknie faktury, opcjonalne.
  - **Obrót** = suma brutto dokumentów liczonych z datą w okresie, w walucie kontrahenta. WZ (bez nieliczonych) plus FV z kwotą; korekty ujemne odejmują.
  - **Sprzedane kg** = suma kg tych samych dokumentów w okresie, plus kg faktur bez kwoty (towar wyjechał). Bez saldo otwarcia.
  - Okres wybiera się na liście i na karcie: `Ten miesiąc | Poprzedni miesiąc | Ten rok | Od początku | Od–do`. Domyślnie ten miesiąc, wybór zapamiętany w localStorage w try/catch.
  - „Od początku” = od daty startu rozliczeń.
  - API: `lista(od, do)` i `karta(..., od, do)` zwracają kg i obrót za okres, per klient i w sumach per waluta.
- **D4. FV z papierów kursu.**
  - W `loading_service` przy wystawieniu papierów (`wystaw`, `invoice_no` per odbiorca) każde zamówienie z częścią fakturowaną (`qty_invoice > 0`) i niepustym `invoice_no` robi upsert do `rozl_dokumenty`:
    - rodzaj `fv`, `zrodlo='kurs'`, klient z zamówienia, numer = `invoice_no`, data = data kursu/wystawienia;
    - kg = Σ `qty_invoice × kg_per_unit`, `kwota NULL`, waluta klienta.
  - Ten sam numer u tego samego klienta (kilka zamówień w kursie) to jeden dokument z sumą kg.
  - Ponowne wystawienie aktualizuje kg i numer, ale nie rusza kwoty wpisanej przez biuro.
  - Stan „czeka na kwotę” to tag. Do salda, po terminie i obrotu taka FV wchodzi dopiero po wpisaniu kwoty. Termin wylicza się z daty i `termin_fv` klienta.
  - Na karcie wiersz ma pole „Wpisz kwotę”, otwierające edycję kwoty (Enter zapisuje). Na liście klient z takimi FV ma znacznik „FV bez kwoty (N)”.
  - Błąd przy dopisywaniu FV nie może zablokować wystawienia papierów kursu: zalogować i iść dalej.
  - Wyłączony klient: FV też się zapisuje (dane), ale nie pokazuje się w rozrachunkach.
- **D5. Kolory.** Czerwień (`crit-ink`) tylko dla kwot po terminie: kolumna „Po terminie”, pigułki po terminie, „w tym po terminie”.
  - Saldo ujemne w terminie ma neutralny kolor tekstu (minus typograficzny zostaje). Nadpłata zostaje zielona z „+”.
  - Dotyczy listy, kafelków listy i karty, nagłówków ksiąg, sald w oknie wpłaty.
  - Na wydrukach dla klienta czerwone zostają tylko pozycje po terminie (już tak jest).
- **D6. KPI na liście**, per waluta, kafelki ukryte, gdy wszystko zero:
  - `Należności łącznie` (neutralnie);
  - `Po terminie` (czerwono, gdy > 0);
  - `Obrót` (za okres);
  - `Sprzedane kg` (za okres);
  - `Gotówka z WZ do odebrania` i `Nadpłaty klientów` jako mniejsze podpisy lub kafelki, bez wizualnego tłoku.
  - Tabela dostaje kolumny `kg` i `Obrót` za okres.
- **D7. Data startu zablokowana.**
  - Komenda „Data startu rozliczeń” znika z PROTRIMA; data zostaje tylko jako tekst w podtytule.
  - `PUT /api/rozliczenia/ustawienia` zwraca 403 „Data startu rozliczeń jest zablokowana”. Funkcja serwisowa `ustaw_date_startu` zostaje dla administratora (skrypt).
  - `api.ts`: metoda `ustawStart` może zostać (zmiany tylko addytywne), ale nikt jej nie woła.
- **D8. Notatki.**
  - Wszędzie „Dziennik ustaleń” → „Notatki” (karta, wydruki, jeśli występuje, testy).
  - Usunięcie notatki jest miękkie: kolumna `rozl_dziennik.usunieto_at`, `usunieto_przez`, przycisk z potwierdzeniem w oknie i wpis w historii. Usunięta znika z listy.
- **D9. Bez placeholderów.** Usunąć atrybuty `placeholder` z pól w `src/protrima/modules/rozrachunki/**`: notatki, notatka o kliencie, uwagi, kwoty, szukaj.
  - Pole szukania zostaje z widoczną etykietą lub ikoną i aria-label.
  - Tam, gdzie podpowiedź niosła informację, zastąpić ją krótkim stałym opisem pod polem, ale tylko gdy naprawdę potrzebny.
- **D10. Wydruk dla klienta** (zestawienie należności, historia rozliczeń, tabelka na WZ):
  - Wspólny nagłówek z logo zakładu: ten sam plik logo co na WZ, przez jeden wspólny komponent/stałą, żeby inny zakład podmieniał jedno miejsce. Obok dane firmy z `settingsApi.getCompany()`.
  - Spójna, elegancka typografia; tabele z delikatnymi liniami; wyraźna suma „Razem do zapłaty”; stopka z danymi kontaktowymi firmy i datą wydruku.
  - Tytuł dokumentu duży, dane nabywcy w ramce; A4, wszystko na jednej stronie, gdy się da.
  - Zrzut PDF przed i po w raporcie.
- **D11. Dodaj kontrahenta.**
  - Komenda `+ Kontrahent` na pasku listy otwiera okno z `Wybor` (kartoteka klientów, szukanie po nazwie i NIP). Lista pomija klientów już widocznych i wyłączonych; wyłączonych przywraca się chipem.
  - Wybór otwiera kartę klienta. Karta ma działać dla klienta bez żadnych dokumentów: puste księgi i podpowiedź „Wprowadź saldo otwarcia” z przyciskiem.
  - Po zapisaniu salda otwarcia klient pojawia się na liście. Lista pokazuje każdego niewyłączonego klienta, który ma dokument, wpłatę albo wiersz `rozl_otwarcia`.
  - Backend: `karta()` dla istniejącego klienta bez danych zwraca pustą kartę, nie 404.
- **D3a. Saldo otwarcia nigdy nie wchodzi do obrotu ani do kg** (słowa właściciela: „liczymy od dzisiaj”). Test na to.
- **Bez zmian:** konwencja znaku (minus = klient winien); osobne księgi WZ/FV; `api.ts` tylko addytywnie; stara część webowa zostaje; brak nazw firm w `src/protrima/modules`; migracje addytywne i idempotentne.

## Zadania

### Task 1: Backend — wyłączenie klienta, WZ nieliczona, kg i obrót, notatki, blokada daty startu
- Pliki: `backend/app/migrations.py`; `backend/app/services/rozliczenia_service.py`, `rozliczenia_ksiega.py`, `rozliczenia_wz.py`; `backend/app/routes/rozliczenia.py`; `src/lib/api.ts` (tylko addytywnie); testy w `backend/tests/test_rozliczenia_poprawki2_db.py`.
- Zakres: D1, D2, D3 + D3a, D11 (backend: pusta karta dla klienta bez danych; lista pokazuje klientów z samym saldem otwarcia), D3 (kolumna kg, wypełnianie z WZ, wstecznie; `lista`/`karta` z `od`/`do` i kg/obrót per klient i w sumach), D7 (403), D8 (miękkie usunięcie notatki + trasa `POST /api/rozliczenia/dziennik/{id}/usun`).
- Pola API dla D5/D6: w sumach `naleznosci`, `po_terminie`, `obrot`, `kg` per waluta; per klient `obrot`, `kg`, `fv_bez_kwoty` (liczba).
- Testy (TDD, DB):
  - wyłączony klient znika z listy i sum, wraca po przywróceniu, a saldo na WZ dla niego to None;
  - WZ nieliczona: saldo bez niej, zestawienie bez niej, synchronizacja nie nadpisuje flagi, FV odmawia;
  - kg z pozycji WZ; obrót i kg za miesiąc/rok/od początku;
  - usunięcie notatki ukrywa ją i pisze historię;
  - PUT daty startu → 403.
- Commit: `feat(rozliczenia): wybór klientów, WZ nieliczone, kg i obrót za okres, usuwanie notatek, blokada daty startu`.

### Task 2: Backend — FV z papierów kursu bez kwoty
- Pliki: `backend/app/services/loading_service.py` (miejsce, gdzie `invoice_no` trafia do formy kursu), `rozliczenia_service.py` (funkcja upsert FV z kursu, stan „czeka_na_kwote”, wpisanie kwoty przez istniejące `edytuj_dokument`), testy `backend/tests/test_rozliczenia_fv_z_kursu_db.py`.
- Zakres: D4.
- Testy:
  - wystawienie kursu z `invoice_no` i częścią fakturowaną tworzy FV bez kwoty z kg;
  - dwa zamówienia z tym samym numerem dają jedną FV z sumą kg;
  - ponowne wystawienie nie rusza wpisanej kwoty;
  - bez `invoice_no` albo bez części fakturowanej nic się nie dzieje;
  - FV bez kwoty nie zmienia salda, a po wpisaniu kwoty zmienia i ma termin;
  - błąd w dopisywaniu nie wywraca wystawienia.
- Commit: `feat(rozliczenia): faktura z papierów kursu trafia do rozrachunków bez kwoty`.

### Task 3: PROTRIMA — lista: KPI, okres, kolory, wyłączeni, bez daty startu
- Pliki: `src/protrima/modules/rozrachunki/RozrachunkiModule.tsx`, `model.ts` (typy/mapery dla nowych pól, okresy), testy `Rozrachunki.test.tsx`, `model.test.ts`, `src/protrima/styles/modules.css`.
- Zakres: D11 (komenda `+ Kontrahent` z wyborem z kartoteki → karta), D3 (wybór okresu na liście), D5, D6, D1 (chip „Wyłączeni” i przywracanie), D4 (znacznik „FV bez kwoty (N)”), D7 (usunąć komendę i jej dialog), D9 na liście.
- Testy:
  - saldo w terminie nie ma klasy czerwieni, po terminie ma;
  - kafelki `Należności łącznie`, `Po terminie`, `Obrót`, `Sprzedane kg`;
  - zmiana okresu woła `lista(od, do)` z właściwymi datami (czas zamrożony);
  - chip „Wyłączeni” i przywrócenie wołają API;
  - brak komendy „Data startu rozliczeń”.
- Commit: `feat(protrima): rozrachunki — KPI należności/po terminie/obrót/kg, okres, kolory tylko dla zaległości`.

### Task 4: PROTRIMA — karta: WZ nieliczone, FV bez kwoty, kg/obrót, Notatki, ustawienia klienta, bez placeholderów
- Pliki: `KartaKlienta.tsx`, `SzczegolyDokumentu.tsx`, `Dziennik.tsx` (zmiana nazwy na Notatki, ewentualnie zmiana nazwy pliku z aktualizacją importów), `UstawieniaKlientaDialog.tsx`, `FakturaDialog.tsx` (pole kg), `WplataDialog.tsx`, `OtwarcieDialog.tsx`, `model.ts`, testy.
- Zakres:
  - D2 UI: akcja w szczegółach z powodem, tag, przełącznik „Pokaż nieliczone”;
  - D4 UI: wiersz „czeka na kwotę” z „Wpisz kwotę”;
  - D3 na karcie: kafelki/podpisy kg i obrót za okres z wyborem okresu;
  - D5 na karcie, D1 w ustawieniach, D8, D9 w całym module.
- Testy dla każdej akcji, z dokładnymi wywołaniami API. Dodatkowo `grep -rn "placeholder" src/protrima/modules/rozrachunki` → pusto, poza testami, które sprawdzają jego brak.
- Commit: `feat(protrima): karta klienta — WZ nieliczone, FV bez kwoty, kg i obrót, Notatki z usuwaniem`.

### Task 5: Wydruk dla klienta — ładny, z logo
- Pliki: `src/features/rozliczenia/NaglowekDruku.tsx`, `TabelaSalda.tsx`, `druk.ts`; `src/pages/office/ZestawienieNaleznosciPrintPage.tsx`, `HistoriaRozliczenPrintPage.tsx`; wspólny komponent/stała logo zakładu, używany też przez `WzDocumentView.tsx` zamiast bezpośredniej ścieżki; testy wydruków.
- Zakres: D10. Nieliczone WZ i wyłączeni klienci nie pojawiają się na wydrukach (backend z Task 1 już to zapewnia; test front na danych).
- Commit: `feat(rozliczenia): wydruk dla klienta z logo zakładu — nowy, czytelny układ`.

### Task 6: Weryfikacja i zrzuty
- Pełny backend z `TEST_DATABASE_URL`, bez SKIP w `test_rozliczenia_*`. Do tego `npx tsc --noEmit`, `npx vitest run --pool=forks --poolOptions.forks.singleFork src/protrima src/features/rozliczenia src/features/wz src/components/wz src/pages/office` i `npm run build`.
- Prawdziwa aplikacja na osobnej bazie testowej (zasiew w scratchpadzie). Scenariusz:
  - wyłączenie klienta (przykład z inną, wymyśloną nazwą);
  - WZ nieliczona;
  - kurs z numerem FV, potem FV bez kwoty, wpisanie kwoty;
  - zmiana okresu;
  - Notatki z usunięciem;
  - wydruk zestawienia i historii (PDF przez serwer).
- Zrzuty 1920 i 1366, jasny i ciemny: lista, karta, wydruki. Zapis w `kebab_fixed/docs/protrima-ui/zrzuty/rozliczenia/poprawki-2026-11-12/`.
- Commit: `docs(rozliczenia): zrzuty poprawek z 12.11`.
- Bez wdrożenia.
