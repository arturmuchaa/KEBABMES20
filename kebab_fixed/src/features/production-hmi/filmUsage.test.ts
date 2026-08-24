import { describe, it, expect } from 'vitest'
import { filmSummary, returnIssues, type FilmMove } from './filmUsage'

const m = (kind: FilmMove['kind'], qty: number): FilmMove => ({ at: '2026-08-25T06:10:00', kind, qty })

describe('filmSummary', () => {
  it('pobranie rano plus dokładka w ciągu dnia', () => {
    expect(filmSummary([m('pobranie', 40), m('pobranie', 20)]).pobrane).toBe(60)
  })

  it('zużycie to pobrane minus zwrócone', () => {
    const s = filmSummary([m('pobranie', 40), m('pobranie', 20), m('zwrot', 5)])
    expect(s).toEqual({ pobrane: 60, zwrocone: 5, zuzyte: 55 })
  })

  it('brak ruchów daje zera, nie NaN', () => {
    expect(filmSummary([])).toEqual({ pobrane: 0, zwrocone: 0, zuzyte: 0 })
  })

  it('ruch z zerową albo ujemną ilością jest ignorowany', () => {
    expect(filmSummary([m('pobranie', 40), m('pobranie', 0), m('zwrot', -3)]).zuzyte).toBe(40)
  })
})

describe('returnIssues', () => {
  it('zwrot mieszczący się w pobraniu przechodzi', () => {
    expect(returnIssues(60, 5)).toEqual([])
  })

  it('zwrot całości też przechodzi — dzień bez zużycia się zdarza', () => {
    expect(returnIssues(60, 60)).toEqual([])
  })

  it('zwrot większy niż pobranie odrzucony z konkretem', () => {
    expect(returnIssues(60, 61)).toEqual(['Nie można zwrócić 61 rolek — pobrano 60'])
  })

  it('zwrot ujemny odrzucony', () => {
    expect(returnIssues(60, -1)).toContain('Zwrot nie może być ujemny')
  })

  it('połówka rolki odrzucona — folia jest w opakowaniach', () => {
    expect(returnIssues(60, 2.5)).toContain('Rolki liczymy w całych sztukach')
  })

  it('puste pole prosi o liczbę zamiast wybuchać', () => {
    expect(returnIssues(60, NaN)).toEqual(['Podaj liczbę rolek'])
  })
})
