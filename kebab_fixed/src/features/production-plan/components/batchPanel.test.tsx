// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BatchPanel, type BatchPanelRow } from './BatchPanel'

/**
 * Panel partii przyprawionego odpowiada na dwa pytania planisty: czy starczy
 * mięsa i KTÓRA partia poszła na którą pozycję. Stary panel mięsa umiał tylko
 * to pierwsze, więc ręczna zmiana przydziału była zgadywanką.
 */
const ROWS: BatchPanelRow[] = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495',
    productionDay: '2026-08-22', kgFreeRaw: 0,    kgFreeLive: 0,    usedByLines: [1] },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496',
    productionDay: '2026-08-22', kgFreeRaw: 664,  kgFreeLive: 664,  usedByLines: [3] },
  { id: 'b3', recipeId: 'r2', recipeName: 'BULLI',   batchNo: '496',
    productionDay: '2026-08-22', kgFreeRaw: 1220, kgFreeLive: 1220, usedByLines: [] },
]

afterEach(cleanup)

describe('BatchPanel', () => {
  it('grupuje partie po recepturze', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-r1')).toBeTruthy()
    expect(screen.getByTestId('grupa-r2')).toBeTruthy()
  })

  it('mówi, która partia poszła na którą pozycję', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1/)).toBeTruthy()
  })

  it('partia nietknięta nie udaje przypisanej', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b3')).queryByText(/poz\./)).toBeNull()
  })

  it('brak mięsa na recepturę widać PRZED zapisem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 5000 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('brak-r1').textContent).toContain('4336')
  })

  it('gdy mięsa starczy, nie straszy brakiem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 100 } }} onRecalc={vi.fn()} />)
    expect(screen.queryByTestId('brak-r1')).toBeNull()
  })

  it('receptura z zapotrzebowaniem, ale BEZ mięsa, też jest widoczna', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r9: { name: 'INDYK', kg: 300 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-r9')).toBeTruthy()
    expect(screen.getByTestId('brak-r9').textContent).toContain('300')
  })

  it('„Przelicz FEFO od nowa" woła wołającego', () => {
    const onRecalc = vi.fn()
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={onRecalc} />)
    fireEvent.click(screen.getByRole('button', { name: /Przelicz FEFO/ }))
    expect(onRecalc).toHaveBeenCalled()
  })

  it('partia zajęta przez kilka pozycji wymienia je wszystkie', () => {
    const wiele = [{ ...ROWS[0], usedByLines: [1, 3, 4] }]
    render(<BatchPanel rows={wiele} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1, 3, 4/)).toBeTruthy()
  })
})

/**
 * Brak liczymy od SUROWYCH wolnych kilogramów, nie od tych pomniejszonych
 * o alokację bieżącego planu.
 *
 * 24.08.2026, plan PROD/24/08/26: partia KIRMIZI 498 miała 3524 kg wolnego
 * mięsa, plan chciał 4480 kg. Panel pokazał „3,8 kg wolne · brakuje 4476,2 kg",
 * bo `kgFreeLive` jest już PO odjęciu tego planu — zapotrzebowanie odejmowało
 * się drugi raz. Realny brak to 4480 − 3524 = 956 kg.
 */
