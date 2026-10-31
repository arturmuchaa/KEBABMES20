// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/**
 * Przyjęcia surowca — zapis idzie do ewidencji kg, więc testy na zamontowanych
 * komponentach z odpowiedziami w kształcie API (dane syntetyczne).
 */
const api = vi.hoisted(() => ({
  suppliers: { list: vi.fn() },
  raw: { materialTypes: vi.fn(), nextNumber: vi.fn(), cancel: vi.fn() },
  rec: { nextNumber: vi.fn(), create: vi.fn(), update: vi.fn(), byId: vi.fn(), cancel: vi.fn(), scanHdi: vi.fn() },
  checks: { get: vi.fn(), save: vi.fn() },
  sig: { forDoc: vi.fn(), eligible: vi.fn(), sign: vi.fn() },
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig() as object),
  suppliersApi: api.suppliers, rawBatchesApi: api.raw, receptionsApi: api.rec, receptionChecksApi: api.checks, signaturesApi: api.sig,
}))
import { PrzyjecieEditor } from './formularz/PrzyjecieEditor'
import { AnulujPrzyjecie } from './AnulujPrzyjecie'
import { KontrolaHaccp } from './KontrolaHaccp'
import { NumeryNaLiscie, opisNumerow } from './PrzyjeciaModule'
import { mapujPrzyjecie, mapujRodzaje } from '../../data/przyjecia'
import { dzisIso, plusDni } from './formularz/model'

const RODZAJE = [
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true, receivable: true, category: 'drob' },
  { id: 'mat-mieso-zs', name: 'Mięso z/s', requiresDeboning: false, receivable: true, category: 'drob' },
  { id: 'mat-mieso-bs', name: 'Mięso b/s', requiresDeboning: false, receivable: false, category: 'drob' },
]
const app = { toast: vi.fn(), editReception: vi.fn(), newReception: vi.fn(), setPanel: vi.fn(), prosty: true, panel: 'dol', appRef: { current: null }, scale: 1 } as unknown as AppApi
let cmds: Array<{ id: string; run?: () => void; disabled?: boolean }> = []
const run = (id: string) => cmds.find(c => c.id === id)!.run!()
const mountEditor = (receptionId?: string) => {
  const onDone = vi.fn()
  render(<AppCtx.Provider value={app}><PrzyjecieEditor tabId="t" receptionId={receptionId} active setCmds={c => { cmds = c }} onDone={onDone} /></AppCtx.Provider>)
  return { onDone }
}
const ustaw = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } })

afterEach(cleanup)
beforeEach(() => {
  for (const g of Object.values(api)) Object.values(g).forEach(f => (f as ReturnType<typeof vi.fn>).mockReset())
  ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
  api.suppliers.list.mockResolvedValue([{ id: 'sup-koko', name: 'KOKO SPÓŁKA Z O.O.', displayName: 'KOKO' }, { id: 'sup-sz', name: 'SZUMERA', displayName: '' }])
  api.raw.materialTypes.mockResolvedValue(RODZAJE)
  api.raw.nextNumber.mockResolvedValue({ suggestedBatchNo: '680' })
  api.rec.nextNumber.mockResolvedValue({ nextNo: '51/10' })
  api.rec.create.mockResolvedValue({ reception: { id: 'rec-new', reception_no: '51/10' }, batches: [{ internalBatchNo: '680', kgReceived: 3000.5 }], warnings: [] })
})

