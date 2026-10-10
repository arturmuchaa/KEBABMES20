import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { CARTON_QR_OPTIONS, CARTON_QR_SIZE_MM, palletQrPayload } from './cartonQr'
import { czyKompletnyKod, kodKartki } from '@/features/scan/skanKodu'
import { utworzBuforSkanu, type Ramka } from '@/features/scan/buforSkanu'

const ID = '3a314e1a29c64d1ab676'

describe('QR pod stretch — krótki zapis i większe moduły', () => {
  it('ma mniej modułów niż poprzedni URL, bez utraty danych identyfikacyjnych', () => {
    const code = palletQrPayload(ID, 13)
    const old = `http://tauri.localhost/m/p/${ID}/13`
    const small = QRCode.create(code, CARTON_QR_OPTIONS)
    const large = QRCode.create(old, CARTON_QR_OPTIONS)
    expect(code).toBe(`PAL|${ID}|13\r`)
    expect(code.length).toBeLessThan(old.length)
    expect(small.modules.size).toBeLessThan(large.modules.size)
    const oldModuleMm = 38 / (large.modules.size + 8)
    const newModuleMm = CARTON_QR_SIZE_MM / (small.modules.size + 8)
    expect(newModuleMm).toBeGreaterThan(oldModuleMm * 1.8)
  })

  it.each([1, 13, 125])('nowa i stara kartka P%i są rozpoznawane przez skaner MES', no => {
    for (const code of [palletQrPayload(ID, no), `http://tauri.localhost/m/p/${ID}/${no}`]) {
      expect(czyKompletnyKod(code)).toBe(true)
      expect(kodKartki(code)).toEqual({ rodzaj: 'order', kod: code.trim() })
    }
  })

  it.each(['pole', 'globalny'] as const)('nowe QR kończą się od razu, bez timera i bez sklejenia (%s)', tryb => {
    const b = utworzBuforSkanu({ tryb })
    const numery = [1, 12, 123, 2]
    const out: Ramka[] = []
    let time = 1000
    for (const n of numery) {
      for (const ch of palletQrPayload(ID, n)) out.push(...b.dodaj(ch, time++))
      // Już w chwili Entera, bez wywołania tik ani czekania 800 ms.
      expect(out[out.length - 1]).toEqual({ rodzaj: 'kod', kod: `PAL|${ID}|${n}` })
      expect(b.reszta()).toBe('')
      expect(b.nastepnyTik()).toBeNull()
    }
    expect(out.map(r => r.rodzaj === 'kod' && r.kod)).toEqual(numery.map(n => `PAL|${ID}|${n}`))
  })

  it('karton magazynowy zachowuje swój odrębny format i id', () => {
    expect(kodKartki(`SCARTON|${ID}`)).toEqual({ rodzaj: 'stock', id: ID, kod: `SCARTON|${ID}` })
    expect(CARTON_QR_OPTIONS).toMatchObject({ errorCorrectionLevel: 'Q', margin: 4, scale: 20 })
  })
})
