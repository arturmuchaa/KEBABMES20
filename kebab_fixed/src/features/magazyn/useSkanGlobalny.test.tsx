// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useSkanGlobalny } from './useSkanGlobalny'

afterEach(cleanup)

function Proba({ onKod, aktywny = true, onBlad }: { onKod: (k: string) => void; aktywny?: boolean; onBlad?: (k: string) => void }) {
  useSkanGlobalny(aktywny, onKod, onBlad)
  return <div>
    <input data-testid="pole" />
    <select data-testid="lista"><option>a</option></select>
    <div data-testid="edytor" contentEditable suppressContentEditableWarning>x</div>
    <button type="button" data-testid="przycisk">ok</button>
  </div>
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

  describe('seria na menu (hala 02.10.2026: sklejone kody)', () => {
    const hex = (n: number) => n.toString(16).padStart(20, '0')

    it('karta kartonu + dwie sztuki bez Entera — trzy kody, od razu, w kolejności', () => {
      vi.useFakeTimers()
      try {
        const onKod = vi.fn()
        render(<Proba onKod={onKod} />)
        wystukaj(`SCARTON|${hex(1)}U|${hex(2)}U|${hex(3)}`)
        expect(onKod.mock.calls.map(c => c[0])).toEqual([`SCARTON|${hex(1)}`, `U|${hex(2)}`, `U|${hex(3)}`])
      } finally { vi.useRealTimers() }
    })

    it('kartka palety + sztuka bez separatora; numer palety nie jest ucinany', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      wystukaj(`PAL|Zam1|12U|${hex(2)}`)
      expect(onKod.mock.calls.map(c => c[0])).toEqual(['PAL|Zam1|12', `U|${hex(2)}`])
    })

    it('spóźniony Tab po samoczynnie zamkniętym kodzie jest połykany, nie robi skanu', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      wystukaj(`U|${hex(2)}`)
      expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false)
      expect(onKod).toHaveBeenCalledTimes(1)
    })

    it('Tab bez zaczętego kodu i Shift+Tab działają normalnie', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(true)
      wystukaj('PAL|o1|3')
      expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(true)
      expect(onKod).not.toHaveBeenCalled()
    })

    it('skróty Ctrl/Meta/Alt nie trafiają do kodu', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
      fireEvent.keyDown(document.body, { key: 'v', metaKey: true })
      fireEvent.keyDown(document.body, { key: 'x', altKey: true })
      wystukaj('PAL|o1|3')
      fireEvent.keyDown(document.body, { key: 'Enter' })
      expect(onKod).toHaveBeenCalledWith('PAL|o1|3')
    })

    it('kompozycja IME jest pomijana', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      fireEvent.keyDown(document.body, { key: 'ą', isComposing: true })
      wystukaj('PAL|o1|3')
      fireEvent.keyDown(document.body, { key: 'Enter' })
      expect(onKod).toHaveBeenCalledWith('PAL|o1|3')
    })

    it('select i contenteditable należą do człowieka', async () => {
      const onKod = vi.fn()
      const { getByTestId } = render(<Proba onKod={onKod} />)
      for (const cel of [getByTestId('lista'), getByTestId('edytor')]) {
        wystukaj(`SCARTON|${hex(9)}`, cel)
        fireEvent.keyDown(cel, { key: 'Enter' })
      }
      await new Promise(r => setTimeout(r, 50))
      expect(onKod).not.toHaveBeenCalled()
    })

    it('ucięty kod po ciszy — błąd do ekranu, nie kod', () => {
      vi.useFakeTimers()
      try {
        const onKod = vi.fn()
        const onBlad = vi.fn()
        render(<Proba onKod={onKod} onBlad={onBlad} />)
        wystukaj('U|ac82b8f61e')
        vi.advanceTimersByTime(2000)
        expect(onKod).not.toHaveBeenCalled()
        expect(onBlad).toHaveBeenCalledWith(expect.stringMatching(/Niepełny odczyt/))
      } finally { vi.useRealTimers() }
    })

    it('wyłączenie w połowie kodu kasuje ogon — nic nie wychodzi później', () => {
      vi.useFakeTimers()
      try {
        const onKod = vi.fn()
        const { rerender } = render(<Proba onKod={onKod} />)
        wystukaj('PAL|o1|3')
        rerender(<Proba onKod={onKod} aktywny={false} />)
        vi.advanceTimersByTime(5000)
        rerender(<Proba onKod={onKod} />)
        vi.advanceTimersByTime(5000)
        expect(onKod).not.toHaveBeenCalled()
      } finally { vi.useRealTimers() }
    })
  })

  describe('klawisze człowieka na menu nie są skanem', () => {
    let teraz = 0
    beforeEach(() => { teraz = 2_000_000; vi.spyOn(Date, 'now').mockImplementation(() => teraz) })
    afterEach(() => vi.restoreAllMocks())
    const klawisz = (cel: Element, key: string, krokMs: number) => {
      teraz += krokMs
      return fireEvent.keyDown(cel, { key })
    }

    it('„a" + Enter na przycisku: nic nie leci, Enter zostaje przyciskowi', () => {
      const onKod = vi.fn()
      const onBlad = vi.fn()
      const { getByTestId } = render(<Proba onKod={onKod} onBlad={onBlad} />)
      const przycisk = getByTestId('przycisk')
      przycisk.focus()
      klawisz(przycisk, 'a', 5)
      expect(klawisz(przycisk, 'Enter', 5)).toBe(true)     // nie zablokowany — przycisk się aktywuje
      expect(onKod).not.toHaveBeenCalled()
      expect(onBlad).not.toHaveBeenCalled()
      // Kolejny Enter (już bez przypadkowego klawisza) też należy do przycisku.
      expect(klawisz(przycisk, 'Enter', 50)).toBe(true)
      expect(klawisz(przycisk, 'Tab', 50)).toBe(true)
    })

    it('powolne pisanie na menu + Enter: nic nie leci, Enter nie zablokowany', () => {
      const onKod = vi.fn()
      const onBlad = vi.fn()
      render(<Proba onKod={onKod} onBlad={onBlad} />)
      for (const ch of 'abcdefghij') klawisz(document.body, ch, 200)
      expect(klawisz(document.body, 'Enter', 200)).toBe(true)
      expect(onKod).not.toHaveBeenCalled()
      expect(onBlad).not.toHaveBeenCalled()
    })

    it('ten sam ciąg w tempie skanera + Enter — to skan, idzie', () => {
      const onKod = vi.fn()
      render(<Proba onKod={onKod} />)
      for (const ch of 'KEBAB-12345') klawisz(document.body, ch, 3)
      expect(klawisz(document.body, 'Enter', 3)).toBe(false)
      expect(onKod).toHaveBeenCalledWith('KEBAB-12345')
    })

    it('ucięta sztuka w tempie skanera + Enter — błąd do ekranu, nie kod', () => {
      const onKod = vi.fn()
      const onBlad = vi.fn()
      render(<Proba onKod={onKod} onBlad={onBlad} />)
      for (const ch of 'U|ac82b8f61e') klawisz(document.body, ch, 3)
      expect(klawisz(document.body, 'Enter', 3)).toBe(false)
      expect(onKod).not.toHaveBeenCalled()
      expect(onBlad).toHaveBeenCalledWith(expect.stringMatching(/Niepełny odczyt/))
    })

    it('kartka palety z doklejonym obcym ciągiem — błąd, paleta NIE leci', () => {
      const onKod = vi.fn()
      const onBlad = vi.fn()
      render(<Proba onKod={onKod} onBlad={onBlad} />)
      for (const ch of 'PAL|Zam1|12SPAM') klawisz(document.body, ch, 3)
      expect(klawisz(document.body, 'Enter', 3)).toBe(false)
      expect(onKod).not.toHaveBeenCalled()
      expect(onBlad).toHaveBeenCalledWith(expect.stringMatching(/PAL\|Zam1\|12SPAM/))
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
