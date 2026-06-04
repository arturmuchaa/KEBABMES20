# Nazwa wyświetlana klienta (F1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MES pokazuje wszędzie nazwę wyświetlaną klienta (`displayName`), zostawiając pełną nazwę tylko w fakturach/dokumentach; identyfikacja/kluczowanie dalej po pełnej nazwie.

**Architecture:** Frontowy resolver `src/lib/clientNames.ts` (cache mapy pełna→wyświetlana + hook `useClientNames()`), użyty w warstwie wyświetlania ~17 ekranów. Brak zmian w backendzie i w zapisach/kluczach. Brak frontowego runnera testów → weryfikacja build + ręczna.

**Tech Stack:** React + TypeScript (Vite).

**Spec:** `docs/superpowers/specs/2026-06-04-nazwa-wyswietlana-klienta-design.md`

**Wzorzec zamiany (stosowany w każdym ekranie):**
- Import: `import { useClientNames } from '@/lib/clientNames'`
- W komponencie: `const clientDisplay = useClientNames()`
- Przy **wyświetlaniu** nazwy klienta: `clientDisplay(x)` zamiast surowego `x`
  (np. `{clientDisplay(order.clientName)}`). NIE zmieniać `value=`, kluczy, zapisów.
- Selecty wyboru klienta: etykieta opcji = displayName, wartość = pełna nazwa:
  `<option value={c.name}>{c.displayName || c.name}</option>` (stan dalej trzyma `c.name`).

---

## Task 1: Resolver `clientNames.ts`

**Files:** Create: `src/lib/clientNames.ts`

- [ ] **Step 1: Utwórz moduł**

```ts
import { useEffect, useState } from 'react'
import { clientsApi } from '@/lib/api'

let _cache: Map<string, string> | null = null
let _loading: Promise<Map<string, string>> | null = null

export async function loadClientNames(): Promise<Map<string, string>> {
  if (_cache) return _cache
  if (!_loading) {
    _loading = clientsApi.list()
      .then((list: any[]) => {
        const m = new Map<string, string>()
        for (const c of list ?? []) {
          const name = (c?.name ?? '').trim()
          const disp = (c?.displayName ?? '').trim()
          if (name) m.set(name, disp || name)
        }
        _cache = m
        return m
      })
      .catch(() => { _loading = null; return new Map<string, string>() })
  }
  return _loading
}

export function resolveClientName(map: Map<string, string> | null, fullName: string): string {
  if (!fullName) return fullName
  return map?.get(fullName.trim()) || fullName
}

export function useClientNames(): (fullName: string) => string {
  const [map, setMap] = useState<Map<string, string> | null>(_cache)
  useEffect(() => {
    if (map) return
    let alive = true
    loadClientNames().then(m => { if (alive) setMap(m) })
    return () => { alive = false }
  }, [map])
  return (fullName: string) => resolveClientName(map, fullName)
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "clientNames" || echo "BRAK błędów clientNames"`
Expected: `BRAK błędów clientNames`.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/lib/clientNames.ts && \
git commit -m "feat(klient): resolver nazwy wyswietlanej (clientNames + useClientNames)"
```

---

## Task 2: Ekrany biura/tablet — nazwa wyświetlana

**Files (Modify):**
- `src/pages/office/ClientOrdersPage.tsx`
- `src/pages/office/ProductionPlanningPage.tsx`
- `src/pages/office/FinishedGoodsPage.tsx`
- `src/pages/office/DashboardPage.tsx`
- `src/pages/office/RecallPage.tsx`
- `src/features/finished-goods/components/DetailModal.tsx`
- `src/pages/office/LabelTemplateSetupPage.tsx`
- `src/pages/tablet/ProductionTabletPage.tsx`

- [ ] **Step 1: Dla KAŻDEGO pliku zlokalizuj wyświetlenia klienta**

Run (per plik): `grep -nE "clientName|client_name|\.name" <plik>`
Zidentyfikuj miejsca, gdzie nazwa klienta jest **renderowana** (w JSX/tekście), oddziel od
`value=`/kluczy/zapisów.

- [ ] **Step 2: Wstaw hook i owiń wyświetlenia**

W każdym pliku dodaj import i hook:
```tsx
import { useClientNames } from '@/lib/clientNames'
// w komponencie:
const clientDisplay = useClientNames()
```
Owiń każde **wyświetlenie** nazwy klienta: `clientDisplay(<wyrażenie z nazwą>)`.
Przykłady: `{clientDisplay(o.clientName)}`, `{clientDisplay(row.client_name)}`.
W `LabelTemplateSetupPage` / `ClientOrdersPage` **selecty** klienta:
`<option value={c.name}>{c.displayName || c.name}</option>` (wartość bez zmian = `c.name`).
NIE zmieniaj `value=`, kluczy React, pól zapisu.

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ClientOrdersPage|ProductionPlanningPage|FinishedGoodsPage|DashboardPage|RecallPage|DetailModal|LabelTemplateSetupPage|ProductionTabletPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/ClientOrdersPage.tsx src/pages/office/ProductionPlanningPage.tsx src/pages/office/FinishedGoodsPage.tsx src/pages/office/DashboardPage.tsx src/pages/office/RecallPage.tsx src/features/finished-goods/components/DetailModal.tsx src/pages/office/LabelTemplateSetupPage.tsx src/pages/tablet/ProductionTabletPage.tsx && \
git commit -m "feat(klient): nazwa wyswietlana na ekranach biura/tablet"
```

