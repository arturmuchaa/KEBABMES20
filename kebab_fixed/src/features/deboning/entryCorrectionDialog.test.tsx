// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EntryCorrectionDialog } from './EntryFixDialogs'

/**
 * Korekta wpisu rozbioru z biura — okno, w którym wpisane kilogramy idą
 * prosto do księgi i do wydajności partii.
 *
 * Dlaczego akurat to okno ma test komponentu: 21.07.2026 korekta biurowa
 * nadpisała ZMIERZONE wagi (154,5 kg z dwóch ważeń zniknęło pod 97,0 kg),
 * a 22.07.2026 panel korekt rozjechał cały audyt rozbioru. Pole, które
 * wstaje z pustą albo cudzą liczbą, jest tu groźniejsze niż brzydki układ.
 */

vi.mock('@/lib/apiClient', () => ({
  usersApi: { list: () => Promise.resolve([]) },
  deboningEntriesApi: {
    corrections: () => Promise.resolve([]),
    correct: vi.fn(),
  },
}))

afterEach(cleanup)

const WPIS = {
  id: 'e1',
  workerId: 'w1',
  workerName: 'ANATOLII',
  kgQuarter: 330,
  kgMeat: 214.5,
  rawBatchNo: '493',
  createdAt: '2026-08-19T06:12:00Z',
} as any

describe('EntryCorrectionDialog — korekta wpisu rozbioru', () => {
  it('startuje ZMIERZONYMI kilogramami wpisu, nie pustymi polami', () => {
    render(<EntryCorrectionDialog entry={WPIS} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByDisplayValue('330')).toBeTruthy()
    expect(screen.getByDisplayValue('214.5')).toBeTruthy()
  })

  it('pokazuje wydajność liczoną z tych kilogramów', () => {
    // 214,5 / 330 = 65% — operator widzi od razu, czy korekta ma sens,
    // zanim zapisze ją do księgi.
    render(<EntryCorrectionDialog entry={WPIS} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getAllByText(/65/).length).toBeGreaterThan(0)
  })
})
