import { describe, expect, it } from 'vitest'
import {
  doEdycji, doUtworzenia, grupy, kolejnaPozycja, nowyFormularz, numeryGrup, plusDni, zDokumentu, zmianaUboju, zSkanu,
  type FormPrzyjecia,
} from './model'

const DZIS = '2026-10-30'

function dwaNumery(): FormPrzyjecia {
  const f = nowyFormularz(DZIS)
  return {
    ...f,
    header: { ...f.header, supplierId: 'sup-1', pricePerKg: 7.5, palletsH1: 12, palletsOther: 3, docKg: 0, docContainers: 600 },
    groupCount: 2,
    lines: [
      { supplierBatchNo: '112819', kgReceived: 3000, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', group: 0 },
      { supplierBatchNo: '112820', kgReceived: 2010, slaughterDate: '2026-10-28', expiryDate: '2026-11-04', group: 0 },
      { supplierBatchNo: '112821', kgReceived: 4000, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', group: 1 },
    ],
  }
}

describe('daty', () => {
  it('plusDni liczy w czasie lokalnym, także przez koniec miesiąca', () => {
    expect(plusDni('2026-10-30', 7)).toBe('2026-11-06')
    expect(plusDni('', 7)).toBe('')
  })
  it('zmiana uboju przesuwa ważność o 7 dni', () => {
    const l = zmianaUboju({ supplierBatchNo: '', kgReceived: 0, slaughterDate: '', expiryDate: '2026-11-01', group: 0 }, '2026-10-28')
    expect(l.expiryDate).toBe('2026-11-04')
  })
  it('kolejna pozycja dziedziczy daty i numer partii +1, wagę zostawia pustą', () => {
    const n = kolejnaPozycja({ supplierBatchNo: '0112819', kgReceived: 900, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', group: 1 }, DZIS)
    expect(n).toMatchObject({ supplierBatchNo: '0112820', kgReceived: 0, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', group: 1 })
  })
})

describe('grupy i numery', () => {
  it('nowe przyjęcie: numery z podpowiedzi sekwencji, pojemniki z kalibru (w górę)', () => {
    const gs = grupy(dwaNumery(), false, '680')
    expect(gs.map(g => g.batchNo)).toEqual(['680', '681'])
    expect(gs[0].kg).toBe(5010)
    expect(gs[0].containersCount).toBe(334) // 5010 / 15 → 334
    expect(gs[0].expiryDate).toBe('2026-11-04') // najkrótsza ważność w grupie
    // Bez poprawki ołówkiem numerów nie wysyłamy — nada je sekwencja.
    expect(gs.map(g => g.sendBatchNo)).toEqual([undefined, undefined])
  })

  it('poprawka ołówkiem przesuwa kolejne numery i wtedy jadą do backendu', () => {
    const f = { ...dwaNumery(), ordinalOverride: { 0: '700' } }
    expect(numeryGrup(f, false, '680')).toEqual(['700', '701'])
    expect(grupy(f, false, '680').map(g => g.sendBatchNo)).toEqual(['700', '701'])
  })

  it('ręcznie przeliczone pojemniki mają pierwszeństwo przed kalibrem', () => {
    const f = { ...dwaNumery(), containerOverride: { 1: 270 } }
    expect(grupy(f, false, '680').map(g => g.containersCount)).toEqual([334, 270])
  })
})

describe('DTO nowego przyjęcia', () => {
  it('palety tylko na pierwszej grupie, docKg 0 → null, usługa tylko dla mięsa z/s', () => {
    const f = dwaNumery()
    const dto = doUtworzenia({ ...f.header, isService: true }, grupy(f, false, '680'))
    expect(dto.isService).toBe(false) // ćwiartka nie bywa usługą
    expect(dto.docKg).toBeNull()
    expect(dto.docContainers).toBe(600)
    expect(dto.groups.map(g => [g.palletsH1, g.palletsOther])).toEqual([[12, 3], [0, 0]])
    expect(dto.groups[0]).toMatchObject({ kgReceived: 5010, containerKg: 15, containersCount: 334, internalBatchNo: undefined })
    expect(dto.groups[0].supplierBatches).toHaveLength(2)
    expect(dto.groups[0].supplierBatches[1]).toEqual({ supplierBatchNo: '112820', kgReceived: 2010, slaughterDate: '2026-10-28', expiryDate: '2026-11-04' })
  })
  it('mięso z/s na usłudze zostaje usługą', () => {
    const f = dwaNumery()
    expect(doUtworzenia({ ...f.header, materialTypeId: 'mat-mieso-zs', isService: true }, grupy(f, false, '48U')).isService).toBe(true)
  })
})

const DOKUMENT = {
  receptionNo: '50/10', receivedDate: '2026-10-30', supplierId: 'sup-1', documentNo: 'WZ 1', hdiNo: '35469',
  docKg: 10005, docContainers: 667, isService: false, notes: '',
  batches: [
    { id: 'b1', internalBatchNo: '679', materialTypeId: 'mat-cwiartka', storageState: 'chlodzony', kgReceived: 6000, pricePerKg: 7, containerKg: 15, containersCount: 401,
      slaughterDate: '2026-10-29', expiryDate: '2026-11-05', palletsH1: 10, palletsOther: 0, palletsOtherKind: 'net_e1', frozenReason: '',
      supplierBatches: [{ supplierBatchNo: 'A1', kgReceived: 6000, slaughterDate: '2026-10-29', expiryDate: '2026-11-05' }] },
    // Numer bez rozpisanych pozycji HDI — dostaje wiersz zastępczy.
    { id: 'b2', internalBatchNo: '680', materialTypeId: 'mat-cwiartka', kgReceived: 4005, containersCount: null, slaughterDate: '2026-10-29', expiryDate: '2026-11-05',
      frozenReason: 'Partia poszła na rozbiór', supplierBatches: [] },
  ],
}

describe('edycja', () => {
  it('dokument → formularz: numery, przeliczone pojemniki, zamrożenie, wiersz zastępczy', () => {
    const { f, frozen } = zDokumentu(DOKUMENT)
    expect(f.groupCount).toBe(2)
    expect(f.numeryDokumentu).toEqual(['679', '680'])
    expect(f.containerOverride).toEqual({ 0: 401 })
    expect(frozen).toEqual({ b2: 'Partia poszła na rozbiór' })
    expect(f.lines).toHaveLength(2)
    expect(f.lines[1]).toMatchObject({ kgReceived: 4005, group: 1 })
  })

  it('zapis „bez zmian” oddaje te same kg i partie, bez numerów', () => {
    const { f } = zDokumentu(DOKUMENT)
    const dto = doEdycji(f.header, grupy(f, true, ''))
    expect(dto.groups.map(g => [g.batchId, g.kgReceived, g.internalBatchNo])).toEqual([['b1', 6000, undefined], ['b2', 4005, undefined]])
    expect(dto.groups[0].containersCount).toBe(401)
  })

  it('dołożony numer bez poprawki NIE wysyła etykiety „nowy” (stary formularz wysyłał i backend odrzucał)', () => {
    const { f } = zDokumentu(DOKUMENT)
    const g = { ...f, groupCount: 3, lines: [...f.lines, { supplierBatchNo: 'C1', kgReceived: 500, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', group: 2 }] }
    const gs = grupy(g, true, '')
    expect(gs[2].batchNo).toBe('nowy')
    const dto = doEdycji(g.header, gs)
    expect(dto.groups[2]).toMatchObject({ batchId: undefined, kgReceived: 500, internalBatchNo: undefined })
    // Poprawka ołówkiem na dołożonej pozycji — jedzie.
    const z = doEdycji(g.header, grupy({ ...g, ordinalOverride: { 2: '690' } }, true, ''))
    expect(z.groups.map(x => x.internalBatchNo)).toEqual([undefined, undefined, '690'])
  })
})

describe('skan HDI', () => {
  it('pozycje do jednego numeru, nagłówek z dokumentu, dostawca tylko gdy rozpoznany', () => {
    const f = { ...dwaNumery(), containerOverride: { 1: 5 } }
    const out = zSkanu(f, {
      hdiNo: '35470', documentNo: '', shippedDate: '2026-10-29', totalKg: 1800, containers: 120, pallets: 4, scanId: 'scan-1',
      supplier: null, lines: [{ supplierBatchNo: '9', kgReceived: 1800.5, slaughterDate: '2026-10-28', expiryDate: '2026-11-04' }],
    })
    expect(out.groupCount).toBe(1)
    expect(out.containerOverride).toEqual({})
    expect(out.lines[0]).toMatchObject({ kgRaw: '1800,5', group: 0 })
    expect(out.header).toMatchObject({ hdiNo: '35470', receivedDate: '2026-10-29', docKg: 1800, docContainers: 120, palletsH1: 4, hdiScanId: 'scan-1', supplierId: 'sup-1' })
  })
})
