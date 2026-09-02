import { describe, expect, it } from 'vitest'
import { haccpBadge } from './haccpBadge'

describe('haccpBadge', () => {
  it('brak wpisu woła o uzupełnienie', () => {
    expect(haccpBadge('brak')).toEqual({ label: 'HACCP: brak', tone: 'todo' })
  })
  it('wpis niepełny jest ostrzeżeniem', () => {
    expect(haccpBadge('niepelne')).toEqual({ label: 'HACCP: niepełne', tone: 'warn' })
  })
  it('komplet nie krzyczy', () => {
    expect(haccpBadge('komplet')).toEqual({ label: 'HACCP', tone: 'ok' })
  })
})
