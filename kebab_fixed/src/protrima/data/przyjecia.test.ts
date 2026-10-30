import { describe, it, expect } from 'vitest'
import { mapaMiesa, mapujPrzyjecie, mapujRodzaje, roznicaKg, stanHaccp, dniDo } from './przyjecia'

/** Dane syntetyczne w kształcie /api/receptions, /wz/stock/raw i /raw-batches/material-types. */
const RODZAJE = mapujRodzaje([
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requires_deboning: true, category: 'drob' },
  { id: 'mat-filet-kurczak', name: 'Filet z kurczaka', requires_deboning: false, category: 'drob' },
  { id: 'mat-wolowina-zrazowa', name: 'Dolna zrazowa wołowa', requires_deboning: false, category: 'czerwone' },
])
const MIESO = mapaMiesa([
  { stock_type: 'meat', internal_batch_no: '701', kg_available: 300, kg_reserved: 50, kg_initial: 500 },
  { stock_type: 'meat', internal_batch_no: '701', kg_available: 100, kg_reserved: 0, kg_initial: 100 },
  { stock_type: 'raw', internal_batch_no: '700', kg_available: 999 },
])
const REC = {
  id: 'r1', reception_no: '50/10', reception_seq: 50, reception_period: '2026-10', received_date: '2026-10-30',
  supplier_id: 's1', supplier_name: 'KOKO SP. Z O.O.', document_no: '', hdi_no: '35469', doc_kg: 6000, doc_containers: 400, hdi_scan: '',
  is_service: false, notes: '', created_at: '2026-10-30T06:26:25Z',
  batches: [
    { id: 'b1', internal_batch_no: '700', internal_batch_seq: 700, material_type_id: 'mat-cwiartka', requires_deboning: true,
      kg_received: 5400, kg_available: 3600, status: 'active', expiry_date: '2026-11-05', received_date: '2026-10-30', containers_count: 360,
      supplier_batches: [{ supplier_batch_no: '113492', kg: 1080, slaughter_date: '2026-10-29', expiry_date: '2026-11-05' }, { supplier_batch_no: '1', kg: null }] },
    { id: 'b2', internal_batch_no: '701', internal_batch_seq: 701, material_type_id: 'mat-filet-kurczak', requires_deboning: false,
      kg_received: 600, kg_available: 0, status: 'active', expiry_date: '2026-11-02', containers_count: 40 },
  ],
}

describe('mapujPrzyjecie', () => {
  const p = mapujPrzyjecie(REC, RODZAJE, MIESO)
  it('ćwiartka: stan z raw_batches; filet: stan z magazynu mięsa (suma lotów), nie wyzerowany kg_available', () => {
    expect(p.numery[0].kgLeft).toBe(3600)
    expect(p.numery[0].stan).toBe('in_progress')
    expect(p.numery[1].kgLeft).toBe(400)
    expect(p.numery[1].kgReserved).toBe(50)
    expect(p.numery[1].stan).toBe('in_progress')
  })
  it('sumy dokumentu, różnica z HDI, najbliższy termin, stan w obiegu', () => {
    expect(p.kgReceived).toBe(6000)
    expect(p.kgLeft).toBe(4000)
    expect(p.containers).toBe(400)
    expect(roznicaKg(p)).toBe(0)
    expect(p.nearestExpiry).toBe('2026-11-02')
    expect(p.stan).toBe('w_obiegu')
    expect(p.materials).toEqual(['Ćwiartka z kurczaka', 'Filet z kurczaka'])
  })
  it('partia dostawcy bez kg (z migracji) to null, nie zero', () => {
    expect(p.numery[0].supplierBatches.map(x => x.kg)).toEqual([1080, null])
  })
  it('anulowana dostawa: numer pierwotny z sekwencji, poza sumą, stan anulowana', () => {
    const a = mapujPrzyjecie({ ...REC, batches: [{ ...REC.batches[0], internal_batch_no: 'ANUL-b1', status: 'cancelled' }] }, RODZAJE, MIESO)
    expect(a.numery[0].no).toBe('700')
    expect(a.kgReceived).toBe(0)
    expect(a.stan).toBe('anulowana')
  })
  it('rozliczona: nic nie leży', () => {
    const z = mapujPrzyjecie({ ...REC, batches: [{ ...REC.batches[0], kg_available: 0 }] }, RODZAJE, {})
    expect(z.stan).toBe('rozliczona')
    expect(z.kgLeft).toBe(0)
  })
  it('brak masy w dokumencie — brak różnicy, nie „−6000”', () => {
    expect(roznicaKg({ ...p, docKg: null })).toBeNull()
  })
})

describe('stanHaccp', () => {
  const p = mapujPrzyjecie(REC, RODZAJE, MIESO)
  const check = { receptionId: 'r1', visual: 'bz' as const, tempChamber: 2, tempMeat: 3.5, kgMatch: 'bz' as const, notes: '', verdict: 'K' as const, ncDescription: '', ncAction: '', ncAt: null }
  it('drób: próg +4 °C', () => {
    expect(stanHaccp(p, check)).toMatchObject({ status: 'komplet', ponadProg: false })
    expect(stanHaccp(p, { ...check, tempMeat: 4.5 }).ponadProg).toBe(true)
  })
  it('wołowina: próg +7 °C', () => {
    const w = mapujPrzyjecie({ ...REC, batches: [{ ...REC.batches[1], material_type_id: 'mat-wolowina-zrazowa' }] }, RODZAJE, MIESO)
    expect(stanHaccp(w, { ...check, tempMeat: 6 }).ponadProg).toBe(false)
  })
  it('brak karty = brak; niezgodność „N” wymaga działania', () => {
    expect(stanHaccp(p, undefined).status).toBe('brak')
    expect(stanHaccp(p, { ...check, visual: 'N' }).niezgodnosc).toBe(true)
  })
})

it('dniDo', () => {
  expect(dniDo('2026-11-02', new Date(2026, 9, 30, 15))).toBe(3)
  expect(dniDo('', new Date())).toBeNull()
})
