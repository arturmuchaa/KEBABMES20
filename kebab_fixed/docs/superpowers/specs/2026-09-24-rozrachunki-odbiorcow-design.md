# Rozrachunki z odbiorcami — specyfikacja

**Data:** 2026-09-24
**Zgłaszający:** właściciel
**Stan dzisiaj:** arkusz `PŁATNOŚCI08.04.xlsx`, 27 zakładek, jedna na kontrahenta.

---

## Po co

> „chciałbym aby w kontrahentach możliwość zaznaczenia rozliczenie w systemie
> i aby było widać ile na WZ a ile na FV wziął dany klient i my zaznaczamy
> czy zapłacono ile zapłacono saldo itp. My teraz to prowadzimy w Excelu."

Cel nie jest „przenieść Excel do MES". Cel to **saldo, któremu można ufać** —
bo dzisiejszemu nie można.

## Co mówi ich własny plik

Układ jest konsekwentny i dobrze przemyślany:

```
WZ (kolumny A–F)                              │ FAKTURA (kolumny G+)
DATA DOSTAWY │ NUMER │ ILOŚĆ │ DO ZAPŁATY │ ZAPŁACONO │ UWAGI
SALDO W €   /   SALDO W PLN   /   SALDO ŁĄCZNIE
```

Plus arkusz `Tabela 1` z kursem euro (4,2668) i `PODSUMOWANIE`
(sprzedane kg, łączny obrót, zaległości).

**Czego plik dowodzi o sobie samym — i co jest najmocniejszym argumentem
za przeniesieniem tego do MES:**

1. **`PODSUMOWANIE` jest w całości `#REF!`.** Wszystkie trzy liczby, na
   których opiera się zarząd, nie liczą się wcale. To samo w arkuszach
   PS INVEST, TRUVA GASTRO, FUDI, SIDLOMEPA, BULLI, ISSA, KRAKTOL
   i trzech arkuszach OYCHE. GRASSO ma `#VALUE!`.
2. **Literówki w datach, których Excel nie ma jak złapać:** `2062-05-14`
   (rok 2062), `01.07.205`, `326/204`. W bazie z typem `date` nie przejdą.
3. **Jeden kontrahent bywa kilkoma arkuszami** — OYCHE ma cztery
   (`subiekt`, `POŁUDNIE2026`, `MATEUSZ`, `(2)`). To dokładnie problem
   rozwiązany 24.09.2026 grupami odbiorców ([[kebab-klienci-grupy]]).

## USTALENIE, OD KTÓREGO ZALEŻY POPRAWNOŚĆ

W arkuszu WZ i FAKTURA to **rozłączne** zbiory dostaw, nie ten sam towar
pokazany dwa razy. Żeby MES mógł je tak samo rozdzielić, dokument WZ musi
znaczyć **dokładnie jedno**: „to, co klient wziął poza fakturą".

Dziś tak NIE jest — zamówienie bez podziału rodzi zwykły WZ, choć całość
idzie na fakturę. **Rozrachunki zbudowane na tym stanie policzyłyby ten sam
towar dwa razy: raz jako WZ, raz jako fakturę.**

Dlatego kolejność jest częścią tej specyfikacji:

> **Najpierw** zmiana „bez podziału → sam WM; z podziałem → WM + WZ"
> (osobne zgłoszenie właściciela z 24.09.2026), **dopiero potem**
> rozrachunki.

Po tej zmianie: `doc_series='WM'` = ruch magazynowy (nie obciąża klienta),
`doc_series='WZ'` = obciążenie poza fakturą.

## Model danych

### 1. Ustawienia kontrahenta (`clients`)

| kolumna | typ | znaczenie |
|---|---|---|
| `settlement_enabled` | bool | „Rozliczenie w systemie" — czy klient wchodzi do rozrachunków |
| `settlement_currency` | text | **`PLN` albo `EUR`** — decyzja właściciela: „w zależności od klienta jest albo euro albo PLN" |

