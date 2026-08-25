// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * Widoczny strażnik ważenia zbiorczego.
 *
 * 24.08.2026 na masownię pojechała paleta z etykietą „485", choć ważono partię
 * 503: ekran nie wiedział, co stoi na wadze, i podpowiadał najstarszy lot
 * z puli. Operator nie widział ani numeru partii, ani ile z niej jeszcze wolno
 * zważyć — limit istniał wyłącznie w backendzie i nigdy nie zdążył zadziałać,
 * bo dobieranie FEFO po cichu przerzucało nadmiar na inną partię.
 */

vi.mock('@/lib/api', () => ({
  meatPalletsApi: { list: async () => [], create: vi.fn() },
  // Pula w kolejności FEFO — 485 najstarsza, dokładnie jak z produkcji.
  meatStockApi: {
    list: async () => ({ data: [
      { lotNo: '485', kgInitial: 2560, kgAvailable: 1360, kgBulkFree: 2360, expiryDate: '2026-08-18' },
      { lotNo: '502', kgInitial: 2293, kgAvailable: 2293, kgBulkFree: 1803, expiryDate: '2026-08-29' },
      { lotNo: '503', kgInitial: 493,  kgAvailable: 493,  kgBulkFree: 193,  expiryDate: '2026-08-29' },
    ] }),
  },
}))
vi.mock('@/lib/zebra', () => ({
  getDevices: async () => [], sendZpl: vi.fn(), probeBrowserPrint: async () => true,
}))
vi.mock('@/features/deboning/utils', () => ({ getProductionDate: () => '2026-08-24' }))

import { BulkWeighingWizard } from './BulkWeighingWizard'

const SCALE = { connected: true, stable: true, gross: 0 } as any

function pokaz(activeBatchNo?: string) {
  render(
    <BulkWeighingWizard
      scale={SCALE} cartTares={[20]} operator="MARCIN"
      activeBatchNo={activeBatchNo} onClose={() => {}}
    />,
  )
}

const kafelek = (key: string) => screen.getByTestId(`bw-cel-${key}`) as HTMLButtonElement

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ważenie zbiorcze — widoczny strażnik partii', () => {
  it('pokazuje, którą partię hala waży', async () => {
    pokaz('503')
    expect((await screen.findByTestId('bw-partia')).textContent).toBe('503')
  })

  it('mówi wprost, ile zważono, ile na paletach i ile zostało', async () => {
    pokaz('503')
    const licznik = await screen.findByTestId('bw-licznik')
    expect(licznik.textContent).toContain('zważone 493 kg')
    expect(licznik.textContent).toContain('na paletach 300 kg')
    expect(licznik.textContent).toContain('zostało 193 kg')
  })

  // 25.08.2026: twarda blokada zapędzała halę w ślepy zaułek. Przy 119,5 kg
  // końcówki partii 505 operator chciał zrobić JEDNĄ paletę 200 kg (końcówka
  // + nowa partia 506), a ekran kazał najpierw zrobić paletę 100 kg i zostawić
  // 19,5 kg sieroty — czyli i tak paletę z dwóch partii, tylko o jedną więcej.
  // Kafelek ostrzega i pyta, ale nie zamyka drogi.
  it('cel ponad resztę partii OSTRZEGA, ale nie jest zamknięty', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    expect(kafelek('t600').disabled).toBe(false)
    expect(kafelek('t400').disabled).toBe(false)
    expect(kafelek('t100').disabled).toBe(false)
  })

  it('kafelek ponad resztę mówi, ile w partii zostało', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    expect(kafelek('t600').textContent).toContain('zostało 193 kg')
  })

  it('wybór celu ponad resztę wymaga POTWIERDZENIA, zanim ruszy ważenie', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    fireEvent.click(kafelek('t400'))

    const pyt = await screen.findByTestId('bw-cel-pytanie')
    expect(pyt.textContent).toContain('193')
    expect(screen.queryByTestId('bw-dodaj')).toBeNull()          // ważenie jeszcze nie ruszyło

    fireEvent.click(screen.getByTestId('bw-cel-potwierdz'))
    fireEvent.click(await screen.findByRole('button', { name: /20/ }))   // wózek
    expect(await screen.findByTestId('bw-dodaj')).toBeTruthy()           // dopiero teraz
  })

  it('anulowanie pytania zostawia operatora przy wyborze celu', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    fireEvent.click(kafelek('t400'))
    fireEvent.click(await screen.findByTestId('bw-cel-anuluj'))

    expect(screen.queryByTestId('bw-cel-pytanie')).toBeNull()
    expect(kafelek('t400')).toBeTruthy()
    expect(screen.queryByTestId('bw-dodaj')).toBeNull()
  })

  it('cel mieszczący się w partii NIE pyta o nic', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    fireEvent.click(kafelek('t100'))
    expect(screen.queryByTestId('bw-cel-pytanie')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /20/ }))   // wózek
    expect(await screen.findByTestId('bw-dodaj')).toBeTruthy()
  })

  it('bez wskazanej partii nic nie blokuje — brak wiedzy to nie zero', async () => {
    pokaz(undefined)
    await waitFor(() => expect(kafelek('t600').disabled).toBe(false))
    expect(screen.queryByTestId('bw-partia')).toBeNull()
  })
})

/**
 * Blokada przy przekroczeniu celu. PAL/24/08/26/18 (24.08.2026) zapisała się
 * jako 218 kg przy ZEROWEJ liczbie pojemników — tara E2 nie została odjęta
 * i 18 kg plastiku poszło na dokument jako mięso.
 */
describe('ważenie zbiorcze — przekroczenie celu', () => {
  /** Doprowadź ekran do ważenia słupka przy celu 200 kg i wskazanej wadze. */
  async function doWagi(gross: number) {
    render(
      <BulkWeighingWizard
        scale={{ connected: true, stable: true, gross } as any}
        cartTares={[6]} operator="MARCIN" activeBatchNo="504" onClose={() => {}}
      />,
    )
    fireEvent.click(await screen.findByTestId('bw-cel-t200'))
    fireEvent.click(screen.getByRole('button', { name: /6/ }))
  }

  it('nadwyżka o dokładną tarę pojemników mówi, ile ich brakuje', async () => {
    await doWagi(224)   // 224 brutto − 6 wózek − 0 pojemników = 218 netto
    expect((await screen.findByTestId('bw-nadwyzka')).textContent).toContain('9 pojemników')
  })

  it('nie da się dodać słupka ponad cel', async () => {
    await doWagi(224)
    await screen.findByTestId('bw-nadwyzka')
    const dodaj = screen.getByTestId('bw-dodaj') as HTMLButtonElement
    expect(dodaj.disabled).toBe(true)
    // Etykieta ma mówić PRAWDĘ o przyczynie: waga jest obciążona, więc
    // „Wjedź na wagę" myliłoby operatora.
    expect(dodaj.textContent).toContain('Ponad cel')
  })

  it('waga w celu nie blokuje niczego', async () => {
    await doWagi(206)   // 206 − 6 = 200 netto
    expect(screen.queryByTestId('bw-nadwyzka')).toBeNull()
  })
})
