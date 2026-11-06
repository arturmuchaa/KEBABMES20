/**
 * Zatwierdzenia biura — praca hali, którą biuro domyka (stary MES: Pulpit „Do potwierdzenia
 * przez biuro” + Realizacja produkcji). Te same endpointy i ten sam rachunek reszty mięsa
 * (features/production-plan/remainderSplit). Lepiej niż w starym MES:
 *  - przed potwierdzeniem planu widać, co tablet zgłosił i co trafi do magazynu (stary: gołe „Potwierdzić?”);
 *  - po potwierdzeniu planu z TABLETU też pada pytanie o resztę mięsa (stary pytał tylko przy ręcznym zamknięciu).
 */
import { batchIdsFromAllocation } from '@/features/production-plan/planMeatAllocation'
import { changedAssignments, splitRemainder } from '@/features/production-plan/remainderSplit'

export const PROCES: Record<string, string> = { deboning: 'Rozbiór', mixing: 'Masowanie', production: 'Produkcja' }

export interface SesjaLite { id: string; processType: string; sessionDate: string; endedAt?: string | null }
export interface WpisTabletu { planLineId: string; qty: number; kgPerUnit: number; workerNames?: string[] }
export interface LiniaZ {
  id: string; qty: number; kgPerUnit: number; productTypeName?: string; recipeId?: string; recipeName?: string
  packagingName?: string; clientName?: string; batchAllocation?: Record<string, unknown> | null; seasonedBatchNos?: string[] | null
}
export interface PlanZ {
  id: string; planNo: string; planDate: string; status: string
  tabletFinishedAt?: string | null; officeConfirmedAt?: string | null
  tabletPendingEntries?: WpisTabletu[] | null; lines: LiniaZ[]
}

export interface Pozycja {
  key: string; rodzaj: 'sesja' | 'plan'; tytul: string; data: string; zalegla: boolean
  sesja?: SesjaLite; plan?: PlanZ
}

/** Do zatwierdzenia: zamknięte sesje (serwer sam zamyka otwarte z poprzednich dni) i plany zakończone na tablecie. */
export function doZatwierdzenia(sesje: SesjaLite[], plany: PlanZ[], dzis: string): Pozycja[] {
  const out: Pozycja[] = [
    ...sesje.map(s => ({ key: `sesja:${s.id}`, rodzaj: 'sesja' as const, tytul: PROCES[s.processType] ?? s.processType, data: s.sessionDate, zalegla: s.sessionDate < dzis, sesja: s })),
    ...plany.filter(p => p.tabletFinishedAt && !p.officeConfirmedAt && p.status !== 'done' && p.status !== 'cancelled')
      .map(p => ({ key: `plan:${p.id}`, rodzaj: 'plan' as const, tytul: `Produkcja ${p.planNo}`, data: p.planDate, zalegla: p.planDate < dzis, plan: p })),
  ]
  // Najstarsze na górze — zaległość z wczoraj jest pilniejsza niż dzisiejsze zamknięcie.
  return out.sort((a, b) => a.data.localeCompare(b.data))
}

export interface WierszPotwierdzenia {
  lineId: string; productTypeName: string; recipeName: string; packagingName: string; clientName: string
  planowano: number; zgloszono: number; kgPerUnit: number; kg: number; pracownicy: string[]
  stan: 'ok' | 'czesc' | 'brak' | 'ponad'
}

