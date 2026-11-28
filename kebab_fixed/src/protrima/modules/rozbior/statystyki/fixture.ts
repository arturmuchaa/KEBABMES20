/** Fikcyjna odpowiedź `/api/deboning/stats?extended=true` do testów ekranów. */
const fr = (a: number, m: number, u = 0, na = 1, nm = 0) => ({ auto: { n: na, kg: a }, manual: { n: nm, kg: m }, unknown: { n: 0, kg: u }, office: { kg: 0 } })
export const STATS = {
  summary: { quarters: 42, kgQuarter: 6300, kgMeat: 4000, kgBacks: 950, kgBones: 1050, avgYield: 63.5, workers: 2, kgPerHour: 118.4,
    backsPct: 15.1, bonesPct: 16.7, missingKg: 300, missingPct: 4.8, prodDays: 1, headcount: 2,
    quarterCost: null, byproductRevenue: null, laborCost: null, meatCostPerKg: null,
    meatByType: { zs: { kgQuarter: 6000, kgMeat: 3846, yieldPct: 64.1 }, bs: { kgQuarter: 300, kgMeat: 154, yieldPct: 51.3 } } },
  workers: [
    { workerId: 'w1', workerName: 'JAN TESTOWY', quarters: 22, kgQuarter: 3300, kgMeat: 2150, avgYield: 65.2, kgPerHour: 121, crewSize: 1, days: 1, attendancePct: 100,
      yieldVsBatchPp: 0.8, yieldMinDay: null, yieldMaxDay: null, yieldRangePp: null, weighings: 30, manualWeighings: 3, manualKg: 96 },
    { workerId: 'w2', workerName: 'ADAM PRZYKŁADOWY', quarters: 20, kgQuarter: 3000, kgMeat: 1850, avgYield: 61.7, kgPerHour: 112, crewSize: 1, days: 1, attendancePct: 100,
      yieldVsBatchPp: -0.9, yieldMinDay: null, yieldMaxDay: null, yieldRangePp: null, weighings: 28, manualWeighings: 1, manualKg: 30 },
  ],
  byHour: [{ hour: '2026-11-28 06:00', quarters: 10, kgMeat: 950 }, { hour: '2026-11-28 07:00', quarters: 12, kgMeat: 1100 }],
  byDay: [{ date: '2026-11-28', quarters: 42, kgMeat: 4000, avgYield: 63.5 }],
  byBatch: [{ batchNo: '850', supplierName: 'DOSTAWCA TESTOWY', kgQuarter: 6300, kgMeat: 4000, yieldPct: 63.5, kgBacks: 950, kgBones: 1050,
    backsPct: 15.1, bonesPct: 16.7, missingKg: 300, missingPct: 4.8, pricePerKg: null, quarterCost: null, byproductRevenue: null, laborCost: null, meatCostPerKg: null }],
  recent: [],
  workerDaily: { w1: [{ date: '2026-11-28', quarters: 22, kgQuarter: 3300, kgMeat: 2150, avgYield: 65.2 }] },
  weighing: { meat: fr(3874, 126, 0, 54, 4), backs: fr(950, 0), bones: fr(1050, 0), autoPct: 97.4, manualCount: 4 },
  manualList: [{ at: '2026-11-28T08:12:00+00:00', workerName: 'JAN TESTOWY', batchNo: '850', fraction: 'meat', kg: 32, reason: '' }],
  previous: { dateFrom: '2026-11-21', dateTo: '2026-11-21', untilTime: '10:00', kgQuarter: 6000, kgMeat: 3700, yieldZs: 62.9,
    backsPct: 15, bonesPct: 17, missingPct: 5, kgPerHour: 110, autoPct: 99 },
  live: { openTakes: [{ entryId: 'e9', workerName: 'ADAM PRZYKŁADOWY', batchNo: '850', kgQuarter: 150, since: '2026-11-28T08:40:00+00:00' }],
    lastWeighByWorker: { w1: '2026-11-28T08:55:00+00:00' }, peopleLastHour: 2 },
  overrides: { total: 1, byWorker: { w2: 1 } },
  corrections: { edits: 2, deleted: 0 },
}
export const PUSTE = { ...STATS, summary: { ...STATS.summary, quarters: 0, kgQuarter: 0, kgMeat: 0, kgBacks: 0, kgBones: 0, missingKg: 0 },
  workers: [], byHour: [], byDay: [], byBatch: [], manualList: [], live: null,
  weighing: { meat: fr(0, 0, 0, 0), backs: fr(0, 0, 0, 0), bones: fr(0, 0, 0, 0), autoPct: null, manualCount: 0 } }

