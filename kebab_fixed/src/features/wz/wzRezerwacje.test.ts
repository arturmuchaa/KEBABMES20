import { describe, expect, it } from 'vitest'
import { rezerwacjeObcegoKlienta } from './wzRezerwacje'

const r = (over: Partial<any> = {}): any => ({
  stockType: 'fg', stockId: 'fg1', qtyStr: '12',
  clientOrderNo: 'YALCIN/Z/1/09/26', clientName: 'YALCIN', ...over,
})

describe('rezerwacjeObcegoKlienta', () => {
  it('ostrzega, gdy zarezerwowany towar jedzie do KOGOŚ INNEGO', () => {
    expect(rezerwacjeObcegoKlienta([r()], 'POLAT')).toEqual([
      { orderNo: 'YALCIN/Z/1/09/26', qty: 12, clientName: 'YALCIN' },
    ])
  })

  it('NIE ostrzega, gdy towar jedzie do właściciela zamówienia', () => {
    // To zwykła realizacja — pytanie przy każdej wysyłce byłoby szumem,
    // a szum uczy klikać „tak" bez czytania.
    expect(rezerwacjeObcegoKlienta([r()], 'YALCIN')).toEqual([])
  })

  it('nazwę odbiorcy porównuje bez względu na wielkość liter i spacje', () => {
    expect(rezerwacjeObcegoKlienta([r()], '  yalcin ')).toEqual([])
  })

  it('towar BEZ stempla nie wywołuje pytania', () => {
    expect(rezerwacjeObcegoKlienta([r({ clientOrderNo: null })], 'POLAT')).toEqual([])
    expect(rezerwacjeObcegoKlienta([r({ clientOrderNo: '' })], 'POLAT')).toEqual([])
  })

  it('pozycje surowcowe pomija — stempel dotyczy wyrobu', () => {
    expect(rezerwacjeObcegoKlienta([r({ stockType: 'raw' })], 'POLAT')).toEqual([])
  })

  it('sumuje sztuki w obrębie jednego zamówienia', () => {
    const out = rezerwacjeObcegoKlienta(
      [r({ stockId: 'a', qtyStr: '12' }), r({ stockId: 'b', qtyStr: '5' })], 'POLAT')
    expect(out).toEqual([{ orderNo: 'YALCIN/Z/1/09/26', qty: 17, clientName: 'YALCIN' }])
  })

  it('rozdziela różne zamówienia i sortuje od największego', () => {
    const out = rezerwacjeObcegoKlienta([
      r({ stockId: 'a', clientOrderNo: 'A/1', qtyStr: '5' }),
      r({ stockId: 'b', clientOrderNo: 'B/2', qtyStr: '12' }),
    ], 'POLAT')
    expect(out.map(x => x.orderNo)).toEqual(['B/2', 'A/1'])
  })

  it('pozycja z ilością zero nie liczy się do ostrzeżenia', () => {
    expect(rezerwacjeObcegoKlienta([r({ qtyStr: '0' })], 'POLAT')).toEqual([])
  })

  it('bez wybranego odbiorcy nie ostrzegamy — nie ma z czym porównać', () => {
    expect(rezerwacjeObcegoKlienta([r()], '')).toEqual([])
  })
})
