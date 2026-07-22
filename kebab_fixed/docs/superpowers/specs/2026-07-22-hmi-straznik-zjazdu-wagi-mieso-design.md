# Strażnik zjazdu z wagi na ważeniu mięsa (HMI rozbiór v10)

Data: 2026-07-22

## Problem

Po rozbiorze brakuje pojemników z mięsem: operator wjeżdża wózkiem na wagę,
odczytuje netto, po czym zjeżdża z wagi **bez naciśnięcia ZAPISZ**. Na głównym
ekranie HMI `meat` liczy się z żywego odczytu (`autoNet = stabilna ? netKg : 0`),
więc po zjeździe wartość spada do zera, wielki przycisk gaśnie i zważone
kilogramy przepadają bez śladu — nie ma nawet informacji, że coś się zgubiło.

Kreator ważenia ubocznych (`ByproductsWizard`) ma na to strażnika od 1.0.58:
`driveOffStep` pamięta ostatni kompletny stabilny odczyt i po zjeździe pyta,
czy dodać paletę do sumy. Główny ekran ważenia mięsa takiego strażnika nie ma.

## Zakres (decyzje użytkownika, 2026-07-22)

1. Strażnik obejmuje **każde ważenie mięsa** na głównym ekranie: zarówno
   domykanie otwartego pobrania, jak i zwykły wpis (ćwiartka + mięso naraz).
2. Okno pokazuje pełny kontekst — pracownik, partia, ile pobrano, ile zważono
   (z tą porcją), procent pobrania — i **od razu oba wyjścia** dla ważenia
   częściowego, bez drugiego okna.
3. Trzeci przycisk to **Anuluj** (odrzuca odczyt), wizualnie odsunięty od
   zapisu, żeby nie dało się go pomylić.
4. Gdy w chwili zjazdu brakuje danych do zapisu (pracownik, ćwiartka) — okno
   **nie** wyskakuje. Zachowanie jak dziś.

## Architektura

### Logika czysta — `src/features/deboning/utils/`

**`weighing.ts` — generalizacja istniejącego trackera.**
`DriveOffTracker` i `driveOffStep` przestają znać budowę palety; ładunek staje
się parametrem typu:

```ts
export interface DriveOffTracker<T> { armed: T | null; prompt: T | null }
export const DRIVE_OFF_IDLE = { armed: null, prompt: null }

export function driveOffStep<T>(
  state: DriveOffTracker<T>,
  reading: { connected: boolean; stable: boolean; gross: number },
  snap: T | null,          // null = dane niekompletne, nie uzbrajaj
): DriveOffTracker<T>
```

Reguły bez zmian: gdy czeka `prompt`, kolejne odczyty go nie ruszają; uzbrojenie
przy `connected && stable && gross > SCALE_EMPTY_KG && snap != null`; przejście
`armed → prompt` przy `gross <= SCALE_EMPTY_KG`; niestabilne odczyty nad progiem
zostawiają `armed` nietknięte.

`ByproductsWizard` buduje `PalletSnapshot` u siebie (dotąd budował go
`driveOffStep`) i przekazuje `null`, gdy `tareKg == null || net <= 0`. Zachowanie
kreatora nie zmienia się ani o krok.

**`meatDriveOff.ts` — nowy moduł.**

```ts
export interface MeatSnapshot {
  netKg: number            // ZAMROŻONE netto mięsa
  gross: number            // brutto z chwili odczytu
  cartTareKg: number | null
  e2Count: number
  workerId: string
  workerName: string
  batchId: string
  batchNo: string
  takenKg: number          // pobrana ćwiartka
  weighedSoFarKg: number   // porcje zważone wcześniej (0 w trybie zwykłym)
  resumeId: string | null  // != null = domykanie otwartego pobrania
}

export function buildMeatSnapshot(input): MeatSnapshot | null
export function meatPromptVariant(snap): MeatPromptVariant
```

`buildMeatSnapshot` zwraca `null` (czyli: nie uzbrajaj), gdy zachodzi choć jedno:
tryb ręczny lub waga niedostępna, brak partii, brak pracownika, `takenKg <= 0`,
`netKg <= 0`, `weighedSoFarKg + netKg > takenKg` (mięso większe niż pobranie).

`meatPromptVariant` opisuje przyciski i który jest wypełniony — na bazie
istniejącego `decideTakeSave(weighedSoFarKg, netKg, takenKg)`:

| tryb | `decideTakeSave` | wypełniony | obrysowany |
|---|---|---|---|
| domykanie | `ask` (<63%) | ZAPISZ PORCJĘ | TO CAŁOŚĆ |
| domykanie | `complete` (≥63%) | TO CAŁOŚĆ | ZAPISZ PORCJĘ |
| zwykły wpis | `ask` (<63%) | TO DOPIERO CZĘŚĆ | ZAPISZ WPIS |
| zwykły wpis | `complete` (≥63%) | ZAPISZ WPIS | — (bez wariantu części) |

### Ekran — `DeboningHmiV10Page.tsx`

Stan `meatDriveOff: DriveOffTracker<MeatSnapshot>` aktualizowany w `useEffect`
zależnym od odczytu wagi i pól formularza — dokładnie tak jak w kreatorze.

Okno (modal, wzór wizualny `partialPrompt`, `z-50`, ikona wagi w kolorze
ostrzegawczym):

```
┌──────────────────────────────────┐
│ ⚖  ZWAŻONE — NIE ZAPISANO        │
│         100,0 kg                 │
│   Anatoli · partia 412           │
│   pobrano 300,0 · zważono 100,0  │
│   ▰▰▰▱▱▱▱▱▱  33% pobrania        │
│ [ ZAPISZ PORCJĘ — RESZTA DOJEDZIE]│
│ [ TO CAŁOŚĆ — ZAMKNIJ POBRANIE  ] │
│ ──────────────────────────────── │
│   anuluj                         │
└──────────────────────────────────┘
```

- Przyciski zapisu: wysokość 56 px, wzajemnie odróżnione wypełnieniem wg tabeli
  wyżej.
- `Anuluj`: wysokość 40 px, bez tła, kolor `var(--mut)`, oddzielony poziomą
  kreską. Odrzuca odczyt (`DRIVE_OFF_IDLE`), nic nie zapisuje.
- Modal przykrywa ekran, więc następnego wózka nie da się zważyć przed
  podjęciem decyzji — ta sama zasada co w kreatorze ubocznych.

### Zapis

Wszystkie DTO idą z **zamrożonego snapshotu**, nie z żywej wagi: po zjeździe
`scale.gross` to zero, więc `kgGross`, `tareCartKg`, `tareE2Kg`, `e2Count`
odczytane w chwili zapisu dałyby wpis 0 kg z bezsensowną tarą. To jest główna
pułapka tej zmiany.

| przycisk | wywołanie |
|---|---|
| ZAPISZ PORCJĘ | `weighPart(resumeId, dto)` |
| TO CAŁOŚĆ | `completeTake(resumeId, dto)` |
| ZAPISZ WPIS | `addEntry({ kgTaken, kgMeat, ...dto })` |
| TO DOPIERO CZĘŚĆ | `addTake({ kgTaken })` → `weighPart(nowyId, dto)` |

Po każdym udanym zapisie oraz po `Anuluj`: `setMeatDriveOff(DRIVE_OFF_IDLE)`.

**Zmiana w `hooks/index.ts`:** `addTake` nie oddaje dziś utworzonego pobrania
(`createTakeMutation.mutate(dto)` → wynik odrzucany), a ścieżka „TO DOPIERO
CZĘŚĆ" potrzebuje jego `id`. Wynik trafia do refa `lastTakeRef` eksportowanego
z hooka — ref, nie stan, bo `id` jest potrzebny w tym samym obrocie funkcji.
Gdy `addTake` zwróci błąd albo ref jest pusty, pokazujemy błąd i **zostawiamy
okno otwarte** — operator ponawia, odczyt się nie gubi.

## Poza zakresem

- Backend bez zmian — `createTake`, `weighPart`, `completeTake` już istnieją.
- Tryb ręczny (awaria wagi): brak strażnika, nie ma zjazdu do wykrycia.
- Niekompletne dane w chwili zjazdu: brak okna (decyzja 4 wyżej).
- Reload/restart kiosku z otwartym oknem gubi niezdecydowany odczyt — nie
  utrwalamy go w localStorage. Okno jest modalne i nachalne, więc ryzyko małe.
- Istniejący dialog `partialPrompt` (po ręcznym ZAPISZ) zostaje bez zmian —
  nowe okno to osobna ścieżka, dla wózka który już zjechał.

## Testy (vitest)

1. `driveOffStep` po generalizacji — istniejące przypadki kreatora przechodzą
   po przepisaniu na jawny snapshot; `snap = null` nie uzbraja.
2. `buildMeatSnapshot` zwraca `null` dla każdego z sześciu braków osobno,
   a komplet danych daje snapshot z zamrożonym `netKg`.
3. `meatPromptVariant` — cztery wiersze tabeli wariantów.
4. Arytmetyka procentu: `weighedSoFarKg + netKg` do `takenKg`; 100 z 300 = 33%.
