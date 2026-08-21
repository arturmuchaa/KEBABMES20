/**
 * palletTags — ile zawieszek trzeba wydrukować na przyjęty numer porządkowy.
 *
 * Dostawa jedzie w pojemnikach ułożonych na paletach, a do chłodni wjeżdża
 * PALETAMI — każda musi mieć własną zawieszkę, inaczej po dwóch dniach nikt
 * nie odróżni, z którego numeru porządkowego jest stos w rogu.
 *
 *     numer porządkowy 471 — 3000 kg, kaliber 15 kg → 200 pojemników
 *     ├── 5 palet po 36 pojemników (540 kg)   → 5 zawieszek
 *     └── reszta 20 pojemników (300 kg)       → 6. zawieszka
 *
 * Kaliber i układ palety zależą od dostawcy: KOKO wozi po 15 kg i układa
 * 9 na warstwę × 4 warstwy = 36. Inny dostawca kładzie 8 na warstwę = 32,
 * dlatego oba wejścia są parametrem, a nie stałą w kodzie.
 *
 * Zero importów z Reacta — moduł ma się dać przetestować w vitest i użyć
 * zarówno na ekranie druku, jak i w podglądzie zawieszki.
 */
import { containersForKg } from '@/lib/containers'

/** Układ palety głównego dostawcy (KOKO): 9 pojemników na warstwę × 4 warstwy. */
export const DEFAULT_CONTAINERS_PER_PALLET = 36

export interface PalletTagsInput {
  /** Numer porządkowy partii („471") — to on wisi na zawieszce. */
  batchNo: string
  /** Waga netto CAŁEGO numeru porządkowego. */
  kg: number
  /** Kaliber pojemnika w kg; null = surowiec niekalibrowany. */
  containerKg?: number | null
  /** Ręcznie przeliczony stos; wygrywa z wyliczeniem z kalibru. */
  containersCount?: number | null
  containersPerPallet: number
}

/** Jedna zawieszka = jedna paleta jadąca do chłodni. */
export interface PalletTag {
  batchNo: string
  /** Numer palety w obrębie numeru porządkowego, liczony od 1. */
  palletIndex: number
  /** Ile palet ma ten numer porządkowy — na zawieszce jako „3 / 6". */
  palletCount: number
  containers: number
  netKg: number
  /** false = paleta niepełna (reszta stosu). */
  full: boolean
}

export interface PalletTagPlan {
  /** Pojemników w całym numerze porządkowym; null = nie da się policzyć. */
  containers: number | null
  fullPallets: number
  restContainers: number
  tags: PalletTag[]
}

const PUSTY: PalletTagPlan = { containers: null, fullPallets: 0, restContainers: 0, tags: [] }

/** Kilogramy do dziesiątej części — tyle drukuje zawieszka (`fmtLabelKg`). */
function round1(kg: number): number {
  return Math.round(kg * 10) / 10
}

export function planPalletTags(input: PalletTagsInput): PalletTagPlan {
  const { batchNo, kg, containersCount, containersPerPallet } = input

  // Ręczna liczba przed wyliczeniem: operator, który przeliczył stos palcem,
  // wie lepiej niż waga (5.08.2026, partia 459 — 199 zamiast 200).
  const containers = containersCount ?? containersForKg(kg, input.containerKg ?? null)
  if (containers === null) return PUSTY
  if (containers <= 0) return { ...PUSTY, containers }

  const naPalecie = Math.floor(containersPerPallet)
  // Zerowa (albo ujemna) paleta to błąd ustawienia, nie dostawa bez palet —
  // liczba zawieszek byłaby nieskończona, więc nie drukujemy nic.
  if (!Number.isFinite(naPalecie) || naPalecie <= 0) {
    return { containers, fullPallets: 0, restContainers: 0, tags: [] }
  }

  const fullPallets = Math.floor(containers / naPalecie)
  const restContainers = containers % naPalecie

  // Waga pojemnika liczona z WAGI PARTII, nie z kalibru: kaliber mówi, ile
  // pojemników wyszło, ale kilogramy na zawieszkach muszą zsumować się do
  // tego, co faktycznie przyjechało — inaczej zawieszki dopisałyby dostawie
  // kilogramy, których nie ma w księdze.
  const kgPojemnika = kg / containers
  const kgPelnej = round1(naPalecie * kgPojemnika)

  const total = fullPallets + (restContainers > 0 ? 1 : 0)
  const tags: PalletTag[] = []
  let rozdane = 0

  for (let i = 0; i < fullPallets; i++) {
    // Ostatnia zawieszka domyka sumę do wagi partii (patrz wyżej) — także
    // wtedy, gdy resztki nie ma i domyka ją ostatnia PEŁNA paleta.
    const ostatnia = i === total - 1
    const netKg = ostatnia ? round1(round1(kg) - rozdane) : kgPelnej
    rozdane = round1(rozdane + netKg)
    tags.push({ batchNo, palletIndex: i + 1, palletCount: total, containers: naPalecie, netKg, full: true })
  }

  if (restContainers > 0) {
    tags.push({
      batchNo, palletIndex: total, palletCount: total,
      containers: restContainers, netKg: round1(round1(kg) - rozdane), full: false,
    })
  }

  return { containers, fullPallets, restContainers, tags }
}
