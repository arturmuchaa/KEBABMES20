// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useSkanGlobalny } from './useSkanGlobalny'

afterEach(cleanup)

function Proba({ onKod, aktywny = true }: { onKod: (k: string) => void; aktywny?: boolean }) {
  useSkanGlobalny(aktywny, onKod)
  return <div><input data-testid="pole" /></div>
}

const wystukaj = (tekst: string, cel: Element | Document = document.body) => {
  for (const ch of tekst) fireEvent.keyDown(cel, { key: ch })
}

describe('skaner słuchany bez pola skanu', () => {
  it('kod karty kartonu bez Entera trafia do obsługi', async () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} />)
    wystukaj('SCARTON|ac82b8f61e2545a4867b')
    await waitFor(() => expect(onKod).toHaveBeenCalledWith('SCARTON|ac82b8f61e2545a4867b'))
  })

  it('Enter kończy kod od razu', () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} />)
    wystukaj('PAL|o1|3')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onKod).toHaveBeenCalledWith('PAL|o1|3')
  })

  it('nie przejmuje pisania w polu tekstowym', async () => {
    const onKod = vi.fn()
    const { getByTestId } = render(<Proba onKod={onKod} />)
    wystukaj('SCARTON|ac82b8f61e2545a4867b', getByTestId('pole'))
    fireEvent.keyDown(getByTestId('pole'), { key: 'Enter' })
    await new Promise(r => setTimeout(r, 250))
    expect(onKod).not.toHaveBeenCalled()
  })

  describe('fokus przeskakuje do pola w połowie kodu', () => {
    let teraz = 0
    beforeEach(() => { teraz = 1_000_000; vi.spyOn(Date, 'now').mockImplementation(() => teraz) })
    afterEach(() => vi.restoreAllMocks())

    /** Znak idzie do AKTUALNIE aktywnego elementu, jak z klawiatury. Pole
     *  dostaje znak tylko, gdy nikt nie zablokował keydown. */
    const klawisz = (ch: string, krokMs = 5) => {
      teraz += krokMs
      const cel = (document.activeElement ?? document.body) as HTMLElement
      const puszczony = fireEvent.keyDown(cel, { key: ch })
      if (puszczony && cel instanceof HTMLInputElement && ch.length === 1) {
        fireEvent.change(cel, { target: { value: cel.value + ch } })
      }
    }

    it('kod zaczęty na body kończy się w całości, nic nie wpada do pola', () => {
      const onKod = vi.fn()
      const { getByTestId } = render(<Proba onKod={onKod} />)
      const pole = getByTestId('pole') as HTMLInputElement
      const KOD = 'U|bc82b8f61e2545a4867b'
      for (const ch of KOD.slice(0, 8)) klawisz(ch)
      pole.focus()                                         // ekran pakowania oddał fokus polu
      expect(document.activeElement).toBe(pole)
      for (const ch of KOD.slice(8)) klawisz(ch)
      klawisz('Enter')
      expect(onKod).toHaveBeenCalledTimes(1)
      expect(onKod).toHaveBeenCalledWith(KOD)
      expect(pole.value).toBe('')
    })

    it('człowiek: kilka klawiszy na body, potem pisze w polu — pole zostaje jego', async () => {
      const onKod = vi.fn()
      const { getByTestId } = render(<Proba onKod={onKod} />)
      const pole = getByTestId('pole') as HTMLInputElement
      for (const ch of 'ab') klawisz(ch, 200)
      pole.focus()
      klawisz('K', 400)                                   // ręka przeszła do pola
      for (const ch of 'R 8842') klawisz(ch, 150)
      klawisz('Enter', 150)
      await new Promise(r => setTimeout(r, 200))
      expect(onKod).not.toHaveBeenCalled()
      expect(pole.value).toBe('KR 8842')
    })
  })

  it('wyłączony nic nie słyszy', () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} aktywny={false} />)
    wystukaj('PAL|o1|3'); fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onKod).not.toHaveBeenCalled()
  })

  describe('skaner zacina się w połowie kodu (29.09.2026)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('sztuka z przerwą 500 ms w środku przychodzi w CAŁOŚCI, nie w dwóch kawałkach', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      wystukaj('U|ac82b8f61e')
      vi.advanceTimersByTime(500)
      expect(onKod).not.toHaveBeenCalled()
      wystukaj('2545a4867b')
      vi.advanceTimersByTime(1000)
      expect(onKod).toHaveBeenCalledTimes(1)
      expect(onKod).toHaveBeenCalledWith('U|ac82b8f61e2545a4867b')
    })

    it('kartka palety WIELKIMI literami z przerwą — też w całości', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      wystukaj('HTTP://TAURI.LOCALHOST/M/P/6890E86337')
      vi.advanceTimersByTime(600)
      wystukaj('6444CEAA10/7')
      vi.advanceTimersByTime(1000)
      expect(onKod).toHaveBeenCalledTimes(1)
      expect(onKod).toHaveBeenCalledWith('HTTP://TAURI.LOCALHOST/M/P/6890E863376444CEAA10/7')
    })
  })
})