describe('BatchPanel — brak liczony od surowego stanu', () => {
  const KIRMIZI: BatchPanelRow[] = [{
    id: 'b498', recipeId: 'kir', recipeName: 'KIRMIZI', batchNo: '498',
    productionDay: '2026-08-24',
    kgFreeRaw: 3524, kgFreeLive: 3.8, usedByLines: [1, 2, 3],
  }]

  it('nagłówek grupy pokazuje SUROWE wolne kilogramy', () => {
    render(<BatchPanel rows={KIRMIZI} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-kir').textContent).toContain('3524')
  })

  it('brak = zapotrzebowanie minus SUROWE wolne, nie minus resztka po alokacji', () => {
    render(<BatchPanel rows={KIRMIZI}
      demandByRecipe={{ kir: { name: 'KIRMIZI', kg: 4480 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('brak-kir').textContent).toContain('956')
    expect(screen.getByTestId('brak-kir').textContent).not.toContain('4476')
  })

  it('gdy mięsa starczy, nie ma braku mimo zjedzonej resztki', () => {
    render(<BatchPanel rows={KIRMIZI}
      demandByRecipe={{ kir: { name: 'KIRMIZI', kg: 3000 } }} onRecalc={vi.fn()} />)
    expect(screen.queryByTestId('brak-kir')).toBeNull()
  })

  it('wiersz partii dalej pokazuje ŻYWĄ resztkę — po niej widać, co plan zjadł', () => {
    render(<BatchPanel rows={KIRMIZI} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('partia-b498').textContent).toContain('3,8')
  })
})

/**
 * Czytelność panelu (25.08.2026).
 *
 * Zgłoszenie z biura: „stan mięsa przyprawionego, jakie partie — strasznie
 * nieczytelne". Panel ma 300 px szerokości i cisnął wszystko czcionką
 * 10–11 px w jedną szarą masę: nazwa receptury, kilogramy, plan, braki
 * i partie wyglądały tak samo.
 */
describe('BatchPanel — czytelność', () => {
  const wiersz = (over: Partial<BatchPanelRow> = {}): BatchPanelRow => ({
    id: 'sm1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '344',
    productionDay: '2026-08-24', kgFreeLive: 300, kgFreeRaw: 800, usedByLines: [1, 3], ...over,
  })

  // jsdom nie kompiluje Tailwinda, więc rozmiar czytamy z klasy `text-[13.5px]`
  // — a to właśnie ta wartość zjechała kiedyś do 10 px.
  const px = (id: string) => {
    const kl = screen.getByTestId(id).className
    const m = /text-\[(\d+(?:\.\d+)?)px\]/.exec(kl)
    return m ? parseFloat(m[1]) : 0
  }

  it('numer partii jest największym napisem w wierszu — po nim się szuka', () => {
    render(<BatchPanel rows={[wiersz()]} demandByRecipe={{}} onRecalc={() => {}} />)
    expect(px('partia-nr-sm1')).toBeGreaterThanOrEqual(13)
    expect(px('partia-nr-sm1')).toBeGreaterThan(px('partia-kg-sm1'))
  })

  it('żadna liczba nie schodzi poniżej 12 px', () => {
    render(<BatchPanel rows={[wiersz()]} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 500 } }} onRecalc={() => {}} />)
    expect(px('partia-kg-sm1')).toBeGreaterThanOrEqual(12)
    expect(px('grupa-wolne-r1')).toBeGreaterThanOrEqual(12)
  })

  it('pozycje planu biorące z partii to znaczniki, nie sam kolor', () => {
    render(<BatchPanel rows={[wiersz()]} demandByRecipe={{}} onRecalc={() => {}} />)
    const uzycie = screen.getByTestId('partia-uzycie-sm1')
    expect(uzycie.textContent).toContain('1')
    expect(uzycie.textContent).toContain('3')
    expect(uzycie.textContent?.toLowerCase()).toContain('poz')
  })

  it('brak mięsa mówi ILE brakuje i nie polega na samej czerwieni', () => {
    render(<BatchPanel rows={[wiersz({ kgFreeRaw: 100 })]}
      demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 500 } }} onRecalc={() => {}} />)
    const brak = screen.getByTestId('brak-r1')
    expect(brak.textContent).toMatch(/brakuje/i)
    expect(brak.textContent).toContain('400')
  })

  it('pasek pokrycia pokazuje na oko, ile planu stoi za mięsem', () => {
    render(<BatchPanel rows={[wiersz({ kgFreeRaw: 250 })]}
      demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 500 } }} onRecalc={() => {}} />)
    const pasek = screen.getByTestId('pokrycie-r1')
    expect(pasek.style.width).toBe('50%')
  })

  it('partia nietknięta planem nie udaje, że coś z niej poszło', () => {
    render(<BatchPanel rows={[wiersz({ usedByLines: [] })]} demandByRecipe={{}} onRecalc={() => {}} />)
    expect(screen.queryByTestId('partia-uzycie-sm1')).toBeNull()
  })
})
