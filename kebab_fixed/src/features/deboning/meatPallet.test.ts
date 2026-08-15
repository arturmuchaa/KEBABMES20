import { describe, it, expect } from 'vitest'
import {
  PALLET_TARGETS, TOLERANCE_KG, withinTolerance, stackNetKg, proposeLots,
  quickPalletDraft, overBudgetLots,
} from './meatPallet'

describe('PALLET_TARGETS — kafelki celu', () => {
  it('pięć kafelków w kolejności od najmniejszego', () => {
    expect(PALLET_TARGETS.map(t => t.totalKg)).toEqual([100, 200, 400, 600, 800])
  })

  it('400 i 800 prowadzą po cztery słupki, 600 jest bez podziału', () => {
    const wg = (kg: number) => PALLET_TARGETS.find(t => t.totalKg === kg)!
    expect(wg(400).stackKg).toBe(100)
    expect(wg(400).stacks).toBe(4)
    expect(wg(800).stackKg).toBe(200)
    expect(wg(800).stacks).toBe(4)
    expect(wg(600).stackKg).toBeNull()
    expect(wg(600).stacks).toBeNull()
  })

  it('100 i 200 to jedno ważenie na wózku', () => {
    const wg = (kg: number) => PALLET_TARGETS.find(t => t.totalKg === kg)!
    expect(wg(100).stacks).toBe(1)
    expect(wg(200).stacks).toBe(1)
    expect(wg(200).stackKg).toBe(200)
  })
})

describe('withinTolerance — ±0,5 kg', () => {
  it('100,4 kg mieści się w normie', () => {
    expect(withinTolerance(100.4, 100)).toBe(true)
  })

  it('100,6 kg już nie', () => {
    expect(withinTolerance(100.6, 100)).toBe(false)
  })

  it('granica 0,5 kg należy do normy', () => {
    expect(withinTolerance(99.5, 100)).toBe(true)
    expect(withinTolerance(100.5, 100)).toBe(true)
  })

  it('tolerancja to pół kilograma', () => {
    expect(TOLERANCE_KG).toBe(0.5)
  })
})

describe('stackNetKg — netto słupka', () => {
  it('pierwszy słupek odejmuje nośnik i pojemniki', () => {
    // brutto 130, paleta H1 18 kg, 5 pojemników × 2 kg
    expect(stackNetKg(130, 18, 5, true)).toBe(102)
  })

  it('kolejny słupek NIE odejmuje nośnika — paleta jest już wytarowana', () => {
    expect(stackNetKg(110, 18, 5, false)).toBe(100)
  })

  it('nie schodzi poniżej zera przy pustej wadze', () => {
    expect(stackNetKg(0, 18, 0, true)).toBe(0)
  })

  it('zaokrągla do 0,1 kg — waga ma działkę 0,5, ale liczymy stabilnie', () => {
    expect(stackNetKg(110.44, 0, 0, false)).toBe(110.4)
  })
})

describe('proposeLots — skład palety wg FEFO', () => {
  // Wejście jest JUŻ posortowane od najstarszej partii (API sortuje po
  // expiry_date), więc bierzemy po kolei.
  const pula = [
    { lotNo: '475', kgFree: 420 },
    { lotNo: '476', kgFree: 900 },
  ]

  it('jedna partia pokrywa cel — jeden wiersz', () => {
    expect(proposeLots(pula, 300)).toEqual({
      picks: [{ lotNo: '475', kg: 300 }], unassignedKg: 0,
    })
  })

  it('najstarsza do dna, reszta z kolejnej', () => {
    expect(proposeLots(pula, 600)).toEqual({
      picks: [{ lotNo: '475', kg: 420 }, { lotNo: '476', kg: 180 }], unassignedKg: 0,
    })
  })

  it('resztka poniżej 0,1 kg nie tworzy wiersza-śmiecia', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 100.04 }, { lotNo: '476', kgFree: 500 }], 100)
    expect(r.picks).toEqual([{ lotNo: '475', kg: 100 }])
  })

  it('za mało mięsa w puli — reszta zostaje DO PRZYPISANIA, nie dopisuje się po cichu', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 200 }], 600)
    expect(r.picks).toEqual([{ lotNo: '475', kg: 200 }])
    expect(r.unassignedKg).toBe(400)
  })

  it('pusta pula — całość do przypisania', () => {
    expect(proposeLots([], 100)).toEqual({ picks: [], unassignedKg: 100 })
  })

  it('kilogramy zaokrągla do 0,1 — suma musi trafić w wagę palety', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 33.333 }, { lotNo: '476', kgFree: 500 }], 100)
    expect(r.picks[0].kg).toBe(33.3)
    expect(r.picks[1].kg).toBe(66.7)
    expect(r.picks.reduce((s, p) => s + p.kg, 0)).toBeCloseTo(100, 5)
  })
})

