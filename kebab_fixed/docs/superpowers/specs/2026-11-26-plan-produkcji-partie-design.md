# Plan produkcji — partie, palety i bilans mięsa (etap 1)

Data: 2026-11-26 · Gałąź: `feat/plan-produkcji-partie-20261126` (od PROTRIMA 0.15.1, `1c8f429f`)

## 1. Po co

Zakład (ok. 10 t gotowego kebaba dziennie) robi plan produkcji **poza systemem**. Powody podane przez właściciela:

1. nie ma edytora etykiet, który drukuje wszystkie etykiety z kodem QR (osobny projekt, poza tym etapem),
2. **nie ma ładu w partiach**: nadawanie numerów, łączenie mięsa z kilku partii, końcówki po produkcji,
3. **nie ma bilansu mięsa**: z 8000 kg mięsa receptura daje teoretycznie +25%, ale zawsze są straty, odpady
   i coś zostaje na następny dzień, a nikt tego nie liczy.

Weterynaria stale dopytuje: *skąd wiecie, co idzie gdzie i do którego kebaba?* Obecne śledzenie jest słabe.
Dziś system **zakłada**, z której partii był kebab (przydział z planu, a gdy go brak, podział kg po równo
— `finished_goods_service` ok. l. 186), zamiast to **wiedzieć**.

**Sukces:** każdy kebab ma numer partii zgodny z tym, co fizycznie poszło na halę. Udowadnia to skan
palety, a nie założenie systemu. Strata liczy się sama dla każdej palety, dnia i receptury z ważenia
końcówek. Biuro układa dzień w PROTRIMA wieczorem, a hala nie może wziąć mięsa spoza planu.

## 2. Jak pracuje hala (ustalone z właścicielem 26.11.2026)

- Jedna masownica daje **jedną paletę** (np. 600 kg). Tablet masowni waży ją przy odbiorze (`kg_output`
  z paleciaka), nadaje numer palety (`out_pallet_no`, ciąg `seasoned_pallet_seq`) i drukuje etykietę palety.
- Mięso po masowaniu **leżakuje minimum 12 h**, więc produkcja dnia D bierze palety zamasowane wcześniej.
  Partie są znane, gdy biuro układa plan.
- **Wieczorem dzień wcześniej** biuro przygotowuje plan, partie i **etykiety kebabów** (z numerem partii).
  **Na hali nie drukuje się nic na bieżąco.**
- Kierownik produkcji ma w planie np. „20 × 40 kg KIRMIZI z 724” i wywozi z chłodni tę paletę.
- W chłodni jest **waga paletowa**.

## 3. Numery partii (bez zmian w nazewnictwie, decyzja: wariant A — dokładne numery)

Właściciel odrzucił „partię dzienną” (dzień + receptura): przy 10 t/dzień wycofanie całego dnia to za duże ryzyko.
Zostają istniejące numery z `utils/batch_numbers.py`:

| Numer | Kiedy powstaje | Skład |
|---|---|---|
| goły numer, np. `724` | masownica z jedną partią surowca | ta partia |
| `PP{n}` | masownica z kilku partii surowca (już działa automatycznie na tablecie masowni) | zapisany przy wsadzie (karta 2.5.1) |
| `PM{n}` | **sztuka z kilku zważonych końcówek, zaplanowana wieczorem przez biuro** (nowa reguła) | końcówki + kg |
| `SC{n}` | pula ścinków bez żywej partii (istnieje) | — |

Numer kebaba bez zmian: `ddmmrr <numer>`, np. `261126 PP7`.

## 4. Zasady (decyzje właściciela)

1. **Paleta = partia na hali.** Pozycja planu wskazuje konkretne palety. Kebaby z pozycji dostają numer partii
   palety, z której były.
2. **Skan przy wywozie na halę, z blokadą.** Kierownik skanuje QR palety (albo końcówki). Gdy paleta jest
   w planie na dziś, system ją puszcza i pokazuje, do której pozycji należy. Gdy jej nie ma, blokuje. Kierownik
   nie może obejść blokady sam. Gdy naprawdę trzeba wziąć inną paletę, biuro zmienia plan, system pokazuje,
   które etykiety są do przedruku, i dopiero wtedy skan przechodzi. *(Ścieżka „biuro zmienia plan → przedruk”
   to moja propozycja, właściciel jej nie zakwestionował.)*
3. **Końcówka zawsze wraca do chłodni i jest ważona** na wadze paletowej. Zachowuje swój numer partii, a plan
   podpowiada ją jako pierwszą (FEFO).