describe('Nowe przyjęcie', () => {
  it('przyjmuje dostawę przez okno potwierdzenia — DTO jak stary MES (kg z HDI z przecinkiem, pojemniki z kalibru)', async () => {
    const { onDone } = mountEditor()
    await screen.findByRole('option', { name: 'KOKO' })
    expect(screen.queryByRole('option', { name: 'Mięso b/s' })).toBeNull() // nieprzyjmowalny rodzaj
    ustaw('Dostawca', 'sup-koko')
    ustaw('Masa netto, pozycja 1', '3 000,50')
    ustaw('Nr partii, pozycja 1', '112819')
    await waitFor(() => expect(cmds.find(c => c.id === 'save')!.disabled).toBe(false))
    run('save')
    // Bez ceny stary MES nie przyjmuje (poza usługą) — ten sam komunikat.
    expect(await screen.findByText(/Podaj cenę za kg/)).toBeTruthy()
    ustaw('Cena / kg (zł)', '7,50')
    run('save')
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('KOKO')).toBeTruthy()
    expect(within(dlg).getByText('22 503,75 zł')).toBeTruthy()
    expect(api.rec.create).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: /Potwierdź/ }))
    await waitFor(() => expect(api.rec.create).toHaveBeenCalledTimes(1))
    const dto = api.rec.create.mock.calls[0][0]
    expect(dto).toMatchObject({ supplierId: 'sup-koko', materialTypeId: 'mat-cwiartka', isService: false, docKg: null, pricePerKg: 7.5 })
    expect(dto.groups).toHaveLength(1)
    expect(dto.groups[0]).toMatchObject({ kgReceived: 3000.5, containerKg: 15, containersCount: 201, internalBatchNo: undefined })
    expect(dto.groups[0].supplierBatches[0]).toMatchObject({ supplierBatchNo: '112819', kgReceived: 3000.5, expiryDate: plusDni(dzisIso(), 7) })
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('rec-new'))
  })

  it('Enter w masie ostatniej pozycji dodaje kolejną z numerem partii +1; podział na dwa numery', async () => {
    mountEditor()
    await screen.findByRole('option', { name: 'KOKO' })
    ustaw('Dostawca', 'sup-koko')
    ustaw('Nr partii, pozycja 1', '112819')
    ustaw('Masa netto, pozycja 1', '1000')
    fireEvent.keyDown(screen.getByLabelText('Masa netto, pozycja 1'), { key: 'Enter' })
    expect((screen.getByLabelText('Nr partii, pozycja 2') as HTMLInputElement).value).toBe('112820')
    ustaw('Masa netto, pozycja 2', '500')
    ustaw('Cena / kg (zł)', '7')
    fireEvent.click(screen.getByRole('button', { name: /Rozbij na kolejny numer/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Numer dla pozycji 2' })).getByRole('button', { name: '681' }))
    run('save')
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(within(dlg).getByRole('button', { name: /Potwierdź/ }))
    await waitFor(() => expect(api.rec.create).toHaveBeenCalled())
    expect(api.rec.create.mock.calls[0][0].groups.map((g: { kgReceived: number }) => g.kgReceived)).toEqual([1000, 500])
  })

  it('reguły starego MES blokują zapis (ważność przed datą przyjęcia) — bez okna i bez zapisu', async () => {
    mountEditor()
    await screen.findByRole('option', { name: 'KOKO' })
    ustaw('Dostawca', 'sup-koko')
    ustaw('Masa netto, pozycja 1', '100')
    ustaw('Cena / kg (zł)', '7')
    ustaw('Data ważności, pozycja 1', plusDni(dzisIso(), -3))
    await waitFor(() => expect(cmds.find(c => c.id === 'save')!.disabled).toBe(false))
    run('save')
    expect(await screen.findByText(/Nie można przyjąć/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.rec.create).not.toHaveBeenCalled()
  })
})

describe('Edycja przyjęcia', () => {
  const DOK = {
    id: 'rec-1', receptionNo: '50/10', receivedDate: '2026-10-30', supplierId: 'sup-koko', documentNo: '', hdiNo: '35469', notes: '', isService: false,
    batches: [
      { id: 'b1', internalBatchNo: '679', materialTypeId: 'mat-cwiartka', kgReceived: 6000, pricePerKg: 7, containerKg: 15, containersCount: 401, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', frozenReason: '',
        supplierBatches: [{ supplierBatchNo: 'A1', kgReceived: 6000, slaughterDate: '2026-10-29', expiryDate: '2026-11-05' }] },
      { id: 'b2', internalBatchNo: '680', materialTypeId: 'mat-cwiartka', kgReceived: 4005, containerKg: 15, containersCount: null, slaughterDate: '2026-10-29', expiryDate: '2026-11-05', frozenReason: 'Partia poszła na rozbiór',
        supplierBatches: [{ supplierBatchNo: 'A2', kgReceived: 4005, slaughterDate: '2026-10-29', expiryDate: '2026-11-05' }] },
    ],
  }
  it('pozycje numeru użytego w produkcji są zablokowane; zapis bez okna, z id partii i bez numerów', async () => {
    api.rec.byId.mockResolvedValue(DOK)
    api.rec.update.mockResolvedValue({})
    const { onDone } = mountEditor('rec-1')
    expect(await screen.findByText(/Część numerów jest już użyta/)).toBeTruthy()
    expect((screen.getByLabelText('Masa netto, pozycja 2') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Dostawca') as HTMLSelectElement).disabled).toBe(true)
    ustaw('Masa netto, pozycja 1', '5990')
    run('save')
    await waitFor(() => expect(api.rec.update).toHaveBeenCalledTimes(1))
    const [id, dto] = api.rec.update.mock.calls[0]
    expect(id).toBe('rec-1')
    expect(dto.groups.map((g: { batchId?: string; kgReceived: number; internalBatchNo?: string }) => [g.batchId, g.kgReceived, g.internalBatchNo])).toEqual([['b1', 5990, undefined], ['b2', 4005, undefined]])
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('rec-1'))
  })
})

const RAW_REC = (b2: Record<string, unknown> = {}) => ({
  id: 'rec-1', reception_no: '50/10', reception_seq: 50, received_date: '2026-10-30', supplier_id: 'sup-koko', supplier_name: 'KOKO SP. Z O.O.', hdi_no: '35469',
  batches: [
    { id: 'b1', internal_batch_no: '679', material_type_id: 'mat-cwiartka', material_name: 'Ćwiartka z kurczaka', kg_received: 6000, kg_available: 6000, status: 'available', expiry_date: '2099-01-01', requires_deboning: true },
    { id: 'b2', internal_batch_no: '680', material_type_id: 'mat-cwiartka', material_name: 'Ćwiartka z kurczaka', kg_received: 4000, kg_available: 2500, status: 'available', expiry_date: '2099-01-01', requires_deboning: true, ...b2 },
  ],
})
const przyjecie = (b2?: Record<string, unknown>) => mapujPrzyjecie(RAW_REC(b2), mapujRodzaje([]), {})

describe('Lista przyjęć — numery porządkowe', () => {
  it('każdy numer z kilogramami w wierszu; dymek z surowcem i tym, co zostało na stanie', () => {
    const p = przyjecie()
    render(<table><tbody><tr><td><NumeryNaLiscie p={p} /></td></tr></tbody></table>)
    const zwykle = (t: string | null | undefined) => (t ?? '').replace(/\u00a0/g, ' ') // kg mają twardą spację w tysiącach
    expect(zwykle(screen.getByText('679').parentElement!.textContent)).toBe('6796 000 kg')
    expect(zwykle(screen.getByText('680').parentElement!.textContent)).toBe('6804 000 kg')
    expect(zwykle(opisNumerow(p))).toBe('679 · Ćwiartka z kurczaka · przyjęto 6 000 kg · na stanie 6 000 kg\n680 · Ćwiartka z kurczaka · przyjęto 4 000 kg · na stanie 2 500 kg')
  })
})

describe('Anulowanie przyjęcia', () => {
  it('pokazuje tożsamość dostawy; całej nie da się anulować, gdy numer poszedł na rozbiór — nietknięty numer tak', async () => {
    api.raw.cancel.mockResolvedValue({})
    const onDone = vi.fn()
    render(<AppCtx.Provider value={app}><AnulujPrzyjecie p={przyjecie()} supplier="KOKO" onClose={vi.fn()} onDone={onDone} /></AppCtx.Provider>)
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText('KOKO')).toBeTruthy()
    expect((within(dlg).getByRole('button', { name: /Anuluj całą dostawę/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dlg).getByText('część poszła na rozbiór')).toBeTruthy()
    expect((within(dlg).getByRole('button', { name: 'Anuluj nr 680' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Anuluj nr 679' }))
    await waitFor(() => expect(api.raw.cancel).toHaveBeenCalledWith('b1'))
    expect(api.rec.cancel).not.toHaveBeenCalled()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
  it('nietknięta dostawa — anulowanie całego dokumentu jednym wywołaniem; odmowa serwera widoczna', async () => {
    api.rec.cancel.mockRejectedValue(new Error('Numer 680 jest już użyty w rozbiorze'))
    render(<AppCtx.Provider value={app}><AnulujPrzyjecie p={przyjecie({ kg_available: 4000 })} supplier="KOKO" onClose={vi.fn()} onDone={vi.fn()} /></AppCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj całą dostawę (2 nr)' }))
    await waitFor(() => expect(api.rec.cancel).toHaveBeenCalledWith('rec-1'))
    expect(await screen.findByText(/Numer 680 jest już użyty/)).toBeTruthy()
  })
})

describe('Kontrola HACCP', () => {
  beforeEach(() => {
    api.checks.get.mockResolvedValue({ receptionId: 'rec-1', required: true, visual: null, tempChamber: null, tempMeat: null, kgMatch: null, notes: '', verdict: null, ncDescription: '', ncAction: '', ncAt: null })
    api.sig.forDoc.mockResolvedValue([])
  })
  it('przecinek w temperaturze nie znika („2,” → 2,3 °C, nie 23 °C); niezapisana zmiana blokuje podpis', async () => {
    api.checks.save.mockImplementation((_id: string, d: Record<string, unknown>) => Promise.resolve({ receptionId: 'rec-1', ...d }))
    render(<AppCtx.Provider value={app}><KontrolaHaccp receptionId="rec-1" category="drob" storageState="chlodzony" /></AppCtx.Provider>)
    const meat = await screen.findByLabelText('Temperatura mięsa [°C] (h)') as HTMLInputElement
    fireEvent.change(meat, { target: { value: '2,' } })
    expect(meat.value).toBe('2,')
    fireEvent.change(meat, { target: { value: '2,3' } })
    expect(meat.value).toBe('2,3')
    fireEvent.click(within(screen.getByRole('group', { name: /Ocena całej dostawy/ })).getByRole('button', { name: /K — przyjęta/ }))
    expect((screen.getAllByRole('button', { name: /^Podpisz$/ })[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Zapisz kontrolę/ }))
    await waitFor(() => expect(api.checks.save).toHaveBeenCalledTimes(1))
    expect(api.checks.save.mock.calls[0][1]).toMatchObject({ tempMeat: 2.3, tempChamber: null, verdict: 'K' })
    await waitFor(() => expect((screen.getAllByRole('button', { name: /^Podpisz$/ })[0] as HTMLButtonElement).disabled).toBe(false))
  })
  it('temperatura ponad próg jest ostrzeżeniem, nie blokadą zapisu; podpis wymaga osoby i PIN-u', async () => {
    api.checks.save.mockImplementation((_id: string, d: Record<string, unknown>) => Promise.resolve({ receptionId: 'rec-1', ...d }))
    api.sig.eligible.mockResolvedValue([{ id: 'w1', name: 'Jan K.', png: '' }])
    api.sig.sign.mockResolvedValue({})
    render(<AppCtx.Provider value={app}><KontrolaHaccp receptionId="rec-1" category="drob" storageState="chlodzony" /></AppCtx.Provider>)
    fireEvent.change(await screen.findByLabelText('Temperatura mięsa [°C] (h)'), { target: { value: '5' } })
    expect(screen.getByText(/przekracza próg/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Zapisz kontrolę/ }))
    await waitFor(() => expect(api.checks.save).toHaveBeenCalled())
    await waitFor(() => expect((screen.getAllByRole('button', { name: /^Podpisz$/ })[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getAllByRole('button', { name: /^Podpisz$/ })[0])
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('option', { name: /Jan K\./ }))
    fireEvent.change(within(dlg).getByLabelText(/PIN podpisującego/), { target: { value: '1234' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Podpisz' }))
    await waitFor(() => expect(api.sig.sign).toHaveBeenCalledWith({ docType: 'reception_check', docId: 'rec-1', role: 'wykonal', workerId: 'w1', pin: '1234' }))
  })
})
