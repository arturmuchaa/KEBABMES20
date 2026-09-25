// @vitest-environment jsdom
/**
 * Pakowanie na kiosku — to, co słyszy i widzi magazynier.
 *
 * CISZA ZNACZY DOBRZE: skan do aktywnego kartonu nie może podnieść alarmu
 * ani zagrać — inaczej 90 sztuk to 90 przerw w robocie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({
  kontenery: [] as any[],
  spakowane: [] as any[],
  mroznia: [] as string[],
  wynik: null as any,
  skany: [] as Array<[string, string | null]>,
  dzwieki: [] as string[],
}))

vi.mock('@/lib/api', () => ({
  magazynApi: {
    pakowanie: () => Promise.resolve({ kontenery: s.kontenery, spakowane: s.spakowane, pula: [] }),
    skan: (kod: string, akt: string | null) => { s.skany.push([kod, akt]); return Promise.resolve(s.wynik) },
    mrozniaKarton: (kod: string) => { s.mroznia.push(`karton:${kod}`); return Promise.resolve({ result: 'SUCCESS' }) },
  },
  palletsApi: { lookup: (kod: string) => Promise.resolve({ id: kod.includes('pelna') ? 'p9' : 'k3' }) },
  palletScanApi: { scan: (kod: string, akcja: string) => {
    s.mroznia.push(`${akcja}:${kod}`)
    return Promise.resolve({ result: 'SUCCESS', palletNo: 1 })
  } },
  isOfflineError: () => false,
}))
vi.mock('./dzwiek', () => ({
  grajInny: () => s.dzwieki.push('inny'),
  grajBlad: () => s.dzwieki.push('blad'),
}))

import { EkranPakowania } from './EkranPakowania'

const K = (id: string, nr: string, klient: string, packed = 28, target = 60) => ({
  kind: 'stock', id, cartonNo: nr, clientName: klient, orderNo: '', palletNo: 0,
  deliveryDate: '', openedAt: '', targetQty: target, packedQty: packed,
  lines: [{ productTypeName: 'UDO 100%', recipeName: 'KIRMIZI', packagingName: 'METAL 80',
            kgPerUnit: 15, targetQty: target, packedQty: packed }],
})

beforeEach(() => {
  s.kontenery = [K('k1', '000318', 'YALCIN'), K('k3', '000320', 'DEMS', 12, 20)]
  s.skany = []; s.dzwieki = []; s.spakowane = []; s.mroznia = []
  s.wynik = { result: 'ACTIVE', unit: 'YALCIN · KIRMIZI 15 kg', container: K('k1', '000318', 'YALCIN', 29) }
})
afterEach(cleanup)

function skan(kod: string) {
  const pole = screen.getByLabelText('Pole skanowania')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
}

describe('pakowanie na kiosku', () => {
  it('„brakuje" aktywnego kartonu jest na ekranie', async () => {
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    expect(await screen.findByText(/^32/)).toBeTruthy()          // 60 − 28
    expect(screen.getByText('YALCIN')).toBeTruthy()
  })

  it('najpierw sztuki, potem kilogramy: 28/60 szt i 420/900 kg', async () => {
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    expect(screen.getByTestId('kg-kartonu').textContent).toMatch(/420\/900/)
  })

  it('karton mieszany rozpisany per pozycja: „20 × 30 kg KIRMIZI", „3 × 30 kg BEYAZ"', async () => {
    const m = K('k1', '000240', 'YALCIN', 0, 23)
    m.lines = [
      { productTypeName: 'UDO 100%', recipeName: 'KIRMIZI', packagingName: 'METAL 80', kgPerUnit: 30, targetQty: 20, packedQty: 5 },
      { productTypeName: 'UDO 100%', recipeName: 'BEYAZ', packagingName: 'METAL 80', kgPerUnit: 30, targetQty: 3, packedQty: 3 },
    ]
    s.kontenery = [m]
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    const wiersze = await screen.findAllByTestId('pozycja-kartonu')
    expect(wiersze.map(w => w.textContent?.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/^20 × 30 kg\s?KIRMIZI.*5\/20\s?brakuje 15$/),
      expect.stringMatching(/^3 × 30 kg\s?BEYAZ.*3\/3\s?komplet$/),
    ])
  })

  it('pełny karton robi się ZIELONY z poleceniem mroźni', async () => {
    s.kontenery = []
    s.spakowane = [{ ...K('p9', '000241', 'POLAT', 60, 60), kind: 'order', orderNo: 'POLAT/Z/2' }]
    render(<EkranPakowania aktywnyId="p9" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    expect(await screen.findByTestId('karton-pelny')).toBeTruthy()
    expect(screen.getByTestId('polecenie-mroznia').textContent).toMatch(/Zeskanuj kartkę i wjedź do mroźni/)
  })

  it('skan kartki pełnej palety wstawia ją do mroźni', async () => {
    s.kontenery = []
    s.spakowane = [{ ...K('p9', '000241', 'POLAT', 60, 60), kind: 'order', orderNo: 'POLAT/Z/2' }]
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByTestId('karton-pelny')
    skan('PAL|pelna|1')
    expect(await screen.findByTestId('w-mrozni')).toBeTruthy()
    expect(s.mroznia).toEqual(['cold_storage:PAL|pelna|1'])
    expect(onAktywny).toHaveBeenCalledWith(null)
  })

  it('karta pełnego kartonu MAGAZYNOWEGO też wstawia go do mroźni i znika z pakowania', async () => {
    const ID = 'ac82b8f61e2545a4867b'
    s.kontenery = []
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId={ID} onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByTestId('karton-pelny')
    skan(`SCARTON|${ID}`)
    expect(await screen.findByTestId('w-mrozni')).toBeTruthy()
    expect(s.mroznia).toEqual([`karton:SCARTON|${ID}`])
    expect(onAktywny).toHaveBeenCalledWith(null)
  })

  it('sztuka zeskanowana jeszcze na menu jest przyjmowana po wejściu', async () => {
    const zuzyty = vi.fn()
    render(<EkranPakowania aktywnyId={null} onAktywny={vi.fn()} onAlarm={vi.fn()}
      pierwszySkan="U|ac82b8f61e2545a4867b" onPierwszySkan={zuzyty} />)
    await waitFor(() => expect(s.skany).toEqual([['U|ac82b8f61e2545a4867b', null]]))
    expect(zuzyty).toHaveBeenCalledOnce()
  })

  it('sztuka do aktywnego: cisza — bez alarmu i bez dźwięku', async () => {
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('UNIT|u1')
    await waitFor(() => expect(s.skany).toEqual([['UNIT|u1', 'k1']]))
    expect(onAlarm).not.toHaveBeenCalled()
    expect(s.dzwieki).toEqual([])
  })

  it('sztuka innego klienta: krótki ton i bursztyn z numerem kartonu', async () => {
    s.wynik = { result: 'OTHER', unit: 'DEMS · YAPRAK 25 kg', container: K('k3', '000320', 'DEMS', 13, 20) }
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan('UNIT|u2')
    expect(await screen.findByText('POSZŁA DO INNEGO KARTONU')).toBeTruthy()
    expect(screen.getAllByText(/karton 000320/).length).toBeGreaterThan(0)
    expect(s.dzwieki).toEqual(['inny'])
    expect(onAktywny).not.toHaveBeenCalled()                    // aktywny zostaje
  })

  it('bez miejsca: czerwony alarm i ostry dźwięk', async () => {
    s.wynik = { result: 'NO_PLACE', unit: 'BULLI · KIRMIZI 10 kg', container: null }
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('UNIT|u3')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].ton).toBe('blad')
    expect(s.dzwieki).toEqual(['blad'])
  })

  it('skan karty kartonu przełącza aktywny bez zapisu sztuki', async () => {
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan('SCARTON|k3')
    await waitFor(() => expect(onAktywny).toHaveBeenCalledWith('k3'))
    expect(s.skany).toEqual([])
  })
})
