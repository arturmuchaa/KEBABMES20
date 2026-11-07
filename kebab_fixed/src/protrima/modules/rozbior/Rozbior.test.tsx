// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Rozbiór — korekty biura. Dane w kształcie odpowiedzi serwera (prod 07.11.2026: RAJA 5 → IVAN 8). */
const api = vi.hoisted(() => ({
  panel: vi.fn(), listByBatch: vi.fn(), deleted: vi.fn(), correct: vi.fn(), officeDelete: vi.fn(), restore: vi.fn(), corrections: vi.fn(),
}))
const ludzie = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), deboningEntriesApi: api, usersApi: ludzie }))
import { RozbiorModule } from './RozbiorModule'
import { akcjeWpisu, bilansWpisu, mapujWpis, opisKorekty, pracownicyRozbioru } from './model'

const PARTIA = { rawBatchId: 'rb694', batchNo: '694', supplierName: 'KOKO', materialName: 'Ćwiartka', status: 'active', kgReceived: 9000, kgAvailable: 4500,
  entriesCount: 2, pendingCount: 1, kgQuarter: 450, kgMeat: 295, backsKg: 81, bonesKg: 72, balancePct: 99.6, firstAt: '2026-11-07T05:22:00Z', lastAt: '2026-11-07T07:52:00Z' }
const ROZLICZONY = { id: 'e1', rawBatchNo: '694', workerId: 'w-raja', workerName: 'RAJA 5', kgTaken: 150, kgMeat: 97.5, kgBacks: 28, kgBones: 24, yieldPct: 65,
  status: 'complete', settlementStage: 'done', completedAt: '2026-11-07T06:42:00Z', createdAt: '2026-11-07T06:30:00Z' }
const W_TOKU = { id: 'e2', rawBatchNo: '694', workerId: 'w-oleh', workerName: 'OLEH 4', kgTaken: 150, kgMeat: 0, kgBacks: 0, kgBones: 0, yieldPct: 0,
  status: 'pending', settlementStage: 'bones', completedAt: null, createdAt: '2026-11-07T07:52:00Z' }
const STARY = { ...ROZLICZONY, id: 'e3', settlementStage: null, kgBacks: 0, kgBones: 0 }
const USUNIETY = { id: 'c1', entryId: 'e9', deletedAt: '2026-11-07T07:38:00Z', bySubject: 'MARCIN', reason: 'Usunięte na hali kodem serwisowym',
  workerName: 'RAJA 5', rawBatchNo: '694', sessionNo: 'ROZ/07/11/26/13', kgQuarter: 150, kgMeat: 97.5, kgBacks: 28, kgBones: 24,
  settlement: true, workDate: '2026-11-07', restoredEntryId: null, restoredWorkerName: null, restorable: true }
const PRACOWNICY = [
  { id: 'w-raja', name: 'RAJA 5', role: 'WORKER_DEBONING', active: true },
  { id: 'w-ivan', name: 'IVAN 8', role: 'WORKER_DEBONING', active: true },
  { id: 'w-ivan-m', name: 'IVAN MIESZANIE', role: 'WORKER_PRODUCTION', active: true },
]

describe('Rozbiór — logika', () => {
  it('stan i akcje: rozliczony per pracownik → zmiana pracownika tak, kg tylko waga; w toku → nic poza usunięciem', () => {
    const r = mapujWpis(ROZLICZONY), t = mapujWpis(W_TOKU), s = mapujWpis(STARY)
    expect([r.stan, t.stan, s.stan]).toEqual(['rozliczony', 'w_rozliczeniu', 'rozliczony'])
    expect(akcjeWpisu(r)).toMatchObject({ zmienPracownika: true, poprawKg: expect.stringMatching(/waga/) })
    expect(akcjeWpisu(t).zmienPracownika).toMatch(/rozliczane na hali/)
    expect(akcjeWpisu(s)).toMatchObject({ zmienPracownika: true, poprawKg: true })
    expect(bilansWpisu(r)).toBeCloseTo(99.67, 1)
    expect(bilansWpisu(s)).toBeNull()
  })
  it('historia: zmiana pracownika, usunięcie, przywrócenie, wyjątek tolerancji — każdy po ludzku', () => {
    expect(opisKorekty({ worker: { from: 'RAJA 5', to: 'IVAN 8' } })).toBe('pracownik: RAJA 5 → IVAN 8')
    expect(opisKorekty({ kgMeat: { from: 97, to: 97.5 } })).toBe('mięso: 97 kg → 97,5 kg')
    expect(opisKorekty({ usuniety: { worker: 'RAJA 5', kgQuarter: 150, kgMeat: 97.5 } })).toBe('usunięty: RAJA 5, ćwiartka 150 kg, mięso 97,5 kg')
    expect(opisKorekty({ przywrocony: { fromWorker: 'RAJA 5', toWorker: 'IVAN 8' } })).toMatch(/RAJA 5 → IVAN 8/)
    expect(opisKorekty({ differenceKg: -4.2 })).toMatch(/kodem kierownika/)
  })
  it('do wyboru tylko pracownicy rozbioru (jak na hali); obecny zostaje nawet spoza listy', () => {
    expect(pracownicyRozbioru(PRACOWNICY).map(u => u.name)).toEqual(['IVAN 8', 'RAJA 5'])
    expect(pracownicyRozbioru(PRACOWNICY, { id: 'w-stary', name: 'ZWOLNIONY' })[0]).toEqual({ id: 'w-stary', name: 'ZWOLNIONY' })
  })
})