/** Co tablet zgłosił przy każdej pozycji planu — to trafi do magazynu wyrobu po potwierdzeniu. */
export function porownaniePlanu(plan: PlanZ) {
  const wpisy = plan.tabletPendingEntries ?? []
  const wiersze: WierszPotwierdzenia[] = plan.lines.map(l => {
    const moje = wpisy.filter(w => w.planLineId === l.id)
    const zgloszono = moje.reduce((a, w) => a + (Number(w.qty) || 0), 0)
    const kg = moje.reduce((a, w) => a + (Number(w.qty) || 0) * (Number(w.kgPerUnit) || l.kgPerUnit), 0)
    const stan: WierszPotwierdzenia['stan'] = zgloszono === 0 ? 'brak' : zgloszono < l.qty ? 'czesc' : zgloszono > l.qty ? 'ponad' : 'ok'
    return {
      lineId: l.id, productTypeName: l.productTypeName ?? '', recipeName: l.recipeName ?? '', packagingName: l.packagingName ?? '',
      clientName: l.clientName ?? '', planowano: l.qty, zgloszono, kgPerUnit: l.kgPerUnit, kg: Math.round(kg * 1000) / 1000,
      pracownicy: [...new Set(moje.flatMap(w => w.workerNames ?? []))], stan,
    }
  })
  // Gramatura w opisie: plan ma zwykle kilka pozycji tej samej receptury — sama nazwa nie mówi, której dotyczy.
  const kto = (w: WierszPotwierdzenia) => `${w.recipeName} ${String(w.kgPerUnit).replace('.', ',')} kg${w.clientName ? ` (${w.clientName})` : ''}`
  const ostrzezenia = wiersze.flatMap(w =>
    w.stan === 'brak' ? [`${kto(w)}: tablet nie zgłosił produkcji — pozycja zostanie bez wyrobu.`]
    : w.stan === 'czesc' ? [`${kto(w)}: ${w.zgloszono} z ${w.planowano} szt. — reszta NIE zostanie wyprodukowana w tym planie.`]
    : w.stan === 'ponad' ? [`${kto(w)}: ${w.zgloszono} szt. przy planie ${w.planowano} — więcej niż w planie.`]
    : [])
  return {
    wiersze, ostrzezenia, pusty: wpisy.length === 0,
    suma: { szt: wiersze.reduce((a, w) => a + w.zgloszono, 0), kg: Math.round(wiersze.reduce((a, w) => a + w.kg, 0) * 1000) / 1000 },
  }
}

export interface PartiaLite { id: string; batchNo: string; recipeId?: string; recipeName?: string; kgAvailable: number; expiryDate?: string }
export interface ResztaReceptury { recipeId: string; recipeName: string; teoria: number; batches: Array<{ id: string; batchNo: string; theoryKg: number; expiryDate?: string }> }

/** Partie mięsa przyprawionego użyte w planie, z czymś jeszcze na stanie — pytamy per RECEPTURA
 *  (w chłodni nikt nie dzieli resztek na partie; podział robi splitRemainder wg FEFO). */
export function resztyDoRozliczenia(plan: PlanZ, partie: PartiaLite[]): ResztaReceptury[] {
  const uzyte = new Set<string>()
  for (const l of plan.lines) for (const id of batchIdsFromAllocation(l.batchAllocation as Record<string, unknown>, l.seasonedBatchNos)) uzyte.add(id)
  const wg = new Map<string, ResztaReceptury>()
  for (const s of partie) {
    if (!uzyte.has(s.id) || !(Number(s.kgAvailable) > 0.05)) continue
    const k = s.recipeId || s.recipeName || s.id
    const g = wg.get(k) ?? { recipeId: k, recipeName: s.recipeName ?? '', teoria: 0, batches: [] }
    g.teoria = Math.round((g.teoria + Number(s.kgAvailable)) * 1000) / 1000
    g.batches.push({ id: s.id, batchNo: s.batchNo, theoryKg: Number(s.kgAvailable), expiryDate: s.expiryDate })
    wg.set(k, g)
  }
  return [...wg.values()]
}

/** Korekty partii z podanej reszty (recipeId → kg, które realnie zostały). Tylko partie, które się zmieniają. */
export function korektyReszty(reszty: ResztaReceptury[], podane: Record<string, number>): Array<{ id: string; targetKg: number; close: boolean }> {
  return reszty.flatMap(r => {
    const kg = podane[r.recipeId]
    if (kg === undefined || !Number.isFinite(kg)) return []
    return changedAssignments(splitRemainder(r.batches, kg)).map(a => ({ id: a.id, targetKg: a.targetKg, close: a.close }))
  })
}
