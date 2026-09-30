import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import type { WazenieMrozni } from '@/lib/api'
import { A0_SZER, dataGodzina, etykietaWagiZpl, mm, WAGA_H_MM, WAGA_W_MM } from './etykietaWagiZpl'

const W: WazenieMrozni = {
  id: 'w1', code: 'SCARTON|c1', containerKind: 'stock', containerId: 'c1', cartonNo: '000123',
  clientName: 'YALCIN', orderNo: '',
  lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: 'UDO' }],
  batches: [{ batchNo: '290926 591', qty: 3 }, { batchNo: '290926 592', qty: 12 }],
  palletTypeId: 'euro', palletTypeName: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, tareKg: 35,
  marginPct: 1, grossKg: 780, netKg: 750, diffKg: -5, ok: true, weighMode: 'auto',
  operator: 'Jan', weighedAt: '2026-09-29T10:24:00',
}

/** Każde pole A0 musi się zmieścić w szerokości taśmy od swojego ^FO. */
function polaPozaTasma(zpl: string): string[] {
  const zle: string[] = []
  for (const m of zpl.matchAll(/\^FO(\d+),\d+\^A0N,\d+,(\d+)(?:\^FB\d+,1,0,C)?(?:\^FR)?\^FD([^^]*)\^FS/g)) {
    const x = Number(m[1]); const width = Number(m[2]); const txt = m[3]
    if (x + txt.length * width * A0_SZER > mm(WAGA_W_MM) - mm(3)) zle.push(txt)
  }
  return zle
}

describe('etykieta ważenia 100×150', () => {
  it('rozmiar taśmy i UTF-8', () => {
    const z = etykietaWagiZpl(W, { kod: 'SCARTON|c1' })
    expect(z).toContain(`^PW${mm(WAGA_W_MM)}`)
    expect(z).toContain(`^LL${mm(WAGA_H_MM)}`)
    expect(z).toContain('^CI28')
    expect(z.startsWith('^XA') && z.endsWith('^XZ')).toBe(true)
  })

  it('treść z przykładu właściciela: skład, netto, brutto, werdykt, godzina', () => {
    const z = etykietaWagiZpl(W, { kod: 'SCARTON|c1' })
    for (const s of ['KARTON', '000123', 'YALCIN', 'MAGAZYN', '15 × 50 kg ZAGROS', '750 kg', '780 kg',
      'Paleta EURO', 'ZGODNA', '29.09.2026 10:24', 'Jan', 'QA,SCARTON|c1']) {
      expect(z).toContain(s)
    }
    expect(z).not.toContain('RĘCZNIE')
    // bez widełek tary (właściciel 29.09.2026)
    expect(z).not.toContain('tara')
    expect(z).not.toContain('33,25')
  })

  it('niezgodna z różnicą, ręcznie, zamówienie', () => {
    const z = etykietaWagiZpl({ ...W, ok: false, diffKg: 12.5, weighMode: 'manual',
      containerKind: 'order', orderNo: 'YALCIN/Z/4' }, { kod: 'PAL|o1|1' })
    expect(z).toContain('NIEZGODNA +12,5 kg')
    expect(z).toContain('RĘCZNIE')
    expect(z).toContain('ZAMÓWIENIE YALCIN/Z/4')
  })

  it('długie nazwy nie wychodzą poza taśmę', () => {
    const z = etykietaWagiZpl({ ...W, clientName: 'BARDZO DŁUGA NAZWA ODBIORCY SPÓŁKA Z O.O. GMBH',
      lines: Array.from({ length: 7 }, (_, i) => ({ qty: 20, kgPerUnit: 12.5, recipeName: `RECEPTURA DŁUGA NUMER ${i}`, productTypeName: '' })),
      ok: false, diffKg: -1234.5 }, { kod: 'x' })
    expect(polaPozaTasma(z)).toEqual([])
    expect(z).toContain('+ 4 poz. więcej')
  })

  it('godzina w czasie lokalnym', () => {
    expect(dataGodzina('2026-09-29T07:05:00')).toBe('29.09.2026 07:05')
    expect(dataGodzina('')).toBe('')
  })

  it('wykaz partii w słupku: ile sztuk z której partii', () => {
    const z = etykietaWagiZpl(W, { kod: 'SCARTON|c1' })
    expect(z).toContain('PARTIE')
    expect(z).toContain('^FD3 szt^FS')
    expect(z).toContain('^FD290926 591^FS')
    expect(z).toContain('^FD12 szt^FS')
    expect(z).toContain('^FD290926 592^FS')
    // słupek: ilości w jednej kolumnie (ten sam ^FO x), partie w drugiej
    const x = (t: string) => new RegExp(`\\^FO(\\d+),\\d+\\^A0N[^\\^]*\\^FD${t}\\^FS`).exec(z)?.[1]
    expect(x('3 szt')).toBe(x('12 szt'))
    expect(x('290926 591')).toBe(x('290926 592'))
    expect(Number(x('290926 591'))).toBeGreaterThan(Number(x('3 szt')))
  })

  it('dużo partii mieści się w dwóch słupkach, reszta jako „+N"', () => {
    const batches = Array.from({ length: 14 }, (_, i) => ({ batchNo: `290926 ${600 + i}`, qty: 2 }))
    const z = etykietaWagiZpl({ ...W, batches }, { kod: 'x' })
    expect(z).toContain('290926 600')
    expect(z).toMatch(/\+ \d+ partii więcej/)
    expect(polaPozaTasma(z)).toEqual([])
  })

  it.each([
    'SCARTON|c1',
    'SCARTON|01234567-89ab-4cde-8f01-23456789abcd',
    'PAL|01234567-89ab-4cde-8f01-23456789abcd|123',
  ])('większy QR z pełnym kodem %s mieści się z białym marginesem', kod => {
    const z = etykietaWagiZpl(W, { kod })
    const field = /\^FO(\d+),(\d+)\^BQN,2,(\d+)\^FDQA,([^^]*)\^FS/.exec(z)!
    expect(field[4]).toBe(kod)
    const [x, y, module] = field.slice(1, 4).map(Number)
    const size = QRCode.create([{ data: new TextEncoder().encode(kod), mode: 'byte' }], { errorCorrectionLevel: 'Q' }).modules.size
    // Poprzedni moduł = 4 punkty. UUID ma teraz co najmniej 6 (50% większy).
    expect(module).toBeGreaterThanOrEqual(6)
    expect(x - 4 * module).toBeGreaterThanOrEqual(mm(63))
    expect(y - 4 * module).toBeGreaterThanOrEqual(mm(113))
    expect(x + (size + 4) * module).toBeLessThanOrEqual(mm(95))
    expect(y + (size + 4) * module).toBeLessThanOrEqual(mm(145))
    // Żaden tekst stopki nie może wejść do białego pola kodu.
    for (const m of z.matchAll(/\^FO(\d+),(\d+)\^A0N,\d+,(\d+)\^FD([^^]*)\^FS/g)) {
      if (Number(m[2]) < mm(113)) continue
      expect(Number(m[1]) + Number(m[3]) * m[4].length * A0_SZER).toBeLessThan(mm(63))
    }
  })
})