describe('quickPalletDraft — szybka etykieta z ekranu głównego', () => {
  const WEJSCIE = {
    netKg: 100, containers: 5, batchNo: '476', carrierLabel: 'wózek 6,5',
    carrierKg: 6.5, operator: 'INNA', productionDate: '2026-08-14',
    expiryDate: '2026-08-19',
  }

  it('cały słupek idzie na partię zaznaczoną na ekranie', () => {
    const d = quickPalletDraft(WEJSCIE)!
    expect(d.lots).toEqual([{ lotNo: '476', kg: 100 }])
    expect(d.kgNet).toBe(100)
    expect(d.targetKg).toBe(100)
    expect(d.stackKg).toBe(100)
  })

  it('na etykietę idzie ZMIERZONE netto, nie okrągły cel', () => {
    const d = quickPalletDraft({ ...WEJSCIE, netKg: 97.6 })!
    expect(d.kgNet).toBe(97.6)
    expect(d.lots[0].kg).toBe(97.6)
    expect(d.targetKg).toBe(100)   // cel zostaje w zapisie jako odniesienie
  })

  it('waga poza tolerancją nadal się drukuje — wydruk ma mówić prawdę', () => {
    expect(quickPalletDraft({ ...WEJSCIE, netKg: 103.2 })).not.toBeNull()
  })

  it('bez zaznaczonej partii nie ma czego zapisać', () => {
    expect(quickPalletDraft({ ...WEJSCIE, batchNo: '' })).toBeNull()
    expect(quickPalletDraft({ ...WEJSCIE, batchNo: '   ' })).toBeNull()
  })

  it('zerowa waga nie tworzy palety', () => {
    expect(quickPalletDraft({ ...WEJSCIE, netKg: 0 })).toBeNull()
  })

  it('daje ten sam skład co kreator dla jednego słupka z jednej partii', () => {
    const d = quickPalletDraft(WEJSCIE)!
    const kreator = proposeLots([{ lotNo: '476', kgFree: 900 }], 100)
    expect(d.lots).toEqual(kreator.picks)
  })
})

describe('overBudgetLots — strażnik wydajności partii na palecie', () => {
  const wolne = new Map([['478', 118.5], ['475', 900]])

  it('paleta w granicach partii nie zgłasza nic', () => {
    expect(overBudgetLots([{ lotNo: '478', kg: 100 }], wolne)).toEqual([])
  })

  it('wskazuje partię, z której paleta bierze za dużo', () => {
    const out = overBudgetLots([{ lotNo: '478', kg: 800 }], wolne)
    expect(out).toEqual([{ lotNo: '478', kg: 800, freeKg: 118.5 }])
  })

  // Bez sumowania operator obszedłby limit, wpisując partię w dwóch wierszach.
  it('sumuje kilogramy tej samej partii z kilku wierszy', () => {
    expect(overBudgetLots([{ lotNo: '478', kg: 60 }, { lotNo: '478', kg: 70 }], wolne))
      .toEqual([{ lotNo: '478', kg: 130, freeKg: 118.5 }])
  })

  // Partia spoza magazynu mięsa (stare dane, mięso z zewnątrz) nie ma limitu —
  // brak wiedzy to nie zero kilogramów.
  it('partia bez znanego limitu nie jest zgłaszana', () => {
    expect(overBudgetLots([{ lotNo: '999', kg: 800 }], wolne)).toEqual([])
  })

  it('zaokrąglenie wagi nie wywołuje alarmu', () => {
    expect(overBudgetLots([{ lotNo: '478', kg: 118.53 }], wolne)).toEqual([])
    expect(overBudgetLots([{ lotNo: '478', kg: 119 }], wolne)).toHaveLength(1)
  })
})
