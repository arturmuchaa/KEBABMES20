import { describe, expect, it } from 'vitest'
import { workerTileLabel } from './DeboningHmiV10Page'

describe('workerTileLabel (kafel pracownika: numer + imię, bez skrótu z liter)', () => {
  it('splits the trailing worker number from the name', () => {
    expect(workerTileLabel('IVAN 8')).toEqual({ no: '8', name: 'IVAN' })
    expect(workerTileLabel('NOWY EVGHENII 11')).toEqual({ no: '11', name: 'NOWY EVGHENII' })
    expect(workerTileLabel(' DAWID 12 ')).toEqual({ no: '12', name: 'DAWID' })
  })
  it('keeps names without a number whole', () => {
    expect(workerTileLabel('IVAN MIESZANIE')).toEqual({ no: null, name: 'IVAN MIESZANIE' })
    expect(workerTileLabel('MARIUSZ NOWY KIEROWCA')).toEqual({ no: null, name: 'MARIUSZ NOWY KIEROWCA' })
  })
})
