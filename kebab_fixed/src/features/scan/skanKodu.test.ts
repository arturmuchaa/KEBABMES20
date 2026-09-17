/**
 * Reguła auto-wysyłki skanu: co wolno wysłać bez Entera i kiedy.
 *
 * Zakład, 17.09.2026: DS2278 bez sufiksu Enter wpisywał kod w pole i nic się
 * nie działo — paleta zostawała `created`, bo żądanie nie wychodziło.
 */
import { describe, it, expect } from 'vitest'
import { czyKompletnyKodPalety, czyWpisalSkaner, MAX_MS_SKANU, MIN_ZNAKOW_SKANU,
         utworzStraznikaWysylki } from './skanKodu'

describe('rozpoznanie kompletnego kodu palety', () => {
  it('token z kartki', () => {
    expect(czyKompletnyKodPalety('PAL|6890e863376444ceaa10|7')).toBe(true)
  })

  it('adres z kodu QR — także z hosta aplikacji desktopowej', () => {
    // Kartki drukowane z Tauri niosą `tauri.localhost`; backend i tak parsuje
    // samą ścieżkę, więc host nie może decydować o auto-wysyłce.
    expect(czyKompletnyKodPalety('http://tauri.localhost/m/p/6890e863376444ceaa10/7')).toBe(true)
    expect(czyKompletnyKodPalety('http://91.98.105.107:8080/m/p/abc/12')).toBe(true)
  })

  it('NIEkompletny kod czeka na Enter', () => {
    expect(czyKompletnyKodPalety('')).toBe(false)
    expect(czyKompletnyKodPalety('   ')).toBe(false)
    expect(czyKompletnyKodPalety('7')).toBe(false)
    expect(czyKompletnyKodPalety('PAL|6890e863')).toBe(false)          // ucięty
    expect(czyKompletnyKodPalety('PAL|6890e863|')).toBe(false)         // bez numeru
    expect(czyKompletnyKodPalety('/m/p/abc')).toBe(false)              // bez numeru
    expect(czyKompletnyKodPalety('YALCIN/Z/6/09/26')).toBe(false)      // numer zamówienia
  })

  it('kod w trakcie wpisywania nie odpala się przedwcześnie', () => {
    const docelowy = 'PAL|abc|7'
    for (let i = 1; i < docelowy.length; i++) {
      expect(czyKompletnyKodPalety(docelowy.slice(0, i))).toBe(false)
    }
    expect(czyKompletnyKodPalety(docelowy)).toBe(true)
  })
})

describe('strażnik podwójnej wysyłki', () => {
  it('pierwszy skan przechodzi', () => {
    const s = utworzStraznikaWysylki()
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
  })

  it('Enter tuż po auto-wysyłce jest ignorowany', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|7', 1150)).toBe(false)   // Enter 150 ms później
  })

  it('INNY kod przechodzi od razu — kolejna paleta nie czeka', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|8', 1050)).toBe(true)
  })

  it('ten sam kod PO oknie przechodzi — blokada nie jest wieczna', () => {
    // Powtórny skan tej samej palety (np. po jej cofnięciu) musi być możliwy.
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|7', 3100)).toBe(true)
  })

  it('po nieudanej wysyłce wolno ponowić od razu', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    s.zwolnij()
    expect(s.wolno('PAL|abc|7', 1100)).toBe(true)
  })

  it('pusty kod nigdy nie leci', () => {
    const s = utworzStraznikaWysylki()
    expect(s.wolno('', 1000)).toBe(false)
    expect(s.wolno('   ', 1000)).toBe(false)
  })
})

describe('rozpoznanie skanera po tempie', () => {
  it('skaner: kilkanaście znaków w kilkadziesiąt ms', () => {
    expect(czyWpisalSkaner(52, 40)).toBe(true)     // adres z QR
    expect(czyWpisalSkaner(24, 12)).toBe(true)     // token palety
  })

  it('człowiek piszący z klawiatury NIE odpala auto-wysyłki', () => {
    expect(czyWpisalSkaner(24, 4800)).toBe(false)  // ~200 ms/znak
    expect(czyWpisalSkaner(12, 2000)).toBe(false)
  })

  it('krótki ciąg nigdy — mógł wpaść przypadkiem', () => {
    expect(czyWpisalSkaner(3, 5)).toBe(false)
    expect(czyWpisalSkaner(7, 10)).toBe(false)
  })

  it('granice są jawne, nie magiczne', () => {
    expect(czyWpisalSkaner(MIN_ZNAKOW_SKANU, MAX_MS_SKANU)).toBe(true)
    expect(czyWpisalSkaner(MIN_ZNAKOW_SKANU, MAX_MS_SKANU + 1)).toBe(false)
  })
})
