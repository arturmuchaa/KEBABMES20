# Responsywność mobilna sekcji planowania masowania

## Problem

Sekcja planowania masowania (`PlanningPage` → `MixingDayPlanEditor` → `PlanRow` + `PlanStockSidebar`)
jest zaprojektowana pod desktop: wiersz to sztywny grid
`grid-cols-[28px_20px_minmax(180px,1.2fr)_120px_96px_minmax(140px,1fr)_110px_88px]` (~780px min),
osobny wiersz nagłówków kolumn, layout strony `xl:grid-cols-[1fr_360px]` (plan + sidebar).
Na telefonie (~390px) rozjeżdża się i nie da się wygodnie planować. Cel: planować i na
telefonie (w domu), i na komputerze w biurze.

## Rozwiązanie

Czysto warstwa prezentacji (Tailwind + drobny stan zwijania). Logika, dane i wygląd desktopu
**bez zmian**. Breakpoint: **`lg` (≥1024px) = desktop/tabela**; poniżej `lg` = układ mobilny (karty).

### `PlanRow.tsx` — dwa układy, wspólne kontrolki

Aby nie dublować logiki, wyciągnąć kontrolki wiersza do lokalnych zmiennych JSX (raz), używanych
w obu wariantach:
- `recipeSelect` — `<Select>` receptury,
- `kgInput` — input kg mięsa + „kg",
- `outputEl` — półprodukt (kg),
- `lotsButton` — przycisk z chipami partii (rozwija picker),
- `statusEl` — `StatusBadge` + przyciski „Potwierdź"/„Cofnij" (logika bez zmian),
- `moveDeleteActions` — ↑ / ↓ / usuń / rozwiń.

Render:
- **Desktop**: `<div className="hidden lg:block ...">` z obecnym gridem `GRID` (1:1 jak teraz).
- **Mobile**: `<div className="lg:hidden ...">` — **karta**:
  - górny pasek: Lp + `recipeSelect` (pełna szerokość) + `moveDeleteActions` po prawej,
  - wiersze z etykietami: „Mięso" → `kgInput`, „Półprodukt" → `outputEl`, „Partie mięsa" →
    `lotsButton` (chipy zawijają), „Status" → `statusEl`,
  - sekcja rozwijana (picker/składniki) jak na desktopie (już `flex-wrap`).
- **Reorder na telefonie** przez strzałki ↑/↓ (`onMove`) — drag&drop zostaje aktywny tylko na
  desktopie (`dragHandlers.draggable` bez zmian; na karcie nie podpinamy uchwytu drag).

### `MixingDayPlanEditor.tsx`

- **Wiersz nagłówków kolumn**: `hidden lg:grid` (karty mają etykiety inline).
- **Toolbar** (data, Auto-FEFO całość, Dodaj pozycję, Plan dla operatora, Plan zapisany):
  `flex-wrap gap-2`; na mobile przyciski szersze/łatwe w kliknięciu (np. `flex-1 min-w-…` w wąskim
  widoku). Selektor daty i strzałki dni czytelne na mobile.
- **Stopka sum**: już `flex`; dodać `flex-wrap` żeby zawijała na wąsko.
- **Kontener strony**: `xl:grid-cols-[minmax(0,1fr)_360px]` → `lg:grid-cols-[minmax(0,1fr)_340px]`;
  poniżej `lg` jedna kolumna (plan na całą szerokość, sidebar pod spodem).

### `PlanStockSidebar` — magazyn do rozplanowania

- Desktop (`lg+`): jak teraz, kolumna z boku (zawsze widoczna).
- Mobile (`<lg`): pod planem, jako **sekcja zwijana** — nagłówek-przycisk „Magazyn / przyprawy"
  z ikoną chevron, domyślnie **zwinięta**; klik rozwija. Stan zwijania lokalny (`useState`,
  domyślnie false na mobile). Na `lg+` zawijanie nieaktywne (zawartość zawsze widoczna) — sterowane
  klasą `lg:block` na treści i `lg:hidden` na przycisku-przełączniku.

## Zakres / pliki

- `src/features/products/components/PlanRow.tsx` — dwa układy (desktop grid + mobile card), wspólne kontrolki.
- `src/features/products/components/MixingDayPlanEditor.tsx` — nagłówki `hidden lg:grid`, toolbar/stopka `flex-wrap`, kontener `lg:grid-cols`.
- `src/features/products/components/PlanStockSidebar.tsx` — zwijanie na mobile (przycisk + `lg:` zawsze widoczne).
- `src/features/products/pages/PlanningPage.tsx` — ewentualny padding/kontener mobilny (jeśli potrzebny).

Bez zmian: backend, logika komponentów, handlery, wygląd desktopu.

## Edge cases / uwagi

- Desktop wygląd MUSI zostać identyczny — desktopowy wariant to obecny grid bez zmian klas
  wewnętrznych (tylko owinięty w `hidden lg:block`).
- Pozycje `in_progress`/`done` (locked) na karcie: te same reguły (brak drag, przyciski
  Potwierdź/Cofnij wg statusu) — reużywamy `statusEl`.
- Bardzo długa nazwa receptury na karcie: `truncate`/zawijanie w nagłówku karty.
- Dialogi (podział partii, undo) i toasty działają niezależnie od układu — bez zmian.

## Testy / weryfikacja

Layout/CSS — weryfikacja wizualna w przeglądarce w 2 szerokościach:
- **~390px (telefon)**: karty czytelne, pola i przyciski klikalne kciukiem, brak poziomego
  rozjazdu (`document.body.scrollWidth ≈ viewport`), magazyn zwinięty i rozwijalny.
- **~1280px (desktop)**: tabela, nagłówki, sidebar z boku — identycznie jak przed zmianą.
Testy jednostkowe bez zmian (105/105) — brak nowej logiki.
