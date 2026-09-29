// @vitest-environment jsdom
/**
 * Pakowanie na kiosku — to, co słyszy i widzi magazynier.
 *
 * CISZA ZNACZY DOBRZE: skan do aktywnego kartonu nie może podnieść alarmu
 * ani zagrać — inaczej 90 sztuk to 90 przerw w robocie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({
  kontenery: [] as any[],
  spakowane: [] as any[],
  mroznia: [] as string[],
  wynik: null as any,
  skany: [] as Array<[string, string | null]>,
  dzwieki: [] as string[],
  offline: false,
  cofnij: vi.fn(),
  /** Gdy ustawione — żądanie skanu sztuki czeka na zwolnienie. */
  wstrzymaj: null as Promise<void> | null,
  /** Gdy true — lookup kartki palety czeka, aż test go zwolni. */
  lookupRecznie: false,
  lookupy: [] as Array<() => void>,
}))

/** Zwalnia najstarszy czekający lookup. */
async function zwolnijLookup() {
  await waitFor(() => expect(s.lookupy.length).toBeGreaterThan(0))
  s.lookupy.shift()!()
}

vi.mock('@/lib/api', () => ({
  magazynApi: {
    pakowanie: () => s.offline ? Promise.reject(new Error('offline')) : Promise.resolve({ kontenery: s.kontenery, spakowane: s.spakowane, pula: [] }),
    cofnij: s.cofnij,
    skan: async (kod: string, akt: string | null) => {
      s.skany.push([kod, akt])
      if (s.wstrzymaj) await s.wstrzymaj
      return s.wynik
    },
    mrozniaKarton: (kod: string) => { s.mroznia.push(`karton:${kod}`); return Promise.resolve({ result: 'SUCCESS' }) },
  },
  palletsApi: { lookup: (kod: string) => {
    const wynik = () => {
      if (kod.includes('offline')) return Promise.reject(new Error('offline'))
      if (kod.includes('nieznana')) return Promise.reject(new Error('Nie znaleziono palety'))
      return Promise.resolve({ id: kod.includes('pelna') ? 'p9' : 'k3' })
    }
    if (!s.lookupRecznie) return wynik()
    // Wolny serwer: odpowiedź dopiero po `zwolnijLookup()`.
    return new Promise((res, rej) => s.lookupy.push(() => { wynik().then(res, rej) }))
  } },
  palletScanApi: { scan: (kod: string, akcja: string) => {
    s.mroznia.push(`${akcja}:${kod}`)
    return Promise.resolve({ result: 'SUCCESS', palletNo: 1 })
  } },
  isOfflineError: (e: unknown) => e instanceof Error && e.message === 'offline',
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
  s.offline = false; s.wstrzymaj = null; s.cofnij.mockReset(); s.cofnij.mockResolvedValue({ ok: true })
  s.lookupRecznie = false; s.lookupy = []
  s.kontenery = [K('k1', '000318', 'YALCIN'), K('k3', '000320', 'DEMS', 12, 20)]
  s.skany = []; s.dzwieki = []; s.spakowane = []; s.mroznia = []
  s.wynik = { result: 'ACTIVE', unit: 'YALCIN · KIRMIZI 15 kg', container: K('k1', '000318', 'YALCIN', 29) }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Ekran z prawdziwym stanem aktywnego kartonu — jak na stronie kiosku. */
function ZeStanem({ start, onAktywny, ...reszta }: Omit<Parameters<typeof EkranPakowania>[0], 'aktywnyId' | 'onAktywny'> & {
  start: string | null; onAktywny?: (id: string | null) => void
}) {
  const [id, setId] = useState<string | null>(start)
  return <EkranPakowania aktywnyId={id} onAktywny={x => { onAktywny?.(x); setId(x) }} {...reszta} />
}

function skan(kod: string) {
  const pole = screen.getByLabelText('Pole skanowania')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
}

describe('pakowanie na kiosku', () => {
  it('błąd odczytu pokazuje brak aktualnych danych zamiast zielonego zapewnienia', async () => {
    s.offline = true
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    await screen.findByText(/Brak aktualnych danych/)
    expect(screen.queryByText(/Cisza — sztuki idą/)).toBeNull()
  })

  it('wyjęcie sztuki wymaga potwierdzenia i wysyła konkretny kod oraz karton', async () => {
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan('U|unit123')
    const wyjmij = await screen.findByText('Wyjmij', { exact: true })
    await waitFor(() => expect((wyjmij as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(wyjmij)
    expect((screen.getByLabelText('Pole skanowania') as HTMLInputElement).disabled).toBe(true)
    expect(s.cofnij).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Wyjmij sztukę', { exact: true }))
    await waitFor(() => expect(s.cofnij).toHaveBeenCalledWith('U|unit123', 'k1'))
    expect(await screen.findByText('wyjęta z kartonu')).toBeTruthy()
  })
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
    expect(screen.getByTestId('polecenie-mroznia').textContent).toMatch(/Do mroźni przez kafel MROŹNIA/)
  })

  it('skan kartki pełnej palety NIE wstawia jej do mroźni — polecenie kafla MROŹNIA', async () => {
    // Właściciel 29.09.2026: do mroźni tylko przez kafel MROŹNIA, z ważeniem.
    s.kontenery = []
    s.spakowane = [{ ...K('p9', '000241', 'POLAT', 60, 60), kind: 'order', orderNo: 'POLAT/Z/2' }]
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByTestId('karton-pelny')
    skan('PAL|pelna|1')
    expect(await screen.findByText('DO MROŹNI PRZEZ KAFEL MROŹNIA')).toBeTruthy()
    expect(s.mroznia).toEqual([])
    expect(onAktywny).not.toHaveBeenCalledWith(null)
  })

  it('karta pełnego kartonu MAGAZYNOWEGO też nie wjeżdża stąd do mroźni', async () => {
    const ID = 'ac82b8f61e2545a4867b'
    s.kontenery = []
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    render(<EkranPakowania aktywnyId={ID} onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    await screen.findByTestId('karton-pelny')
    skan(`SCARTON|${ID}`)
    expect(await screen.findByText('DO MROŹNI PRZEZ KAFEL MROŹNIA')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })

  it('kartka kartonu, który już jest w mroźni — karta kartonu zamiast czerwonego alarmu', async () => {
    const ID = 'ac82b8f61e2545a4867b'
    const onKarta = vi.fn(); const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} onKartaKartonu={onKarta} />)
    await screen.findByText(/^32/)
    skan(`SCARTON|${ID}`)
    await waitFor(() => expect(onKarta).toHaveBeenCalledWith(`SCARTON|${ID}`))
    expect(onAlarm).not.toHaveBeenCalled()
  })

  it('sztuka zeskanowana jeszcze na menu jest przyjmowana po wejściu — przez kolejkę pola', async () => {
    const przejeto = vi.fn()
    render(<EkranPakowania aktywnyId={null} onAktywny={vi.fn()} onAlarm={vi.fn()}
      oczekujace={[{ nr: 1, kod: 'U|ac82b8f61e2545a4867b', ts: Date.now() }]} onPrzejeto={przejeto} />)
    await waitFor(() => expect(s.skany).toEqual([['U|ac82b8f61e2545a4867b', null]]))
    expect(przejeto).toHaveBeenCalledWith(1)
    expect(przejeto).toHaveBeenCalledOnce()
  })

  it('kilka skanów z menu idzie po kolei, każdy raz', async () => {
    let zwolnij!: () => void
    s.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()}
      oczekujace={[{ nr: 1, kod: 'U|a1', ts: 1 }, { nr: 2, kod: 'U|a2', ts: 2 }]} />)
    await waitFor(() => expect(s.skany).toEqual([['U|a1', 'k1']]))
    zwolnij()
    await waitFor(() => expect(s.skany).toEqual([['U|a1', 'k1'], ['U|a2', 'k1']]))
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
    expect(await screen.findByText('ODŁÓŻ DO KARTONU 000320')).toBeTruthy()
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

describe('kartka → sztuka i wyścigi', () => {
  const ID = 'ac82b8f61e2545a4867b'

  it('szybko „kartka, sztuka": sztuka idzie już do NOWEGO kartonu, choć ekran nie zdążył się przerysować', async () => {
    const onAktywny = vi.fn()                  // rodzic celowo NIE zmienia propsa
    render(<EkranPakowania aktywnyId="k1" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan('SCARTON|k3')
    skan('UNIT|u9')
    await waitFor(() => expect(s.skany).toEqual([['UNIT|u9', 'k3']]))
    expect(onAktywny).toHaveBeenCalledWith('k3')
  })

  it('kartka z menu i sztuka z przejścia ekranu: sztuka z id tej kartki', async () => {
    s.kontenery = [K(ID, '000318', 'YALCIN'), K('k3', '000320', 'DEMS', 12, 20)]
    render(<EkranPakowania aktywnyId={ID} onAktywny={vi.fn()} onAlarm={vi.fn()}
      ostatniaKartka={{ id: ID, kod: `SCARTON|${ID}`, ts: Date.now() }}
      oczekujace={[{ nr: 1, kod: 'U|sztuka', ts: Date.now() }]} />)
    await waitFor(() => expect(s.skany).toEqual([['U|sztuka', ID]]))
  })

  it('karta kartonu, którego nie ma — alarm, bez zapisu sztuki i bez zmiany aktywnego', async () => {
    const onAktywny = vi.fn()
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={onAktywny} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('SCARTON|ffffffffffffffffffff')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].naglowek).toBe('TEN KARTON NIE JEST OTWARTY')
    expect(onAktywny).not.toHaveBeenCalled()
    expect(s.skany).toEqual([])
  })

  it('nieznana kartka palety — alarm, bez zapisu sztuki', async () => {
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('PAL|nieznana|4')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].naglowek).toBe('NIEZNANA KARTKA')
    expect(s.skany).toEqual([])
  })

  it('kartka palety bez sieci — „nie zapisany", bez zapisu sztuki', async () => {
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('PAL|offline|4')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].naglowek).toBe('SKAN NIE ZAPISANY')
    expect(s.skany).toEqual([])
  })

  it('kolejka po odmontowaniu: wysłana sztuka kończy się, czekająca NIE leci i jest komunikat', async () => {
    let zwolnij!: () => void
    s.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    const onAlarm = vi.fn()
    const { unmount } = render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('UNIT|u1')
    await waitFor(() => expect(s.skany).toEqual([['UNIT|u1', 'k1']]))
    skan('UNIT|u2')
    unmount()
    zwolnij()
    await waitFor(() => expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'SKAN NIE ZAPISANY', ton: 'uwaga' })))
    expect(s.skany).toEqual([['UNIT|u1', 'k1']])
  })
})

