# Przeprojektowanie strony „Planowanie masowania"

Data: 2026-06-14
Status: zatwierdzony kierunek (do realizacji)

## Cel

Biuro w ciągu jednego dnia masuje kilka receptur (np. 3000 kg GOLD, 2000 kg
BEYAZ, 600 kg Gold2). Obecna strona ma **dwie dublujące się ścieżki** tworzenia
zleceń, co jest niewygodne:

1. **Plan dnia** (`MixingDayPlanEditor`) — kolejka receptura + kg + strzałki
   kolejności; mięso NIE przypisywane (operator wybiera przy maszynie).
2. **Kreator „Nowe zlecenie masowania"** — 3-krokowy modal ze szczegółowym
   wyborem partii mięsa FEFO.

Plus osobna tabela „Zlecenia masowania" na dole.

Cel: **jedna** strona, gdzie plan dnia jest sercem — wygodne planowanie,
zmiana kolejności, dodawanie i edycja w ciągu dnia, z **pełną rezerwacją
partii** wbudowaną w wiersz planu.

## Decyzje (zatwierdzone)

- **Zakres**: przeprojektowanie całej strony. Plan dnia = jedyny sposób
  planowania.
- **Mięso**: pełna rezerwacja partii FEFO już przy planowaniu, wbudowana
  w wiersz planu.
- **Usuwamy**: modal „Nowe zlecenie masowania" (3 kroki) oraz osobną tabelę
  „Zlecenia masowania". Ich funkcje wchłania plan dnia (logika FEFO i podglądu
  składników jest **przenoszona**, nie kasowana).
- **Zmiana kolejności**: przeciąganie myszą (natywne HTML5 drag, bez nowej
  zależności); strzałki ↑↓ zostają jako fallback.
- **Auto-FEFO całość**: rozdziela dostępne partie po kolei wg planu
  (wiersz 1 dostaje najwcześniej wygasające mięso).

## Układ (wariant A — rozwijane wiersze)

Cała strona = jedna karta „Plan dnia".

```
┌─ Plan dnia masowania — niedziela 14.06 ────────────────────────┐
│  Σ plan 5600 kg → 6100 kg półprodukt   Dostępne mięso: 7200 kg │
│  [⚡ Auto-FEFO całość]              [+ Dodaj pozycję] [Zapisz]  │
├────────────────────────────────────────────────────────────────┤
│ ⠿ 1  [GOLD KEBAB ▾]   3000 kg → 3250   ✓ partie  [w kolejce] ⌄ │
│ ⠿ 2  [BEYAZ ▾]        2000 kg → 2180   ⚠ brak    [w kolejce] ⌄ │
│ ⠿ 3  [Gold2 ▾]         600 kg →  650   ✓ partie  [w masownicy 120kg] ⌄
└────────────────────────────────────────────────────────────────┘
```

**Górny pasek**: data, suma kg planu, suma półproduktu, dostępne mięso,
przyciski `⚡ Auto-FEFO całość`, `+ Dodaj pozycję`, `Zapisz plan`.

**Wiersz kompaktowy**: uchwyt przeciągania ⠿, numer kolejności, select
receptury, input kg, wyliczony półprodukt, chip statusu partii (`✓ partie` /
`⚠ brak`), badge statusu zlecenia, przycisk rozwijania ⌄, kosz.

**Wiersz rozwinięty** (pod spodem, jeden naraz): lista partii mięsa FEFO
z checkboxami i polami kg (przeniesiona z kreatora), przycisk „Auto-FEFO ten
wiersz", zwięzły podgląd składników i półproduktu.

## Komponenty (frontend)

`MixingDayPlanEditor.tsx` rozrasta się do serca strony — rozbicie na mniejsze,
testowalne jednostki:

- **`PlanRow`** — pojedynczy wiersz (kompaktowy + rozwinięcie). Wejście: dane
  wiersza, dostępne partie, callbacki (update / move / delete / toggle-expand).
