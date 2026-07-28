/**
 * yieldBonus.ts — warianty premii za uzysk, do decyzji zarządu.
 *
 * Skąd to się wzięło: akord płaci za KILOGRAMY POBRANEJ ĆWIARTKI, czyli za
 * tempo. Uzysk — jedyna rzecz, która realnie zmienia koszt kilograma mięsa —
 * nie jest wynagradzany wcale. W lipcu 2026 dało to sytuację, w której osoba
 * o najwyższym uzysku zarabiała mniej niż osoba o najniższym.
 *
 * Rozdział raportu ma POKAZAĆ DWA WARIANTY i ich cenę, a nie wybrać za
 * prezesa — to decyzja biznesowa, nie techniczna:
 *
 * * INDYWIDUALNY — celny, ale przy wąskim rozrzucie brygady trafia
 *   praktycznie do jednej osoby, a reszta dostaje kwoty, których nie widać
 *   na pasku.
 * * ZESPOŁOWY — płaci dopiero, gdy CAŁY zakład przekroczy próg, więc każdy
 *   ma interes w podciągnięciu sąsiada zamiast w sporze o to, kto dostał
 *   lepszą partię. Tam leżą większe pieniądze.
 *
 * Obie miary liczą się względem ŚREDNIEJ ZAKŁADU i tego samego kosztu 1 kg
 * mięsa co reszta raportu — żeby kwoty dało się połączyć z KPI na stronie 1.
 */

/** Domyślny udział pracownika w wypracowanej korzyści. Jawny, bo to
 *  parametr negocjacyjny, a nie stała techniczna. */
export const BONUS_SHARE = 0.4

/** Minimalna próba, żeby premia w ogóle przysługiwała [kg ćwiartki].
 *  Jeden dobry dzień to pomiar, nie poziom — i nie podstawa do wypłaty. */
export const BONUS_MIN_KG = 2000

export interface BonusWorker {
  workerId: string
  workerName: string
  kgQuarter: number
  avgYield: number
  days: number
  attendancePct: number
  yieldMinDay: number | null
  yieldMaxDay: number | null
  smallSample: boolean
}

export interface BonusRow extends BonusWorker {
  deltaPp: number
  /** Wartość jego przewagi dla firmy [zł] — zanim podzielimy się udziałem. */
  valuePln: number
  bonusPln: number
  companyPln: number
  /** Za mała próba, żeby wypłacać — pokazany dla kompletu, z powodem. */
  excluded: boolean
}

export function individualBonus(
  workers: BonusWorker[], plantAvgYield: number, meatCostPerKg: number | null,
  share: number = BONUS_SHARE,
): BonusRow[] {
  if (meatCostPerKg == null) return []
  return workers
    .map(w => {
      const deltaPp = w.avgYield - plantAvgYield
      const excluded = w.smallSample || w.kgQuarter < BONUS_MIN_KG
      const valuePln = Math.max(0, deltaPp) / 100 * w.kgQuarter * meatCostPerKg
      const bonusPln = excluded ? 0 : valuePln * share
      return { ...w, deltaPp, valuePln, bonusPln, companyPln: valuePln - bonusPln, excluded }
    })
    .sort((a, b) =>
      a.excluded !== b.excluded ? (a.excluded ? 1 : -1) : b.bonusPln - a.bonusPln)
}

export interface TeamBonusStep {
  yieldPct: number
  /** Ile zakład zyskuje na tym poziomie względem obecnej średniej [zł]. */
  gainPln: number
  poolPln: number
  companyPln: number
}

export function teamBonusLadder(
  kgQuarter: number, plantAvgYield: number, meatCostPerKg: number | null,
  share: number = BONUS_SHARE, targets: number[] = [66.0, 66.5, 67.0],
): TeamBonusStep[] {
  if (meatCostPerKg == null || !kgQuarter) return []
  return targets
    // Próg poniżej obecnej średniej nie jest celem — nie ma za co płacić.
    .filter(t => t > plantAvgYield)
    .map(t => {
      const gainPln = (t - plantAvgYield) / 100 * kgQuarter * meatCostPerKg
      const poolPln = gainPln * share
      return { yieldPct: t, gainPln, poolPln, companyPln: gainPln - poolPln }
    })
}

export interface Standout extends BonusWorker {
  deltaPp: number
  /** Nawet w najsłabszym dniu był ponad średnią zakładu — argument mocniejszy
   *  niż sama średnia, bo wyklucza „miał kilka dobrych dni". */
  worstDayAbovePlant: boolean
  fullAttendance: boolean
}

/** Kogo warto nagrodzić poza schematem — z argumentami, nie samą kwotą. */
export function standoutWorker(
  workers: BonusWorker[], plantAvgYield: number,
): Standout | null {
  const best = workers
    .filter(w => !w.smallSample && w.kgQuarter >= BONUS_MIN_KG)
    .sort((a, b) => b.avgYield - a.avgYield)[0]
  if (!best || best.avgYield <= plantAvgYield) return null
  return {
    ...best,
    deltaPp: best.avgYield - plantAvgYield,
    worstDayAbovePlant: best.yieldMinDay != null && best.yieldMinDay >= plantAvgYield,
    fullAttendance: best.attendancePct >= 100,
  }
}
