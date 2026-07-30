# Strażnik wydajności pobrania i bilansu ubocznych

Data: 2026-07-30

## Problem

Jeden operator (Marcin) obsługuje kiosk rozbioru dla całego zakładu — ~50 pobrań
dziennie, 927 akcji w 10 dni, bez drugiej pary oczu. W 10 dni zebrało się 72
interwencje na 379 pobrań (19%), z czego 30 to korekty z biura.

Analiza korekt pokazała JEDEN wzorzec: wpisy fizycznie niemożliwe, przyjęte przez
system.

| Partia | Pracownik | Zapisano | Poprawiono na | Wydajność w chwili zapisu |
|--------|-----------|----------|---------------|---------------------------|
| 443 | SERHII | 150,0 / 150 | 98,0 | **100,0%** |
| 442 | ANATOLII | 298,5 / 300 | 198,5 | **99,5%** |
| 431 | ANATOLII | 290,5 / 300 | 197,0 | **96,8%** |
| 444 | DAWID | 231,0 / 300 | 197,0 | 77,0% |

Różnice 87–110 kg odpowiadają **tarze wózka** — operator nie wybiera wózka albo
wybiera zły, i waga wózka wchodzi w mięso. Jedyny warunek w HMI to dziś
`kgMeat > kgQuarter` (>100%), więc 100,0% przechodzi.

Druga klasa błędu: partia 445 (30.07) miała bilans masy 108,3% przy normie 101%,
bo ta sama paleta trafiła do obu frakcji. Kreator ważenia ostrzega WYŁĄCZNIE gdy
frakcja jest za mała (`isByproductBelowNorm`) — górnej granicy nie ma żadnej.
Sam dubel naprawiony osobno (przenoszenie palety między frakcjami), ale nic nie
ostrzega przed nadmiarem z innej przyczyny.

Cel: **błąd ma być zatrzymany na kiosku, w chwili powstania** — żeby liczby były
wiarygodne i żeby biuro przestało po hali sprzątać.

## Decyzje

- **Twardy blok** (decyzja właściciela, 2026-07-30), nie ostrzeżenie. Ryzyko:
  operator obchodzi blokadę fałszywą ćwiartką. Neutralizuje je furtka serwisowa
  poniżej — obejście zostaje możliwe, ale świadome i zapisane.
- Pasmo wydajności **60–71%**.
- Pobrania **< 30 kg zwolnione** — przy małych porcjach procent jest z natury
  rozchwiany (zaokrąglenie 0,5 kg to ponad 3 pp przy 15 kg).

### Uzasadnienie progów (676 wpisów z 25 dni)

| miara | wartość |
|---|---|
| mediana | 66,0% |
| p1 / p99 | 60,0% / 68,4% |
| min / max | 55,0% / 69,5% |
| prawdziwe wpisy ≥ 30 kg | 62,5% – 69,5% |

Blokada 60–71% ze zwolnieniem < 30 kg zatrzymałaby **1 z 676 wpisów (0,15%)** —
pobranie 30 kg → 16,5 kg (55%), samo w sobie podejrzane. Zapas do progów: 2,5 pp
od dołu, 1,5 pp od góry.

## Zakres

### 1. Strażnik wydajności pobrania (kiosk)

Przy zapisie pobrania z wagą: `wydajność = kgMeat / kgQuarter × 100`.

- `kgQuarter < 30` → brak sprawdzenia.
- `60 ≤ wydajność ≤ 71` → zapis normalnie.
- poza pasmem → **zapis odrzucony**, komunikat z konkretną podpowiedzią:
  „Wydajność 99,5% — mięso 298,5 kg z 300 kg ćwiartki. Sprawdź, czy wybrałeś
  właściwy wózek (tara)." Przy wydajności za niskiej podpowiedź o niezważonej
  reszcie pobrania.

Walidacja po stronie **backendu** (źródło prawdy — HMI może być starszej wersji),
z lustrem w kiosku, żeby operator dostał komunikat bez czekania na odpowiedź.

### 2. Furtka serwisowa

Blokadę można ominąć **kodem 0099** (ten sam mechanizm co menu serwisowe kiosku).
Ominięcie zapisuje ślad: wpis, wartości, kto i kiedy. Bez tego nietypowa partia
zatrzymuje linię albo — gorzej — uczy operatora wpisywania zmyślonej ćwiartki.

### 3. Strażnik bilansu ubocznych (kiosk)

Przy zapisie palety w kreatorze: jeśli bilans masy partii (mięso + grzbiety +
kości ÷ ćwiartka) przekroczy **103%**, pytanie przed zapisem:
„Ta partia ma już 108% bilansu — sprawdź, czy paleta nie jest zapisana pod drugą
frakcją." Tu **ostrzeżenie, nie blokada**: uboczne waży się po fakcie, a nadmiar
bywa prawdziwy (mokre grzbiety, ociek).

Norma bilansu i progi — patrz pamięć `kebab-bilans-masy-rozbioru`.

### 4. Usuwanie pojedynczej palety (kiosk)

Kreator ma dziś tylko „Wyczyść sumę" na całą frakcję. Operator, który pomylił
frakcję, musiałby przeważyć wszystko od nowa — i tego nie zrobi. Dokładamy
usunięcie pojedynczego wiersza z listy palet frakcji.

### 5. Raport odchyleń (biuro)

Lista wpisów z ostatnich dni, które przeszły przez furtkę serwisową albo leżą
blisko progów. Siatka bezpieczeństwa na to, co zostało ominięte.

## Poza zakresem

- Zmiana sposobu liczenia ćwiartki (nominał pojemniki × 15 kg zostaje).
- Progi per materiał/klient — dziś rozbiór to wyłącznie ćwiartka.
- Automatyczne wyrównywanie odchyleń. Nadpisywanie zmierzonych wag to incydent
  424 — strażnik ma zatrzymać człowieka, nie poprawiać dane za niego.

## Testy

- Wydajność: 100,0% odrzucone; 96,8% odrzucone; 66% przyjęte; 55% przy pobraniu
  15 kg przyjęte (zwolnienie); 55% przy pobraniu 150 kg odrzucone.
- Granice: dokładnie 60,0% i 71,0% przyjęte (pasmo domknięte).
- Furtka: z kodem 0099 zapis przechodzi i zostawia ślad.
- Bilans ubocznych: paleta wpychająca partię powyżej 103% wywołuje ostrzeżenie,
  poniżej — nie.
- Usunięcie palety: frakcja przelicza kg i %, lot ABP zgodny; zdjęcie jedynej
  palety wraca frakcję na kafel jako niezważoną.

## Wdrożenie

Punkty 1, 3, 4 wymagają **releasu kiosku** — frontend hali jest wbudowany, więc
bump wersji w `tauri.rozbior-v10.conf.json` + tag `rozbior-v10-*`. Backend
(walidacja + ślad) i punkt 5 idą zwykłym deployem na VPS z restartem usługi.
