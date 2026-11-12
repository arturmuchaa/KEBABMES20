// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LOGO_ZAKLADU, LogoZakladu } from './LogoZakladu'

afterEach(cleanup)

describe('LogoZakladu — jedno miejsce na logo zakładu', () => {
  it('cały plik w zadanej wysokości (jak na WZ)', () => {
    const { container } = render(<LogoZakladu wysokosc={72} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe(LOGO_ZAKLADU.src)
    expect(img.getAttribute('alt')).toBe(LOGO_ZAKLADU.alt)
    expect(img.style.height).toBe('72px')
  })

  it('przycięte do samego znaku: ramka o proporcjach znaku, ten sam plik', () => {
    const { container } = render(<LogoZakladu wysokosc={38} przyciete />)
    const ramka = container.firstElementChild as HTMLElement
    const { w, h } = LOGO_ZAKLADU.znak
    expect(ramka.style.height).toBe('38px')
    expect(parseFloat(ramka.style.width)).toBeCloseTo(38 * w / h, 1)
    expect(ramka.style.overflow).toBe('hidden')
    expect(container.querySelector('img')!.getAttribute('src')).toBe(LOGO_ZAKLADU.src)
  })
})
