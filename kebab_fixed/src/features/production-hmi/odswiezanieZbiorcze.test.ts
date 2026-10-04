import { describe, it, expect, vi } from 'vitest'
import { utworzOdswiezanieZbiorcze } from './odswiezanieZbiorcze'

const mikro = () => new Promise(r => setTimeout(r, 0))

describe('odświeżenie po serii skanów', () => {
  it('seria próśb w trakcie odczytu: jeden w locie + jeden końcowy, nie po jednym na skan', async () => {
    const puszczenia: Array<() => void> = []
    const odswiez = vi.fn(() => new Promise<void>(r => { puszczenia.push(r) }))
    const zadaj = utworzOdswiezanieZbiorcze(odswiez)
    for (let i = 0; i < 50; i++) zadaj()
    expect(odswiez).toHaveBeenCalledTimes(1)
    puszczenia[0]()
    await mikro()
    expect(odswiez).toHaveBeenCalledTimes(2)              // końcowa synchronizacja po serii
    puszczenia[1]()
    await mikro()
    expect(odswiez).toHaveBeenCalledTimes(2)
  })

  it('prośba po zakończeniu serii odświeża od razu', async () => {
    const odswiez = vi.fn(() => Promise.resolve())
    const zadaj = utworzOdswiezanieZbiorcze(odswiez)
    zadaj(); await mikro()
    zadaj(); await mikro()
    expect(odswiez).toHaveBeenCalledTimes(2)
  })

  it('błąd odczytu nie blokuje następnych odświeżeń', async () => {
    const odswiez = vi.fn()
      .mockRejectedValueOnce(new Error('sieć'))
      .mockResolvedValue(undefined)
    const zadaj = utworzOdswiezanieZbiorcze(odswiez)
    zadaj(); await mikro()
    zadaj(); await mikro()
    expect(odswiez).toHaveBeenCalledTimes(2)
  })
})