---

## Task 3: Ekrany mobilne — nazwa wyświetlana

**Files (Modify):**
- `src/pages/mobile/MobileZaladunekPage.tsx`
- `src/pages/mobile/MobileWydanieLuzemPage.tsx`
- `src/pages/mobile/MobileMrozniaPage.tsx`
- `src/pages/mobile/MobileSztukaPage.tsx`
- `src/pages/mobile/MobilePalletLandingPage.tsx`
- `src/pages/mobile/MobileProdukcjaPage.tsx`
- `src/pages/mobile/MobilePakowaniePage.tsx`

- [ ] **Step 1: Zlokalizuj wyświetlenia klienta (per plik)**

Run: `grep -nE "clientName|client_name" <plik>`

- [ ] **Step 2: Hook + owinięcie**

W każdym pliku:
```tsx
import { useClientNames } from '@/lib/clientNames'
const clientDisplay = useClientNames()
```
Owiń **wyświetlenia** nazwy klienta `clientDisplay(...)`. W `MobileWydanieLuzemPage` select
klienta: etykieta opcji `{c.displayName || c.name}`, `value={c.name}` (wartość/stan bez zmian —
`clientId`/`clientName` zapisywane jak dziś). NIE zmieniaj wartości skanu/zapisu.

> Uwaga: w `MobileWydanieLuzemPage` lista otwartych wydań (`d.clientName`) i nagłówek aktywnego
> wydania → owinąć `clientDisplay(...)`; pole `clientName` wysyłane do `dispatchesApi.create`
> zostaje pełną nazwą.

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "Mobile(Zaladunek|WydanieLuzem|Mroznia|Sztuka|PalletLanding|Produkcja|Pakowanie)Page" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/mobile/MobileZaladunekPage.tsx src/pages/mobile/MobileWydanieLuzemPage.tsx src/pages/mobile/MobileMrozniaPage.tsx src/pages/mobile/MobileSztukaPage.tsx src/pages/mobile/MobilePalletLandingPage.tsx src/pages/mobile/MobileProdukcjaPage.tsx src/pages/mobile/MobilePakowaniePage.tsx && \
git commit -m "feat(klient): nazwa wyswietlana na ekranach mobilnych"
```

---

## Task 4: Wydruki zamówień i etykiety — nazwa wyświetlana

**Files (Modify):**
- `src/pages/office/OrderPrintPage.tsx`
- `src/pages/office/PalletLabelPrintPage.tsx`

(Decyzja użytkownika: wydruki zamówień i etykiety = nazwa wyświetlana; faktury/HDI/CMR/WZ = pełna,
ale te tu nie występują.)

- [ ] **Step 1: Zlokalizuj wyświetlenia klienta**

Run: `grep -nE "clientName|client_name" src/pages/office/OrderPrintPage.tsx src/pages/office/PalletLabelPrintPage.tsx`

- [ ] **Step 2: Hook + owinięcie**

W obu plikach dodaj `import { useClientNames } from '@/lib/clientNames'` + `const clientDisplay = useClientNames()`
i owiń wyświetlaną nazwę klienta `clientDisplay(...)`.

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "OrderPrintPage|PalletLabelPrintPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/OrderPrintPage.tsx src/pages/office/PalletLabelPrintPage.tsx && \
git commit -m "feat(klient): nazwa wyswietlana na wydrukach zamowien i etykietach"
```

---

## Task 5: Build + e2e

- [ ] **Step 1: Build całości**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -2`
Expected: build OK.

- [ ] **Step 2: Sanity — żaden ekran nie zgubił nazwy przy braku displayName**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && grep -rn "useClientNames" src/ | wc -l`
Expected: ≥ 1 w każdym z 17 plików (helper użyty wszędzie, gdzie pokazujemy klienta).

- [ ] **Step 3: Ręczny e2e**

1. Klient z `displayName='Zagros'` i `name='Okaytekin …'`.
2. Ekrany operacyjne (planowanie, pakowanie, wydanie luzem, mroźnia, dashboard, recall),
   wydruk zamówienia, etykieta palety → widać **„Zagros"**.
3. Zapis zamówienia/wydania/szablonu etykiety → w bazie dalej pełna nazwa; szablon etykiety
   nadal znajdowany (kluczowanie po pełnej nazwie nietknięte).
4. Klient bez `displayName` lub „na magazyn"/„STAN" → pokazuje się wejściowa (pełna) wartość.

Expected: zgodne ze specem.

---

## Self-Review (autora planu)

- **Pokrycie specu:** resolver (T1); zamiana wyświetlania na biurze/tablecie (T2), mobile (T3),
  wydruki/etykiety (T4); identyfikacja/kluczowanie nietknięte (wzorzec: tylko wyświetlanie,
  selecty `value=c.name`); fallback brak/pusto → pełna (T1 `resolveClientName`); build+e2e (T5). ✅
- **Spójność:** `useClientNames()` → funkcja `clientDisplay(name)` użyta jednakowo w T2/T3/T4;
  `clientsApi` z `@/lib/api`; brak zmian backendu. ✅
- **Placeholdery:** helper z pełnym kodem (T1); zamiany to mechaniczny, w pełni pokazany wzorzec
  + grep do lokalizacji miejsc — nie luka logiczna. Faktury/HDI/CMR/WZ świadomie pominięte. ✅
