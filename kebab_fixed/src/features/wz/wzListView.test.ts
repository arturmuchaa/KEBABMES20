import { describe, it, expect } from 'vitest'

import { filterWz, rodzajDokumentu, sladDostepny, wzRodzajCounts, wzTabCounts,
         type WzTab } from './wzListView'

/**
 * Rejestr WZ czyta się jak rejestr faktur: aktywne dokumenty w jednym miejscu,
 * anulowane osobno. Wcześniej anulowane leżały w tej samej liście, tylko
 * wyszarzone — przy 12 anulowanych na 34 dokumenty w sierpniu lista przestała
 * być czytelna.
 */
const DOCS = [
  { id: '1', number: 'WZ/1/08/26', buyer_name: 'KRAK-TOL', buyer_nip: '6772447787', status: 'wstepny' },
  { id: '2', number: 'WZ/2/08/26', buyer_name: 'GRASO', buyer_nip: '1111111111', status: 'wstepny' },
  { id: '3', number: 'ANUL WZ/2/08/26', buyer_name: 'MARCIN', buyer_nip: '', status: 'anulowany' },
] as any[]

describe('filterWz — zakładki rejestru WZ', () => {
  it('zakładka aktywnych pomija anulowane', () => {
    expect(filterWz(DOCS, '', 'active').map(d => d.id)).toEqual(['1', '2'])
  })

  it('zakładka anulowanych pokazuje TYLKO anulowane', () => {
    expect(filterWz(DOCS, '', 'cancelled').map(d => d.id)).toEqual(['3'])
  })

  it('szukajka działa w obrębie zakładki, nie przez całą bazę', () => {
    expect(filterWz(DOCS, 'MARCIN', 'active')).toEqual([])
    expect(filterWz(DOCS, 'MARCIN', 'cancelled').map(d => d.id)).toEqual(['3'])
  })

  it('szuka po numerze, odbiorcy i NIP-ie', () => {
    expect(filterWz(DOCS, 'WZ/1', 'active').map(d => d.id)).toEqual(['1'])
    expect(filterWz(DOCS, 'graso', 'active').map(d => d.id)).toEqual(['2'])
    expect(filterWz(DOCS, '6772447787', 'active').map(d => d.id)).toEqual(['1'])
  })

  it('liczniki zakładek liczą całość, nie przefiltrowaną listę', () => {
    expect(wzTabCounts(DOCS)).toEqual({ active: 2, cancelled: 1 })
  })

  it('pusta lista nie wywraca liczników', () => {
    expect(wzTabCounts([])).toEqual({ active: 0, cancelled: 0 })
    expect(filterWz([], 'cokolwiek', 'active' as WzTab)).toEqual([])
  })
})


/**
 * Druga oś rejestru: ZEWNĘTRZNE (WZ klientów) kontra MAGAZYNOWE (WM).
 *
 * Właściciel 22.09.2026: „zmień Dokumenty WZ na Wydania magazynowe oraz dodaj
 * wydania zewnętrzne gdzie będą WZ klientów". Jedna strona z dwiema
 * zakładkami, nie dwa ekrany — jedno zamówienie rodzi OBA dokumenty, a biuro
 * szuka po kliencie i dacie, nie po rodzaju.
 */
const WYDANIA = [
  { id: 'z1', number: 'WZ/21/09/26', buyer_name: 'YALCIN', doc_series: 'WZ', status: 'wstepny' },
  { id: 'm1', number: 'WM/3/09/26',  buyer_name: 'YALCIN', doc_series: 'WM', status: 'wstepny' },
  { id: 's1', number: 'WZ/9/08/26',  buyer_name: 'TRUVA',  status: 'wstepny' }, // sprzed podziału
  { id: 'a1', number: 'WM/1/09/26',  buyer_name: 'POLAT',  doc_series: 'WM', status: 'anulowany' },
] as any[]

describe('rodzajWydania — zewnętrzne kontra magazynowe', () => {
  it('zakładka zewnętrznych pokazuje WZ klientów', () => {
    expect(filterWz(WYDANIA, '', 'active', 'zewnetrzne').map(d => d.id)).toEqual(['z1', 's1'])
  })

  it('zakładka magazynowych pokazuje WM', () => {
    expect(filterWz(WYDANIA, '', 'active', 'magazynowe').map(d => d.id)).toEqual(['m1'])
  })

  it('DOKUMENT BEZ SERII to zewnętrzny — inaczej znika cała historia sprzed 09.2026', () => {
    expect(rodzajDokumentu({ number: 'WZ/9/08/26' } as any)).toBe('zewnetrzne')
  })

  it('bez podanego rodzaju zachowuje się jak dotąd — zgodność wstecz', () => {
    expect(filterWz(WYDANIA, '', 'active').map(d => d.id)).toEqual(['z1', 'm1', 's1'])
  })

  it('anulowane dalej odpadają, niezależnie od rodzaju', () => {
    expect(filterWz(WYDANIA, '', 'active', 'magazynowe').map(d => d.id)).toEqual(['m1'])
    expect(filterWz(WYDANIA, '', 'cancelled', 'magazynowe').map(d => d.id)).toEqual(['a1'])
  })

  it('szukanie działa W OBRĘBIE rodzaju', () => {
    expect(filterWz(WYDANIA, 'YALCIN', 'active', 'magazynowe').map(d => d.id)).toEqual(['m1'])
  })

  it('liczniki liczą osobno dla każdego rodzaju', () => {
    expect(wzRodzajCounts(WYDANIA, 'active')).toEqual({ zewnetrzne: 2, magazynowe: 1 })
  })
})

// ─── Ślad skanowania: na KTÓRYCH dokumentach go pokazać ──────────────
//
// Zgłoszenie właściciela 24.09.2026, DRUGIE w tej sprawie: „dalej nie widzę
// w wydaniach historii skanów kebabów". Ślad istniał i dane były kompletne
// (WM/10 — 9 skanów na 3 paletach, WZ/83 — 27 na 13), ale link rysował się
// wyłącznie na zakładce „Magazynowe (WM)", a ekran otwiera się na
// „Zewnętrzne (WZ)". Szukający nie widział NICZEGO.
describe('sladDostepny', () => {
  it('dokument z zamówienia ma ślad — także WZ dla klienta', () => {
    // WZ/83 realnie ma 27 skanów; zakładka, na której leży, nie jest
    // powodem, żeby je chować.
    expect(sladDostepny({ doc_series: 'WZ', source_id: 'ord1' })).toBe(true)
  })

  it('wydanie magazynowe z zamówienia ma ślad', () => {
    expect(sladDostepny({ doc_series: 'WM', source_id: 'ord1' })).toBe(true)
  })

  it('dokument ręczny nie ma śladu — nie ma zamówienia, nie ma palet', () => {
    expect(sladDostepny({ doc_series: 'WZ', source_type: 'manual' })).toBe(false)
  })

  it('puste źródło liczy się jak brak', () => {
    expect(sladDostepny({ doc_series: 'WM', source_id: '' })).toBe(false)
  })

  it('czyta też zapis camelCase z API', () => {
    expect(sladDostepny({ doc_series: 'WM', sourceId: 'ord1' })).toBe(true)
  })
})
