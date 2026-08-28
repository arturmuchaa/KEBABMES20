/**
 * HDI musi wyjść na JEDNEJ stronie A4 — na dole jest pole na podpis
 * i pieczęć, i to ono spadało na drugą stronę.
 *
 * Zapas mierzony doświadczalnie (headless Chrome, @page margin 5mm):
 * zadrukowana A4 kończy się na 1085 px — 1085 px jeszcze się mieści,
 * 1090 px już przelewa. Te testy pilnują, żeby nikt nie podniósł progów
 * z powrotem pod krawędź.
 */
import { describe, it, expect } from 'vitest'
import {
  A4_PRINTABLE_PX, A4_FILL_PX, A4_MAX_PX, MAX_ROWS, MIN_SCALE,
  bodyRowsFor, baseHeight, fitFor, fitChanged, sheetWidthPct, SHEET_WIDTH_MM,
  shouldApplyFit, MAX_FIT_PASSES, type FitState,
} from './hdiFit'

describe('zapas do krawędzi kartki', () => {
  it('wypełnienie zostawia co najmniej 25 mm luzu', () => {
    const luzMm = (A4_PRINTABLE_PX - A4_FILL_PX) / 96 * 25.4
    expect(luzMm).toBeGreaterThanOrEqual(25)
  })

  it('nawet arkusz tuż pod progiem skalowania ma ponad 20 mm luzu', () => {
    const luzMm = (A4_PRINTABLE_PX - A4_MAX_PX) / 96 * 25.4
    expect(luzMm).toBeGreaterThanOrEqual(20)
  })

  it('próg skalowania nie jest niżej niż cel wypełnienia', () => {
    expect(A4_MAX_PX).toBeGreaterThanOrEqual(A4_FILL_PX)
  })
})

describe('fitFor — arkusz mieszczący się', () => {
  it('rozkłada wolne miejsce równo na wiersze', () => {
    const f = fitFor(800, 15)
    expect(f.scale).toBe(1)
    expect(f.scaledH).toBeNull()
    expect(f.rowExtra).toBeCloseTo((A4_FILL_PX - 800) / 15, 5)
  })

  it('po rozłożeniu arkusz trafia dokładnie w cel wypełnienia', () => {
    const h0 = 800, rows = 15
    const f = fitFor(h0, rows)
    expect(h0 + f.rowExtra * rows).toBeCloseTo(A4_FILL_PX, 5)
  })

  it('nie rozciąga pojedynczego wiersza w nieskończoność', () => {
    expect(fitFor(100, 2).rowExtra).toBeLessThanOrEqual(40)
  })

  it('arkusz już wyższy od celu nie jest ściskany, dopóki mieści się w progu', () => {
    const f = fitFor(A4_FILL_PX + 10, 15)
    expect(f.rowExtra).toBe(0)
    expect(f.scale).toBe(1)
  })

  it('bez wierszy nie ma czego rozkładać', () => {
    expect(fitFor(500, 0).rowExtra).toBe(0)
  })
})

describe('fitFor — arkusz przepełniony', () => {
  it('skaluje w dół do progu', () => {
    const f = fitFor(1300, 20)
    expect(f.scale).toBeCloseTo(A4_MAX_PX / 1300, 5)
    expect(f.rowExtra).toBe(0)
    expect(f.scaledH).toBe(Math.ceil(1300 * (A4_MAX_PX / 1300)))
  })

  it('po przeskalowaniu arkusz mieści się na kartce', () => {
    for (const h0 of [1001, 1200, 1500, 1800]) {
      const f = fitFor(h0, 20)
      expect(Math.ceil(h0 * f.scale)).toBeLessThanOrEqual(A4_PRINTABLE_PX)
    }
  })

  it('nie schodzi poniżej granicy czytelności', () => {
    expect(fitFor(9000, 60).scale).toBe(MIN_SCALE)
  })
})

describe('bodyRowsFor', () => {
  it('krótki dokument dopełniamy do pełnej tabeli', () => {
    expect(bodyRowsFor(3)).toBe(MAX_ROWS)
    expect(bodyRowsFor(MAX_ROWS)).toBe(MAX_ROWS)
  })
  it('długi dokument liczy własne wiersze', () => {
    expect(bodyRowsFor(22)).toBe(22)
  })
})

