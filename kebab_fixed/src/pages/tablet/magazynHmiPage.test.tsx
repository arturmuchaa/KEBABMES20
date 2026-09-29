// @vitest-environment jsdom
/**
 * Ekran startowy kiosku magazynu — menu czynności i nawigacja.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  podsumowanie: null as any,
  kontenery: [] as any[],
  spakowane: [] as any[],
  /** Gdy ustawione — odczyt stanu pakowania czeka na zwolnienie. */
  wstrzymaj: null as Promise<void> | null,
  offline: false,
  skan: null as any,
  lookup: null as any,
  mrozniaKarton: null as any,
  wyjazd: null as any,
  otworzSerwis: null as null | (() => void),
  buildLabel: '' as string,
}))

vi.mock('@/lib/api', () => ({
  magazynApi: {
    podsumowanie: () => Promise.resolve(stan.podsumowanie),
    pakowanie: async () => {
      if (stan.wstrzymaj) await stan.wstrzymaj
      if (stan.offline) throw new Error('offline')
      return { kontenery: stan.kontenery, spakowane: stan.spakowane, pula: [] }
    },
    skan: (...a: unknown[]) => stan.skan(...a),
    mrozniaKarton: (...a: unknown[]) => stan.mrozniaKarton(...a),
    mrozniaSprawdz: (kod: string) => Promise.resolve({
      result: 'OK', status: 'cold_storage', kind: 'stock', id: 'x', code: kod, cartonNo: '000777',
      clientName: 'ZAGROS', orderNo: '', full: true, inColdStorage: true, netKg: 750, qty: 15,
      lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' }],
      batches: [{ batchNo: '290926 591', qty: 3 }, { batchNo: '290926 592', qty: 12 }], lastWeighing: null }),
    mrozniaWyjazd: (...a: unknown[]) => stan.wyjazd(...a),
  },
  vehiclesApi: { list: () => Promise.resolve([
    { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own', vehicleType: 'solo', sortOrder: 0, notes: '', active: true },
  ]) },
  palletScanApi: { inColdStorage: () => Promise.resolve([]), scan: vi.fn(), activeLoading: () => Promise.resolve([]) },
  palletsApi: { lookup: (...a: unknown[]) => stan.lookup(...a) },
  vehicleLoadingApi: { state: () => Promise.resolve(null) },
  errCode: () => '',
  isOfflineError: (e: unknown) => e instanceof Error && e.message === 'offline',
}))
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Vlad M.' }, logout: vi.fn() }),
}))
vi.mock('@/features/deboning/ServiceMenu', () => ({
  useServiceHold: (fn: () => void) => { stan.otworzSerwis = fn; return { holdProps: {} } },
  ServiceMenuModal: (p: { buildLabel: string }) => { stan.buildLabel = p.buildLabel; return null },
  serviceSections: () => ({ printer: false, signatures: false }),
}))

import { MagazynHmiPage, WERSJA_HMI } from './MagazynHmiPage'

const ID = 'ac82b8f61e2545a4867b'
const SZTUKA = 'U|0123456789abcdef0123'
const K = (id: string, nr: string, klient: string, packed = 28, target = 60) => ({
  kind: 'stock', id, cartonNo: nr, clientName: klient, orderNo: '',
  palletNo: 0, deliveryDate: '', openedAt: '', targetQty: target, packedQty: packed,
  lines: [{ productTypeName: 'UDO', recipeName: 'KIRMIZI', packagingName: 'METAL 80',
            kgPerUnit: 15, targetQty: target, packedQty: packed }] })

beforeEach(() => {
  stan.kontenery = []
  stan.spakowane = []
  stan.wstrzymaj = null
  stan.offline = false
  stan.buildLabel = ''
  stan.skan = vi.fn(async () => ({ result: 'ACTIVE', unit: 'YALCIN · KIRMIZI 15 kg', container: stan.kontenery[0] ?? null }))
  stan.lookup = vi.fn(async () => { throw new Error('Nie znaleziono') })
  stan.mrozniaKarton = vi.fn(async () => ({ result: 'SUCCESS' }))
  stan.podsumowanie = {
    kartony: { otwarte: 16, sztukDoSpakowania: 43, zalegle: 11, brakujeWKartonach: 80, doSpakowania: 14, doDokonczenia: 2,
      zaczete: [{ cartonNo: '000318', klient: 'YALCIN', packedQty: 28, targetQty: 60 }] },
    wydanie: { zamowien: 3, kg: 1840 },
    mroznia: { palet: 12 },
  }
})
afterEach(cleanup)

