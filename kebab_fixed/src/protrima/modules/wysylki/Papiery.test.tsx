// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

const zapis = vi.hoisted(() => vi.fn(async (_u: string, n: string) => ({ nazwa: n.toUpperCase(), sciezka: `C:\\Users\\biuro\\Downloads\\${n.toUpperCase()}` })))
const otworz = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const druk = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/lib/api', async orig => ({ ...(await orig() as object), zapiszDokumentPdf: zapis, downloadDocPdf: otworz }))
vi.mock('./kurs', async orig => ({ ...(await orig() as object), drukujZaznaczone: druk }))
import { PapierChip, ZapiszZaznaczone, DrukujZaznaczone, useZaznaczonePapiery, zapiszPapiery, type ZaznaczonePapiery } from './Papiery'
import type { PapierKursu } from './kurs'

const PAPIERY: PapierKursu[] = [
  { key: 'wz-1', etykieta: 'WZ', numer: 'WZ/1/11/26', url: '/api/wz/1/pdf', plik: 'wz_1.pdf' },
  { key: 'hdi-2', etykieta: 'HDI', numer: '2/11/26', url: '/api/hdi/2/pdf', plik: 'hdi_2.pdf' },
  { key: 'cmr-3', etykieta: 'CMR na drogę', numer: '3/11/26', url: '/api/cmr/3/pdf', plik: 'cmr_3.pdf' },
]
const toast = vi.fn()
const app = { toast } as unknown as AppApi
afterEach(() => { cleanup(); vi.clearAllMocks() })

function Ekran() {
  const z: ZaznaczonePapiery = useZaznaczonePapiery(PAPIERY, 'Zestaw')
  return <>{PAPIERY.map(p => <PapierChip key={p.key} p={p} z={z} />)}<ZapiszZaznaczone z={z} /><DrukujZaznaczone z={z} /></>
}

describe('Zapisz zaznaczone PDF', () => {
  it('każdy zaznaczony dokument w osobnym pliku, bez okna druku; komunikat z folderem i nazwami', async () => {
    render(<AppCtx.Provider value={app}><Ekran /></AppCtx.Provider>)
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: WZ WZ/1/11/26'))
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: CMR na drogę 3/11/26'))
    fireEvent.click(screen.getByRole('button', { name: /Zapisz zaznaczone PDF \(2\)/ }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Zapisano 2 pliki PDF' })))
    expect(zapis.mock.calls.map(c => c[0])).toEqual(['/api/wz/1/pdf', '/api/cmr/3/pdf'])
    expect(toast.mock.calls[0][0].detail).toBe('C:\\Users\\biuro\\Downloads: WZ_1.PDF, CMR_3.PDF')
    expect(druk).not.toHaveBeenCalled()
  })

  it('błąd jednego dokumentu nie zatrzymuje pozostałych', async () => {
    zapis.mockRejectedValueOnce(new Error('HTTP 500'))
    const n = await zapiszPapiery(PAPIERY, { toast })
    expect(n).toBe(2)
    expect(zapis).toHaveBeenCalledTimes(3)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warn', title: 'Nie udało się zapisać WZ WZ/1/11/26' }))
  })

  it('drukowanie zaznaczonych dalej idzie przez okno druku', async () => {
    render(<AppCtx.Provider value={app}><Ekran /></AppCtx.Provider>)
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: HDI 2/11/26'))
    fireEvent.click(screen.getByRole('button', { name: /Drukuj zaznaczone \(1\)/ }))
    await waitFor(() => expect(druk).toHaveBeenCalled())
    expect(zapis).not.toHaveBeenCalled()
  })
})
