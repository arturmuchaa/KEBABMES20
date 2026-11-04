import { describe, it, expect } from 'vitest'
import { odm, ile, krotkaNazwa } from './tekst'

describe('teksty interfejsu', () => {
  it('odmiana liczebników', () => {
    const f = (n: number) => odm(n, 'sprawa', 'sprawy', 'spraw')
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 102, 112].map(f)).toEqual(['spraw', 'sprawa', 'sprawy', 'sprawy', 'spraw', 'spraw', 'spraw', 'spraw', 'spraw', 'sprawy', 'spraw', 'sprawy', 'spraw'])
    expect(ile(1, 'dzień', 'dni', 'dni')).toBe('1 dzień')
    expect(ile(3, 'dzień', 'dni', 'dni')).toBe('3 dni')
  })
  it('krótka nazwa bez formy prawnej', () => {
    expect(krotkaNazwa('KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')).toBe('KOKO')
    expect(krotkaNazwa('Zakład Mięsny Sp. z o.o.')).toBe('Zakład Mięsny')
    expect(krotkaNazwa('ABC S.A.')).toBe('ABC')
    expect(krotkaNazwa('NYSA')).toBe('NYSA')
  })
})