const wystukaj = (t: string) => { for (const ch of t) fireEvent.keyDown(document.body, { key: ch }) }
const enter = () => fireEvent.keyDown(document.body, { key: 'Enter' })
async function skanWPolu(kod: string) {
  const pole = screen.getByLabelText('Pole skanowania') as HTMLInputElement
  await waitFor(() => expect(pole.disabled).toBe(false))      // pierwszy odczyt stanu
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
}
const naPakowaniu = () => screen.findByText('Pakowanie')

describe('kiosk magazynu — menu czynności', () => {
  it('pokazuje cztery czynności rzeczownikami', async () => {
    render(<MagazynHmiPage />)
    for (const n of ['Kartony', 'Wydanie', 'Mroźnia', 'Przyjęcie']) {
      expect(screen.getByText(n)).toBeTruthy()
    }
  })

  it('pod kaflami żywy stan z serwera — zaległe podbijają kafel KARTONY', async () => {
    const { container } = render(<MagazynHmiPage />)
    expect(await screen.findByText('14')).toBeTruthy()
    expect(screen.getByText('kartonów do spakowania')).toBeTruthy()
    expect(screen.getByText(/do dokończenia: 2/)).toBeTruthy()
    expect(screen.getByText('000318 · YALCIN')).toBeTruthy()
    expect(screen.getByText(/11 szt zaległych/)).toBeTruthy()
    expect(screen.getByText(/1\s?840 kg do wydania dziś/)).toBeTruthy()
    expect(container.querySelector('[data-wariant="pilne"]')).toBeTruthy()
  })

  it('PRZYJĘCIE jest wyłączone i nie prowadzi donikąd', async () => {
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Przyjęcie').closest('button')!)
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
  })

  it('WYDANIE prowadzi do wyboru auta, Wstecz wraca do menu', async () => {
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Wydanie').closest('button')!)
    expect(await screen.findByText('SOLÓWKA')).toBeTruthy()
    expect(screen.getByText('Które auto')).toBeTruthy()
    fireEvent.click(screen.getByText(/Wstecz/))
    await waitFor(() => expect(screen.getByText('Mroźnia')).toBeTruthy())
  })

  it('KARTONY prowadzą do listy kartonów i puli', async () => {
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    expect(await screen.findByText('Otwarte kartony')).toBeTruthy()
    expect(screen.getByText('Do spakowania')).toBeTruthy()
  })

  it('menu i lista mówią wprost, co robi kartka kartonu', async () => {
    render(<MagazynHmiPage />)
    expect(screen.getByText('Zeskanuj QR z kartki kartonu — otworzę jego pakowanie')).toBeTruthy()
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    await screen.findByText('Otwarte kartony')
    expect(screen.getByText('Zeskanuj QR z kartki kartonu — otworzę jego pakowanie')).toBeTruthy()
  })
})

describe('wersja HMI widoczna jak w rozbiorze', () => {
  it('ta sama stała kompilacji na menu, na pakowaniu i w menu serwisowym', async () => {
    expect(WERSJA_HMI).toBe('HMI Magazyn · test')            // vitest.config: __MAGAZYN_VERSION__ = 'test'
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    expect(screen.getByTestId('wersja-hmi').textContent).toBe(WERSJA_HMI)
    expect(stan.buildLabel).toBe(WERSJA_HMI)
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    const odRazu = (await screen.findByText('Skanuj od razu')).closest('button')!
    await waitFor(() => expect(odRazu.disabled).toBe(false))
    fireEvent.click(odRazu)
    await naPakowaniu()
    expect(screen.getByTestId('wersja-hmi').textContent).toBe(WERSJA_HMI)
  })
})