4. **Łączenie końcówek planuje biuro wieczorem, nie hala.** Plan może mieć pozycję „z końcówek 724 + 731”.
   System nadaje jej numer `PM{n}` w chwili, gdy plan idzie do produkcji. Skład PM wynika ze **zważonych** kg
   końcówek. Etykiety PM drukuje się wieczorem z resztą. Łączenia „w locie” na hali nie ma.
5. **Strata** palety = kg palety przed produkcją − kg wyrobów z tej palety − kg zważonej końcówki. Zapisuje się
   przy zwrocie końcówki jako ruch magazynowy straty (mechanika `_reconcile_row` z `seasoned_meat_service`).

## 5. Podejścia rozważone

| | Opis | Za | Przeciw |
|---|---|---|---|
| 1 | Z planu + potwierdzenie dotknięciem na tablecie | najmniej pracy na hali | zapomniane dotknięcie = zapis z planu, a nie rzeczywistość |
| **2 (wybrane)** | **Plan podpowiada palety + skan QR palety przy wywozie, z blokadą** | zapis zawsze zgodny z halą, dowód z godziną skanu | jeden skan na paletę, etykieta palety potrzebuje QR |
| 3 | Biuro uzupełnia po fakcie z kartki | najmniej do zbudowania | ten sam słaby zapis co dziś |
| — | Partia dzienna kebaba (dzień + receptura) | najprościej | odrzucone przez właściciela: zbyt szerokie wycofanie |

## 6. Co budujemy

### 6.1 Etykieta palety z kodem QR (tablet masowni)
`src/features/masownia/mixingLabelZpl.ts` dziś **nie ma QR**. Trzeba dodać kod `SP|<id palety>` (format jak
`PAL|…` i `U|…` w innych skanach). Dodruk z „Dzisiejszych mieszań” drukuje ten sam kod. Palety zamasowane przed
wdrożeniem dostają QR przez dodruk (lista dnia już ma dodruk; dodać dodruk dla palet z poprzednich dni, które
leżą w chłodni).

Id palety po stronie serwera to wiersz `mixing_charges` (ma `out_pallet_no`, `kg_output`, `batch_no`). Paleta
wskazuje swoją partię `seasoned_meat` przez `batch_no` i sesję.

### 6.2 Końcówka jako byt
Zważona końcówka to paleta z mniejszą wagą: ta sama partia, nowy wpis „końcówka” z kg z wagi, nową etykietą
z QR i datą zwrotu. Etykietę końcówki drukuje **biuro albo chłodnia** w chwili zwrotu. To nie jest druk na hali
produkcyjnej. *(Do sprawdzenia przez builderów, na której drukarce: patrz §9.)*

### 6.3 Plan produkcji w PROTRIMA (nowy dział, zastępuje placeholder `plan-produkcji`)
Oparty na istniejącym serwerze `routes/production_plans.py` i logice ze starego `src/features/production-plan/`
(przenieść **ulepszone**, nie 1:1, zgodnie z zasadą PROTRIMA).

- Lista planów (dzień, status, kg, stan etykiet, stan palet).
- Edytor dnia: import z potwierdzonych zamówień (z odliczeniem zrobionego), wpisywanie z klawiatury jak w starym
  edytorze, **panel palet w chłodni** (paleta, partia, receptura, kg ważone, termin, końcówki z wagą) zamiast
  panelu „partii”.
- Pozycja ↔ palety: system podpowiada najstarsze palety pasującej receptury i rodzaju mięsa, planista może
  zmienić. Liczba sztuk z palety = kg ważone palety / kg sztuki, w dół. Reszta jest przewidywaną końcówką
  (informacyjnie).
- Pozycja „z końcówek”: wybór kilku końcówek, suma zważonych kg, liczba pełnych sztuk. Przy aktywacji planu
  nadaje się `PM{n}` (`ensure_pm_assigned` już istnieje; `MIXED_PIECE_NUMBERING` zostaje `off` dla automatu,
  a PM nadaje się tylko dla pozycji świadomie zaplanowanych z końcówek).
- „Wyślij do produkcji” = aktywacja (rezerwacja mięsa) + przygotowanie sztuk z QR (`/finished-units/from-plan-line`
  dla każdej pozycji) w kolejności palet. Druk etykiet: istniejący przepływ druku sztuk (pełny edytor etykiet
  to osobny projekt).
- Zmiana planu po wydruku: system wylicza, które sztuki/etykiety są nieważne (inna partia), unieważnia je
  i każe przedrukować.
