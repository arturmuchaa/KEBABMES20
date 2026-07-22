/**
 * meatDriveOff.ts — strażnik zjazdu z wagi na ważeniu MIĘSA (HMI rozbiór v10).
 *
 * Operator wjeżdża wózkiem, system liczy netto, po czym wózek zjeżdża z wagi
 * BEZ naciśnięcia ZAPISZ — kilogramy przepadały, bo `meat` liczy się z żywego
 * odczytu. Ten moduł decyduje, czy odczyt wolno zapamiętać (`buildMeatSnapshot`)
 * i jakie wyjścia pokazać po zjeździe (`meatPromptVariant`).
 *
 * Sam tracker (uzbrojenie/zjazd) siedzi w weighing.ts — tu tylko ładunek.
 */
import { decideTakeSave } from './partialWeighing'

/** Zamrożony odczyt ważenia mięsa — wszystko, czego potrzeba do zapisu PO
 * zjeździe z wagi (scale.gross jest wtedy zerem, więc żywych danych nie ma). */
export interface MeatSnapshot {
  netKg: number
  gross: number
  cartTareKg: number | null
  e2Count: number
  workerId: string
  workerName: string
  batchId: string
  batchNo: string
  /** Pobrana ćwiartka (kg). */
  takenKg: number
  /** Porcje zważone wcześniej w ramach tego pobrania (0 w trybie zwykłym). */
  weighedSoFarKg: number
  /** != null = domykanie otwartego pobrania. */
  resumeId: string | null
}

export interface MeatSnapshotInput {
  /** Mięso liczone z wagi (false = operator przejął ręcznie). */
  autoMode: boolean
  connected: boolean
  /** Tara wózka wybrana i brutto > tara (computeWeighing().ready). */
  ready: boolean
  /** Otwarty kreator ubocznych / prompt zakończenia partii — na wadze stoi
   * paleta grzbietów, nie wózek z mięsem. */
  blocked: boolean
  netKg: number
  gross: number
  cartTareKg: number | null
  e2Count: number
  worker: { id: string; name: string } | null
  batch: { id: string; internalBatchNo: string } | null
  takenKg: number
  weighedSoFarKg: number
  resumeId: string | null
}

/** Snapshot albo `null` = nie uzbrajaj trackera. Okno pojawia się WYŁĄCZNIE
 * przy komplecie danych (decyzja użytkownika 2026-07-22) — przy braku
 * pracownika czy ćwiartki zachowujemy się jak dotąd. */
export function buildMeatSnapshot(i: MeatSnapshotInput): MeatSnapshot | null {
  if (!i.autoMode || !i.connected || !i.ready || i.blocked) return null
  if (!i.worker || !i.batch) return null
  if (i.takenKg <= 0 || i.netKg <= 0) return null
  if (i.weighedSoFarKg + i.netKg > i.takenKg) return null
  return {
    netKg: i.netKg,
    gross: i.gross,
    cartTareKg: i.cartTareKg,
    e2Count: i.e2Count,
    workerId: i.worker.id,
    workerName: i.worker.name,
    batchId: i.batch.id,
    batchNo: i.batch.internalBatchNo,
    takenKg: i.takenKg,
    weighedSoFarKg: i.weighedSoFarKg,
    resumeId: i.resumeId,
  }
}

/** part = zapisz porcję (pobranie otwarte) · complete = domknij pobranie ·
 *  entry = zwykły wpis ćwiartka+mięso · entry-part = zamień wpis na otwarte
 *  pobranie i zapisz porcję. */
export type MeatPromptAction = 'part' | 'complete' | 'entry' | 'entry-part'

export interface MeatPromptVariant {
  /** Przycisk wypełniony — podpowiedź systemu. */
  primary: MeatPromptAction
  /** Przycisk obrysowany; null = brak drugiego wyjścia. */
  secondary: MeatPromptAction | null
  /** Zważone łącznie z tą porcją (kg, 0,1). */
  totalWeighedKg: number
  /** Procent pobrania po tej porcji. */
  pct: number
}

export function meatPromptVariant(s: MeatSnapshot): MeatPromptVariant {
  const totalWeighedKg = Math.round((s.weighedSoFarKg + s.netKg) * 10) / 10
  const pct = s.takenKg > 0 ? (totalWeighedKg / s.takenKg) * 100 : 0
  // Ta sama reguła co po ręcznym ZAPISZ: ≥63% uzysku = pewnie całość.
  const decision = decideTakeSave(s.weighedSoFarKg, s.netKg, s.takenKg)
  if (s.resumeId) {
    return decision === 'complete'
      ? { primary: 'complete', secondary: 'part', totalWeighedKg, pct }
      : { primary: 'part', secondary: 'complete', totalWeighedKg, pct }
  }
  return decision === 'complete'
    ? { primary: 'entry', secondary: null, totalWeighedKg, pct }
    : { primary: 'entry-part', secondary: 'entry', totalWeighedKg, pct }
}
