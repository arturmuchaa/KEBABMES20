import { describe, it, expect } from 'vitest'

import { etapyPalety, type SladPalety } from './etapyPalety'

/**
 * Łańcuch etapów palety: produkcja → magazyn → karton → paleta → wydanie.
 *
 * Właściciel 24.09.2026: „P1 na auto nic mi nie mówi — chcę widzieć, gdzie
 * ewentualnie jaka sztuka zaginęła przy reklamacji". Sedno jest w tym, że
 * etapy BEZ danych muszą być widoczne, bo to one mówią, gdzie ślad się urywa.
 */
const PALETA: SladPalety = {
  pallet_no: 1,
  status: 'shipped',
  sklad: [{ qty: 20, kg_per_unit: 40, rodzaj: 'KEBAB UDO 100%', receptura: 'BULLI' }],
  sztuki: { zadeklarowane: 20, sledzone: 0 },
  zdarzenia: [
    { action: 'cold_storage', scanned_at: '2026-09-23T08:00:00Z', operator: 'VLAD M.', vehicle: '' },
    { action: 'loaded', scanned_at: '2026-09-23T10:14:00Z', operator: 'VLAD M.', vehicle: 'SOLÓWKA KR 8842L' },
    { action: 'undo', scanned_at: '2026-09-23T10:16:00Z', operator: 'VLAD M.', vehicle: 'SOLÓWKA KR 8842L' },
    { action: 'loaded', scanned_at: '2026-09-23T10:22:00Z', operator: 'VLAD M.', vehicle: 'SOLÓWKA KR 8842L' },
  ],
}

describe('etapyPalety', () => {
  it('zawsze oddaje PEŁNY łańcuch, także etapy bez danych', () => {
    // Gdyby puste etapy wypadały, okno odpowiadałoby wyłącznie na pytania,
    // na które i tak znamy odpowiedź — a szukamy miejsca, gdzie ślad ginie.
    expect(etapyPalety(PALETA).map(e => e.kod)).toEqual(
      ['produkcja', 'magazyn', 'karton', 'paleta', 'wydanie'])
  })

  it('skany mroźni trafiają na etap palety', () => {
    const paleta = etapyPalety(PALETA).find(e => e.kod === 'paleta')!
    expect(paleta.zdarzenia.map(z => z.action)).toEqual(['cold_storage'])
  })

  it('załadunek i cofnięcie trafiają na etap wydania, w kolejności', () => {
    const wydanie = etapyPalety(PALETA).find(e => e.kod === 'wydanie')!
    expect(wydanie.zdarzenia.map(z => z.action)).toEqual(['loaded', 'undo', 'loaded'])
  })

  it('etapy sztukowe są oznaczone jako BEZ ŹRÓDŁA, dopóki hala nie skanuje', () => {
    /** To jest zdanie, które ma paść przy reklamacji: dalej niż paleta nie
     *  wiemy, bo produkcji nikt nie skanuje. Nie „brak zdarzeń" — brak
     *  ŹRÓDŁA; to dwie różne informacje. */
    const stany = etapyPalety(PALETA)
    expect(stany.find(e => e.kod === 'produkcja')!.stan).toBe('brak_zrodla')
    expect(stany.find(e => e.kod === 'magazyn')!.stan).toBe('brak_zrodla')
    expect(stany.find(e => e.kod === 'karton')!.stan).toBe('brak_zrodla')
  })

  it('etap sztukowy ożywa, gdy sztuki mają numery', () => {
    /** Gniazdo na przyszłość: ta sama funkcja, żadnej przebudowy okna. */
    const zeSztukami = { ...PALETA, sztuki: { zadeklarowane: 20, sledzone: 20 } }
    expect(etapyPalety(zeSztukami).find(e => e.kod === 'produkcja')!.stan).toBe('pusty')
  })

  it('etap ze źródłem, ale bez skanu tej palety, to PUSTY — nie brak źródła', () => {
    /** Paleta, której nikt nie wstawił do mroźni, to realna informacja:
     *  źródło jest, zdarzenia nie ma. */
    const bezMrozni = { ...PALETA, zdarzenia: PALETA.zdarzenia.filter(z => z.action !== 'cold_storage') }
    expect(etapyPalety(bezMrozni).find(e => e.kod === 'paleta')!.stan).toBe('pusty')
  })

  it('etap ze zdarzeniami ma stan "jest"', () => {
    expect(etapyPalety(PALETA).find(e => e.kod === 'wydanie')!.stan).toBe('jest')
  })

  it('nieznana akcja nie znika — ląduje na wydaniu', () => {
    /** Nowy rodzaj skanu dodany w hali nie może wyparować ze śladu tylko
     *  dlatego, że ta funkcja go jeszcze nie zna. */
    const dziwna = { ...PALETA, zdarzenia: [
      { action: 'cos_nowego', scanned_at: '2026-09-23T11:00:00Z', operator: '', vehicle: '' },
    ] }
    expect(etapyPalety(dziwna).find(e => e.kod === 'wydanie')!.zdarzenia).toHaveLength(1)
  })

  it('paleta bez żadnych zdarzeń ma wszystkie etapy puste, a nie znika', () => {
    const nietknieta = { ...PALETA, zdarzenia: [] }
    expect(etapyPalety(nietknieta)).toHaveLength(5)
    expect(etapyPalety(nietknieta).every(e => e.zdarzenia.length === 0)).toBe(true)
  })
})
