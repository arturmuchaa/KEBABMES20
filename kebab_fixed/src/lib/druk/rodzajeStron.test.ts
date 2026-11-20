/**
 * Strażnik: każdy wydruk dokumentu w MES podaje swój rodzaj. Bez tego WZ, CMR,
 * HDI… dzieliły jedno zapamiętane ustawienie („inne”) — CMR z zielonego
 * zasobnika i następna WZ też szła na zielonym (przegląd 19.11.2026, I2).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const STRONY: Record<string, string> = {
  'src/pages/office/WzPrintPage.tsx': "'wm' : 'wz'",
  'src/pages/office/CmrPrintPage.tsx': "'cmr'",
  'src/pages/office/HdiPrintPage.tsx': "'hdi'",
  'src/pages/office/ContainerDocPrintPage.tsx': "'wz-pojemniki'",
  'src/pages/office/OrderPrintPage.tsx': "'zamowienie'",
  'src/pages/office/OrderPickingPrintPage.tsx': "'lista-kompletacji'",
  'src/pages/office/MixingPlanPrintPage.tsx': "'plan-masowania'",
  'src/pages/office/LabelPrintPage.tsx': "'etykiety'",
}

describe('rodzaj dokumentu przy każdym wydruku MES', () => {
  for (const [plik, rodzaj] of Object.entries(STRONY)) {
    it(plik, () => {
      const kod = readFileSync(resolve(__dirname, '../../..', plik), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
      const wywolania = [...kod.matchAll(/\bdrukuj\(([^)]*)\)/g)].map(m => m[1])
      expect(wywolania.length).toBeGreaterThan(0)
      for (const arg of wywolania) expect(arg, `drukuj(${arg})`).toMatch(/rodzaj/)
      expect(kod).toContain(rodzaj)
    })
  }
})