// Właściciel 25.09.2026: „skan QR na kartce kartonu ma przenosić do pakowania
// tego kartonu — teraz muszę wejść ręcznie".
describe('skan kartki kartonu z menu', () => {
  it('otwiera pakowanie TEGO kartonu, bez dotykania ekranu', async () => {
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    await naPakowaniu()
    expect(await screen.findByText('YALCIN')).toBeTruthy()
    expect(stan.skan).not.toHaveBeenCalled()
  })

  it.each([
    ['małe litery, bez Entera', `SCARTON|${ID}`, false],
    ['CapsLock, z Enterem', `SCARTON|${ID.toUpperCase()}`, true],
    ['CapsLock, bez Entera', `SCARTON|${ID.toUpperCase()}`, false],
  ])('kartka magazynowa (%s) → następna sztuka idzie z id tego kartonu', async (_, kod, zEnterem) => {
    stan.kontenery = [K('inny', '000100', 'DEMS'), K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    wystukaj(kod)
    if (zEnterem) enter()
    await naPakowaniu()
    await screen.findByText('YALCIN')
    await skanWPolu(SZTUKA)
    await waitFor(() => expect(stan.skan).toHaveBeenCalledWith(SZTUKA, ID))
  })

  it('kartka palety PAL z prefiksem AIM i Enterem — lookup dostaje czysty kod', async () => {
    stan.kontenery = [{ ...K('pal-1', '000401', 'POLAT'), kind: 'order', orderNo: 'POLAT/Z/2', palletNo: 2 }]
    stan.lookup = vi.fn(async () => ({ id: 'pal-1' }))
    render(<MagazynHmiPage />)
    wystukaj(']Q1PAL|Zam1Ab|2')
    enter()
    await naPakowaniu()
    expect(stan.lookup).toHaveBeenCalledWith('PAL|Zam1Ab|2')
    await skanWPolu(SZTUKA)
    await waitFor(() => expect(stan.skan).toHaveBeenCalledWith(SZTUKA, 'pal-1'))
  })

  it('adres QR palety bez Entera — adres idzie bez zmian', async () => {
    const url = 'http://tauri.localhost/m/p/Zam1Ab/2'
    stan.kontenery = [{ ...K('pal-1', '000401', 'POLAT'), kind: 'order' }]
    stan.lookup = vi.fn(async () => ({ id: 'pal-1' }))
    render(<MagazynHmiPage />)
    wystukaj(url)
    await naPakowaniu()
    expect(stan.lookup).toHaveBeenCalledWith(url)
  })

  it('kartka kartonu z mroźni — KARTA KARTONU (status, skład, partie), bez czerwonego alarmu', async () => {
    // Właściciel 29.09.2026: gotowy karton to nie błąd — system wchodzi w karton.
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    expect(await screen.findByRole('dialog', { name: 'Karta kartonu' })).toBeTruthy()
    expect(screen.getByTestId('status-kartonu').textContent).toContain('W MROŹNI')
    expect(screen.getByTestId('partie-kartonu').textContent).toContain('290926 592')
    expect(screen.queryByText('TEN KARTON NIE JEST OTWARTY')).toBeNull()
    expect(stan.skan).not.toHaveBeenCalled()
  })

  it('z karty kartonu: wyjazd z mroźni na poprawki', async () => {
    stan.wyjazd = vi.fn().mockResolvedValue({ result: 'SUCCESS', cartonNo: '000777', clientName: 'ZAGROS' })
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    fireEvent.click(await screen.findByRole('button', { name: /Wyjedź z mroźni/ }))
    await waitFor(() => expect(stan.wyjazd).toHaveBeenCalledWith(`SCARTON|${ID}`))
    expect(await screen.findByText(/WYJECHAŁ Z MROŹNI/)).toBeTruthy()
  })

  it('nieznana kartka palety — alarm, bez przejścia i bez zapisu', async () => {
    render(<MagazynHmiPage />)
    wystukaj('PAL|nie-ma|9'); enter()
    expect(await screen.findByText('NIEZNANA KARTKA')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    expect(stan.skan).not.toHaveBeenCalled()
  })

  it('bez sieci — uczciwe „brak połączenia", bez przejścia i bez zapisu', async () => {
    stan.offline = true
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    expect(await screen.findByText('BRAK POŁĄCZENIA')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    expect(stan.skan).not.toHaveBeenCalled()
  })

  it('w trakcie szukania widać „Szukam kartonu…", a nie sukces', async () => {
    let zwolnij!: () => void
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    stan.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`); enter()
    expect(await screen.findByText('Szukam kartonu z tej kartki…')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    zwolnij()
    await naPakowaniu()
  })
})

describe('wyścigi skanów globalnych', () => {
  it('szybko kartka + sztuka na menu: sztuka czeka na kartkę i idzie z jej id', async () => {
    let zwolnij!: () => void
    stan.kontenery = [K('inny', '000100', 'DEMS'), K(ID, '000318', 'YALCIN')]
    stan.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`); enter()
    wystukaj(SZTUKA); enter()
    await new Promise(r => setTimeout(r, 30))
    expect(stan.skan).not.toHaveBeenCalled()
    stan.wstrzymaj = null
    zwolnij()
    await naPakowaniu()
    await waitFor(() => expect(stan.skan).toHaveBeenCalledWith(SZTUKA, ID))
    expect(stan.skan).toHaveBeenCalledTimes(1)
  })

  it('wolny lookup + Wstecz: stary wynik nie przenosi do pakowania, jest komunikat', async () => {
    let zwolnij!: () => void
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    await screen.findByText('Otwarte kartony')
    stan.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    wystukaj(`SCARTON|${ID}`); enter()
    await screen.findByText('Szukam kartonu z tej kartki…')
    fireEvent.click(screen.getByText(/Wstecz/))
    stan.wstrzymaj = null
    zwolnij()
    expect(await screen.findByText('SKAN PRZERWANY')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    expect(screen.queryByText('Pakowanie')).toBeNull()
  })

  it('wolny lookup + ręczny wybór innego kartonu: wygrywa wybór ręczny', async () => {
    let zwolnij!: () => void
    stan.kontenery = [K('k2', '000100', 'DEMS'), K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    const dems = await screen.findByText('DEMS')
    stan.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    wystukaj(`SCARTON|${ID}`); enter()
    await screen.findByText('Szukam kartonu z tej kartki…')
    fireEvent.click(dems.closest('button')!)
    stan.wstrzymaj = null
    zwolnij()
    await naPakowaniu()
    expect(await screen.findByText('SKAN PRZERWANY')).toBeTruthy()
    await skanWPolu(SZTUKA)
    await waitFor(() => expect(stan.skan).toHaveBeenCalledWith(SZTUKA, 'k2'))
  })
})

// Review 28.09.2026 (Chromium, keyboard.type): odczyt pakowania skończył się
// w połowie kodu sztuki, pole dostało fokus i kod rozciął się na dwa POST-y.
describe('fokus przechodzi do pola w połowie kodu', () => {
  afterEach(() => vi.restoreAllMocks())

  it('kartka → sztuka zaczęta na menu, dokończona przy polu z fokusem: JEDEN skan z pełnym kodem', async () => {
    let teraz = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => teraz)
    /** Znak do AKTUALNIE aktywnego elementu; pole dostaje go tylko, gdy
     *  nikt nie zablokował keydown — jak w przeglądarce. */
    const klawisz = (ch: string) => {
      teraz += 5
      const cel = (document.activeElement ?? document.body) as HTMLElement
      const puszczony = fireEvent.keyDown(cel, { key: ch })
      if (puszczony && cel instanceof HTMLInputElement && ch.length === 1) {
        fireEvent.change(cel, { target: { value: cel.value + ch } })
      }
    }
    let zwolnij!: () => void
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    stan.wstrzymaj = new Promise<void>(r => { zwolnij = r })
    render(<MagazynHmiPage />)
    for (const ch of `SCARTON|${ID}`) klawisz(ch)
    klawisz('Enter')
    await screen.findByText('Szukam kartonu z tej kartki…')
    const KOD = 'U|bc82b8f61e2545a4867b'
    // 7 znaków: mniej niż próg tempa skanera, żeby wolny jsdom nie wysłał
    // połówki timerem — test sprawdza przejście fokusu, nie timer.
    for (const ch of KOD.slice(0, 7)) klawisz(ch)
    stan.wstrzymaj = null
    zwolnij()
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Pole skanowania'), { interval: 5 })
    for (const ch of KOD.slice(7)) klawisz(ch)
    klawisz('Enter')
    await waitFor(() => expect(stan.skan).toHaveBeenCalledWith(KOD, ID))
    await new Promise(r => setTimeout(r, 250))
    expect(stan.skan).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Pole skanowania') as HTMLInputElement).value).toBe('')
  })
})

describe('unieważnienie odczytu kartki na menu', () => {
  it('wolny lookup + menu serwisowe: bez przejścia, spinner zgaszony, uczciwy komunikat', async () => {
    const czekaj: Array<(v: unknown) => void> = []
    stan.kontenery = [{ ...K('pal-1', '000401', 'POLAT'), kind: 'order' }]
    stan.lookup = vi.fn(() => new Promise(r => { czekaj.push(r) }))
    render(<MagazynHmiPage />)
    wystukaj('PAL|Zam1Ab|2'); enter()
    await screen.findByText('Szukam kartonu z tej kartki…')
    act(() => stan.otworzSerwis!())
    expect(screen.queryByText('Szukam kartonu z tej kartki…')).toBeNull()
    await act(async () => { czekaj[0]({ id: 'pal-1' }) })
    expect(await screen.findByText('SKAN PRZERWANY')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    expect(screen.queryByText('Pakowanie')).toBeNull()
  })

  it('stary odczyt po Wstecz nie blokuje nowego skanu i nie gasi jego spinnera', async () => {
    const czekaj: Array<(v: unknown) => void> = []
    stan.kontenery = [{ ...K('pal-1', '000401', 'POLAT'), kind: 'order' }]
    stan.lookup = vi.fn(() => new Promise(r => { czekaj.push(r) }))
    render(<MagazynHmiPage />)
    fireEvent.click(screen.getByText('Kartony').closest('button')!)
    await screen.findByText('Otwarte kartony')
    wystukaj('PAL|stary|1'); enter()
    await waitFor(() => expect(czekaj.length).toBe(1))
    fireEvent.click(screen.getByText(/Wstecz/))
    wystukaj('PAL|nowy|1'); enter()
    await waitFor(() => expect(czekaj.length).toBe(2))          // nowy nie czeka za starym
    expect(screen.getByText('Szukam kartonu z tej kartki…')).toBeTruthy()
    await act(async () => { czekaj[0]({ id: 'pal-1' }) })
    expect(screen.getByText('Szukam kartonu z tej kartki…')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
    await act(async () => { czekaj[1]({ id: 'pal-1' }) })
    await naPakowaniu()
    // Na pakowaniu nie ma paska „kartka otwiera (nic nie zapisuje)".
    await waitFor(() => expect(screen.queryByTestId('instrukcja-kartki')).toBeNull())
  })
})

describe('pełny karton z menu', () => {
  it('kartka INNEGO pełnego kartonu tylko go otwiera; duplikat tuż po przejściu nie wstawia do mroźni', async () => {
    stan.spakowane = [K(ID, '000242', 'TRUVA', 40, 40)]
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`); enter()
    expect(await screen.findByTestId('karton-pelny')).toBeTruthy()
    // Ten sam odczyt jeszcze raz — trafia obok pola (przejście ekranu).
    wystukaj(`SCARTON|${ID}`); enter()
    expect(await screen.findByText('KARTON JEST WYBRANY')).toBeTruthy()
    expect(stan.mrozniaKarton).not.toHaveBeenCalled()
    expect(stan.skan).not.toHaveBeenCalled()
  })
})

describe('menu serwisowe na pakowaniu', () => {
  it('blokuje pole skanu i nasłuch w tle', async () => {
    stan.kontenery = [K(ID, '000318', 'YALCIN')]
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`); enter()
    await naPakowaniu()
    await screen.findByText('YALCIN')
    act(() => stan.otworzSerwis!())
    expect((screen.getByLabelText('Pole skanowania') as HTMLInputElement).disabled).toBe(true)
    wystukaj(SZTUKA); enter()
    await new Promise(r => setTimeout(r, 250))
    expect(stan.skan).not.toHaveBeenCalled()
  })
})

describe('odmiana „karton"', () => {
  it('1 karton, 2 kartony, 5 kartonów, 12 kartonów, 22 kartony', async () => {
    const { kartonow } = await import('./MagazynHmiPage')
    expect([1, 2, 5, 12, 22].map(kartonow)).toEqual(['karton', 'kartony', 'kartonów', 'kartonów', 'kartony'])
  })
})
