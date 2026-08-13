/**
 * KARTA PRODUKCJI KEBAB — wiersze wydruku dla kierownika produkcji.
 *
 * Wzorzec: kartka, którą biuro dotąd wypełniało ręcznie (Excel). Kolejność
 * pozycji MUSI być taka, jak przy planowaniu, a kolumna NR PARTII niesie
 * podział na partie — kierownik nie ma jeszcze HMI, więc kartka jest
 * jedynym nośnikiem tej informacji na hali.
 */
import { describe, it, expect } from 'vitest'
import { buildProductionCard, formatBatchSplit, BLANK_ROWS } from './productionCard'

const line = (o: Partial<any> = {}): any => ({
  qty: 36, kgPerUnit: 30, recipeName: 'KIRMIZI',
  packagingName: 'METAL 65CM', clientName: 'NAZAR',
  batchAllocation: { '472': { pieces: 36, kg: 1080, batch_id: 'b472' } },
  ...o,
})

describe('formatBatchSplit', () => {
  it('jedna partia = sam numer, bez mnożnika', () => {
    expect(formatBatchSplit({ '472': { pieces: 36, kg: 1080 } })).toBe('472')
  })

  it('podział na partie = „1x470, 19x472" jak na kartce ręcznej', () => {
    expect(formatBatchSplit({
      '470': { pieces: 1, kg: 25 },
      '472': { pieces: 19, kg: 475 },
    })).toBe('1x470, 19x472')
  })

  it('sztuka z resztek niesie numer łączony', () => {
    expect(formatBatchSplit({
      '472': { pieces: 8, kg: 200 },
      '471/472': { pieces: 1, kg: 25, parts: {} },
    })).toBe('8x472, 1x471/472')
  })

  it('partie z zerem sztuk nie zaśmiecają kolumny', () => {
    expect(formatBatchSplit({
      '470': { pieces: 30, kg: 900 },
      'PP11': { pieces: 0, kg: 0 },
    })).toBe('470')
  })

  it('brak alokacji = pusto (planista dopisze długopisem)', () => {
    expect(formatBatchSplit({})).toBe('')
    expect(formatBatchSplit(null)).toBe('')
  })
})

describe('buildProductionCard', () => {
  it('zachowuje kolejność pozycji z planu', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13',
      lines: [
        line({ clientName: 'NAZAR' }),
        line({ clientName: 'ZAGROS' }),
        line({ clientName: 'POLAT' }),
      ],
    } as any)
    expect(card.rows.filter(r => !r.blank).map(r => r.client))
      .toEqual(['NAZAR', 'ZAGROS', 'POLAT'])
  })

  it('pozycje idą pod sobą — BEZ pustych separatorów między klientami', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13',
      lines: [
        line({ clientName: 'NAZAR' }),
        line({ clientName: 'NAZAR' }),
        line({ clientName: 'ZAGROS' }),
      ],
    } as any)
    const uklad = card.rows.slice(0, 4).map(r => r.blank ? '—' : r.client)
    expect(uklad).toEqual(['NAZAR', 'NAZAR', 'ZAGROS', '—'])
    // puste wiersze WYŁĄCZNIE na końcu, na dopiski
    expect(card.rows.filter(r => r.blank)).toHaveLength(BLANK_ROWS)
  })

  it('dokłada puste wiersze na dopiski długopisem', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13', lines: [line()],
    } as any)
    expect(card.rows.filter(r => r.blank)).toHaveLength(BLANK_ROWS)
  })

  it('tabela ZAWSZE ma tyle wierszy, ile mieści strona — reszta pusta', () => {
    // 3 pozycje na stronie mieszczącej 16 → 13 pustych, kartka wygląda
    // tak samo jak przy 10 pozycjach (uwaga biura: „musi być zawsze taka sama")
    const card = buildProductionCard(
      { planDate: '2026-08-13', lines: [line(), line(), line()] } as any,
      { rowsPerPage: 16 },
    )
    expect(card.rows).toHaveLength(16)
    expect(card.rows.filter(r => r.blank)).toHaveLength(13)
  })

  it('plan dłuższy niż strona dostaje zapas na dopiski, nie obcięcie', () => {
    const lines = Array.from({ length: 20 }, () => line())
    const card = buildProductionCard(
      { planDate: '2026-08-13', lines } as any, { rowsPerPage: 16 },
    )
    expect(card.rows).toHaveLength(20 + BLANK_ROWS)
  })

  it('KLIENT pokazuje nazwę wyświetlaną, nie pełną rejestrową', () => {
    const card = buildProductionCard(
      { planDate: '2026-08-13', lines: [line({ clientName: 'SZUMERA SP. Z O.O.' })] } as any,
      { clientName: n => n === 'SZUMERA SP. Z O.O.' ? 'SZUMERA' : n },
    )
    expect(card.rows[0].client).toBe('SZUMERA')
  })

  it('liczy ILOŚĆ jako sumę kg pozycji', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13',
      lines: [line({ qty: 36, kgPerUnit: 30 }), line({ qty: 30, kgPerUnit: 25 })],
    } as any)
    expect(card.totalKg).toBe(36 * 30 + 30 * 25)
  })

  it('wiersz niesie wszystkie kolumny kartki', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13',
      lines: [line({
        qty: 20, kgPerUnit: 25, recipeName: 'KIRMIZI',
        packagingName: 'METAL 65CM', clientName: 'ZAGROS',
        batchAllocation: {
          '470': { pieces: 1, kg: 25 },
          '472': { pieces: 19, kg: 475 },
        },
      })],
    } as any)
    expect(card.rows[0]).toMatchObject({
      qty: 20, kgPerUnit: 25, kind: 'KIRMIZI', sleeve: 'METAL 65CM',
      client: 'ZAGROS', totalKg: 500, batches: '1x470, 19x472',
    })
  })

  it('dzień tygodnia po polsku, wielkimi literami', () => {
    // 13.08.2026 to czwartek — jak na wzorcowej kartce
    expect(buildProductionCard({ planDate: '2026-08-13', lines: [] } as any).weekday)
      .toBe('CZWARTEK')
  })

  it('pozycja bez opakowania i klienta nie wywraca wiersza', () => {
    const card = buildProductionCard({
      planDate: '2026-08-13',
      lines: [line({ packagingName: undefined, clientName: undefined })],
    } as any)
    expect(card.rows[0].sleeve).toBe('')
    expect(card.rows[0].client).toBe('')
  })
})
