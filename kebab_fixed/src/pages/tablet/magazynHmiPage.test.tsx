// @vitest-environment jsdom
/**
 * Ekran startowy kiosku magazynu — menu czynności i nawigacja.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ podsumowanie: null as any, kontenery: [] as any[] }))

vi.mock('@/lib/api', () => ({
  magazynApi: {
    podsumowanie: () => Promise.resolve(stan.podsumowanie),
    pakowanie: () => Promise.resolve({ kontenery: stan.kontenery, pula: [] }),
    skan: vi.fn(),
  },
  vehiclesApi: { list: () => Promise.resolve([
    { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own', vehicleType: 'solo', sortOrder: 0, notes: '', active: true },
  ]) },
  palletScanApi: { inColdStorage: () => Promise.resolve([]), scan: vi.fn(), activeLoading: () => Promise.resolve([]) },
  palletsApi: { lookup: vi.fn() },
  vehicleLoadingApi: { state: () => Promise.resolve(null) },
  errCode: () => '',
  isOfflineError: () => false,
}))
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Vlad M.' }, logout: vi.fn() }),
}))
vi.mock('@/features/deboning/ServiceMenu', () => ({
  useServiceHold: () => ({ holdProps: {} }),
  ServiceMenuModal: () => null,
  serviceSections: () => ({ printer: false, signatures: false }),
}))

import { MagazynHmiPage } from './MagazynHmiPage'

beforeEach(() => {
  stan.kontenery = []
  stan.podsumowanie = {
    kartony: { otwarte: 16, sztukDoSpakowania: 43, zalegle: 11, brakujeWKartonach: 80, doSpakowania: 14, doDokonczenia: 2,
      zaczete: [{ cartonNo: '000318', klient: 'YALCIN', packedQty: 28, targetQty: 60 }] },
    wydanie: { zamowien: 3, kg: 1840 },
    mroznia: { palet: 12 },
  }
})
afterEach(cleanup)

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
})

// Właściciel 25.09.2026: „skan QR na kartce kartonu ma przenosić do pakowania
// tego kartonu — teraz muszę wejść ręcznie".
describe('skan karty kartonu z menu', () => {
  const ID = 'ac82b8f61e2545a4867b'
  const wystukaj = (t: string) => { for (const ch of t) fireEvent.keyDown(document.body, { key: ch }) }

  it('otwiera pakowanie TEGO kartonu, bez dotykania ekranu', async () => {
    stan.kontenery = [{ kind: 'stock', id: ID, cartonNo: '000318', clientName: 'YALCIN', orderNo: '',
      palletNo: 0, deliveryDate: '', openedAt: '', targetQty: 60, packedQty: 28,
      lines: [{ productTypeName: 'UDO', recipeName: 'KIRMIZI', packagingName: 'METAL 80',
                kgPerUnit: 15, targetQty: 60, packedQty: 28 }] }]
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    expect(await screen.findByText('Pakowanie')).toBeTruthy()
    expect(await screen.findByText('YALCIN')).toBeTruthy()
  })

  it('karta kartonu, którego nie ma wśród otwartych — alarm, zostajemy w menu', async () => {
    render(<MagazynHmiPage />)
    wystukaj(`SCARTON|${ID}`)
    expect(await screen.findByText('TEN KARTON NIE JEST OTWARTY')).toBeTruthy()
    expect(screen.getByText('Stanowisko magazynowe')).toBeTruthy()
  })
})

describe('odmiana „karton"', () => {
  it('1 karton, 2 kartony, 5 kartonów, 12 kartonów, 22 kartony', async () => {
    const { kartonow } = await import('./MagazynHmiPage')
    expect([1, 2, 5, 12, 22].map(kartonow)).toEqual(['karton', 'kartony', 'kartonów', 'kartonów', 'kartony'])
  })
})
