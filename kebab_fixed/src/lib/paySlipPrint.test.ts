import { describe, it, expect } from 'vitest'
import {
  settlementOverlapsRange, chunkIntoPages, pageCount, buildPaySlipsDocument,
} from './paySlipPrint'

const sample = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  worker_name: 'Jan Kowalski',
  worker_role: 'WORKER_DEBONING',
  date_from: '2026-07-13',
  date_to: '2026-07-19',
  kg_total: 820,
  rate_per_kg: 2,
  gross_amount: 1640,
  net_amount: 1440,
  deductions: [{ id: 'd1', description: 'zaliczka', amount: 200 }],
  work_dates_detail: [{ work_date: '2026-07-13', kg: 120.5 }],
  ...over,
})

describe('settlementOverlapsRange — filtr zakresu dat druku zbiorczego', () => {
  const s = { date_from: '2026-07-13', date_to: '2026-07-19' }

  it('okres w całości w zakresie', () => {
    expect(settlementOverlapsRange(s, '2026-07-01', '2026-07-31')).toBe(true)
  })

  it('zahacza początkiem lub końcem (brzegi włącznie)', () => {
    expect(settlementOverlapsRange(s, '2026-07-19', '2026-07-25')).toBe(true)
    expect(settlementOverlapsRange(s, '2026-07-06', '2026-07-13')).toBe(true)
  })

  it('całkowicie poza zakresem', () => {
    expect(settlementOverlapsRange(s, '2026-07-20', '2026-07-26')).toBe(false)
    expect(settlementOverlapsRange(s, '2026-07-06', '2026-07-12')).toBe(false)
  })

  it('pusty zakres = bez filtra (pokaż wszystko)', () => {
    expect(settlementOverlapsRange(s, '', '')).toBe(true)
    expect(settlementOverlapsRange(s, '2026-07-01', '')).toBe(true)
    expect(settlementOverlapsRange(s, '', '2026-07-12')).toBe(false)
  })
})

describe('chunkIntoPages — podział pasków na strony A4 po 4 (2×2)', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }))

  it('1 pasek → 1 strona dopełniona trzema pustymi', () => {
    const pages = chunkIntoPages(items(1))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(4)
    expect(pages[0].filter(x => x === null)).toHaveLength(3)
  })

  it('4 paski → 1 pełna strona bez pustych', () => {
    const pages = chunkIntoPages(items(4))
    expect(pages).toHaveLength(1)
    expect(pages[0].every(x => x !== null)).toBe(true)
  })

  it('5 pasków → 2 strony, druga z 3 pustymi', () => {
    const pages = chunkIntoPages(items(5))
    expect(pages).toHaveLength(2)
    expect(pages[1].filter(x => x === null)).toHaveLength(3)
  })

  it('12 pasków (typowa wypłata) → 3 pełne strony', () => {
    const pages = chunkIntoPages(items(12))
    expect(pages).toHaveLength(3)
    expect(pages.every(p => p.length === 4 && p.every(x => x !== null))).toBe(true)
  })

  it('0 pasków → 1 pusta strona (zachowanie dotychczasowego druku)', () => {
    const pages = chunkIntoPages([])
    expect(pages).toHaveLength(1)
    expect(pages[0]).toEqual([null, null, null, null])
  })

  it('kolejność zachowana wiersz po wierszu', () => {
    const pages = chunkIntoPages(items(6))
    expect(pages[0].map(x => (x ? x.id : null))).toEqual(['0', '1', '2', '3'])
    expect(pages[1].map(x => (x ? x.id : null))).toEqual(['4', '5', null, null])
  })
})