Waluta jest **per klient**, nie per dokument. Upraszcza to saldo do jednej
liczby; przeliczenie na złotówki robi wyłącznie zestawienie zbiorcze.

### ⚠️ REGUŁA NADRZĘDNA: saldo otwarcia jest ODCIĘCIEM

Właściciel 24.09.2026: *„historycznie nie patrz — ja zrobię saldo na dany
dzień i już będziemy szli od nowa na nowym systemie."*

Z tego wynika **najważniejsza reguła poprawności całego modułu**:

> Do salda liczą się **wyłącznie** dokumenty o dacie **PO** `as_of_date`
> salda otwarcia. Wszystko wcześniejsze jest już **zawarte** w tej jednej
> kwocie.

Bez tego obciążenia zaciągnęłyby się z **177 historycznych WZ** leżących
w bazie i doliczyły **na wierzchu** salda otwarcia — każdy kontrahent
miałby zawyżony dług, a błąd byłby cichy: liczby wyglądałyby sensownie.

Dotyczy tak samo faktur i wpłat. Data odcięcia jest widoczna na ekranie
i na zestawieniu dla klienta („saldo na dzień …"), żeby nikt nie szukał
w MES dokumentów sprzed wdrożenia.

### 2. Saldo otwarcia (`client_opening_balances`)

`client_id` · `amount` · `currency` · `as_of_date` · `note`

Jednorazowo przepisywane z Excela. **Bez tego trzeba by wprowadzić całą
historię** — a historia zawiera daty typu `2062-05-14`.

Saldo otwarcia jest w walucie rozliczeniowej klienta; zmiana waluty klienta
wymaga świadomego przeliczenia (ostrzeżenie w interfejsie, nie cicha zamiana).

### 3. Obciążenia (`client_charges`)

`id` · `client_id` · `kind` · `source_id` · `number` · `doc_date` · `qty_kg`
· `amount` · `currency` · `note`

Dwa rodzaje:

- **`kind='wz'`** — **automatycznie** z `wz_documents` (seria `WZ`,
  nieanulowane, wyceniane). Biuro nic nie przepisuje.
- **`kind='invoice'`** — numer, data, kwota **wpisywane przez biuro**.
  Numer faktury **MES już zna**: biuro wpisuje go przy wystawianiu CMR
  (`orders[].invoice_no`, patrz [[kebab-cmr-faktura-per-odbiorca]]), więc
  formularz go podpowiada zamiast kazać przepisywać.

⚠️ Faktura niepowiązana z zamówieniem też musi dać się dopisać ręcznie —
w Excelu takie są (`niezarejestrowany`, `faktura zwykła (FS)`).

### Terminy płatności

Właściciel 24.09.2026: *„termin FV 14 dni od daty wydania, a WZ wymagany
przy odbiorze, czyli +1 dzień, bo wyjeżdża do klientów zawsze dzień
wcześniej."*

| rodzaj | termin | liczony od |
|---|---|---|
| faktura | **+14 dni** | daty dostawy |
| WZ | **+1 dzień** | daty dostawy |

**Liczymy od daty DOSTAWY, nie od daty wystawienia dokumentu.** Potwierdza
to ich własny arkusz: kolumna faktur ma nagłówek `DATA DOSTAWY`, nie „data
wystawienia". Towar wyjeżdża dzień wcześniej, więc dla WZ „przy odbiorze"
znaczy dzień po dacie dokumentu — stąd `+1`, a nie `0`.

Terminy są **ustawieniem** (domyślnie 14 i 1), nie liczbą zaszytą w kodzie:
zmiana umowy z odbiorcą nie może wymagać wydania nowej wersji. Osobnych
terminów per kontrahent nie robimy, dopóki nikt o nie nie poprosi.

`dni_po_terminie` na zestawieniu liczy się względem **dnia wydruku**,
tak samo jak samo saldo.

### 4. Wpłaty (`client_payments`)

`id` · `client_id` · `paid_date` · `amount` · `currency` · `note`

**Wpłata idzie na WSPÓLNE SALDO klienta, nie do konkretnego dokumentu** —
decyzja właściciela, zgodna z tym, jak działa Excel. Uwagi zostają polem
tekstowym, bo tak są dziś używane: „2850 28.07", „1264+1500 husain",
„zap.7632/21.05".

### Saldo

```
saldo = saldo_otwarcia + Σ obciążenia − Σ wpłaty     (w walucie klienta)
```

Znak: **ujemne = klient jest nam winien** (tak jak w ich arkuszu, gdzie
`SALDO W € = -15649` oznacza dług YBM GASTRO).

## Ekrany

### Kartoteka kontrahenta → zakładka „Rozrachunki"

- **Nagłówek:** saldo w walucie klienta, duże; obok saldo otwarcia i data.
- **Dwie listy obok siebie:** WZ i Faktury — data, numer, kg, kwota.
- **Rejestr wpłat** z przyciskiem „Dodaj wpłatę".

### Zestawienie zbiorcze „Rozrachunki"

Lista kontrahentów z włączonym rozliczeniem: saldo w walucie klienta
i przeliczone na PLN, suma zaległości. **To zastępuje `PODSUMOWANIE`,
które dziś nie działa.**

Kurs do przeliczenia: pole w konfiguracji, widoczne przy sumie — żeby nikt
nie musiał zgadywać, po jakim kursie policzono łączną kwotę.

## Saldo NA DOKUMENCIE i zestawienie do druku

Doprecyzowanie właściciela 24.09.2026:

> „bardzo ważna sprawa — aby móc ładnie wydrukować zestawienie dla klienta
> i chciałbym, aby do każdej WZ i do faktury drukowało się saldo
> niezapłaconych FV lub WZ; będę podpinał klientowi do dokumentów."

To zmienia rozrachunki z narzędzia WEWNĘTRZNEGO w coś, co **jedzie do
klienta** — a więc podnosi wymagania wobec poprawności i formy.

### Blok salda na dokumencie

Na wydruku WZ (i na zestawieniu do faktury) sekcja: **niezapłacone
dokumenty** (data, numer, kwota) i **saldo razem**, w walucie rozliczeniowej
klienta.

⚠️ **Saldo na papierze musi być z chwili WYDRUKU, nie z chwili wystawienia.**
Dokument drukowany ponownie za tydzień pokaże inne saldo — i tak ma być, bo
klient dostaje aktualny stan. Dlatego saldo NIE jest zapisywane w treści
dokumentu; liczy się przy renderowaniu, a na wydruku jest data i godzina,
na które zostało policzone. Bez tej daty dwa wydruki tego samego WZ pokazują
różne kwoty i nikt nie wie, który jest aktualny — ta sama zasada co przy
kursie NBP na raporcie zarządczym ([[fx_service]]).

⚠️ **Dokument bieżący nie może liczyć się sam do siebie** jako zaległość —
klient dostaje WZ i widzi je w „niezapłaconych" tego samego papieru. Pozycja
bieżąca pokazuje się osobno („ten dokument"), a saldo ma dwie liczby: przed
i po tym dokumencie.

### Wzorzec z ręki: rozliczenie dostawy dla TRUVY

Właściciel przysłał 24.09.2026 zdjęcie kartki, którą dziś wypisuje TRUVIE
długopisem, z prośbą „chciałbym coś bardziej profesjonalnego". Rachunki na
niej zgadzają się co do euro, więc to gotowa specyfikacja układu:

```
TRUVA
KIRMIZI         30×25kg=750 + 80×20kg=1600 + 60×15kg=900 = 3250 kg × 3,20 € = 10 400 €
KIRMIZI/FILET   30×30kg=900 + 60×25kg=1500 + 40×20kg=800 = 3200 kg × 3,40 € = 10 880 €
BEYAZ           60×30kg=1800                             = 1800 kg × 3,20 € =  5 760 €
                                                         za dostawę          27 040 €
                                           + BOŁGAR                          37 000 €
                                                         RAZEM               64 040 €
```

Czego to uczy o dokumencie:

| element kartki | skąd w MES |
|---|---|
| grupy po RODZAJU/RECEPTURZE | pozycje dokumentu (ta sama para co przy scalaniu WZ) |
| linia `30 × 25 kg = 750 kg` | `qty × kg_per_unit`, obie liczby WIDOCZNE |
| podsuma kg grupy × cena za kg | `total_kg` × cena z wyceny |
| **za dostawę** | suma grup |
| **zadłużenie z poprzednich dostaw** | `saldo_przed` |
| **RAZEM** | `saldo_po` |

Dwie rzeczy, które ta kartka rozstrzyga, a których sama specyfikacja nie
mówiła:

1. **Cena jest PER GRUPA, nie jedna na dokument** (3,20 / 3,40 / 3,20).
2. **Liczba sztuk i gramatura muszą zostać widoczne** — klient sprawdza
   dostawę po pojemnikach, nie po kilogramach. Scalona linia „3250 kg"
   bez rozbicia byłaby krokiem wstecz wobec kartki.

**`BOLÇAR` = `borçlar`, po turecku „długi"** (właściciel, 24.09.2026).
Ta linia to więc zadłużenie z poprzednich dostaw, czyli `saldo_przed` —
potwierdzone, nie zgadywane.

Skoro papier jedzie do tureckiego odbiorcy, podpisy mogą być DWUJĘZYCZNE:
„Zadłużenie z poprzednich dostaw / BORÇLAR", „Razem / TOPLAM". Precedens
w kodzie już jest — `hdi_documents.language`. Decyzja przy wykonaniu
wydruku; domyślnie polskie, turecki jako opcja per kontrahent.

### Zestawienie dla klienta

Osobny wydruk: nagłówek z danymi kontrahenta, tabela niezapłaconych WZ
i faktur (data, numer, kwota, dni po terminie), saldo razem, data
sporządzenia. Ma się mieścić na jednej stronie A4 przy typowej liczbie
pozycji ([[kebab-wydruk-jedna-strona]]).

Wydruk jest **stroną aplikacji**, nie oknem `window.open` — w Tauri okna
i skrypty inline nie działają ([[tauri-okna-i-inline-skrypty]]).

## Poza zakresem (świadomie)

- **Integracja z Subiektem.** Właściciel: „docelowo MES będzie połączony
  z Subiektem i będzie zaciągał od Subiekta". Model jest na to gotowy
  (`client_charges.kind='invoice'` + `source_id`), ale sam import to osobny
  temat.
- **Wystawianie faktur przez MES.** Odrzucone na tym etapie.
- **Import historii z Excela.** Zastępuje go saldo otwarcia.
- **Rozliczanie wpłat na konkretne dokumenty** (kompensaty, wiekowanie
  należności). Świadomie nie — Excel tego nie robi i nikt o to nie prosił.

## Testy

- **Saldo** jako czysta funkcja: otwarcie + obciążenia − wpłaty, w jednej
  walucie; zero obciążeń; wpłata większa niż dług (nadpłata).
- **Obciążenia z WZ**: anulowany WZ nie obciąża; WM **nigdy** nie obciąża
  (to ruch magazynowy) — to test pilnujący ustalenia z początku dokumentu.
- **Waluta**: klient w EUR nie miesza się z klientem w PLN; zmiana waluty
  na kliencie z niezerowym saldem wymaga potwierdzenia.
- **Zestawienie zbiorcze**: suma zaległości po przeliczeniu kursem.

## Ryzyka

1. **Podwójne liczenie**, jeśli zmiana WM/WZ nie wejdzie pierwsza. Opisane
   wyżej; kolejność jest wiążąca.
2. **Saldo otwarcia wpisane w złej walucie** — nie do wykrycia przez system.
   Formularz musi pokazywać walutę klienta przy polu kwoty, nie pod spodem.
3. **Klient zmienia walutę rozliczeniową.** Nie przeliczamy automatycznie;
   ostrzeżenie i świadoma decyzja biura.
