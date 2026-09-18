// @vitest-environment jsdom
/**
 * Bęben masownicy MUSI się kręcić na panelu hali.
 *
 * Pierwsza wersja (keyframes w `<style>` + wyjątek na `prefers-reduced-motion`)
 * stała w miejscu na prawdziwym kiosku: „są łopatki, ale stoją". Na panelu PC
 * w Windows wyłączone są efekty animacji, więc przeglądarka raportuje
 * „ogranicz ruch" i CSS-owa animacja nigdy nie ruszała. Na hali obracający się
 * bęben to INFORMACJA („maszyna pracuje"), nie ozdoba — nie wolno jej wyciszać
 * ustawieniem systemowym.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Beben } from './components/Beben'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('bęben masownicy', () => {
  it('kręci się przez Web Animations API, nie przez CSS', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    ;(Element.prototype as any).animate = animate

    render(<Beben />)

    expect(animate).toHaveBeenCalledTimes(1)
    const [klatki, opcje] = animate.mock.calls[0] as any[]
    expect(klatki[0].transform).toMatch(/rotate\(0/)
    expect(klatki[1].transform).toMatch(/rotate\(360/)
    expect(opcje.iterations).toBe(Infinity)
    expect(opcje.duration).toBe(3000)
  })

  it('bez WAAPI zostaje klasa CSS — bęben nie zostaje nieruchomy', () => {
    delete (Element.prototype as any).animate
    render(<Beben />)
    const grupa = screen.getByTestId('beben-masownicy').querySelector('g')
    expect(grupa).toHaveClass('beben-obrot')
  })

  it('zatrzymuje animację przy odmontowaniu', () => {
    const cancel = vi.fn()
    ;(Element.prototype as any).animate = vi.fn(() => ({ cancel }))
    const { unmount } = render(<Beben />)
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it('ma łopatki — samo koło wygląda na nieruchome', () => {
    ;(Element.prototype as any).animate = vi.fn(() => ({ cancel: vi.fn() }))
    render(<Beben />)
    expect(screen.getByTestId('beben-masownicy').querySelectorAll('path,circle').length).toBeGreaterThan(2)
  })

  it('kręci GRUPĄ w środku, nie korzeniem svg — to rysuje każdy silnik', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    ;(Element.prototype as any).animate = animate
    const { container } = render(<Beben />)
    const grupa = container.querySelector('g')
    expect(animate.mock.instances[0]).toBe(grupa)
    expect((grupa as SVGGElement).style.transformOrigin).toBe('17px 17px')
  })
})