describe('buildPaySlipsDocument — dokument do druku', () => {
  it('kartka A4 POZIOMO, siatka 2×2 (297×210 mm)', () => {
    const html = buildPaySlipsDocument([sample()])
    expect(html).toContain('size: A4 landscape')
    expect(html).toContain('width:297mm')
    expect(html).toContain('height:210mm')
  })

  it('12 pasków → 3 kartki', () => {
    const html = buildPaySlipsDocument(Array.from({ length: 12 }, () => sample()))
    expect(html.match(/class="sheet"/g)).toHaveLength(3)
  })

  it('niepełna kartka ma puste komórki na dalsze paski', () => {
    const html = buildPaySlipsDocument([sample(), sample()])
    expect(html.match(/class="cell empty"/g)).toHaveLength(2)
  })

  it('dane pracownika i kwoty w formacie polskim', () => {
    const html = buildPaySlipsDocument([sample()])
    expect(html).toContain('Jan Kowalski')
    expect(html).toContain('Rozbiór')
    expect(html).toContain('1440,00 zł')    // do wypłaty (pl-PL nie grupuje 4 cyfr)
    expect(html).toContain('820,00 kg')     // suma kg
    expect(html).toContain('241,00 zł')     // zarobek dnia: 120,5 kg × 2 zł
    expect(html).toContain('zaliczka')      // potrącenie
  })

  it('kwoty 5-cyfrowe grupowane po polsku (spacja nierozdzielająca)', () => {
    const html = buildPaySlipsDocument([sample({ net_amount: 14400 })])
    expect(html).toContain('14 400,00 zł')
  })

  it('nazwiska ze znakami HTML nie rozbijają wydruku', () => {
    const html = buildPaySlipsDocument([sample({ worker_name: 'Jan <b>&</b> Syn' })])
    expect(html).not.toContain('<b>&</b> Syn')
    expect(html).toContain('Jan &lt;b&gt;&amp;&lt;/b&gt; Syn')
  })

  it('długie rozliczenie (>8 dni) łamie listę dni na dwie kolumny', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ work_date: `2026-07-${String(6 + i).padStart(2, '0')}`, kg: 100 }))
    const html = buildPaySlipsDocument([sample({ work_dates_detail: days })])
    expect(html).toContain('days-wrap split')
    expect(html.match(/<table class="days">/g)).toHaveLength(2)
    days.forEach(d => expect(html).toContain(d.work_date.slice(8) + '.07'))
  })

  it('krótkie rozliczenie zostaje w jednej kolumnie', () => {
    const days = Array.from({ length: 6 }, (_, i) => ({ work_date: `2026-07-1${i + 3}`, kg: 100 }))
    const html = buildPaySlipsDocument([sample({ work_dates_detail: days })])
    expect(html).not.toContain('days-wrap split')
    expect(html.match(/<table class="days">/g)).toHaveLength(1)
  })

  it('potrącenia na czerwono, kwota do wypłaty na zielono', () => {
    const html = buildPaySlipsDocument([sample()])
    expect(html).toContain('.minus{color:#c00000')
    expect(html).toContain('color:#166534')
    expect(html).toContain('print-color-adjust:exact')  // inaczej druk zignoruje kolory
  })

  it('kwoty nie łamią się do nowej linii (nowrap na liczbach)', () => {
    const html = buildPaySlipsDocument([sample()])
    expect(html).toContain('class="r bold nw">820,00 kg')
    expect(html).toContain('class="r bold nw">1640,00 zł')
    expect(html).toContain('td.r{width:1%}')
  })

  it('pasek bez rozpisanych dni i bez potrąceń nadal się generuje', () => {
    const html = buildPaySlipsDocument([sample({ work_dates_detail: [], deductions: [] })])
    expect(html).toContain('Jan Kowalski')
    expect(html).toContain('1440,00 zł')
  })
})

describe('pageCount — licznik kartek w stopce dialogu', () => {
  it('⌈n/4⌉, minimum 1', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(1)).toBe(1)
    expect(pageCount(4)).toBe(1)
    expect(pageCount(5)).toBe(2)
    expect(pageCount(12)).toBe(3)
    expect(pageCount(13)).toBe(4)
  })
})
