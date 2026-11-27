// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { wylaczPodpowiedziPrzegladarki } from './bezPodpowiedzi'

afterEach(() => { document.body.innerHTML = '' })
const tick = () => new Promise(r => setTimeout(r, 0))

describe('podpowiedzi przeglądarki w formularzach', () => {
  it('pola i formularze dostają autocomplete=off — także dodane później', async () => {
    document.body.innerHTML = '<form><input id="szt"><textarea></textarea></form>'
    const stop = wylaczPodpowiedziPrzegladarki()
    expect(document.querySelector('#szt')!.getAttribute('autocomplete')).toBe('off')
    expect(document.querySelector('textarea')!.getAttribute('autocomplete')).toBe('off')
    expect(document.querySelector('form')!.getAttribute('autocomplete')).toBe('off')
    const nowe = document.createElement('div')
    nowe.innerHTML = '<input id="temp" inputmode="decimal">'
    document.body.appendChild(nowe)
    await tick()
    expect(document.querySelector('#temp')!.getAttribute('autocomplete')).toBe('off')
    stop()
  })
  it('jawne autocomplete (logowanie) zostaje', () => {
    document.body.innerHTML = '<input id="u" autocomplete="username"><input id="p" type="password" autocomplete="current-password">'
    const stop = wylaczPodpowiedziPrzegladarki()
    expect(document.querySelector('#u')!.getAttribute('autocomplete')).toBe('username')
    expect(document.querySelector('#p')!.getAttribute('autocomplete')).toBe('current-password')
    stop()
  })
})
