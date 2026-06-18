import { describe, it, expect } from 'vitest'
import { summarizeSync, type SyncResult } from './summarizeSync'

describe('summarizeSync — raport po dosłaniu kolejki', () => {
  it('liczy wysłane i odrzucone', () => {
    const results: SyncResult[] = [
      { code: 'U|a', ok: true },
      { code: 'U|b', ok: true },
      { code: 'U|c', ok: false, reason: 'dubel' },
    ]
    const s = summarizeSync(results)
    expect(s.sent).toBe(2)
    expect(s.rejected).toBe(1)
    expect(s.details).toEqual([{ code: 'U|c', reason: 'dubel' }])
  })

  it('pusta lista → zera', () => {
    const s = summarizeSync([])
    expect(s).toEqual({ sent: 0, rejected: 0, details: [] })
  })

  it('wszystkie OK → brak szczegółów odrzuceń', () => {
    const s = summarizeSync([{ code: 'U|a', ok: true }])
    expect(s.sent).toBe(1)
    expect(s.rejected).toBe(0)
    expect(s.details).toEqual([])
  })

  it('odrzucenie bez powodu → domyślny opis', () => {
    const s = summarizeSync([{ code: 'U|x', ok: false }])
    expect(s.details).toEqual([{ code: 'U|x', reason: 'odrzucono' }])
  })
})