describe('menu serwisowe i korekta blokują skaner', () => {
  it('menu serwisowe: pole wyłączone, skan z menu nie jest wysyłany, jest komunikat', async () => {
    const onAlarm = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} zablokowany
      oczekujace={[{ nr: 1, kod: 'U|zaplecze', ts: Date.now() }]} />)
    await screen.findByText(/^32/)
    expect((screen.getByLabelText('Pole skanowania') as HTMLInputElement).disabled).toBe(true)
    await waitFor(() => expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'SKAN NIE ZAPISANY' })))
    expect(s.skany).toEqual([])
  })

  it('otwarta korekta: skan z tła nie jest wysyłany', async () => {
    const onAlarm = vi.fn()
    const { rerender } = render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    skan('U|unit123')
    const wyjmij = await screen.findByText('Wyjmij', { exact: true })
    await waitFor(() => expect((wyjmij as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(wyjmij)
    rerender(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={onAlarm}
      oczekujace={[{ nr: 7, kod: 'U|zdialogu', ts: Date.now() }]} />)
    await waitFor(() => expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'SKAN NIE ZAPISANY' })))
    expect(s.skany.map(x => x[0])).toEqual(['U|unit123'])
  })
})

describe('pełny INNY karton: skan tylko wybiera, do mroźni przez kafel', () => {
  const ID = 'ac82b8f61e2545a4867b'

  it('pierwszy skan wybiera, kolejny skan — polecenie kafla MROŹNIA, nic nie wjeżdża', async () => {
    let teraz = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => teraz)
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    const onAktywny = vi.fn()
    render(<ZeStanem start="k1" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan(`SCARTON|${ID}`)
    expect(await screen.findByTestId('karton-pelny')).toBeTruthy()
    expect(onAktywny).toHaveBeenCalledWith(ID)
    expect(s.mroznia).toEqual([])
    expect(screen.getByTestId('polecenie-mroznia').textContent).toMatch(/kafel MROŹNIA/)
    teraz += 3000
    skan(`SCARTON|${ID}`)
    expect(await screen.findByText('DO MROŹNI PRZEZ KAFEL MROŹNIA')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })

  it('ta sama kartka odczytana zaraz drugi raz (inna wielkość liter) — nic nie wjeżdża', async () => {
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    render(<ZeStanem start="k1" onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan(`SCARTON|${ID}`)
    await screen.findByTestId('karton-pelny')
    skan(`SCARTON|${ID.toUpperCase()}`)
    expect(await screen.findByText('KARTON JEST WYBRANY')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })

  it('duplikat kartki tuż po przejściu z menu nie wstawia do mroźni', async () => {
    const ts = Date.now()
    s.kontenery = []
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    render(<EkranPakowania aktywnyId={ID} onAktywny={vi.fn()} onAlarm={vi.fn()}
      ostatniaKartka={{ id: ID, kod: `SCARTON|${ID}`, ts }}
      oczekujace={[{ nr: 1, kod: `SCARTON|${ID.toUpperCase()}`, ts: ts + 300 }]} />)
    expect(await screen.findByText('KARTON JEST WYBRANY')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })

  it('pełny AKTYWNY karton wybrany z menu: skan w polu w oknie powtórki też nic nie zapisuje', async () => {
    const ts = Date.now()
    s.kontenery = []
    s.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    render(<EkranPakowania aktywnyId={ID} onAktywny={vi.fn()} onAlarm={vi.fn()}
      ostatniaKartka={{ id: ID, kod: `SCARTON|${ID}`, ts }} />)
    await screen.findByTestId('karton-pelny')
    skan(`SCARTON|${ID}`)
    expect(await screen.findByText('KARTON JEST WYBRANY')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })
})

describe('czytelność pakowania', () => {
  it('komplet sztuk w otwartym kartonie: zielony tekst, nie sam kolor', async () => {
    s.kontenery = [K('k1', '000318', 'YALCIN', 60, 60)]
    render(<EkranPakowania aktywnyId="k1" onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    expect((await screen.findByTestId('komplet')).textContent).toMatch(/KOMPLET/)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('bez kartonu: prosta instrukcja QR zamiast technicznego opisu', async () => {
    render(<EkranPakowania aktywnyId={null} onAktywny={vi.fn()} onAlarm={vi.fn()} />)
    expect(await screen.findByText('Zeskanuj QR z kartki kartonu — otworzę jego pakowanie')).toBeTruthy()
    expect(screen.queryByText(/panel mógł milczeć/)).toBeNull()
  })
})

// Review 28.09.2026 (Chromium, prawdziwe klawisze + mock API): kartka czekała
// na lookup, operator wyszedł z ekranu, a stary callback i tak wysłał NOWY
// POST mroźni. Żądanie już wysłane może się skończyć — nowe już nie.
describe('kartka czekająca na serwer, a ekran się zmienił', () => {
  const PELNA = () => ({ ...K('p9', '000241', 'POLAT', 60, 60), kind: 'order', orderNo: 'POLAT/Z/2' })

  it('wolny lookup + Wstecz (odmontowanie): brak POST mroźni, brak zmiany aktywnego, uczciwy komunikat', async () => {
    s.kontenery = []
    s.spakowane = [PELNA()]
    s.lookupRecznie = true
    const onAktywny = vi.fn()
    const onAlarm = vi.fn()
    const { unmount } = render(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={onAlarm} />)
    await screen.findByTestId('karton-pelny')
    skan('PAL|pelna|1')
    await waitFor(() => expect(s.lookupy.length).toBe(1))
    unmount()
    await zwolnijLookup()
    await waitFor(() => expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'SKAN PRZERWANY' })))
    expect(onAlarm.mock.calls[0][0].szczegol).toMatch(/Nic nie zapisano/)
    expect(s.mroznia).toEqual([])
    expect(onAktywny).not.toHaveBeenCalled()
  })

  it('wolny lookup + menu serwisowe (potem zamknięte): skan zostaje unieważniony, brak POST', async () => {
    s.kontenery = []
    s.spakowane = [PELNA()]
    s.lookupRecznie = true
    const onAktywny = vi.fn()
    const onAlarm = vi.fn()
    const { rerender } = render(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={onAlarm} />)
    await screen.findByTestId('karton-pelny')
    skan('PAL|pelna|1')
    await waitFor(() => expect(s.lookupy.length).toBe(1))
    rerender(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={onAlarm} zablokowany />)
    rerender(<EkranPakowania aktywnyId="p9" onAktywny={onAktywny} onAlarm={onAlarm} />)   // serwis zamknięty
    await zwolnijLookup()
    await waitFor(() => expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'SKAN PRZERWANY' })))
    expect(s.mroznia).toEqual([])
    expect(onAktywny).not.toHaveBeenCalled()
  })

  it('wolny lookup + ręczny wybór z listy: wygrywa wybór ręczny, brak POST', async () => {
    s.spakowane = [PELNA()]
    s.lookupRecznie = true
    const onAktywny = vi.fn()
    render(<ZeStanem start="p9" onAktywny={onAktywny} onAlarm={vi.fn()} />)
    await screen.findByTestId('karton-pelny')
    skan('PAL|pelna|1')
    await waitFor(() => expect(s.lookupy.length).toBe(1))
    fireEvent.click(screen.getByRole('tab', { name: /Inne kartony/ }))
    fireEvent.click(screen.getByText('DEMS').closest('button')!)
    expect(onAktywny).toHaveBeenLastCalledWith('k3')
    await zwolnijLookup()
    await new Promise(r => setTimeout(r, 30))
    expect(s.mroznia).toEqual([])
    expect(onAktywny).toHaveBeenLastCalledWith('k3')
    expect(screen.getByTestId('karton-aktywny')).toBeTruthy()
  })

  it('karton spoza pamięci, a odświeżenie nie doszło (offline): brak danych, nie „zamknięty"', async () => {
    const onAlarm = vi.fn()
    const onAktywny = vi.fn()
    render(<EkranPakowania aktywnyId="k1" onAktywny={onAktywny} onAlarm={onAlarm} />)
    await screen.findByText(/^32/)
    s.offline = true
    skan('SCARTON|ffffffffffffffffffff')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].naglowek).toBe('BRAK AKTUALNYCH DANYCH')
    expect(onAlarm.mock.calls[0][0].szczegol).toMatch(/brak połączenia/)
    expect(onAlarm.mock.calls.map(c => c[0].naglowek)).not.toContain('TEN KARTON NIE JEST OTWARTY')
    expect(onAktywny).not.toHaveBeenCalled()
    expect(s.mroznia).toEqual([])
  })
})