- Karta produkcji dla kierownika (wydruk): pozycje, palety w kolejności, liczba sztuk z każdej.

### 6.4 Skan palety na hali (tablet produkcji)
Na tablecie produkcji (`production-hmi`) kierownik ma pole „Wywóz palety”:
- skan `SP|…` → serwer sprawdza, czy paleta należy do pozycji aktywnego planu na dziś;
- zgodna: zapis „wywieziono” (kto, kiedy, paleta, pozycja) i komunikat z pozycją; niezgodna: blokada z powodem
  (spoza planu / inny dzień / już zużyta / zła receptura);
- sztuki zeskanowane jako wyprodukowane z danej pozycji są ważne tylko wtedy, gdy ich paleta była wywieziona.
  Sztuka z partii, której palety nie wywieziono, odbija się przy skanie.

### 6.5 Zwrot końcówki i strata
Na koniec produkcji palety (tablet produkcji albo chłodnia): skan palety → kg z wagi paletowej (0 = zużyta do zera)
→ serwer: końcówka (jeśli > 0) z nowym QR, strata = §4.5, paleta zamknięta.
**Plan nie może być potwierdzony przez biuro (office-confirm), dopóki każda wywieziona paleta nie ma zwrotu.**

### 6.6 Bilans w PROTRIMA
W dziale Plan produkcji, przy zakończonym planie: tabela palet (teoria z receptury → ważone po masowaniu →
na wyroby → końcówka → strata kg i %), sumy dla receptury i dnia. Ten sam widok w zakresie dat (trend strat).

## 7. Cele, nie-cele, anty-cele

**Cele:** wszystko z §6. Każdy kebab z planu wysłanego tym przepływem ma partię potwierdzoną skanem palety.
Strata z ważenia.

**Nie-cele (osobne etapy):** edytor etykiet z QR (projekt 4); ekran i wydruk śledzenia wstecz/w przód dla
weterynarii (projekt 3, następny po tym etapie; dane, które tu zbieramy, mają go zasilać); zmiany na tablecie
masowni poza QR na etykiecie; automatyczne PM na hali.

**Anty-cele (porażka, nawet jeśli „działa”):**
- numer partii przy kebabie, który nie wynika ze skanu palety (powrót do zgadywania),
- hala, która musi coś wpisywać z ręki poza kg końcówki,
- blokada, którą da się obejść na hali bez śladu,
- stary MES i PROTRIMA rozjeżdżające się na tym samym planie (stary edytor planu ma po wdrożeniu przestać być
  drogą do tworzenia planów albo widzieć te same zasady).

## 8. Ograniczenia

- Serwer wspólny ze starym MES. Migracje addytywne, testy pytest jak dotąd. Deploy przez SSH na prod Falkenstein
  (pamięć: deploy-sh-gotchas). Kopia bazy przed wdrożeniem.
- PROTRIMA: zasady `kebab_fixed/docs/protrima-ui/ZASADY_PROTRIMA.md`, zrzuty do akceptacji przed wdrożeniem.
- Przed wydaniem zmiany na tablet masowni (QR) i produkcji (skan palety) wymagają zrzutów i akceptacji
  (pamięć: „screenshot approval before UI deploys”).
- Znane błędy do naprawy przy okazji: rezerwacja planu nie zwalniana po zapisie wyrobu
  (pamięć protrima-dodaj-wyrob); `finish_day` dzieli kg po równo, gdy brak alokacji (ma przestać to robić dla
  planów z paletami).

## 9. Do rozstrzygnięcia przez buildera (moje decyzje oznaczone)

- *(moja decyzja)* Prefiks QR palety `SP|` (seasoned pallet). Builder może zmienić, jeśli koliduje z istniejącym.
- *(moja decyzja)* Zwrot końcówki robi kierownik na tablecie produkcji (to samo urządzenie co wywóz). Etykietę
  końcówki drukuje się na drukarce w chłodni lub w biurze. Jeśli w chłodni nie ma drukarki, końcówka dostaje
  etykietę w biurze przed planem wieczornym. **Do potwierdzenia z właścicielem.**
- Model danych palety/końcówki: nowa tabela `seasoned_pallets` (id, charge_id, batch_no, kg_weighed, status,
  parent_id dla końcówki) czy rozszerzenie `mixing_charges`. Do decyzji w planie implementacji.
- Palety zamasowane przed wdrożeniem: jednorazowe wprowadzenie stanu chłodni (lista + dodruk QR).