- **`MeatLotPicker`** — wyciągnięty z obecnego kreatora; lista partii FEFO
  z zaznaczaniem i kg, auto-FEFO dla pojedynczego wiersza. Wejście: lista
  partii, wybrane loty, target kg; wyjście: zmiana wyboru.
- **`IngredientPreview`** — podgląd składników i półproduktu dla receptury+kg
  (przeniesiony z `calcSteps`/`plannedOutput`).
- **`PlanningPage.tsx`** — mocno odchudzona: nagłówek + `<MixingDayPlanEditor>`.
  Modal kreatora i tabela zleceń usunięte. Progress-modal (podgląd postępu)
  zwijany do rozwinięcia wiersza dla pozycji `in_progress`.

Każda jednostka: jedno zadanie, jasny interfejs, testowalna osobno.

## Zachowania

- **Dodawanie w ciągu dnia**: `+ Dodaj pozycję` dokłada wiersz na końcu;
  status `nowa` aż do zapisu.
- **Zmiana kolejności**: przeciąganie za uchwyt ⠿ (HTML5 drag); strzałki ↑↓
  jako fallback.
- **Edycja**: receptura / kg / partie edytowalne dla `nowa` i `w kolejce`
  (`planned`/`confirmed`); `in_progress`/`done` zablokowane — tylko kolejność
  (backend już to wymusza w `save_day_plan`).
- **Auto-FEFO całość**: iteruje wiersze w kolejności planu, konsumując partie
  w kolejności FEFO (najwcześniej wygasające najpierw), respektując dostępność;
  per-wiersz override w rozwinięciu.
- **Walidacja na żywo**: chip `⚠ brak` gdy suma partii < kg wiersza; górny pasek
  czerwienieje gdy Σ planu > dostępne mięso.
- **Status na żywo**: badge + kg w masownicy / postęp (recykling logiki
  z obecnego progress-modala), odświeżanie co 15 s; baner „plan zmieniony" dla
  operatora przez `rev` (już działa, bez zmian).
- **Anulowanie**: usunięcie wiersza w kolejce = anulowanie (zwolnienie
  rezerwacji) — istniejąca logika w `save_day_plan` (`to_cancel`).

## Backend

- **`PUT /api/mixing-orders/day-plan`** (`save_day_plan`) rozszerzamy o
  `meatLots` per pozycja. Dziś pozycja przyjmuje tylko `recipeId` / `meatKg` /
  `seq`, a nowe pozycje tworzą zlecenie `confirmed` **bez** lotów. Po zmianie:
  - nowa pozycja z `meatLots` → tworzy zlecenie z **rezerwacją partii**
    (reużycie logiki rezerwacji z `create_mixing_order`),
  - edytowana pozycja w kolejce → aktualizacja receptury / kg / **lotów**
    (re-rezerwacja: zwolnij stare, zarezerwuj nowe),
  - pozycja bez `meatLots` → zachowanie jak dziś (operator wybierze przy
    maszynie) — wsteczna zgodność.
- Reszta endpointów (`start` / `finish-session` / `cancel` / `auto-approve`)
  bez zmian.
- `get_day_plan` zwraca już `meatLots` per zlecenie (`build_mixing_order`) —
  do zweryfikowania przy implementacji.

## Poza zakresem (YAGNI)

- Szablony planów / plany cykliczne (powtarzalne dni) — nie teraz.
- Filtrowanie partii po typie materiału recepturą — zachowujemy wspólną pulę
  mięsa jak w obecnym kreatorze.
- Touch-drag dla tabletu — strona jest w biurze (desktop, mysz).

## Testowanie

- Backend: testy `save_day_plan` z `meatLots` — tworzenie z rezerwacją,
  edycja z re-rezerwacją, usunięcie → zwolnienie, wsteczna zgodność (bez lotów).
- Walidacja: suma lotów ≠ kg wiersza, kg lota > dostępne.
- Frontend: render planu, dodawanie/usuwanie wiersza, auto-FEFO całość
  rozdziela poprawnie, blokada wierszy `in_progress`/`done`.