describe('Rozbiór — ekran', () => {
  const app = { toast: vi.fn() } as unknown as AppApi
  const mount = () => render(<AppCtx.Provider value={app}><RozbiorModule active setCtx={vi.fn()} setCmds={vi.fn()} /></AppCtx.Provider>)
  afterEach(cleanup)
  beforeEach(() => {
    Object.values(api).forEach(f => f.mockReset()); ludzie.list.mockReset(); (app.toast as ReturnType<typeof vi.fn>).mockClear()
    api.panel.mockResolvedValue([PARTIA]); api.listByBatch.mockResolvedValue([ROZLICZONY, W_TOKU]); api.deleted.mockResolvedValue([USUNIETY])
    api.corrections.mockResolvedValue([]); ludzie.list.mockResolvedValue(PRACOWNICY)
    api.correct.mockResolvedValue({}); api.officeDelete.mockResolvedValue({ ok: true }); api.restore.mockResolvedValue({})
  })

  it('zmiana pracownika w rozliczonym pobraniu: tylko rozbiorowcy, powód wymagany, wysyła samego pracownika (bez kg)', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Partia 694' }))
    const wpis = await screen.findByLabelText('Wpis RAJA 5')
    expect(within(wpis).getByText('28 kg')).toBeTruthy()
    expect((within(screen.getByLabelText('Wpis OLEH 4')).getByRole('button', { name: /Zmień pracownika/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(wpis).queryByRole('button', { name: /Popraw kg/ })).toBeNull() // kg rozliczonego pobrania — tylko waga
    fireEvent.click(within(wpis).getByRole('button', { name: /Zmień pracownika/ }))
    const dlg = await screen.findByRole('dialog')
    const sel = within(dlg).getByLabelText('Nowy pracownik') as HTMLSelectElement
    expect([...sel.options].map(o => o.text)).toEqual(['IVAN 8', 'RAJA 5 (obecny)'])
    fireEvent.change(sel, { target: { value: 'w-ivan' } })
    const zapisz = within(dlg).getByRole('button', { name: 'Przenieś na IVAN 8' }) as HTMLButtonElement
    expect(zapisz.disabled).toBe(true)
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'pobranie na złym pracowniku' } })
    fireEvent.click(zapisz)
    await waitFor(() => expect(api.correct).toHaveBeenCalledWith('e1', { workerId: 'w-ivan', reason: 'pobranie na złym pracowniku' }))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wpis przeniesiony na IVAN 8' })))
    expect(api.listByBatch).toHaveBeenCalledTimes(2) // po zapisie wpisy partii wczytane od nowa
  })

  it('odmowa serwera zostaje w oknie jego słowami', async () => {
    api.correct.mockImplementation(() => Promise.reject(new Error('Dzień wpisu jest już rozliczony w wypłacie pracownika RAJA 5 — najpierw cofnij to rozliczenie')))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Partia 694' }))
    fireEvent.click(within(await screen.findByLabelText('Wpis RAJA 5')).getByRole('button', { name: /Zmień pracownika/ }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('Nowy pracownik'), { target: { value: 'w-ivan' } })
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'zły pracownik' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Przenieś na IVAN 8' }))
    expect(await within(dlg).findByText(/rozliczony w wypłacie pracownika RAJA 5/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('usunięcie z powodem; usunięte wpisy: wagi, kto usunął, przywrócenie na innego pracownika', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Partia 694' }))
    fireEvent.click(within(await screen.findByLabelText('Wpis RAJA 5')).getByRole('button', { name: /Usuń/ }))
    let dlg = await screen.findByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'wpis testowy' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Usuń wpis' }))
    await waitFor(() => expect(api.officeDelete).toHaveBeenCalledWith('e1', 'wpis testowy'))

    fireEvent.click(screen.getByRole('button', { name: /Usunięte wpisy/ }))
    const wiersz = (await screen.findByText('MARCIN')).closest('tr') as HTMLElement
    expect(within(wiersz).getByText('97,5 kg')).toBeTruthy()
    expect(within(wiersz).getByText('24 kg')).toBeTruthy()
    fireEvent.click(within(wiersz).getByRole('button', { name: /Przywróć/ }))
    dlg = await screen.findByRole('dialog')
    expect((within(dlg).getByLabelText('Pracownik przywróconego wpisu') as HTMLSelectElement).value).toBe('w-raja')
    fireEvent.change(within(dlg).getByLabelText('Pracownik przywróconego wpisu'), { target: { value: 'w-ivan' } })
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'pobranie było na złym pracowniku' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Przywróć na IVAN 8' }))
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('e9', { workerId: 'w-ivan', reason: 'pobranie było na złym pracowniku' }))
  })

  it('przywrócony wpis pokazuje dokąd wrócił i nie da się go przywrócić drugi raz', async () => {
    api.deleted.mockResolvedValue([{ ...USUNIETY, restoredEntryId: 'e10', restoredWorkerName: 'IVAN 8', restorable: false }])
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Usunięte wpisy/ }))
    expect(await screen.findByText('przywrócony → IVAN 8')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Przywróć/ })).toBeNull()
  })
})