describe('duplikat kartki pełnego kartonu przy wolnym serwerze', () => {
  it('liczy się chwila ODCZYTU: druga forma tej samej kartki to powtórka; kolejny skan — polecenie kafla', async () => {
    let teraz = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => teraz)
    s.spakowane = [{ ...K('p9', '000241', 'POLAT', 60, 60), kind: 'order', orderNo: 'POLAT/Z/2' }]
    s.lookupRecznie = true
    render(<ZeStanem start="k1" onAlarm={vi.fn()} />)
    await screen.findByText(/^32/)
    skan('PAL|pelna|1')                                   // odczyt t0
    teraz += 300
    skan(']Q1PAL|pelna|1')                                // ta sama kartka, inna forma, t0+300
    teraz += 5000                                         // wolny lookup pierwszej
    await zwolnijLookup()
    expect(await screen.findByTestId('karton-pelny')).toBeTruthy()   // tylko wybór
    teraz += 3000                                         // wolny lookup drugiej
    await zwolnijLookup()
    expect(await screen.findByText('KARTON JEST WYBRANY')).toBeTruthy()
    expect(s.mroznia).toEqual([])
    // Kolejny skan AKTYWNEGO pełnego po oknie → tylko polecenie kafla MROŹNIA.
    s.lookupRecznie = false
    teraz += 3000
    skan('PAL|pelna|1')
    expect(await screen.findByText('DO MROŹNI PRZEZ KAFEL MROŹNIA')).toBeTruthy()
    expect(s.mroznia).toEqual([])
  })
})
