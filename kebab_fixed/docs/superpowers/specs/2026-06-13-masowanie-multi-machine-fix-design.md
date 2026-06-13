# Masowanie: multi-machine fix + planowanie UI

Data: 2026-06-13  
Status: Zatwierdzone

## Problem

1. **Plan znika po załadowaniu maszyny.** Gdy operator załaduje np. 600 kg z 3000 kg zlecenia i kliknie "Rozpocznij masowanie", zlecenie przechodzi do statusu `in_progress` + blokada maszyny na 50 min. `MixingTabletPage` pokazuje tylko zlecenia `confirmed` — zlecenie `in_progress` znika z listy. Operator widzi pustą listę i myśli, że nie ma planu.

2. **Trzeba tworzyć 3 oddzielne zlecenia zamiast 1.** Żeby załadować 3 masownice z jednego produktu, operator musi tworzyć 3 osobne zlecenia (MAS-001, MAS-002, MAS-003). Model docelowy: 1 zlecenie → wiele sesji masowania (1 sesja = 1 maszyna + określone kg).

3. **Planowanie: strzałki ▲▼ za małe.** W `MixingDayPlanEditor` przyciski do zmiany kolejności mają 16px wysokości — trudne do kliknięcia.

## Decyzje projektowe

- **Bez zmian backendu.** `start_mixing_order` już obsługuje zlecenia `in_progress` (`status IN ('planned','confirmed','in_progress')`). `finish_mixing_session` resetuje `confirmed_steps` i `machine_id` po każdej sesji — każda kolejna maszyna dostaje świeże potwierdzenie składników.
- **Przepływ sekwencyjny, ale szybki (opcja C).** Po załadowaniu masownicy 3 → ekran "Sesja zakończona" → przycisk "Kolejna maszyna" → lista z "Gold · 2400 kg pozostało" na górze → operator klika i ładuje masownicę 1. Masownica 3 masuje w tle, jej timer widoczny w kafelku na dole listy.
- **`PlanRail` bez zmian.** Lewa szyna HMI już poprawnie pokazuje `in_progress` ze słupkiem postępu.

## Architektura zmian

### MixingTabletPage.tsx

**1. Filtr listy** — obejmuje `in_progress` z kgRemaining > 0:
```tsx
all
  .filter((o) =>
    o.status === 'confirmed' ||
    (o.status === 'in_progress' && (o as any).kgRemaining > 0.1)
  )
  .sort((a, b) =>
    a.status === 'in_progress' && b.status !== 'in_progress' ? -1
    : b.status === 'in_progress' && a.status !== 'in_progress' ? 1 : 0
  )
```

**2. Kafelek zlecenia in_progress** — badge z aktywną masownicą i timerem:
```
[MAS-240613-001]
Gold                              2 400 kg pozostało
🔄 Masownica 3 · 43 min           z 3000 kg planu
```
Badge bierze dane z `locks` (lista aktywnych blokad) i filtruje po `orderId`.

**3. handleStartMixing — rozgałęzienie po sesji:**
```tsx
const fullyDone = finished.kgRemaining < 0.1 || finished.status === 'done'
if (fullyDone) {
  setActiveLock(lock)  // → CooldownTimer jak dotychczas
} else {
  setActiveLock(null)  // → DoneScreen z przyciskiem "Kolejna maszyna"
}
setSessionFullyDone(fullyDone)
setPhase('done')
```
`DoneScreen` już ma `onNext` → `setPhase('list')`, co refetchuje listę. Teraz zlecenie pojawi się na liście jako `in_progress`.

**4. Usunięcie sekcji "Wznów sesję"** — redundantna, `in_progress` i tak w liście.

**5. Wybór maszyny (MachineScreen)** — bez zmian. Masownica zablokowana (lock w DB) pokazuje się jako `🔒 X min`. Wolne masownice są klikalne.

### MixingDayPlanEditor.tsx

**1. Strzałki ▲▼:** `h-4` → `h-8 w-8`, `cursor-pointer`, obrys hover.

**2. Nowy wiersz:** `meatKg: ''` → `meatKg: '100'`.

## Przepływ operatora (po zmianach)

```
Lista zleceń:
  [Gold · confirmed · 3000 kg]
  [Gold2 · confirmed · 2000 kg]

→ Klik Gold → MachineScreen (1 2 3 wolne)
→ Wybiera masownicę 3 → MeatScreen (600 kg)
→ StepScreen (składniki) → ReviewScreen → "Rozpocznij"
→ finishSession → DoneScreen:
    "Sesja zakończona! · Masownica 3 · 600 kg → partia 326"
    [Kolejna maszyna]  [Menu]

→ Klik "Kolejna maszyna" → lista odświeżona:
  [Gold · in_progress · 2400 kg pozostało  🔄 Masownica 3 · 48 min]
  [Gold2 · confirmed · 2000 kg]

→ Klik Gold → MachineScreen (1 2 wolne, 🔒3 = 48 min)
→ Wybiera masownicę 1 → MeatScreen (200 kg)
→ [...]
```

## Pliki do zmiany

| Plik | Zmiana |
|---|---|
| `src/pages/tablet/MixingTabletPage.tsx` | Filtr listy, badge in_progress, handleStartMixing |
| `src/features/products/components/MixingDayPlanEditor.tsx` | Strzałki ▲▼, domyślne meatKg |

## Poza zakresem

- Backend: bez zmian
- PlanRail (HMI): bez zmian
- Model danych sesji: bez zmian
- CooldownTimer (dla w pełni skończonych zleceń): bez zmian
