import { describe, it, expect } from 'vitest'
import { packagingOptions, type PackagingItem } from './packagingOptions'

const t = (over: Partial<PackagingItem> = {}): PackagingItem => ({
  id: 'p1', name: 'METAL 65', type: 'tuleja', kgAvailable: 100, ...over,
})

/** Kolejność bada osobny test — reszta pyta o konkretną pozycję po id. */
const poId = (lista: PackagingItem[], currentId: string, needed: number, id: string) =>
  packagingOptions(lista, currentId, needed).find(o => o.id === id)!

describe('packagingOptions', () => {
  it('zostawia same tuleje — folia i kartony nie są tuleją pozycji', () => {
    const lista = [
      t({ id: 'a', name: 'METAL 65' }),
      t({ id: 'b', name: 'Folia stretch', type: 'FOLIA' }),
      t({ id: 'c', name: 'KARTON 65', type: 'TULEJA' }),
    ]
    expect(packagingOptions(lista, '', 0).map(o => o.id).sort()).toEqual(['a', 'c'])
  })

  it('oznacza tuleję, która już stoi na pozycji', () => {
    const lista = [t({ id: 'a' }), t({ id: 'b', name: 'KARTON 65' })]
    expect(poId(lista, 'a', 0, 'a').current).toBe(true)
    expect(poId(lista, 'a', 0, 'b').current).toBe(false)
  })

  it('mówi, czy starczy na to, co jeszcze zostało do zrobienia', () => {
    const lista = [t({ id: 'a', kgAvailable: 8 }), t({ id: 'b', name: 'KARTON 65', kgAvailable: 30 })]
    expect(poId(lista, '', 12, 'a')).toMatchObject({ available: 8, enough: false })
    expect(poId(lista, '', 12, 'b')).toMatchObject({ available: 30, enough: true })
  })

  it('bez tulei na stanie nadal pokazuje pozycję — hala musi wiedzieć, że jest zero', () => {
    const [a] = packagingOptions([t({ id: 'a', kgAvailable: 0 })], '', 5)
    expect([a.available, a.enough]).toEqual([0, false])
  })

  it('układa te ze stanem przed pustymi, resztę alfabetycznie', () => {
    const lista = [
      t({ id: 'a', name: 'ZETKA 90', kgAvailable: 5 }),
      t({ id: 'b', name: 'ALFA 40', kgAvailable: 0 }),
      t({ id: 'c', name: 'BETA 50', kgAvailable: 7 }),
    ]
    expect(packagingOptions(lista, '', 0).map(o => o.name)).toEqual(['BETA 50', 'ZETKA 90', 'ALFA 40'])
  })

  it('obecna tuleja zostaje na liście nawet bez stanu — inaczej zniknęłaby operatorowi z oczu', () => {
    const lista = [t({ id: 'a', kgAvailable: 0 }), t({ id: 'b', name: 'KARTON 65' })]
    expect(packagingOptions(lista, 'a', 3).map(o => o.id)).toContain('a')
  })

  it('znosi śmieci z API bez wybuchu', () => {
    expect(packagingOptions(null as any, '', 0)).toEqual([])
    expect(packagingOptions([{ id: 'x', name: 'X', type: 'tuleja' } as any], '', 1)[0].available).toBe(0)
  })
})
