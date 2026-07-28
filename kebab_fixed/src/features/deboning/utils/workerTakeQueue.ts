/**
 * workerTakeQueue.ts — co robi kafelek pracownika na HMI rozbioru, gdy w
 * kolejce stoją pobrania RÓŻNYCH rodzajów mięsa.
 *
 * Z hali (28.07): Anatoli robi pobranie 150 kg z/s, wpada pilne zamówienie na
 * b/s — operator przełącza suwak Z/S↔B/S i musi móc dodać DRUGIE pobranie
 * (np. 15 kg), a przy zdaniu mięsa zobaczyć to pobranie, które pasuje do
 * suwaka. Wcześniej kafel pokazywał sumę obu (165 kg) i wchodził w domykanie
 * niezależnie od rodzaju.
 *
 * Cała decyzja siedzi tutaj (nie w komponencie), bo używają jej DWA miejsca —
 * wygląd kafelka i klik w kafelek — a rozjazd między nimi to najkrótsza droga
 * do zważenia b/s pod pobranie z/s.
 */
import type { MeatType } from './partialWeighing'

export interface QueuedTake {
  id: string
  workerId: string
  rawBatchId: string
  rawBatchNo: string
  /** Ćwiartka wydana pracownikowi [kg]. */
  kgTaken: number
  /** Suma zapisanych już porcji mięsa [kg]. */
  kgMeatWeighed?: number
  /** Brak = pobranie sprzed wprowadzenia b/s → z/s. */
  meatType?: MeatType | null
}

export interface WorkerTakeState {
  /** 'resume' — domknij wskazane pobranie; 'new' — nowe pobranie;
   *  'wrong-batch' — pracownik czeka z mięsem z INNEJ partii niż wybrana. */
  action: 'resume' | 'new' | 'wrong-batch'
  resumeEntryId?: string
  /** Kafel na szaro (jest co domykać, ale nie przy tej partii). */
  blocked: boolean
  /** Kg pobrania/pobrań RODZAJU z suwaka (undefined = nic nie czeka). */
  pendingKg?: number
  pendingWeighedKg?: number
  pendingBatchNos?: string[]
  /** Ile kg czeka w DRUGIM rodzaju — znacznik, żeby operator o nim nie zapomniał. */
  otherKindKg?: number
  /** Partie, w których pracownik czeka z mięsem (do komunikatu przy blokadzie). */
  wrongBatchNos?: string[]
}

const kindOf = (t: QueuedTake): MeatType => (t.meatType ?? 'zs') as MeatType

export function workerTakeState(
  takes: QueuedTake[],
  workerId: string,
  meatType: MeatType,
  selectedBatchId: string | null,
): WorkerTakeState {
  const mine = takes.filter(t => t.workerId === workerId)
  const sameKind = mine.filter(t => kindOf(t) === meatType)
  const otherKind = mine.filter(t => kindOf(t) !== meatType)
  const otherKindKg = otherKind.length
    ? sum(otherKind.map(t => Number(t.kgTaken) || 0))
    : undefined

  if (!sameKind.length) {
    // Otwarte pobranie DRUGIEGO rodzaju nie blokuje — na tym polega dodanie
    // b/s obok trwającego z/s.
    return { action: 'new', blocked: false, otherKindKg }
  }

  const batchNos = uniq(sameKind.map(t => t.rawBatchNo).filter(Boolean))
  const base: WorkerTakeState = {
    action: 'resume',
    blocked: false,
    pendingKg: sum(sameKind.map(t => Number(t.kgTaken) || 0)),
    pendingWeighedKg: sum(sameKind.map(t => Number(t.kgMeatWeighed) || 0)),
    pendingBatchNos: batchNos,
    otherKindKg,
  }

  // Mięso wraca na wagę pod partię POBRANIA, nie pod aktualnie wybraną
  // (prod 2026-07-10) — inaczej mięso z 408 zapisałoby się na 409.
  const forBatch = selectedBatchId ? sameKind.find(t => t.rawBatchId === selectedBatchId) : undefined
  if (selectedBatchId && !forBatch) {
    return { ...base, action: 'wrong-batch', blocked: true, wrongBatchNos: batchNos }
  }
  return { ...base, resumeEntryId: (forBatch ?? sameKind[0]).id }
}

function sum(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10
}

function uniq(xs: string[]): string[] {
  return xs.filter((x, i) => xs.indexOf(x) === i)
}
