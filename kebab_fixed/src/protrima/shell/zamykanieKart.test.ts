import { describe, it, expect } from 'vitest'
import { doZamkniecia, poZamknieciu } from './zamykanieKart'
import type { WTab } from './Chrome'

const t = (id: string, kind: WTab['kind'] = 'module'): WTab => ({ id, kind, key: id, title: id })
const KARTY = [t('pulpit'), t('rozbior'), t('order:1', 'order'), t('new:1', 'new-order')]

describe('doZamkniecia', () => {
  it('wszystkie: bez Pulpitu, edytory osobno', () => {
    const r = doZamkniecia(KARTY, 'wszystkie', 'rozbior')
    expect(r.zwykle).toEqual(['rozbior', 'order:1'])
    expect(r.edycja.map(x => x.id)).toEqual(['new:1'])
  })
  it('pozostale: pomija kliknietą kartę i Pulpit', () => {
    const r = doZamkniecia(KARTY, 'pozostale', 'rozbior')
    expect(r.zwykle).toEqual(['order:1'])
    expect(r.edycja.map(x => x.id)).toEqual(['new:1'])
  })
  it('jedna: sama kliknięta; edytor trafia do edycji', () => {
    expect(doZamkniecia(KARTY, 'jedna', 'order:1')).toEqual({ zwykle: ['order:1'], edycja: [] })
    expect(doZamkniecia(KARTY, 'jedna', 'new:1').edycja.map(x => x.id)).toEqual(['new:1'])
  })
  it('Pulpitu nigdy nie zamyka', () => {
    expect(doZamkniecia(KARTY, 'jedna', 'pulpit')).toEqual({ zwykle: [], edycja: [] })
  })
})

describe('poZamknieciu', () => {
  it('aktywna zamknięta → pierwsza pozostała inna niż Pulpit', () => {
    const r = poZamknieciu(KARTY, ['rozbior', 'order:1'], 'rozbior')
    expect(r.tabs.map(x => x.id)).toEqual(['pulpit', 'new:1'])
    expect(r.active).toBe('new:1')
  })
  it('wszystko zamknięte → Pulpit', () => {
    const r = poZamknieciu(KARTY, ['rozbior', 'order:1', 'new:1'], 'new:1')
    expect(r.tabs.map(x => x.id)).toEqual(['pulpit'])
    expect(r.active).toBe('pulpit')
  })
  it('aktywna zostaje → bez zmiany', () => {
    expect(poZamknieciu(KARTY, ['order:1'], 'rozbior').active).toBe('rozbior')
  })
})
