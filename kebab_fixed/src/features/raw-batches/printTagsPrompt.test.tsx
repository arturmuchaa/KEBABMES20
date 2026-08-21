// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { PrintTagsPrompt } from './components/PrintTagsPrompt'

/**
 * Po zarejestrowaniu dostawy biuro musi od razu dostać pytanie o zawieszki —
 * palety jadą do chłodni w ciągu kilku minut, a nieoznaczony stos rozpoznaje
 * się potem tylko po pamięci magazyniera.
 */

function pokaz(props: Partial<React.ComponentProps<typeof PrintTagsPrompt>> = {}) {
  const onPrint = vi.fn()
  const onSkip = vi.fn()
  render(
    <PrintTagsPrompt
      open
      receptionNo={props.receptionNo ?? '12/08/2026'}
      batchNos={props.batchNos ?? ['471', '472']}
      kg={props.kg ?? 9000}
      onPrint={props.onPrint ?? onPrint}
      onSkip={props.onSkip ?? onSkip}
    />,
  )
  return { onPrint, onSkip }
}

afterEach(cleanup)

describe('PrintTagsPrompt — pytanie o druk zawieszek po przyjęciu', () => {
  it('mówi, która dostawa została zapisana', () => {
    pokaz()
    expect(screen.getAllByText(/12\/08\/2026/).length).toBeGreaterThan(0)
  })

  it('wymienia numery porządkowe, na które pójdą zawieszki', () => {
    pokaz()
    expect(screen.getByText(/471/)).toBeTruthy()
    expect(screen.getByText(/472/)).toBeTruthy()
  })

  it('„Drukuj zawieszki" prowadzi do ekranu druku', () => {
    const { onPrint } = pokaz()
    fireEvent.click(screen.getByRole('button', { name: /Drukuj zawieszki/ }))
    expect(onPrint).toHaveBeenCalled()
  })

  it('„Nie teraz" zamyka bez druku — zawieszki zostają do wydrukowania później', () => {
    const { onSkip } = pokaz()
    fireEvent.click(screen.getByRole('button', { name: /Nie teraz/ }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('przypomina, że druk można powtórzyć z rejestru dostaw', () => {
    pokaz()
    expect(screen.getByText(/rejestr/i)).toBeTruthy()
  })
})