describe('baseHeight — zdejmowanie własnego naddatku', () => {
  it('odejmuje rozłożone podwyższenie wierszy', () => {
    expect(baseHeight(980, { rowExtra: 12, scale: 1, scaledH: null }, 15)).toBe(800)
  })
  it('odwraca skalowanie', () => {
    expect(baseHeight(1000, { rowExtra: 0, scale: 0.5, scaledH: 1000 }, 20)).toBe(2000)
  })
  it('pomiar bez naddatku zostaje sobą', () => {
    expect(baseHeight(870, { rowExtra: 0, scale: 1, scaledH: null }, 15)).toBe(870)
  })
})

describe('pętla dopasowania zbiega', () => {
  it('drugi przebieg nie zmienia już nic', () => {
    const h0 = 812, rows = 15
    const a = fitFor(h0, rows)
    const zmierzone = h0 + a.rowExtra * rows          // tyle pokaże DOM po przerysowaniu
    const b = fitFor(baseHeight(zmierzone, a, rows), rows)
    expect(fitChanged(a, b)).toBe(false)
  })

  it('fitChanged ignoruje drgania poniżej progu', () => {
    const a = { rowExtra: 10, scale: 1, scaledH: null }
    expect(fitChanged(a, { rowExtra: 10.2, scale: 1, scaledH: null })).toBe(false)
    expect(fitChanged(a, { rowExtra: 11, scale: 1, scaledH: null })).toBe(true)
  })
})

describe('szerokość arkusza — pełna A4, bez białych pasów po bokach', () => {
  it('bez skalowania arkusz zajmuje całą obudowę', () => {
    expect(sheetWidthPct(1)).toBe(100)
  })

  it('przy skalowaniu arkusz jest ROZSZERZANY, żeby po skalowaniu wypełnić stronę', () => {
    // Skala 0,8 sama z siebie zostawiała ~20 % kartki na boczne marginesy
    // i tabela robiła się nieczytelna (biuro, 27.08.2026, HDI na 16 pozycji).
    expect(sheetWidthPct(0.8)).toBeCloseTo(125, 3)
    expect(0.8 * sheetWidthPct(0.8)).toBeCloseTo(100, 3)
  })

  it('każda dopuszczalna skala wypełnia szerokość dokładnie', () => {
    for (const s of [0.95, 0.9, 0.75, 0.6, MIN_SCALE]) {
      expect(s * sheetWidthPct(s)).toBeCloseTo(100, 3)
    }
  })

  it('arkusz A4 wykorzystuje szerokość kartki, nie 194 mm', () => {
    // Zadrukowana szerokość A4 przy marginesie 5 mm to 200 mm.
    expect(SHEET_WIDTH_MM).toBeGreaterThanOrEqual(198)
    expect(SHEET_WIDTH_MM).toBeLessThanOrEqual(200)
  })
})

// ── Bezpiecznik pętli dopasowania ─────────────────────────────────────────
//
// 28.08.2026: wydruk HDI otwarty na TELEFONIE wywalał aplikację na
// „Maximum update depth exceeded" (React #185). Dopasowanie jest pętlą
// zmierz→przeskaluj→zmierz, a na wąskim ekranie arkusz dostawał szerokość
// zależną od skali, więc każda nowa skala łamała wiersze inaczej i wysokość
// skakała w nieskończoność. Szerokość arkusza jest już usztywniona; ten limit
// zostaje jako bezpiecznik — ekran wydruku nie może położyć całej aplikacji.

describe('shouldApplyFit', () => {
  const a: FitState = { rowExtra: 0, scale: 1, scaledH: null }
  const b: FitState = { rowExtra: 12, scale: 1, scaledH: null }

  it('przepuszcza zmianę, dopóki nie wyczerpie limitu przebiegów', () => {
    expect(shouldApplyFit(a, b, 0)).toBe(true)
    expect(shouldApplyFit(a, b, MAX_FIT_PASSES - 1)).toBe(true)
  })

  it('po limicie NIE przepuszcza, choćby stan wciąż się różnił', () => {
    expect(shouldApplyFit(a, b, MAX_FIT_PASSES)).toBe(false)
    expect(shouldApplyFit(a, b, MAX_FIT_PASSES + 5)).toBe(false)
  })

  it('nie przerysowuje, gdy stan jest ten sam — limit tu nie ma znaczenia', () => {
    expect(shouldApplyFit(a, { ...a }, 0)).toBe(false)
  })

  it('limit jest mały — pętla ma się urwać, zanim zamuli przeglądarkę', () => {
    expect(MAX_FIT_PASSES).toBeGreaterThan(2)
    expect(MAX_FIT_PASSES).toBeLessThan(20)
  })
})
