import { describe, it, expect } from 'vitest'
import { mozliweHdiDoWz } from './hdiDostepne'

/**
 * Kto dostaje przycisk „HDI" na liście WZ (zgłoszenie właściciela 29.08.2026).
 *
 * Handlowy dokument identyfikacyjny wystawiamy tylko do WYROBU (kebab).
 * Uboczne — grzbiety, kości, mięso z/s — mają identyfikację partii w sekcji
 * HDI drukowanej NA SAMYM WZ (patrz `hdiRows.ts`), więc osobny dokument jest
 * im niepotrzebny. Wcześniej przycisk stał przy każdym ręcznym WZ i klik na
 * ubocznych kończył się komunikatem błędu z backendu.
 */
describe('mozliweHdiDoWz — komu wolno wystawić HDI', () => {
  const wz = (extra: any = {}) =>
    ({ source_type: 'manual', status: 'wstepny', has_fg: true, ...extra }) as any

  it('ręczny WZ z wyrobem gotowym — tak', () => {
    expect(mozliweHdiDoWz(wz())).toBe(true)
  })

  it('WZ tylko z ubocznymi — nie, HDI ma na sobie sam WZ', () => {
    expect(mozliweHdiDoWz(wz({ has_fg: false }))).toBe(false)
  })

  it('WZ z zamówienia — nie, HDI idzie z zamówienia (liczone z produkcji)', () => {
    expect(mozliweHdiDoWz(wz({ source_type: 'order' }))).toBe(false)
  })

  it('WZ anulowany — nie', () => {
    expect(mozliweHdiDoWz(wz({ status: 'anulowany' }))).toBe(false)
  })

  it('starszy backend bez pola has_fg — nie chowamy przycisku', () => {
    // Ekran biura bywa świeższy niż backend na serwerze; brak informacji nie
    // może odebrać biuru dokumentu, który wcześniej dawało się wystawić.
    expect(mozliweHdiDoWz(wz({ has_fg: undefined }))).toBe(true)
  })
})
