import { describe, expect, it } from 'vitest'
import { docNumberKey, compareDocNumbers } from './docNumberSort'

describe('docNumberKey — rozbiór numeru NN/MM/RR', () => {
  it('czyta numer HDI', () => {
    expect(docNumberKey('7/09/26')).toEqual([26, 9, 7])
  })
  it('czyta numer WZ z prefiksem', () => {
    expect(docNumberKey('WZ/14/09/26')).toEqual([26, 9, 14])
  })
  it('czyta numer anulowanego WZ', () => {
    expect(docNumberKey('ANUL WZ/9/09/26')).toEqual([26, 9, 9])
  })
  it('numer nierozpoznany trafia na koniec, nie wywraca sortowania', () => {
    expect(docNumberKey('')).toEqual([-1, -1, -1])
    expect(docNumberKey('brak numeru')).toEqual([-1, -1, -1])
  })
})

describe('compareDocNumbers — najnowszy pierwszy', () => {
  it('wrzesień stoi nad sierpniem, mimo niższego numeru', () => {
    // SEDNO BŁĘDU: sortowanie tekstowe stawiało „9/08/26" nad „7/09/26",
    // bo znak „9" > „7". Sierpniowe dokumenty lądowały nad wrześniowymi.
    expect(compareDocNumbers('7/09/26', '9/08/26')).toBeLessThan(0)
  })

  it('22/08 stoi pod 7/09 — inny miesiąc wygrywa z wyższym numerem', () => {
    expect(compareDocNumbers('7/09/26', '22/08/26')).toBeLessThan(0)
  })

  it('w tym samym miesiącu wyższy numer jest nowszy', () => {
    expect(compareDocNumbers('22/08/26', '9/08/26')).toBeLessThan(0)
  })

  it('nowszy rok wygrywa ze wszystkim', () => {
    expect(compareDocNumbers('1/01/27', '22/12/26')).toBeLessThan(0)
  })

  it('ten sam numer daje remis', () => {
    expect(compareDocNumbers('7/09/26', '7/09/26')).toBe(0)
  })

  it('działa na numerach WZ z prefiksem', () => {
    expect(compareDocNumbers('WZ/14/09/26', 'WZ/9/09/26')).toBeLessThan(0)
  })

  it('cała lista układa się od najnowszego', () => {
    const wej = ['1/09/26', '22/08/26', '7/09/26', '9/08/26', '16/08/26']
    expect([...wej].sort(compareDocNumbers)).toEqual([
      '7/09/26', '1/09/26', '22/08/26', '16/08/26', '9/08/26',
    ])
  })

  it('numery nierozpoznane spadają na koniec', () => {
    const wej = ['brak', '7/09/26', '', '1/09/26']
    const out = [...wej].sort(compareDocNumbers)
    expect(out.slice(0, 2)).toEqual(['7/09/26', '1/09/26'])
    expect(out.slice(2).sort()).toEqual(['', 'brak'])
  })
})
